import {
  MINKE_PWA_ROUTES,
} from "../../pwa-contract.ts";

export type PwaInstallGuide = "browser" | "ios";
export type PwaInstallMode =
  | "error"
  | "hidden"
  | "installed"
  | "installing"
  | "manual"
  | "ready";

export type PwaInstallSnapshot =
  | {
      readonly mode: "error";
      readonly guide: PwaInstallGuide;
      readonly message: string;
    }
  | {
      readonly mode: "manual";
      readonly guide: PwaInstallGuide;
    }
  | {
      readonly mode:
        | "hidden"
        | "installed"
        | "installing"
        | "ready";
    };

export type PwaInstallResult =
  | "error"
  | "installed"
  | "manual"
  | "unavailable";

interface BeforeInstallPromptChoice {
  readonly outcome: "accepted" | "dismissed";
  readonly platform: string;
}

export interface BeforeInstallPromptEventLike extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<BeforeInstallPromptChoice>;
}

interface PwaServiceWorkerContainer {
  register(
    url: string,
    options: {
      readonly scope: string;
      readonly updateViaCache: "none";
    },
  ): Promise<unknown>;
}

interface PwaNavigator {
  readonly serviceWorker?: PwaServiceWorkerContainer;
  readonly standalone?: boolean;
}

interface PwaMediaQuery {
  readonly matches: boolean;
  addEventListener?(
    type: "change",
    listener: EventListener,
  ): void;
  removeEventListener?(
    type: "change",
    listener: EventListener,
  ): void;
}

export interface MinkePwaBootstrapState {
  installPrompt?: BeforeInstallPromptEventLike | null;
  serviceWorker?: Promise<unknown>;
  serviceWorkerError?: string;
}

export interface PwaWindow {
  readonly isSecureContext: boolean;
  readonly navigator: PwaNavigator;
  readonly __minkePwa?: MinkePwaBootstrapState;
  matchMedia(query: "(display-mode: standalone)"): PwaMediaQuery;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

const HIDDEN: PwaInstallSnapshot = { mode: "hidden" };
const INSTALLED: PwaInstallSnapshot = { mode: "installed" };

function isInstallPrompt(
  event: Event | null | undefined,
): event is BeforeInstallPromptEventLike {
  if (event === null || event === undefined) return false;
  const candidate = event as Partial<BeforeInstallPromptEventLike>;
  return (
    typeof candidate.prompt === "function" &&
    candidate.userChoice instanceof Promise
  );
}

/** Browser lifecycle for optional PWA installation. */
export class PwaInstallRuntime {
  readonly #window: PwaWindow;
  readonly #listeners = new Set<() => void>();
  #snapshot: PwaInstallSnapshot = HIDDEN;
  #prompt: BeforeInstallPromptEventLike | undefined;
  #dispose: (() => void) | undefined;
  #displayMode: PwaMediaQuery | undefined;

  constructor(
    source: PwaWindow =
      window as unknown as PwaWindow,
  ) {
    this.#window = source;
  }

  readonly getSnapshot = (): PwaInstallSnapshot =>
    this.#snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  mount(): () => void {
    if (this.#dispose !== undefined) return this.#dispose;
    if (!this.#window.isSecureContext) {
      this.#set(HIDDEN);
      this.#dispose = () => {};
      return this.#dispose;
    }

    this.#displayMode = this.#window.matchMedia(
      "(display-mode: standalone)",
    );
    const beforeInstall = (event: Event): void => {
      if (this.#isStandalone() || !isInstallPrompt(event)) return;
      event.preventDefault();
      this.#prompt = event;
      if (this.#window.__minkePwa !== undefined) {
        this.#window.__minkePwa.installPrompt = event;
      }
      this.#set({ mode: "ready" });
    };
    const installed = (): void => {
      this.#clearPrompt();
      this.#set(INSTALLED);
    };
    const displayChanged = (): void => {
      if (this.#isStandalone()) {
        installed();
        return;
      }
      this.#deriveAvailableState();
    };

    this.#window.addEventListener(
      "beforeinstallprompt",
      beforeInstall,
    );
    this.#window.addEventListener(
      "minke:pwa-install-ready",
      displayChanged,
    );
    this.#window.addEventListener("appinstalled", installed);
    this.#displayMode.addEventListener?.(
      "change",
      displayChanged,
    );

    const bootstrapPrompt =
      this.#window.__minkePwa?.installPrompt;
    if (isInstallPrompt(bootstrapPrompt)) {
      this.#prompt = bootstrapPrompt;
    }
    this.#registerServiceWorker();
    this.#deriveAvailableState();

    let active = true;
    this.#dispose = () => {
      if (!active) return;
      active = false;
      this.#window.removeEventListener(
        "beforeinstallprompt",
        beforeInstall,
      );
      this.#window.removeEventListener(
        "minke:pwa-install-ready",
        displayChanged,
      );
      this.#window.removeEventListener(
        "appinstalled",
        installed,
      );
      this.#displayMode?.removeEventListener?.(
        "change",
        displayChanged,
      );
      this.#displayMode = undefined;
    };
    return this.#dispose;
  }

  async install(): Promise<PwaInstallResult> {
    if (this.#snapshot.mode === "manual") return "manual";
    if (this.#snapshot.mode !== "ready") return "unavailable";
    const prompt = this.#prompt;
    if (prompt === undefined) {
      this.#set({
        mode: "manual",
        guide: "browser",
      });
      return "manual";
    }

    this.#set({ mode: "installing" });
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      this.#clearPrompt();
      if (choice.outcome === "accepted") {
        this.#set(INSTALLED);
        return "installed";
      }
      this.#set({
        mode: "manual",
        guide: "browser",
      });
      return "manual";
    } catch (error) {
      this.#clearPrompt();
      this.#set({
        mode: "error",
        guide: "browser",
        message:
          error instanceof Error ? error.message : String(error),
      });
      return "error";
    }
  }

  clearError(): void {
    if (this.#snapshot.mode !== "error") return;
    this.#set({
      mode: "manual",
      guide: this.#snapshot.guide,
    });
  }

  #registerServiceWorker(): void {
    const bootstrap = this.#window.__minkePwa;
    if (bootstrap?.serviceWorker !== undefined) return;
    const container = this.#window.navigator.serviceWorker;
    if (container === undefined) return;
    const registration = container.register(
      MINKE_PWA_ROUTES.serviceWorker,
      {
        scope: "/",
        updateViaCache: "none",
      },
    );
    if (bootstrap !== undefined) {
      bootstrap.serviceWorker = registration;
    }
    void registration.catch(() => {
      // Manifest installation remains useful even without offline fallback.
    });
  }

  #deriveAvailableState(): void {
    if (this.#isStandalone()) {
      this.#set(INSTALLED);
      return;
    }
    if (this.#prompt !== undefined) {
      this.#set({ mode: "ready" });
      return;
    }
    if ("standalone" in this.#window.navigator) {
      this.#set({
        mode: "manual",
        guide: "ios",
      });
      return;
    }
    this.#set(HIDDEN);
  }

  #isStandalone(): boolean {
    return (
      this.#displayMode?.matches === true ||
      this.#window.navigator.standalone === true
    );
  }

  #clearPrompt(): void {
    this.#prompt = undefined;
    if (this.#window.__minkePwa !== undefined) {
      this.#window.__minkePwa.installPrompt = null;
    }
  }

  #set(snapshot: PwaInstallSnapshot): void {
    if (
      JSON.stringify(this.#snapshot) ===
      JSON.stringify(snapshot)
    ) {
      return;
    }
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }
}
