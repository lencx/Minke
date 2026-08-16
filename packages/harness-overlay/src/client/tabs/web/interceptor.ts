import {
  normalizeWebTabUrl,
} from "@minke/harness-overlay/tabs/contract.ts";
import type {
  WebTabsController,
} from "./controller.ts";

function anchorFromClick(
  event: MouseEvent,
): HTMLAnchorElement | undefined {
  for (const candidate of event.composedPath()) {
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      "tagName" in candidate &&
      candidate.tagName === "A"
    ) {
      return candidate as HTMLAnchorElement;
    }
  }
  return undefined;
}

/**
 * Turn safe HTTP(S) anchors anywhere in the Harness surface into Web tabs.
 * Modified primary clicks retain familiar browser semantics by opening the
 * tab in the background.
 */
export function installWebLinkTabs(
  controller: WebTabsController,
  root: Document = document,
): () => void {
  const view = root.defaultView;
  if (view === null) return () => {};

  const handleClick = (event: MouseEvent): void => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.altKey
    ) {
      return;
    }
    const anchor = anchorFromClick(event);
    if (
      anchor === undefined ||
      anchor.hasAttribute("download")
    ) {
      return;
    }
    const url = normalizeWebTabUrl(anchor.href);
    if (url === undefined) return;

    event.preventDefault();
    event.stopPropagation();
    controller.open(
      url,
      anchor.textContent ?? undefined,
      { activate: !(event.metaKey || event.ctrlKey) },
    );
  };

  root.addEventListener("click", handleClick, true);
  return () => {
    root.removeEventListener("click", handleClick, true);
  };
}
