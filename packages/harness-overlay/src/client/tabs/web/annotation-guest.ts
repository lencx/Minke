import {
  AGENT_BROWSER_ANNOTATION_TARGET_LIMIT,
  parseAgentBrowserAnnotationTarget,
  type AgentBrowserAnnotationPage,
  type AgentBrowserAnnotationTarget,
} from "@minke/harness-overlay/agent-browser-annotation-contract.ts";
import {
  normalizeWebTabUrl,
} from "@minke/harness-overlay/tabs/contract.ts";

const WEB_ANNOTATION_RUNTIME_KEY =
  "__minke_web_annotation_runtime_v1__";
const MAX_SCREENSHOT_BASE64_LENGTH = 8 * 1024 * 1024;

export interface WebAnnotationGuestView {
  executeJavaScript(
    code: string,
    userGesture?: boolean,
  ): Promise<unknown>;
  capturePage(): Promise<{
    toDataURL(): string;
  }>;
}

export interface WebAnnotationGuestSelection {
  readonly type: "selected";
  readonly page: AgentBrowserAnnotationPage;
  readonly target: AgentBrowserAnnotationTarget;
}

export interface WebAnnotationGuestRefresh {
  readonly page: AgentBrowserAnnotationPage;
  readonly targets: readonly AgentBrowserAnnotationTarget[];
}

export interface WebAnnotationGuestCapture
  extends WebAnnotationGuestRefresh {
  readonly mimeType: "image/png";
  readonly data: string;
}

