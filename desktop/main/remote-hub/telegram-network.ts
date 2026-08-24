import {
  DEFAULT_TELEGRAM_NETWORK_SETTINGS,
  parseTelegramNetworkSettings,
  type TelegramNetworkSettings,
} from "@minke/harness-overlay/remote-hub-contract.ts";

export interface TelegramNetworkSettingsStore {
  read(): Promise<unknown>;
  write(settings: TelegramNetworkSettings): Promise<void>;
}

export type TelegramNetworkProxyConfig =
  | {
      readonly mode: "fixed_servers";
      readonly proxyRules: string;
    }
  | {
      readonly mode: "system";
    };

export interface TelegramNetworkSessionPort {
  fetch: typeof globalThis.fetch;
  setProxy(config: TelegramNetworkProxyConfig): Promise<void>;
  closeAllConnections(): Promise<void>;
}

export interface TelegramNetworkRuntimeOptions {
  readonly session: TelegramNetworkSessionPort;
  readonly store: TelegramNetworkSettingsStore;
}

function settingsSnapshot(
  value: TelegramNetworkSettings,
): TelegramNetworkSettings {
  return Object.freeze({
    httpProxyUrl: value.httpProxyUrl,
  });
}

function proxyConfig(
  settings: TelegramNetworkSettings,
): TelegramNetworkProxyConfig {
  return settings.httpProxyUrl === ""
    ? { mode: "system" }
    : {
        mode: "fixed_servers",
        proxyRules: `https=${settings.httpProxyUrl}`,
      };
}

/**
 * Own the live Electron Session network policy used by Telegram.
 *
 * The settings store commits after the Session has switched successfully.
 * Failed persistence restores the previous live policy so disk and runtime do
 * not silently diverge.
 */
export class TelegramNetworkRuntime {
  readonly #session: TelegramNetworkSessionPort;
  readonly #store: TelegramNetworkSettingsStore;
  readonly fetch: typeof globalThis.fetch;
  #settings = settingsSnapshot(
    DEFAULT_TELEGRAM_NETWORK_SETTINGS,
  );
  #initializePromise: Promise<void> | undefined;
  #configureTail: Promise<void> = Promise.resolve();

  constructor(options: TelegramNetworkRuntimeOptions) {
    this.#session = options.session;
    this.#store = options.store;
    this.fetch = (input, init) =>
      this.#session.fetch(input, init);
  }

  get settings(): TelegramNetworkSettings {
    return this.#settings;
  }

  getSnapshot = (): TelegramNetworkSettings =>
    this.#settings;

  async initialize(): Promise<void> {
    if (this.#initializePromise === undefined) {
      const operation = this.#initialize().catch((error) => {
        if (this.#initializePromise === operation) {
          this.#initializePromise = undefined;
        }
        throw error;
      });
      this.#initializePromise = operation;
    }
    await this.#initializePromise;
  }

  async configure(value: unknown): Promise<void> {
    const next = settingsSnapshot(
      parseTelegramNetworkSettings(value),
    );
    const operation = this.#configureTail.then(async () => {
      await this.initialize();
      const previous = this.#settings;
      await this.#apply(next);
      try {
        await this.#store.write(next);
      } catch (error) {
        await this.#rollback(previous, error);
        throw error;
      }
      this.#settings = next;
    });
    this.#configureTail = operation.catch(() => undefined);
    await operation;
  }

  async #initialize(): Promise<void> {
    const stored = settingsSnapshot(
      parseTelegramNetworkSettings(
        await this.#store.read(),
      ),
    );
    if (stored.httpProxyUrl !== "") {
      await this.#apply(stored);
    }
    this.#settings = stored;
  }

  async #apply(
    settings: TelegramNetworkSettings,
  ): Promise<void> {
    await this.#session.setProxy(proxyConfig(settings));
    await this.#session.closeAllConnections();
  }

  async #rollback(
    previous: TelegramNetworkSettings,
    primaryError: unknown,
  ): Promise<void> {
    const rollbackErrors: unknown[] = [];
    try {
      await this.#session.setProxy(proxyConfig(previous));
    } catch (error) {
      rollbackErrors.push(error);
    }
    try {
      await this.#session.closeAllConnections();
    } catch (error) {
      rollbackErrors.push(error);
    }
    if (rollbackErrors.length !== 0) {
      throw new AggregateError(
        [primaryError, ...rollbackErrors],
        "Telegram network persistence failed and live rollback also failed",
      );
    }
  }
}
