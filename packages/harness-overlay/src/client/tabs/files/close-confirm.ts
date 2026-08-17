import type {
  ManagedTab,
} from "@minke/harness-overlay/client/tabs/types.ts";
import type {
  FilesTabsTranslate,
} from "./locales.ts";
import {
  isFilesTab,
} from "./types.ts";

export function confirmFilesTabClose(
  tab: ManagedTab,
  t: FilesTabsTranslate,
  confirm: (message: string) => boolean = (message) =>
    globalThis.window?.confirm(message) ?? true,
): boolean {
  if (!isFilesTab(tab)) return true;
  if (tab.payload.preview?.saving) return false;
  if (!tab.payload.preview?.dirty) return true;
  return confirm(
    t("files.preview.discardConfirm", {
      name: tab.payload.preview.entry.name,
    }),
  );
}
