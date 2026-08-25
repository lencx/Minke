import {
  ipcRenderer,
} from "electron";
import {
  fileUrlToAbsoluteLocalPath,
  normalizeUserGestureExternalLinkUrl,
  parseWebTabLocalPathRequest,
  TABS_WEB_EXTERNAL_LINK_CHANNEL,
  TABS_WEB_LOCAL_PATH_CHANNEL,
} from "@minke/harness-overlay/tabs/web-link-contract.ts";

function anchorFromEvent(
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

function requestsAnotherContext(
  event: MouseEvent,
  anchor: HTMLAnchorElement,
): boolean {
  const target = anchor.target.trim().toLowerCase();
  return (
    event.button === 1 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    (
      target !== "" &&
      target !== "_self" &&
      target !== "_parent" &&
      target !== "_top"
    )
  );
}

function stopLink(event: MouseEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function handleLink(event: MouseEvent): void {
  if (
    !event.isTrusted ||
    event.defaultPrevented ||
    (event.type === "click" && event.button !== 0) ||
    (event.type === "auxclick" && event.button !== 1) ||
    event.altKey
  ) {
    return;
  }
  const anchor = anchorFromEvent(event);
  if (
    anchor === undefined ||
    anchor.hasAttribute("download")
  ) {
    return;
  }
  let url: URL;
  try {
    url = new URL(anchor.href);
  } catch {
    return;
  }
  const title =
    anchor.textContent?.replace(/\s+/gu, " ").trim().slice(0, 160) ||
    undefined;
  if (url.protocol === "file:") {
    try {
      const path = fileUrlToAbsoluteLocalPath(
        url,
        process.platform,
      );
      if (path === undefined) return;
      const request = parseWebTabLocalPathRequest({
        path,
        ...(title === undefined ? {} : { title }),
      });
      stopLink(event);
      ipcRenderer.sendToHost(
        TABS_WEB_LOCAL_PATH_CHANNEL,
        request,
      );
    } catch {
      // Chromium retains ownership of malformed or non-local file URLs.
    }
    return;
  }
  if (
    (url.protocol === "http:" || url.protocol === "https:") &&
    !requestsAnotherContext(event, anchor)
  ) {
    return;
  }
  const external = normalizeUserGestureExternalLinkUrl(
    url.toString(),
  );
  if (external === undefined) return;
  stopLink(event);
  ipcRenderer.send(TABS_WEB_EXTERNAL_LINK_CHANNEL, external);
}

window.addEventListener("click", handleLink, true);
window.addEventListener("auxclick", handleLink, true);
