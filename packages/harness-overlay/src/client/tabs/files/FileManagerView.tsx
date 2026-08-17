import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type {
  FileManagerEntry,
} from "@minke/harness-overlay/tabs/files-contract.ts";
import type {
  FilesTabsController,
} from "./controller.ts";
import {
  FilePreviewPane,
} from "./FilePreviewPane.tsx";
import {
  FileTreeView,
} from "./FileTreeView.tsx";
import {
  DirectoryIcon,
  EnterDirectoryIcon,
  FileIcon,
  FilesIcon,
  OtherFileIcon,
  SymlinkIcon,
} from "./icons.tsx";
import type {
  FilesTabsTranslate,
} from "./locales.ts";
import {
  clampFilesPreviewWidth,
  defaultFilesPreviewWidth,
  FILES_EXPLORER_MIN_WIDTH,
  FILES_PREVIEW_MIN_WIDTH,
  FILES_PREVIEW_RESIZE_HANDLE_WIDTH,
} from "./preview-resize.ts";
import type {
  FilesTab,
} from "./types.ts";
import {
  isDirectoryEntry,
} from "./types.ts";

function entryIcon(entry: FileManagerEntry): ReactNode {
  if (entry.kind === "directory") {
    return <DirectoryIcon name={entry.name} size={16} />;
  }
  if (entry.kind === "file") {
    return <FileIcon name={entry.name} size={16} />;
  }
  if (entry.kind === "symlink") {
    return <SymlinkIcon size={16} />;
  }
  return <OtherFileIcon size={16} />;
}

