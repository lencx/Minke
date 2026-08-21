export interface HarnessLifecycleRuntime {
  start(): Promise<string>;
}

export interface HarnessLifecycleRemote {
  read(): { state: string };
  start(harnessUrl: string): Promise<unknown>;
  stop(): Promise<unknown>;
}

export interface HarnessLifecycleWindow {
  isDestroyed(): boolean;
  loadURL(url: string): Promise<unknown>;
  webContents: {
    isDestroyed(): boolean;
  };
}

export interface HarnessLifecycleOptions {
  runtime: HarnessLifecycleRuntime;
  remote?: HarnessLifecycleRemote;
  reportError?: (message: string, error: unknown) => void;
}

function isUsableWindow(
  window: HarnessLifecycleWindow | undefined,
): window is HarnessLifecycleWindow {
  return window !== undefined &&
    !window.isDestroyed() &&
    !window.webContents.isDestroyed();
}

/**
 * Own the live Harness URL and the ordering between the local runtime, the
 * optional desktop window, and remote exposure.
 */
export class HarnessLifecycle {
  readonly #runtime: HarnessLifecycleRuntime;
  readonly #remote: HarnessLifecycleRemote | undefined;
  readonly #reportError: (message: string, error: unknown) => void;
  #url: string | undefined;

  constructor(options: HarnessLifecycleOptions) {
    this.#runtime = options.runtime;
    this.#remote = options.remote;
    this.#reportError =
      options.reportError ??
      ((message, error) => console.error(message, error));
  }

  get url(): string | undefined {
    return this.#url;
  }

  clear(): void {
    this.#url = undefined;
  }

  async attach(
    window: HarnessLifecycleWindow,
  ): Promise<void> {
    const url = this.#url;
    if (url === undefined || !isUsableWindow(window)) return;
    await window.loadURL(url);
  }

  async start(
    window?: HarnessLifecycleWindow,
  ): Promise<string> {
    if (this.#remote !== undefined) {
      try {
        await this.#remote.stop();
      } catch (error) {
        this.#reportError(
          "Remote access failed to stop:",
          error,
        );
      }
    }

    const url = await this.#runtime.start();
    this.#url = url;
    if (isUsableWindow(window)) {
      await window.loadURL(url);
    }
    if (this.#remote?.read().state === "ready") {
      void this.#remote.start(url).catch((error: unknown) => {
        this.#reportError(
          "Remote access failed to start:",
          error,
        );
      });
    }
    return url;
  }
}
