import type {
  CSSProperties,
  ReactNode,
} from "react";
import type {
  FileManagerEntry,
} from "@minke/harness-overlay/tabs/files-contract.ts";
import type {
  FilesTabsController,
} from "./controller.ts";
import {
  CollapseDirectoryIcon,
  DirectoryIcon,
  EnterDirectoryIcon,
  FileIcon,
  OtherFileIcon,
  SymlinkIcon,
} from "./icons.tsx";
import type {
  FilesTabsTranslate,
} from "./locales.ts";
import type {
  FilesTab,
} from "./types.ts";
import {
  isDirectoryEntry,
} from "./types.ts";

function treeEntryIcon(
  entry: FileManagerEntry,
  expanded: boolean,
): ReactNode {
  if (entry.kind === "directory") {
    return (
      <DirectoryIcon
        name={entry.name}
        expanded={expanded}
        size={16}
      />
    );
  }
  if (entry.kind === "file") {
    return <FileIcon name={entry.name} size={16} />;
  }
  if (entry.kind === "symlink") {
    return <SymlinkIcon size={16} />;
  }
  return <OtherFileIcon size={16} />;
}

function TreeEntries(props: {
  readonly tab: FilesTab;
  readonly entries: readonly FileManagerEntry[];
  readonly depth: number;
  readonly controller: FilesTabsController;
  readonly t: FilesTabsTranslate;
  readonly onPreview: (entry: FileManagerEntry) => void;
}): ReactNode {
  const {
    tab,
    entries,
    depth,
    controller,
    t,
    onPreview,
  } = props;
  return entries.map((entry) => {
    const directory = tab.payload.tree[entry.path];
    const directoryEntry = isDirectoryEntry(entry);
    const expanded =
      directoryEntry &&
      directory?.expanded === true;
    const selected =
      tab.payload.preview?.entry.path === entry.path;
    const rowStyle = {
      "--minke-files-depth": depth,
    } as CSSProperties;
    const label =
      directoryEntry
        ? t(
            expanded
              ? "files.entry.collapse"
              : "files.entry.expand",
            { name: entry.name },
          )
        : t("files.entry.preview", { name: entry.name });
    return (
      <li
        key={entry.path}
        className="minke-files-tree__item"
      >
        <button
          type="button"
          className="minke-files-tree-row"
          style={rowStyle}
          data-kind={
            directoryEntry ? "directory" : entry.kind
          }
          data-hidden={entry.name.startsWith(".") || undefined}
          data-selected={selected || undefined}
          aria-label={label}
          aria-expanded={
            directoryEntry ? expanded : undefined
          }
          aria-current={selected ? "true" : undefined}
          title={entry.path}
          onClick={() => {
            if (directoryEntry) {
              controller.toggleTreeDirectory(tab.id, entry);
            } else {
              onPreview(entry);
            }
          }}
        >
          <span
            className="minke-files-tree-row__disclosure"
            aria-hidden="true"
          >
            {directoryEntry &&
              (expanded
                ? <CollapseDirectoryIcon size={13} />
                : <EnterDirectoryIcon size={13} />)}
          </span>
          <span
            className="minke-files-tree-row__icon"
            aria-hidden="true"
          >
            {treeEntryIcon(entry, expanded)}
          </span>
          <span className="minke-files-tree-row__name">
            {entry.name}
          </span>
        </button>
        {expanded && directory !== undefined && (
          <ul className="minke-files-tree__group">
            {directory.loading ? (
              <li
                className="minke-files-tree__message"
                style={{
                  "--minke-files-depth": depth + 1,
                } as CSSProperties}
                role="status"
              >
                {t("files.tree.loading")}
              </li>
            ) : directory.error !== undefined ? (
              <li
                className="minke-files-tree__message"
                style={{
                  "--minke-files-depth": depth + 1,
                } as CSSProperties}
              >
                <button
                  type="button"
                  onClick={() =>
                    controller.retryTreeDirectory(
                      tab.id,
                      entry.path,
                    )}
                >
                  {t("files.tree.retry")}
                </button>
              </li>
            ) : (
              <>
                <TreeEntries
                  tab={tab}
                  entries={directory.entries}
                  depth={depth + 1}
                  controller={controller}
                  t={t}
                  onPreview={onPreview}
                />
                {directory.truncated && (
                  <li
                    className="minke-files-tree__message"
                    style={{
                      "--minke-files-depth": depth + 1,
                    } as CSSProperties}
                    role="status"
                  >
                    {t("files.limit")}
                  </li>
                )}
              </>
            )}
          </ul>
        )}
      </li>
    );
  });
}

export function FileTreeView(props: {
  readonly tab: FilesTab;
  readonly controller: FilesTabsController;
  readonly t: FilesTabsTranslate;
  readonly onPreview: (entry: FileManagerEntry) => void;
}): ReactNode {
  return (
    <ul
      className="minke-files-tree"
      aria-label={props.t("files.mode.tree")}
    >
      <TreeEntries
        tab={props.tab}
        entries={props.tab.payload.entries}
        depth={0}
        controller={props.controller}
        t={props.t}
        onPreview={props.onPreview}
      />
    </ul>
  );
}