export function FileManagerView(props: {
  readonly tab: FilesTab;
  readonly active: boolean;
  readonly controller: FilesTabsController;
  readonly t: FilesTabsTranslate;
}): ReactNode {
  const { tab, active, controller, t } = props;
  const { entries, error, loading, truncated } = tab.payload;
  const preview = tab.payload.preview;
  const hasPreview = preview !== undefined;
  const browserRef = useRef<HTMLDivElement | null>(null);
  const [previewWidth, setPreviewWidth] = useState<
    number | undefined
  >(tab.payload.previewWidth);
  const [browserWidth, setBrowserWidth] = useState(0);
  const [resizingPreview, setResizingPreview] = useState(false);
  const explorerId = `minke-files-explorer-${tab.id}`;
  const previewId = `minke-files-preview-${tab.id}`;

  useLayoutEffect(() => {
    if (!hasPreview || !active) return;
    const browser = browserRef.current;
    const view = browser?.ownerDocument.defaultView;
    if (browser === null || view === null || view === undefined) {
      return;
    }
    const sync = (): void => {
      const containerWidth = browser.getBoundingClientRect().width;
      if (containerWidth <= 0) return;
      setBrowserWidth(containerWidth);
      setPreviewWidth((current) => {
        const next = clampFilesPreviewWidth(
          containerWidth,
          current ??
            tab.payload.previewWidth ??
            defaultFilesPreviewWidth(containerWidth),
        );
        return current === next ? current : next;
      });
    };
    sync();
    const observer = new view.ResizeObserver(sync);
    observer.observe(browser);
    return () => observer.disconnect();
  }, [active, hasPreview, tab.payload.previewWidth]);

  const commitPreviewWidth = (width: number): void => {
    setPreviewWidth(width);
    controller.setPreviewWidth(tab.id, width);
  };

  const resizePreviewAt = (clientX: number): void => {
    const bounds = browserRef.current?.getBoundingClientRect();
    if (bounds === undefined) return;
    commitPreviewWidth(
      clampFilesPreviewWidth(
        bounds.width,
        bounds.right -
          clientX -
          FILES_PREVIEW_RESIZE_HANDLE_WIDTH / 2,
      ),
    );
  };
  const releasePreviewResize = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setResizingPreview(false);
  };
  const previewEntry = (entry: FileManagerEntry): void => {
    if (preview?.entry.path === entry.path) return;
    if (preview?.saving) return;
    if (preview?.dirty) {
      const view = browserRef.current?.ownerDocument.defaultView;
      if (
        view !== undefined &&
        view !== null &&
        !view.confirm(
          t("files.preview.discardConfirm", {
            name: preview.entry.name,
          }),
        )
      ) {
        return;
      }
    }
    controller.preview(tab.id, entry);
  };
  const activate = (entry: FileManagerEntry): void => {
    if (isDirectoryEntry(entry)) {
      controller.navigate(tab.id, entry.path);
    } else {
      previewEntry(entry);
    }
  };
  return (
    <div
      id={`minke-tab-view-${tab.id}`}
      className="minke-tabs-view minke-files-view"
      data-mode={tab.payload.viewMode}
      data-preview={preview === undefined ? undefined : ""}
      role="tabpanel"
      aria-labelledby={`minke-tab-${tab.id}`}
      hidden={!active}
    >
      <div
        ref={browserRef}
        className="minke-files-browser"
        data-resizing={resizingPreview || undefined}
      >
        <section
          id={explorerId}
          className="minke-files-explorer"
          aria-label={t(
            tab.payload.viewMode === "tree"
              ? "files.mode.tree"
              : "files.mode.list",
          )}
        >
          {loading && entries.length === 0 ? (
            <div className="minke-files-state" role="status">
              <span
                className="minke-files-state__pulse"
                aria-hidden="true"
              >
                <FilesIcon size={22} />
              </span>
              <span>
                {t("files.state.loading", {
                  path: tab.payload.path ?? "",
                })}
              </span>
            </div>
          ) : error !== undefined && entries.length === 0 ? (
            <div className="minke-tabs-error" role="alert">
              <h2>{t("files.error.title")}</h2>
              <p>{error}</p>
              <div className="minke-tabs-error__actions">
                <button
                  type="button"
                  onClick={() => controller.reload(tab.id)}
                >
                  {t("files.error.retry")}
                </button>
              </div>
            </div>
          ) : entries.length === 0 ? (
            <div className="minke-files-state">
              <span
                className="minke-files-state__empty"
                aria-hidden="true"
              >
                <DirectoryIcon size={24} />
              </span>
              <strong>{t("files.empty.title")}</strong>
              <span>{t("files.empty.body")}</span>
            </div>
          ) : (
            <>
              {error !== undefined && (
                <div
                  className="minke-files-inline-error"
                  role="alert"
                >
                  <span>{error}</span>
                  <button
                    type="button"
                    onClick={() => controller.reload(tab.id)}
                  >
                    {t("files.error.retry")}
                  </button>
                </div>
              )}
              {tab.payload.viewMode === "tree" ? (
                <FileTreeView
                  tab={tab}
                  controller={controller}
                  t={t}
                  onPreview={previewEntry}
                />
              ) : (
                <ul className="minke-files-list">
                  {entries.map((entry) => {
                    const selected =
                      preview?.entry.path === entry.path;
                    return (
                      <li
                        key={entry.path}
                        className="minke-files-list__item"
                      >
                        <button
                          type="button"
                          className="minke-files-row"
                          data-kind={entry.kind}
                          data-hidden={
                            entry.name.startsWith(".") ||
                            undefined
                          }
                          data-selected={selected || undefined}
                          aria-label={t(
                            isDirectoryEntry(entry)
                              ? "files.entry.open"
                              : "files.entry.preview",
                            { name: entry.name },
                          )}
                          title={entry.path}
                          onClick={() => activate(entry)}
                        >
                          <span
                            className="minke-files-row__icon"
                            aria-hidden="true"
                          >
                            {entryIcon(entry)}
                          </span>
                          <span className="minke-files-row__name">
                            {entry.name}
                          </span>
                          {isDirectoryEntry(entry) && (
                            <span
                              className="minke-files-row__enter"
                              aria-hidden="true"
                            >
                              <EnterDirectoryIcon size={13} />
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {truncated && (
                <div className="minke-files-limit" role="status">
                  {t("files.limit")}
                </div>
              )}
            </>
          )}
        </section>
        {preview !== undefined && (
          <>
            <div
              className="minke-files-preview-resize"
              role="separator"
              aria-label={t("files.preview.resize")}
              aria-controls={`${explorerId} ${previewId}`}
              aria-orientation="vertical"
              aria-valuemin={Math.min(
                FILES_PREVIEW_MIN_WIDTH,
                Math.max(
                  0,
                  browserWidth -
                    FILES_EXPLORER_MIN_WIDTH -
                    FILES_PREVIEW_RESIZE_HANDLE_WIDTH,
                ),
              )}
              aria-valuemax={Math.max(
                0,
                browserWidth -
                  FILES_EXPLORER_MIN_WIDTH -
                  FILES_PREVIEW_RESIZE_HANDLE_WIDTH,
              )}
              aria-valuenow={previewWidth}
              tabIndex={0}
              onClick={(event) => event.currentTarget.focus()}
              onDoubleClick={() => {
                const width =
                  browserRef.current?.getBoundingClientRect()
                    .width;
                if (width !== undefined) {
                  commitPreviewWidth(
                    defaultFilesPreviewWidth(width),
                  );
                }
              }}
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(
                  event.pointerId,
                );
                setResizingPreview(true);
                resizePreviewAt(event.clientX);
              }}
              onPointerMove={(event) => {
                if (
                  event.currentTarget.hasPointerCapture(
                    event.pointerId,
                  )
                ) {
                  resizePreviewAt(event.clientX);
                }
              }}
              onPointerUp={releasePreviewResize}
              onPointerCancel={releasePreviewResize}
              onKeyDown={(event) => {
                if (
                  event.key !== "ArrowLeft" &&
                  event.key !== "ArrowRight"
                ) {
                  return;
                }
                event.preventDefault();
                const bounds =
                  browserRef.current?.getBoundingClientRect();
                if (bounds === undefined) return;
                const current =
                  previewWidth ??
                  defaultFilesPreviewWidth(bounds.width);
                const step = event.shiftKey ? 48 : 16;
                commitPreviewWidth(
                  clampFilesPreviewWidth(
                    bounds.width,
                    current +
                      (event.key === "ArrowLeft"
                        ? step
                        : -step),
                  ),
                );
              }}
            />
            <FilePreviewPane
              id={previewId}
              tabId={tab.id}
              preview={preview}
              controller={controller}
              t={t}
              active={active}
              style={
                previewWidth === undefined
                  ? undefined
                  : { flexBasis: previewWidth }
              }
            />
          </>
        )}
      </div>
    </div>
  );
}
