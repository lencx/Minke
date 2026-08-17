import type {
  DesktopFilesPort,
} from "@minke/harness-overlay/client/bridge.ts";
import type {
  TabsRuntime,
} from "@minke/harness-overlay/client/tabs/runtime.ts";
import type {
  FileManagerListResult,
  FileManagerEntry,
} from "@minke/harness-overlay/tabs/files-contract.ts";
import {
  isDirectoryEntry,
  isFilesTab,
  type FilesTabPayload,
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

/** Files-specific navigation layered over the content-agnostic Tabs core. */
export class FilesTabsController {
  readonly #tabs: TabsRuntime;
  readonly #desktop: DesktopFilesPort;
  readonly #history = new Map<string, HistoryState>();
  readonly #revision = new Map<string, number>();
  readonly #previewRevision = new Map<string, number>();
  readonly #saveRevision = new Map<string, number>();
  readonly #unsubscribeTabs: () => void;
  #nextId = 0;
  #disposed = false;

  constructor(tabs: TabsRuntime, desktop: DesktopFilesPort) {
    this.#tabs = tabs;
    this.#desktop = desktop;
    this.#unsubscribeTabs = tabs.subscribe(
      () => this.#releaseClosedTabs(),
    );
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
        viewMode: "list",
        tree: {},
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
    if (
      tab === undefined ||
      !isFilesTab(tab) ||
      tab.payload.viewMode === viewMode
    ) {
      return;
    }
    this.#tabs.update<FilesTabPayload>(tabId, {
      payload: {
        ...tab.payload,
        viewMode,
      },
    });
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
    if (tab.payload.previewWidth === next) return;
    this.#tabs.update<FilesTabPayload>(tabId, {
      payload: {
        ...tab.payload,
        previewWidth: next,
      },
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
          loading: true,
          dirty: false,
          saving: false,
        },
      },
    });
    void this.#desktop.preview({ path: entry.path })
      .then((result) => {
        const current = this.#tabs.tab(tabId);
        if (
          this.#disposed ||
          this.#previewRevision.get(tabId) !== revision ||
          current === undefined ||
          !isFilesTab(current) ||
          current.payload.preview?.entry.path !== entry.path
        ) {
          return;
        }
        this.#tabs.update<FilesTabPayload>(tabId, {
          payload: {
            ...current.payload,
            preview: {
              entry,
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
        if (
          this.#disposed ||
          this.#previewRevision.get(tabId) !== revision ||
          current === undefined ||
          !isFilesTab(current) ||
          current.payload.preview?.entry.path !== entry.path
        ) {
          return;
        }
        this.#tabs.update<FilesTabPayload>(tabId, {
          payload: {
            ...current.payload,
            preview: {
              entry,
              loading: false,
              dirty: false,
              saving: false,
              error: errorMessage(error),
            },
          },
        });
      });
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
          saveStatus: undefined,
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
          saveStatus: undefined,
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
              saveStatus: changedAfterSave
                ? undefined
                : "saved",
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
              saveStatus: undefined,
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
        loading: true,
        error: undefined,
      },
    });

    try {
      const result = await this.#desktop.list(
        path === undefined ? {} : { path },
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
  ): void {
    const tab = this.#tabs.tab(tabId);
    if (tab === undefined || !isFilesTab(tab)) return;
    this.#updateTreeDirectory(tabId, path, {
      entries: [],
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
    }
  }
}
