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
    stop(): void;
  };
}

export interface HarnessLifecycleOptions {
  runtime: HarnessLifecycleRuntime;
  remote?: HarnessLifecycleRemote;
  reportError?: (message: string, error: unknown) => void;
  navigationTimeoutMs?: number;
}

const DEFAULT_NAVIGATION_TIMEOUT_MS = 15_000;

export class HarnessNavigationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HarnessNavigationError";
  }
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
  readonly #navigationTimeoutMs: number;
  #url: string | undefined;

  constructor(options: HarnessLifecycleOptions) {
    this.#runtime = options.runtime;
    this.#remote = options.remote;
    this.#reportError =
      options.reportError ??
      ((message, error) => console.error(message, error));
    this.#navigationTimeoutMs =
      options.navigationTimeoutMs ??
      DEFAULT_NAVIGATION_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.#navigationTimeoutMs) ||
      this.#navigationTimeoutMs <= 0
    ) {
      throw new RangeError(
        "Harness navigation timeout must be a positive integer",
      );
    }
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
    await this.#loadWindow(window, url);
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
      await this.#loadWindow(window, url);
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

  async #loadWindow(
    window: HarnessLifecycleWindow,
    url: string,
  ): Promise<void> {
    let navigation: Promise<unknown>;
    try {
      navigation = window.loadURL(url);
    } catch (error) {
      throw new HarnessNavigationError(
        `Harness window could not start loading ${url}`,
        { cause: error },
      );
    }

    await new Promise<void>((resolvePromise, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (isUsableWindow(window)) {
          try {
            window.webContents.stop();
          } catch {
            // The window can be destroyed between the guard and stop().
          }
        }
        reject(
          new HarnessNavigationError(
            `Harness window navigation did not finish within ${String(this.#navigationTimeoutMs)} ms`,
          ),
        );
      }, this.#navigationTimeoutMs);
      timeout.unref();

      void navigation.then(
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolvePromise();
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(
            new HarnessNavigationError(
              `Harness window failed to load ${url}`,
              { cause: error },
            ),
          );
        },
      );
    });
  }
}
