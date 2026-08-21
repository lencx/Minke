import type {
  DesktopFilesPort,
} from "@minke/harness-overlay/client/desktop/index.ts";
import type {
  TabsRuntime,
} from "@minke/harness-overlay/client/tabs/runtime.ts";
import type {
  FileManagerChangeEvent,
  FileManagerListResult,
  FileManagerEntry,
  FileManagerPanelPlacement,
  FileManagerPreviewResult,
  FileManagerViewStateUpdate,
} from "@minke/harness-overlay/tabs/files-contract.ts";
import {
  isDirectoryEntry,
  isFilesTab,
  type FilesExplorerPosition,
  type FilesTabPayload,
  type FilesPreviewMode,
  type FilesTreeDirectoryState,
  type FilesViewMode,
} from "./types.ts";

interface HistoryState {
  readonly paths: readonly string[];
  readonly index: number;
}

type HistoryTransition =
  | { readonly type: "initial" }
  | { readonly type: "push" }
  | { readonly type: "move"; readonly index: number }
  | { readonly type: "reload" };

function pathTitle(path: string): string {
  const withoutTrailingSeparators = path.replace(
    /[\\/]+$/u,
    "",
  );
  if (withoutTrailingSeparators === "") return path;
  const parts = withoutTrailingSeparators.split(/[\\/]/u);
  return parts.at(-1) ?? path;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parentPath(path: string): string {
  const withoutTrailingSeparators = path.replace(/[\\/]+$/u, "");
  const lastSeparator = Math.max(
    withoutTrailingSeparators.lastIndexOf("/"),
    withoutTrailingSeparators.lastIndexOf("\\"),
  );
  if (lastSeparator < 0) return withoutTrailingSeparators;
  if (lastSeparator === 0) {
    return withoutTrailingSeparators.slice(0, 1);
  }
  if (
    lastSeparator === 2 &&
    /^[A-Za-z]:[\\/]/u.test(withoutTrailingSeparators)
  ) {
    return withoutTrailingSeparators.slice(0, 3);
  }
  return withoutTrailingSeparators.slice(0, lastSeparator);
}

function directlyContains(directory: string, path: string): boolean {
  return path === directory || parentPath(path) === directory;
}

function isAbsoluteFilePath(path: string): boolean {
  return (
    path.startsWith("/") ||
    /^[A-Za-z]:[\\/]/u.test(path) ||
    path.startsWith("\\\\")
  );
}

/** Files-specific navigation layered over the content-agnostic Tabs core. */
export class FilesTabsController {
  readonly #tabs: TabsRuntime;
  readonly #desktop: DesktopFilesPort;
  readonly #history = new Map<string, HistoryState>();
  readonly #revision = new Map<string, number>();
  readonly #previewRevision = new Map<string, number>();
  readonly #saveRevision = new Map<string, number>();
  readonly #watchSubscriptions = new Map<
    string,
    {
      readonly key: string;
      readonly dispose: () => void;
    }
  >();
  readonly #unsubscribeTabs: () => void;
  readonly #placement: FileManagerPanelPlacement;
  #nextId = 0;
  #defaultExplorerPosition: FilesExplorerPosition = "left";
  #defaultPreviewWidth: number | undefined;
  #defaultViewMode: FilesViewMode = "list";
  #explorerPositionStateRevision = 0;
  #previewWidthStateRevision = 0;
  #viewModeStateRevision = 0;
  #disposed = false;

  constructor(
    tabs: TabsRuntime,
    desktop: DesktopFilesPort,
    options: {
      readonly placement?: FileManagerPanelPlacement;
    } = {},
  ) {
    this.#tabs = tabs;
    this.#desktop = desktop;
    this.#placement = options.placement ?? "right";
    this.#unsubscribeTabs = tabs.subscribe(() => {
      this.#releaseClosedTabs();
      this.#syncWatches();
    });
    this.#hydrateViewState();
  }

  create(path: string | undefined, title: string): string | undefined {
    if (this.#disposed || !this.#desktop.available) return undefined;
    const tabId = this.#tabs.open<FilesTabPayload>({
      kind: "files",
      key: `files:${++this.#nextId}`,
      title,
      payload: {
        ...(path === undefined ? {} : { path }),
        entries: [],
        explorerPosition: this.#defaultExplorerPosition,
        viewMode: this.#defaultViewMode,
        tree: {},
        ...(this.#defaultPreviewWidth === undefined
          ? {}
          : { previewWidth: this.#defaultPreviewWidth }),
        loading: true,
        truncated: false,
        canGoBack: false,
        canGoForward: false,
      },
    });
    if (tabId === undefined) return undefined;
    void this.#load(tabId, path, { type: "initial" });
    return tabId;
  }

  openFile(path: string, title: string): string | undefined {
    if (
      this.#disposed ||
      !this.#desktop.available ||
      !isAbsoluteFilePath(path)
    ) {
      return undefined;
    }
    const snapshot = this.#tabs.getSnapshot();
    const activeCandidate = snapshot.tabs.find(
      (tab) => tab.id === snapshot.activeId,
    );
    const active =
      activeCandidate !== undefined && isFilesTab(activeCandidate)
        ? activeCandidate
        : undefined;
    const reusable = snapshot.tabs.find((tab) => {
      if (!isFilesTab(tab)) return false;
      const preview = tab.payload.preview;
      return (
        preview === undefined ||
        preview.entry.path === path ||
        (!preview.dirty && !preview.saving)
      );
    });
    const candidate = active !== undefined &&
        (
          active.payload.preview === undefined ||
          active.payload.preview.entry.path === path ||
          (
            !active.payload.preview.dirty &&
            !active.payload.preview.saving
          )
        )
      ? active
      : reusable;
    const tabId =
      candidate?.id ??
      this.create(parentPath(path), title);
    if (tabId === undefined) return undefined;
    this.#tabs.activate(tabId);
    const tab = this.#tabs.tab(tabId);
    if (tab === undefined || !isFilesTab(tab)) return undefined;
    if (tab.payload.preview?.entry.path === path) {
      this.setPreviewMode(tabId, "source");
      return tabId;
    }
    const directory = parentPath(path);
    if (tab.payload.path !== directory) {
      this.navigate(tabId, directory);
    }
    this.preview(tabId, {
      name: pathTitle(path),
      path,
      kind: "file",
    });
    return tabId;
  }

  navigate(tabId: string, path: string): void {
    const tab = this.#tabs.tab(tabId);
    if (tab === undefined || !isFilesTab(tab)) return;
    if (tab.payload.path === path) {
      this.reload(tabId);
      return;
    }
    void this.#load(tabId, path, { type: "push" });
  }

  back(tabId: string): void {
    const history = this.#history.get(tabId);
    if (history === undefined || history.index <= 0) return;
    const index = history.index - 1;
    const path = history.paths[index];
    if (path !== undefined) {
      void this.#load(tabId, path, { type: "move", index });
    }
  }

  forward(tabId: string): void {
    const history = this.#history.get(tabId);
    if (
      history === undefined ||
      history.index >= history.paths.length - 1
    ) {
      return;
    }
    const index = history.index + 1;
    const path = history.paths[index];
    if (path !== undefined) {
      void this.#load(tabId, path, { type: "move", index });
    }
  }

  up(tabId: string): void {
    const tab = this.#tabs.tab(tabId);
    if (
      tab === undefined ||
      !isFilesTab(tab) ||
      tab.payload.parent === undefined
    ) {
      return;
    }
    this.navigate(tabId, tab.payload.parent);
  }

  reload(tabId: string): void {
    const tab = this.#tabs.tab(tabId);
    if (tab === undefined || !isFilesTab(tab)) return;
    void this.#load(tabId, tab.payload.path, {
      type: "reload",
    });
  }

  setViewMode(tabId: string, viewMode: FilesViewMode): void {
    const tab = this.#tabs.tab(tabId);
    if (tab === undefined || !isFilesTab(tab)) return;
    let changed = false;
    if (this.#defaultViewMode !== viewMode) {
      this.#defaultViewMode = viewMode;
      this.#viewModeStateRevision += 1;
      changed = true;
    }
    for (const candidate of this.#tabs.getSnapshot().tabs) {
      if (
        !isFilesTab(candidate) ||
        candidate.payload.viewMode === viewMode
      ) {
        continue;
      }
      changed = true;
      this.#tabs.update<FilesTabPayload>(candidate.id, {
        payload: {
          ...candidate.payload,
          viewMode,
        },
      });
    }
    if (changed) this.#writeViewState({ viewMode });
  }

  setViewLayout(
    tabId: string,
    viewMode: FilesViewMode,
    explorerPosition: FilesExplorerPosition,
  ): void {
    const tab = this.#tabs.tab(tabId);
    if (tab === undefined || !isFilesTab(tab)) return;
    let changed = false;
    if (this.#defaultViewMode !== viewMode) {
      this.#defaultViewMode = viewMode;
      this.#viewModeStateRevision += 1;
      changed = true;
    }
    if (this.#defaultExplorerPosition !== explorerPosition) {
      this.#defaultExplorerPosition = explorerPosition;
      this.#explorerPositionStateRevision += 1;
      changed = true;
    }
    for (const candidate of this.#tabs.getSnapshot().tabs) {
      if (
        !isFilesTab(candidate) ||
        (
          candidate.payload.viewMode === viewMode &&
          candidate.payload.explorerPosition === explorerPosition
        )
      ) {
        continue;
      }
      changed = true;
      this.#tabs.update<FilesTabPayload>(candidate.id, {
        payload: {
          ...candidate.payload,
          explorerPosition,
          viewMode,
        },
      });
    }
    if (changed) {
      this.#writeViewState({ explorerPosition, viewMode });
    }
  }

  setExplorerPosition(
    tabId: string,
    explorerPosition: FilesExplorerPosition,
  ): void {
    const tab = this.#tabs.tab(tabId);
    if (tab === undefined || !isFilesTab(tab)) return;
    let changed = false;
    if (this.#defaultExplorerPosition !== explorerPosition) {
      this.#defaultExplorerPosition = explorerPosition;
      this.#explorerPositionStateRevision += 1;
      changed = true;
    }
    for (const candidate of this.#tabs.getSnapshot().tabs) {
      if (
        !isFilesTab(candidate) ||
        candidate.payload.explorerPosition === explorerPosition
      ) {
        continue;
      }
      changed = true;
      this.#tabs.update<FilesTabPayload>(candidate.id, {
        payload: {
          ...candidate.payload,
          explorerPosition,
        },
      });
    }
    if (changed) this.#writeViewState({ explorerPosition });
  }

  setPreviewWidth(tabId: string, previewWidth: number): void {
    const tab = this.#tabs.tab(tabId);
    if (
      tab === undefined ||
      !isFilesTab(tab) ||
      !Number.isFinite(previewWidth)
    ) {
      return;
    }
    const next = Math.max(0, Math.round(previewWidth));
    if (this.#defaultPreviewWidth !== next) {
      this.#defaultPreviewWidth = next;
      this.#previewWidthStateRevision += 1;
    }
    for (const candidate of this.#tabs.getSnapshot().tabs) {
      if (
        !isFilesTab(candidate) ||
        candidate.payload.previewWidth === next
      ) {
        continue;
      }
      this.#tabs.update<FilesTabPayload>(candidate.id, {
        payload: {
          ...candidate.payload,
          previewWidth: next,
        },
      });
    }
  }

  persistPreviewWidth(tabId: string): void {
    const tab = this.#tabs.tab(tabId);
    if (
      this.#disposed ||
      tab === undefined ||
      !isFilesTab(tab) ||
      tab.payload.previewWidth === undefined
    ) {
      return;
    }
    this.#writeViewState({
      previewWidth: tab.payload.previewWidth,
    });
  }

  toggleTreeDirectory(
    tabId: string,
    entry: FileManagerEntry,
  ): void {
    const tab = this.#tabs.tab(tabId);
    if (
      tab === undefined ||
      !isFilesTab(tab) ||
      !isDirectoryEntry(entry) ||
      tab.payload.path === undefined
    ) {
      return;
    }
    const directory = tab.payload.tree[entry.path];
    if (directory?.expanded === true) {
      this.#updateTreeDirectory(tabId, entry.path, {
        ...directory,
        expanded: false,
      });
      return;
    }
    if (directory !== undefined && directory.error === undefined) {
      this.#updateTreeDirectory(tabId, entry.path, {
        ...directory,
        expanded: true,
      });
      return;
    }
    this.#startTreeDirectoryLoad(
      tabId,
      tab.payload.path,
      entry.path,
    );
  }

  retryTreeDirectory(tabId: string, path: string): void {
    const tab = this.#tabs.tab(tabId);
    if (
      tab === undefined ||
      !isFilesTab(tab) ||
      tab.payload.path === undefined
    ) {
      return;
    }
    this.#startTreeDirectoryLoad(
      tabId,
      tab.payload.path,
      path,
    );
  }

  preview(tabId: string, entry: FileManagerEntry): void {
    this.#startPreview(tabId, entry, "source");
  }

  setPreviewMode(
    tabId: string,
    mode: FilesPreviewMode,
  ): void {
    const tab = this.#tabs.tab(tabId);
    if (tab === undefined || !isFilesTab(tab)) return;
    const preview = tab.payload.preview;
    if (
      preview === undefined ||
      (
        mode === "diff" &&
        (
          preview.result?.kind !== "text" ||
          preview.result.truncated
        )
      )
    ) {
      return;
    }
    const needsComparison =
      mode === "diff" &&
      preview.comparison?.loading !== true &&
      preview.comparison?.result === undefined;
    if (preview.mode === mode && !needsComparison) return;
    const comparison = needsComparison
      ? { loading: true }
      : preview.comparison;
    this.#tabs.update<FilesTabPayload>(tabId, {
      payload: {
        ...tab.payload,
        preview: {
          ...preview,
          mode,
          ...(comparison === undefined
            ? {}
            : { comparison }),
        },
      },
    });
    if (needsComparison) {
      this.#startComparison(
        tabId,
        preview.entry,
        this.#previewRevision.get(tabId) ?? 0,
      );
    }
  }

  updatePreviewDraft(
    tabId: string,
    path: string,
    content: string,
  ): void {
    const tab = this.#tabs.tab(tabId);
    if (tab === undefined || !isFilesTab(tab)) return;
    const preview = tab.payload.preview;
    if (
      preview === undefined ||
      preview.entry.path !== path ||
      preview.result?.kind !== "text" ||
      preview.result.truncated
    ) {
      return;
    }
    const dirty = content !== preview.result.content;
    const draft = dirty ? content : undefined;
    if (
      preview.dirty === dirty &&
      preview.draft === draft &&
      preview.saveError === undefined
    ) {
      return;
    }
    this.#tabs.update<FilesTabPayload>(tabId, {
      payload: {
        ...tab.payload,
        preview: {
          ...preview,
          dirty,
          draft,
          saveError: undefined,
        },
      },
    });
  }

  savePreview(tabId: string): void {
    const tab = this.#tabs.tab(tabId);
    if (tab === undefined || !isFilesTab(tab)) return;
    const preview = tab.payload.preview;
    if (
      this.#disposed ||
      preview === undefined ||
      preview.saving ||
      !preview.dirty ||
      preview.result?.kind !== "text" ||
      preview.result.truncated
    ) {
      return;
    }
    const path = preview.entry.path;
    const content = preview.draft ?? preview.result.content;
    const previewRevision = this.#previewRevision.get(tabId) ?? 0;
    const saveRevision =
      (this.#saveRevision.get(tabId) ?? 0) + 1;
    this.#saveRevision.set(tabId, saveRevision);
    this.#tabs.update<FilesTabPayload>(tabId, {
      payload: {
        ...tab.payload,
        preview: {
          ...preview,
          saving: true,
          saveError: undefined,
        },
      },
    });
    void this.#desktop.write({
      path,
      content,
      expectedVersion: preview.result.version,
    })
      .then((result) => {
        const current = this.#tabs.tab(tabId);
        const currentPreview =
          current !== undefined && isFilesTab(current)
            ? current.payload.preview
            : undefined;
        if (
          this.#disposed ||
          this.#saveRevision.get(tabId) !== saveRevision ||
          this.#previewRevision.get(tabId) !== previewRevision ||
          current === undefined ||
          !isFilesTab(current) ||
          currentPreview === undefined ||
          currentPreview.entry.path !== path ||
          currentPreview.result?.kind !== "text"
        ) {
          return;
        }
        const currentContent =
          currentPreview.draft ??
          currentPreview.result.content;
        const changedAfterSave = currentContent !== content;
        this.#tabs.update<FilesTabPayload>(tabId, {
          payload: {
            ...current.payload,
            preview: {
              ...currentPreview,
              result: {
                ...currentPreview.result,
                path: result.path,
                content,
                size: result.size,
                truncated: false,
                version: result.version,
              },
              draft: changedAfterSave
                ? currentContent
                : undefined,
              dirty: changedAfterSave,
              saving: false,
              saveError: undefined,
              diskChanged: undefined,
            },
          },
        });
      })
      .catch((error: unknown) => {
        const current = this.#tabs.tab(tabId);
        const currentPreview =
          current !== undefined && isFilesTab(current)
            ? current.payload.preview
            : undefined;
        if (
          this.#disposed ||
          this.#saveRevision.get(tabId) !== saveRevision ||
          this.#previewRevision.get(tabId) !== previewRevision ||
          current === undefined ||
          !isFilesTab(current) ||
          currentPreview === undefined ||
          currentPreview.entry.path !== path
        ) {
          return;
        }
        this.#tabs.update<FilesTabPayload>(tabId, {
          payload: {
            ...current.payload,
            preview: {
              ...currentPreview,
              saving: false,
              saveError: errorMessage(error),
            },
          },
        });
      });
  }

  closePreview(tabId: string): void {
    const tab = this.#tabs.tab(tabId);
    if (
      tab === undefined ||
      !isFilesTab(tab) ||
      tab.payload.preview === undefined
    ) {
      return;
    }
    this.#previewRevision.set(
      tabId,
      (this.#previewRevision.get(tabId) ?? 0) + 1,
    );
    this.#saveRevision.set(
      tabId,
      (this.#saveRevision.get(tabId) ?? 0) + 1,
    );
    const {
      preview: removedPreview,
      ...payload
    } = tab.payload;
    void removedPreview;
    this.#tabs.update<FilesTabPayload>(tabId, { payload });
  }

  open(tabId: string, path: string): void {
    if (this.#disposed) return;
    void this.#desktop.open({ path }).catch((error: unknown) => {
      const tab = this.#tabs.tab(tabId);
      if (tab === undefined || !isFilesTab(tab)) return;
      this.#tabs.update<FilesTabPayload>(tabId, {
        payload: {
          ...tab.payload,
          error: errorMessage(error),
        },
      });
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribeTabs();
    this.#history.clear();
    this.#revision.clear();
    this.#previewRevision.clear();
    this.#saveRevision.clear();
    for (const subscription of this.#watchSubscriptions.values()) {
      subscription.dispose();
    }
    this.#watchSubscriptions.clear();
  }

  #hydrateViewState(): void {
    const readViewState = this.#desktop.readViewState;
    if (readViewState === undefined) return;
    const explorerPositionRevision =
      this.#explorerPositionStateRevision;
    const previewWidthRevision =
      this.#previewWidthStateRevision;
    const viewModeRevision = this.#viewModeStateRevision;
    void readViewState.call(this.#desktop)
      .then((state) => {
        if (this.#disposed) return;
        const placementState = state[this.#placement];
        const explorerPosition =
          this.#explorerPositionStateRevision ===
            explorerPositionRevision
            ? placementState?.explorerPosition
            : undefined;
        const previewWidth =
          this.#previewWidthStateRevision ===
            previewWidthRevision
            ? placementState?.previewWidth
            : undefined;
        const viewMode =
          this.#viewModeStateRevision === viewModeRevision
            ? placementState?.viewMode
            : undefined;
        if (
          explorerPosition === undefined &&
          previewWidth === undefined &&
          viewMode === undefined
        ) {
          return;
        }
        if (explorerPosition !== undefined) {
          this.#defaultExplorerPosition = explorerPosition;
        }
        if (previewWidth !== undefined) {
          this.#defaultPreviewWidth = previewWidth;
        }
        if (viewMode !== undefined) {
          this.#defaultViewMode = viewMode;
        }
        for (const tab of this.#tabs.getSnapshot().tabs) {
          if (!isFilesTab(tab)) continue;
          const nextExplorerPosition =
            explorerPosition ?? tab.payload.explorerPosition;
          const nextPreviewWidth =
            previewWidth !== undefined &&
              tab.payload.previewWidth === undefined
              ? previewWidth
              : tab.payload.previewWidth;
          const nextViewMode =
            viewMode ?? tab.payload.viewMode;
          if (
            nextExplorerPosition ===
              tab.payload.explorerPosition &&
            nextPreviewWidth === tab.payload.previewWidth &&
            nextViewMode === tab.payload.viewMode
          ) {
            continue;
          }
          this.#tabs.update<FilesTabPayload>(tab.id, {
            payload: {
              ...tab.payload,
              explorerPosition: nextExplorerPosition,
              ...(nextPreviewWidth === undefined
                ? {}
                : { previewWidth: nextPreviewWidth }),
              viewMode: nextViewMode,
            },
          });
        }
      })
      .catch(() => {
        // Missing or unreadable UI state falls back to responsive defaults.
      });
  }

  #writeViewState(
    update: Omit<FileManagerViewStateUpdate, "placement">,
  ): void {
    const writeViewState = this.#desktop.writeViewState;
    if (this.#disposed || writeViewState === undefined) return;
    void writeViewState.call(this.#desktop, {
      placement: this.#placement,
      ...update,
    }).catch(() => {
      // Files remains usable when best-effort UI-state persistence fails.
    });
  }

  #startPreview(
    tabId: string,
    entry: FileManagerEntry,
    mode: FilesPreviewMode,
  ): void {
    const tab = this.#tabs.tab(tabId);
    if (
      this.#disposed ||
      tab === undefined ||
      !isFilesTab(tab) ||
      isDirectoryEntry(entry)
    ) {
      return;
    }
    const revision =
      (this.#previewRevision.get(tabId) ?? 0) + 1;
    this.#previewRevision.set(tabId, revision);
    this.#saveRevision.set(
      tabId,
      (this.#saveRevision.get(tabId) ?? 0) + 1,
    );
    this.#tabs.update<FilesTabPayload>(tabId, {
      payload: {
        ...tab.payload,
        preview: {
          entry,
          mode,
          loading: true,
          dirty: false,
          saving: false,
          ...(mode === "diff"
            ? { comparison: { loading: true } }
            : {}),
        },
      },
    });
    void this.#desktop.preview({ path: entry.path })
      .then((result) => {
        const current = this.#tabs.tab(tabId);
        const currentPreview =
          current !== undefined && isFilesTab(current)
            ? current.payload.preview
            : undefined;
        if (
          this.#disposed ||
          this.#previewRevision.get(tabId) !== revision ||
          current === undefined ||
          !isFilesTab(current) ||
          currentPreview?.entry.path !== entry.path
        ) {
          return;
        }
        this.#tabs.update<FilesTabPayload>(tabId, {
          payload: {
            ...current.payload,
            preview: {
              ...currentPreview,
              loading: false,
              dirty: false,
              saving: false,
              result,
            },
          },
        });
      })
      .catch((error: unknown) => {
        const current = this.#tabs.tab(tabId);
        const currentPreview =
          current !== undefined && isFilesTab(current)
            ? current.payload.preview
            : undefined;
        if (
          this.#disposed ||
          this.#previewRevision.get(tabId) !== revision ||
          current === undefined ||
          !isFilesTab(current) ||
          currentPreview?.entry.path !== entry.path
        ) {
          return;
        }
        this.#tabs.update<FilesTabPayload>(tabId, {
          payload: {
            ...current.payload,
            preview: {
              ...currentPreview,
              loading: false,
              dirty: false,
              saving: false,
              error: errorMessage(error),
            },
          },
        });
      });
    if (mode === "diff") {
      this.#startComparison(tabId, entry, revision);
    }
  }

  #startComparison(
    tabId: string,
    entry: FileManagerEntry,
    previewRevision: number,
  ): void {
    void this.#desktop.diff({ path: entry.path })
      .then((result) => {
        const current = this.#tabs.tab(tabId);
        const preview =
          current !== undefined && isFilesTab(current)
            ? current.payload.preview
            : undefined;
        if (
          this.#disposed ||
          this.#previewRevision.get(tabId) !== previewRevision ||
          current === undefined ||
          !isFilesTab(current) ||
          preview?.entry.path !== entry.path
        ) {
          return;
        }
        this.#tabs.update<FilesTabPayload>(tabId, {
          payload: {
            ...current.payload,
            preview: {
              ...preview,
              comparison: {
                loading: false,
                result,
              },
            },
          },
        });
      })
      .catch((error: unknown) => {
        const current = this.#tabs.tab(tabId);
        const preview =
          current !== undefined && isFilesTab(current)
            ? current.payload.preview
            : undefined;
        if (
          this.#disposed ||
          this.#previewRevision.get(tabId) !== previewRevision ||
          current === undefined ||
          !isFilesTab(current) ||
          preview?.entry.path !== entry.path
        ) {
          return;
        }
        this.#tabs.update<FilesTabPayload>(tabId, {
          payload: {
            ...current.payload,
            preview: {
              ...preview,
              comparison: {
                loading: false,
                error: errorMessage(error),
              },
            },
          },
        });
      });
  }

  #refreshCleanPreview(
    tabId: string,
    entry: FileManagerEntry,
  ): void {
    const tab = this.#tabs.tab(tabId);
    const preview =
      tab !== undefined && isFilesTab(tab)
        ? tab.payload.preview
        : undefined;
    if (
      this.#disposed ||
      preview === undefined ||
      preview.entry.path !== entry.path ||
      preview.dirty ||
      preview.saving
    ) {
      return;
    }
    const revision =
      (this.#previewRevision.get(tabId) ?? 0) + 1;
    this.#previewRevision.set(tabId, revision);
    void this.#desktop.preview({ path: entry.path })
      .then((result) => {
        const current = this.#tabs.tab(tabId);
        const currentPreview =
          current !== undefined && isFilesTab(current)
            ? current.payload.preview
            : undefined;
        if (
          this.#disposed ||
          this.#previewRevision.get(tabId) !== revision ||
          current === undefined ||
          !isFilesTab(current) ||
          currentPreview === undefined ||
          currentPreview.entry.path !== entry.path ||
          currentPreview.dirty ||
          currentPreview.saving
        ) {
          return;
        }
        if (
          this.#sameTextVersion(currentPreview.result, result)
        ) {
          return;
        }
        const needsComparison =
          currentPreview.mode === "diff" &&
          result.kind === "text" &&
          !result.truncated;
        this.#tabs.update<FilesTabPayload>(tabId, {
          payload: {
            ...current.payload,
            preview: {
              ...currentPreview,
              loading: false,
              dirty: false,
              saving: false,
              result,
              draft: undefined,
              error: undefined,
              saveError: undefined,
              diskChanged: undefined,
              comparison: needsComparison
                ? { loading: true }
                : undefined,
            },
          },
        });
        if (needsComparison) {
          this.#startComparison(tabId, entry, revision);
        }
      })
      .catch(() => {
        // A transient watcher refresh must not unmount a usable editor.
      });
  }

  #sameTextVersion(
    current: FileManagerPreviewResult | undefined,
    next: FileManagerPreviewResult,
  ): boolean {
    return (
      current?.kind === "text" &&
      next.kind === "text" &&
      current.version === next.version
    );
  }

  async #load(
    tabId: string,
    path: string | undefined,
    transition: HistoryTransition,
  ): Promise<void> {
    const tab = this.#tabs.tab(tabId);
    if (
      this.#disposed ||
      tab === undefined ||
      !isFilesTab(tab)
    ) {
      return;
    }
    const revision = (this.#revision.get(tabId) ?? 0) + 1;
    this.#revision.set(tabId, revision);
    this.#tabs.update<FilesTabPayload>(tabId, {
      payload: {
        ...tab.payload,
        loading: transition.type === "initial",
        error: undefined,
      },
    });

    try {
      const result = await this.#desktop.list(
        {
          ...(path === undefined ? {} : { path }),
          includeRepository: true,
        },
      );
      if (
        this.#disposed ||
        this.#revision.get(tabId) !== revision
      ) {
        return;
      }
      const current = this.#tabs.tab(tabId);
      if (current === undefined || !isFilesTab(current)) return;
      const history = this.#commitHistory(
        tabId,
        result,
        transition,
      );
      this.#tabs.update<FilesTabPayload>(tabId, {
        title: pathTitle(result.path),
        payload: {
          path: result.path,
          ...(result.parent === undefined
            ? {}
            : { parent: result.parent }),
          entries: result.entries,
          explorerPosition: current.payload.explorerPosition,
          viewMode: current.payload.viewMode,
          tree: {},
          ...(current.payload.previewWidth === undefined
            ? {}
            : { previewWidth: current.payload.previewWidth }),
          ...(current.payload.preview === undefined
            ? {}
            : { preview: current.payload.preview }),
          loading: false,
          truncated: result.truncated,
          canGoBack: history.index > 0,
          canGoForward:
            history.index < history.paths.length - 1,
          ...(result.repository === undefined
            ? {}
            : { repository: result.repository }),
        },
      });
    } catch (error: unknown) {
      if (
        this.#disposed ||
        this.#revision.get(tabId) !== revision
      ) {
        return;
      }
      const current = this.#tabs.tab(tabId);
      if (current === undefined || !isFilesTab(current)) return;
      this.#tabs.update<FilesTabPayload>(tabId, {
        payload: {
          ...current.payload,
          loading: false,
          error: errorMessage(error),
        },
      });
    }
  }

  #commitHistory(
    tabId: string,
    result: FileManagerListResult,
    transition: HistoryTransition,
  ): HistoryState {
    const previous = this.#history.get(tabId);
    let next: HistoryState;
    if (transition.type === "initial" || previous === undefined) {
      next = { paths: [result.path], index: 0 };
    } else if (transition.type === "push") {
      const currentPath = previous.paths[previous.index];
      if (currentPath === result.path) {
        next = previous;
      } else {
        next = {
          paths: [
            ...previous.paths.slice(0, previous.index + 1),
            result.path,
          ],
          index: previous.index + 1,
        };
      }
    } else if (transition.type === "move") {
      const paths = [...previous.paths];
      paths[transition.index] = result.path;
      next = { paths, index: transition.index };
    } else {
      const paths = [...previous.paths];
      paths[previous.index] = result.path;
      next = { paths, index: previous.index };
    }
    this.#history.set(tabId, next);
    return next;
  }

  #updateTreeDirectory(
    tabId: string,
    path: string,
    directory: FilesTreeDirectoryState,
  ): void {
    const tab = this.#tabs.tab(tabId);
    if (tab === undefined || !isFilesTab(tab)) return;
    this.#tabs.update<FilesTabPayload>(tabId, {
      payload: {
        ...tab.payload,
        tree: {
          ...tab.payload.tree,
          [path]: directory,
        },
      },
    });
  }

  #startTreeDirectoryLoad(
    tabId: string,
    rootPath: string,
    path: string,
    preserveEntries = false,
  ): void {
    const tab = this.#tabs.tab(tabId);
    if (tab === undefined || !isFilesTab(tab)) return;
    const previous = tab.payload.tree[path];
    this.#updateTreeDirectory(tabId, path, {
      entries:
        preserveEntries && previous !== undefined
          ? previous.entries
          : [],
      expanded: true,
      loading: true,
      truncated: false,
    });
    void this.#desktop.list({ path })
      .then((result) => {
        const current = this.#tabs.tab(tabId);
        if (
          this.#disposed ||
          current === undefined ||
          !isFilesTab(current) ||
          current.payload.path !== rootPath
        ) {
          return;
        }
        const directory = current.payload.tree[path];
        if (directory === undefined) return;
        this.#updateTreeDirectory(tabId, path, {
          entries: result.entries,
          expanded: directory.expanded,
          loading: false,
          truncated: result.truncated,
        });
      })
      .catch((error: unknown) => {
        const current = this.#tabs.tab(tabId);
        if (
          this.#disposed ||
          current === undefined ||
          !isFilesTab(current) ||
          current.payload.path !== rootPath
        ) {
          return;
        }
        const directory = current.payload.tree[path];
        if (directory === undefined) return;
        this.#updateTreeDirectory(tabId, path, {
          entries: [],
          expanded: directory.expanded,
          loading: false,
          truncated: false,
          error: errorMessage(error),
        });
      });
  }

  #releaseClosedTabs(): void {
    const tracked = new Set([
      ...this.#history.keys(),
      ...this.#revision.keys(),
      ...this.#previewRevision.keys(),
      ...this.#saveRevision.keys(),
    ]);
    for (const tabId of tracked) {
      if (this.#tabs.tab(tabId) !== undefined) continue;
      this.#history.delete(tabId);
      this.#revision.delete(tabId);
      this.#previewRevision.delete(tabId);
      this.#saveRevision.delete(tabId);
      this.#watchSubscriptions.get(tabId)?.dispose();
      this.#watchSubscriptions.delete(tabId);
    }
  }

  #watchDirectories(tabId: string): readonly string[] {
    const tab = this.#tabs.tab(tabId);
    if (tab === undefined || !isFilesTab(tab)) return [];
    const paths = new Set<string>();
    if (tab.payload.path !== undefined) {
      paths.add(tab.payload.path);
    }
    for (const [path, directory] of Object.entries(
      tab.payload.tree,
    )) {
      if (directory?.expanded === true) paths.add(path);
    }
    if (tab.payload.preview !== undefined) {
      paths.add(parentPath(tab.payload.preview.entry.path));
    }
    return [...paths].sort();
  }

  #syncWatches(): void {
    if (this.#disposed) return;
    for (const tab of this.#tabs.getSnapshot().tabs) {
      if (!isFilesTab(tab)) continue;
      const paths = this.#watchDirectories(tab.id);
      const key = paths.join("\0");
      const previous = this.#watchSubscriptions.get(tab.id);
      if (previous?.key === key) continue;
      previous?.dispose();
      this.#watchSubscriptions.delete(tab.id);
      if (paths.length === 0) continue;
      const dispose = this.#desktop.watch(
        paths,
        (event) => this.#handleDiskChange(tab.id, event),
      );
      this.#watchSubscriptions.set(tab.id, { key, dispose });
    }
  }

  #handleDiskChange(
    tabId: string,
    event: FileManagerChangeEvent,
  ): void {
    const tab = this.#tabs.tab(tabId);
    if (
      this.#disposed ||
      tab === undefined ||
      !isFilesTab(tab)
    ) {
      return;
    }
    const affectedDirectories = this.#watchDirectories(tabId)
      .filter((directory) =>
        event.paths.some((path) =>
          directlyContains(directory, path)
        )
      );
    for (const directory of affectedDirectories) {
      if (directory === tab.payload.path) {
        void this.#load(tabId, directory, { type: "reload" });
      } else if (tab.payload.tree[directory]?.expanded === true) {
        this.#startTreeDirectoryLoad(
          tabId,
          tab.payload.path ?? directory,
          directory,
          true,
        );
      }
    }

    const preview = tab.payload.preview;
    if (
      preview === undefined ||
      preview.saving ||
      !event.paths.some((path) =>
        path === preview.entry.path ||
        path === parentPath(preview.entry.path)
      )
    ) {
      return;
    }
    if (!preview.dirty) {
      this.#refreshCleanPreview(tabId, preview.entry);
      return;
    }
    const current = this.#tabs.tab(tabId);
    if (
      current === undefined ||
      !isFilesTab(current) ||
      current.payload.preview?.entry.path !==
        preview.entry.path
    ) {
      return;
    }
    this.#tabs.update<FilesTabPayload>(tabId, {
      payload: {
        ...current.payload,
        preview: {
          ...current.payload.preview,
          diskChanged: true,
        },
      },
    });
  }
}
