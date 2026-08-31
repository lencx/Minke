import type { HarnessRuntimeEndpoint } from "./harness-runtime.ts";

export interface HarnessLifecycleRuntime {
  start(): Promise<HarnessRuntimeEndpoint>;
}

export interface HarnessLifecycleRemote {
  detach(): Promise<unknown>;
  start(
    harnessOrigin: string,
    launchToken: string,
  ): Promise<unknown>;
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
  #authenticatedUrl: string | undefined;
  #launchToken: string | undefined;

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
    this.#authenticatedUrl = undefined;
    this.#launchToken = undefined;
  }

  async attach(
    window: HarnessLifecycleWindow,
  ): Promise<void> {
    const url = this.#url;
    if (url === undefined || !isUsableWindow(window)) return;
    const authenticatedUrl = this.#authenticatedUrl;
    const launchToken = this.#launchToken;
    await this.#loadWindow(
      window,
      authenticatedUrl ?? url,
      url,
      launchToken,
    );
    if (
      authenticatedUrl !== undefined &&
      this.#authenticatedUrl === authenticatedUrl
    ) {
      this.#authenticatedUrl = undefined;
      this.#launchToken = undefined;
    }
  }

  async start(
    window?: HarnessLifecycleWindow,
  ): Promise<string> {
    if (this.#remote !== undefined) {
      try {
        await this.#remote.detach();
      } catch (error) {
        this.#reportError(
          "Remote access failed to detach:",
          error,
        );
      }
    }

    const endpoint = await this.#runtime.start();
    const {
      authenticatedUrl,
      launchToken,
      origin,
    } = endpoint;
    this.#url = origin;
    this.#authenticatedUrl = authenticatedUrl;
    this.#launchToken = launchToken;
    if (isUsableWindow(window)) {
      await this.#loadWindow(
        window,
        authenticatedUrl,
        origin,
        launchToken,
      );
      if (this.#authenticatedUrl === authenticatedUrl) {
        this.#authenticatedUrl = undefined;
        this.#launchToken = undefined;
      }
    }
    if (this.#remote !== undefined) {
      void this.#remote
        .start(origin, launchToken)
        .catch((error: unknown) => {
          this.#reportError(
            "Remote access failed to start:",
            error,
          );
        });
    }
    return origin;
  }

  async #loadWindow(
    window: HarnessLifecycleWindow,
    navigationUrl: string,
    origin: string,
    launchToken: string | undefined,
  ): Promise<void> {
    let navigation: Promise<unknown>;
    try {
      navigation = window.loadURL(navigationUrl);
    } catch (error) {
      throw new HarnessNavigationError(
        `Harness window could not start loading ${origin}`,
        {
          cause: sanitizedNavigationCause(
            error,
            launchToken,
          ),
        },
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
              `Harness window failed to load ${origin}`,
              {
                cause: sanitizedNavigationCause(
                  error,
                  launchToken,
                ),
              },
            ),
          );
        },
      );
    });
  }
}

function sanitizedNavigationCause(
  error: unknown,
  launchToken: string | undefined,
): Error {
  const source =
    error instanceof Error
      ? error.message
      : String(error);
  const withoutToken =
    launchToken === undefined
      ? source
      : source.replaceAll(launchToken, "<redacted>");
  const cause = new Error(
    withoutToken.replace(
      /([?&]token=)[^&\s)]*/giu,
      "$1<redacted>",
    ),
  );
  if (error instanceof Error) cause.name = error.name;
  return cause;
}
