import type {
  ManagedTab,
} from "@minke/harness-overlay/client/tabs/types.ts";
import type {
  FileManagerEntry,
  FileManagerPreviewResult,
} from "@minke/harness-overlay/tabs/files-contract.ts";

export type FilesViewMode = "list" | "tree";

export interface FilesTreeDirectoryState {
  readonly entries: readonly FileManagerEntry[];
  readonly expanded: boolean;
  readonly loading: boolean;
  readonly truncated: boolean;
  readonly error?: string;
}

export interface FilesPreviewState {
  readonly entry: FileManagerEntry;
  readonly loading: boolean;
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly result?: FileManagerPreviewResult;
  readonly draft?: string;
  readonly error?: string;
  readonly saveError?: string;
  readonly saveStatus?: "saved";
  readonly diskChanged?: boolean;
}

export interface FilesTabPayload {
  readonly path?: string;
  readonly parent?: string;
  readonly entries: readonly FileManagerEntry[];
  readonly viewMode: FilesViewMode;
  readonly tree: Readonly<
    Record<string, FilesTreeDirectoryState | undefined>
  >;
  readonly loading: boolean;
  readonly truncated: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly preview?: FilesPreviewState;
  readonly previewWidth?: number;
  readonly error?: string;
}

export type FilesTab = ManagedTab<FilesTabPayload>;

export function isDirectoryEntry(
  entry: FileManagerEntry,
): boolean {
  return (
    entry.kind === "directory" ||
    (entry.kind === "symlink" &&
      entry.targetKind === "directory")
  );
}

export function isFilesTab(tab: ManagedTab): tab is FilesTab {
  return tab.kind === "files";
}