const INSTALL_WEB_ANNOTATION_RUNTIME = String.raw`
(() => {
  const key = "__minke_web_annotation_runtime_v1__";
  const prior = globalThis[key];
  if (prior?.version === 1) return true;

  const refs = new Map();
  const ids = new WeakMap();
  let sequence = 0;
  let pendingPromise;
  let pendingResolve;
  let cleanupSelection = () => {};
  let hoverTarget;
  let highlight;

  const clean = (value, limit) =>
    String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, limit);

  const viewport = () => ({
    width: Math.max(1, Math.min(100000, window.innerWidth)),
    height: Math.max(1, Math.min(100000, window.innerHeight)),
  });

  const page = () => ({
    url: String(location.href).slice(0, 8192),
    title: clean(document.title, 160),
    viewport: viewport(),
  });

  const segment = (element) => {
    const tag = clean(element.localName || element.tagName, 80)
      .toLowerCase() || "element";
    const parent = element.parentElement;
    if (!parent) return tag;
    const siblings = Array.from(parent.children).filter(
      (sibling) => sibling.localName === element.localName,
    );
    if (siblings.length <= 1) return tag;
    return tag + ":nth-of-type(" +
      String(siblings.indexOf(element) + 1) + ")";
  };

  const identity = (element) => {
    let id = ids.get(element);
    if (id !== undefined) {
      refs.set(id, element);
      return id;
    }
    if (refs.size >= 1024) return undefined;
    sequence += 1;
    id = "target-" + sequence.toString(36);
    ids.set(element, id);
    refs.set(id, element);
    return id;
  };

  const describe = (element) => {
    if (!(element instanceof Element) || !element.isConnected) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    if (
      !Number.isFinite(rect.x) ||
      !Number.isFinite(rect.y) ||
      rect.width < 0.25 ||
      rect.height < 0.25
    ) {
      return null;
    }
    const selectorParts = [];
    const pathParts = [];
    let current = element;
    for (
      let depth = 0;
      current instanceof Element && depth < 12;
      depth += 1
    ) {
      selectorParts.unshift(segment(current));
      pathParts.unshift(
        clean(current.localName || current.tagName, 80)
          .toLowerCase() || "element",
      );
      const root = current.getRootNode();
      current = current.parentElement ??
        (root instanceof ShadowRoot ? root.host : null);
    }
    const size = viewport();
    const role = clean(element.getAttribute("role"), 80);
    const ariaLabel = clean(
      element.getAttribute("aria-label"),
      500,
    );
    const tag = clean(
      element.localName || element.tagName,
      80,
    ).toLowerCase();
    const targetId = identity(element);
    if (targetId === undefined) return null;
    return {
      targetId,
      tag: tag || "element",
      ...(role === "" ? {} : { role }),
      text: clean(
        element.innerText ?? element.textContent,
        500,
      ),
      ...(ariaLabel === "" ? {} : { ariaLabel }),
      selector: selectorParts.join(" > ").slice(0, 1000) ||
        (tag || "element"),
      path: pathParts.join(" > ").slice(0, 1000) ||
        (tag || "element"),
      position: {
        x: Math.max(
          0,
          Math.min(size.width, rect.x + rect.width / 2),
        ),
        y: Math.max(
          0,
          Math.min(size.height, rect.y + rect.height / 2),
        ),
      },
      rect: {
        x: Math.max(-100000, Math.min(100000, rect.x)),
        y: Math.max(-100000, Math.min(100000, rect.y)),
        width: Math.max(0.25, Math.min(100000, rect.width)),
        height: Math.max(0.25, Math.min(100000, rect.height)),
      },
      viewport: size,
      frame: "top document",
    };
  };

  const ensureHighlight = () => {
    if (highlight?.isConnected) return highlight;
    highlight = document.createElement("div");
    highlight.setAttribute(
      "data-minke-web-annotation-highlight",
      "",
    );
    const style = highlight.style;
    style.setProperty("position", "fixed", "important");
    style.setProperty("z-index", "2147483646", "important");
    style.setProperty("box-sizing", "border-box", "important");
    style.setProperty("pointer-events", "none", "important");
    style.setProperty("border", "2px dashed #0878ff", "important");
    style.setProperty(
      "background",
      "rgb(8 120 255 / 8%)",
      "important",
    );
    style.setProperty("border-radius", "2px", "important");
    style.setProperty("display", "none", "important");
    document.documentElement.append(highlight);
    return highlight;
  };

  const showHighlight = (element) => {
    hoverTarget = element;
    const rect = element.getBoundingClientRect();
    const overlay = ensureHighlight();
    overlay.style.setProperty("display", "block", "important");
    overlay.style.setProperty("left", rect.left + "px", "important");
    overlay.style.setProperty("top", rect.top + "px", "important");
    overlay.style.setProperty("width", rect.width + "px", "important");
    overlay.style.setProperty("height", rect.height + "px", "important");
  };

  const hideHighlight = () => {
    hoverTarget = undefined;
    highlight?.remove();
    highlight = undefined;
  };

  const candidate = (event) => {
    const path = typeof event.composedPath === "function"
      ? event.composedPath()
      : [];
    return path.find(
      (entry) =>
        entry instanceof Element &&
        !entry.hasAttribute(
          "data-minke-web-annotation-highlight",
        ),
    );
  };

  const finish = (result) => {
    cleanupSelection();
    cleanupSelection = () => {};
    hideHighlight();
    const resolve = pendingResolve;
    pendingResolve = undefined;
    pendingPromise = undefined;
    resolve?.(result);
  };

  const select = () => {
    if (pendingPromise !== undefined) return pendingPromise;
    pendingPromise = new Promise((resolve) => {
      pendingResolve = resolve;
    });
    const move = (event) => {
      const element = candidate(event);
      if (element instanceof Element) showHighlight(element);
    };
    const block = (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    const choose = (event) => {
      const element = candidate(event);
      block(event);
      if (!(element instanceof Element)) return;
      const target = describe(element);
      if (target === null) return;
      finish({ type: "selected", page: page(), target });
    };
    const keydown = (event) => {
      if (event.key !== "Escape") return;
      block(event);
      finish({ type: "cancelled" });
    };
    const reposition = () => {
      if (hoverTarget instanceof Element && hoverTarget.isConnected) {
        showHighlight(hoverTarget);
      } else {
        hideHighlight();
      }
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerdown", block, true);
    window.addEventListener("mousedown", block, true);
    window.addEventListener("mouseup", block, true);
    window.addEventListener("click", choose, true);
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("scroll", reposition, true);
    cleanupSelection = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerdown", block, true);
      window.removeEventListener("mousedown", block, true);
      window.removeEventListener("mouseup", block, true);
      window.removeEventListener("click", choose, true);
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("scroll", reposition, true);
    };
    return pendingPromise;
  };

  const pause = () => {
    if (pendingResolve !== undefined) {
      finish({ type: "cancelled" });
    } else {
      cleanupSelection();
      cleanupSelection = () => {};
      hideHighlight();
    }
  };

  const stop = () => {
    pause();
    refs.clear();
  };

  const refresh = (targetIds) => ({
    page: page(),
    targets: targetIds.flatMap((targetId) => {
      const element = refs.get(targetId);
      const target = describe(element);
      return target === null ? [] : [target];
    }),
  });

  const runtime = Object.freeze({
    version: 1,
    page,
    select,
    pause,
    stop,
    refresh,
  });
  Object.defineProperty(globalThis, key, {
    value: runtime,
    configurable: true,
  });
  return true;
})()
`;

