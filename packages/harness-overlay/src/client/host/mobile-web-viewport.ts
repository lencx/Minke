import {
  defineOverlayStyle,
} from "../shared/style-runtime.ts";
import MOBILE_WEB_VIEWPORT_STYLES from "./mobile-web-viewport.css";

export { MOBILE_WEB_VIEWPORT_STYLES };

export const MOBILE_WEB_ROOT_ATTRIBUTE =
  "data-minke-mobile-web";

const VISUAL_VIEWPORT_HEIGHT =
  "--minke-visual-viewport-height";
const VISUAL_VIEWPORT_OFFSET_TOP =
  "--minke-visual-viewport-offset-top";

interface StylePort {
  setProperty(name: string, value: string): void;
  removeProperty(name: string): void;
}

interface RootPort {
  readonly style: StylePort;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

interface EventSource {
  addEventListener(
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListener,
    options?: EventListenerOptions,
  ): void;
}

interface VisualViewportPort extends EventSource {
  readonly height: number;
  readonly offsetTop: number;
}

interface ViewportWindowPort {
  readonly innerHeight: number;
  readonly visualViewport?: VisualViewportPort | null;
  addEventListener?(
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions,
  ): void;
  removeEventListener?(
    type: string,
    listener: EventListener,
    options?: EventListenerOptions,
  ): void;
}

function viewportPixel(value: number, minimum: number): string {
  return `${String(Math.max(minimum, Math.round(value)))}px`;
}

/** Keeps the Web app pinned to the portion of the viewport not covered by UI. */
export class MobileWebViewportRuntime {
  readonly #root: RootPort;
  readonly #view: ViewportWindowPort;
  #active = false;

  constructor(root: RootPort, view: ViewportWindowPort) {
    this.#root = root;
    this.#view = view;
  }

  readonly #sync = (): void => {
    const viewport = this.#view.visualViewport;
    this.#root.style.setProperty(
      VISUAL_VIEWPORT_HEIGHT,
      viewportPixel(
        viewport?.height ?? this.#view.innerHeight,
        1,
      ),
    );
    this.#root.style.setProperty(
      VISUAL_VIEWPORT_OFFSET_TOP,
      viewportPixel(viewport?.offsetTop ?? 0, 0),
    );
  };

  start(): void {
    if (this.#active) return;
    this.#active = true;
    this.#root.setAttribute(MOBILE_WEB_ROOT_ATTRIBUTE, "");
    this.#sync();
    this.#view.visualViewport?.addEventListener(
      "resize",
      this.#sync,
      { passive: true },
    );
    this.#view.visualViewport?.addEventListener(
      "scroll",
      this.#sync,
      { passive: true },
    );
    this.#view.addEventListener?.("resize", this.#sync, {
      passive: true,
    });
  }

  dispose(): void {
    if (!this.#active) return;
    this.#active = false;
    this.#view.visualViewport?.removeEventListener(
      "resize",
      this.#sync,
    );
    this.#view.visualViewport?.removeEventListener(
      "scroll",
      this.#sync,
    );
    this.#view.removeEventListener?.("resize", this.#sync);
    this.#root.removeAttribute(MOBILE_WEB_ROOT_ATTRIBUTE);
    this.#root.style.removeProperty(VISUAL_VIEWPORT_HEIGHT);
    this.#root.style.removeProperty(VISUAL_VIEWPORT_OFFSET_TOP);
  }
}

export const installMobileWebViewportStyles =
  defineOverlayStyle(
    "mobile-web-viewport",
    MOBILE_WEB_VIEWPORT_STYLES,
  );

export function installMobileWebViewport(
  root: RootPort = document.documentElement,
  view: ViewportWindowPort = window,
): () => void {
  const runtime = new MobileWebViewportRuntime(root, view);
  runtime.start();
  return () => runtime.dispose();
}