function record(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function viewport(
  value: unknown,
): AgentBrowserAnnotationPage["viewport"] {
  const candidate = record(value, "Web annotation viewport");
  const width = candidate.width;
  const height = candidate.height;
  if (
    typeof width !== "number" ||
    !Number.isFinite(width) ||
    width < 1 ||
    width > 100_000 ||
    typeof height !== "number" ||
    !Number.isFinite(height) ||
    height < 1 ||
    height > 100_000
  ) {
    throw new TypeError("Web annotation viewport is invalid");
  }
  return { width, height };
}

function page(value: unknown): AgentBrowserAnnotationPage {
  const candidate = record(value, "Web annotation page");
  const url = typeof candidate.url === "string"
    ? normalizeWebTabUrl(candidate.url)
    : undefined;
  if (url === undefined) {
    throw new TypeError("Web annotation page URL is invalid");
  }
  if (typeof candidate.title !== "string") {
    throw new TypeError("Web annotation page title is invalid");
  }
  return {
    url,
    title: candidate.title.replace(/\s+/gu, " ").trim().slice(0, 160),
    viewport: viewport(candidate.viewport),
  };
}

function runtimeCall(
  method: "page" | "select" | "pause" | "stop" | "refresh",
  argument?: unknown,
): string {
  const key = JSON.stringify(WEB_ANNOTATION_RUNTIME_KEY);
  const args = argument === undefined
    ? ""
    : JSON.stringify(argument);
  return `globalThis[${key}].${method}(${args})`;
}

async function install(view: WebAnnotationGuestView): Promise<void> {
  if (await view.executeJavaScript(
    INSTALL_WEB_ANNOTATION_RUNTIME,
  ) !== true) {
    throw new Error("Could not initialize webpage annotation");
  }
}

export async function readWebAnnotationPage(
  view: WebAnnotationGuestView,
): Promise<AgentBrowserAnnotationPage> {
  await install(view);
  return page(await view.executeJavaScript(runtimeCall("page")));
}

export async function waitForWebAnnotationSelection(
  view: WebAnnotationGuestView,
): Promise<WebAnnotationGuestSelection | undefined> {
  await install(view);
  const value = record(
    await view.executeJavaScript(runtimeCall("select")),
    "Web annotation selection",
  );
  if (value.type === "cancelled") return undefined;
  if (value.type !== "selected") {
    throw new TypeError("Web annotation selection is invalid");
  }
  return {
    type: "selected",
    page: page(value.page),
    target: parseAgentBrowserAnnotationTarget(value.target),
  };
}

export async function pauseWebAnnotationSelection(
  view: WebAnnotationGuestView,
): Promise<void> {
  await install(view);
  await view.executeJavaScript(runtimeCall("pause"));
}

export async function stopWebAnnotationSelection(
  view: WebAnnotationGuestView,
): Promise<void> {
  await install(view);
  await view.executeJavaScript(runtimeCall("stop"));
}

export async function refreshWebAnnotationTargets(
  view: WebAnnotationGuestView,
  targetIds: readonly string[],
): Promise<WebAnnotationGuestRefresh> {
  if (
    targetIds.length > AGENT_BROWSER_ANNOTATION_TARGET_LIMIT ||
    targetIds.some((targetId) =>
      !/^target-[a-zA-Z0-9]+$/u.test(targetId)
    )
  ) {
    throw new TypeError("Web annotation target ids are invalid");
  }
  await install(view);
  const value = record(
    await view.executeJavaScript(
      runtimeCall("refresh", [...new Set(targetIds)]),
    ),
    "Web annotation refresh",
  );
  if (!Array.isArray(value.targets)) {
    throw new TypeError("Web annotation refresh targets are invalid");
  }
  return {
    page: page(value.page),
    targets: value.targets.map(
      parseAgentBrowserAnnotationTarget,
    ),
  };
}

function screenshotData(dataUrl: string): string {
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) {
    throw new Error("Could not encode the webpage screenshot");
  }
  const data = dataUrl.slice(prefix.length);
  if (
    data === "" ||
    data.length > MAX_SCREENSHOT_BASE64_LENGTH ||
    !/^[a-zA-Z0-9+/]+={0,2}$/u.test(data)
  ) {
    throw new Error("The webpage screenshot is invalid or too large");
  }
  return data;
}

export async function captureWebAnnotationTargets(
  view: WebAnnotationGuestView,
  targetIds: readonly string[],
): Promise<WebAnnotationGuestCapture> {
  await pauseWebAnnotationSelection(view);
  const refreshed = await refreshWebAnnotationTargets(
    view,
    targetIds,
  );
  const image = await view.capturePage();
  return {
    ...refreshed,
    mimeType: "image/png",
    data: screenshotData(image.toDataURL()),
  };
}
