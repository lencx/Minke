import {
  DEFAULT_DISCORD_NETWORK_SNAPSHOT,
  parseDiscordNetworkSettings,
  type DiscordNetworkSettings,
  type DiscordNetworkSnapshot,
  type DiscordProxySource,
} from "@minke/harness-overlay/remote-hub-contract.ts";
import type {
  DiscordWebSocketFactory,
  DiscordWebSocketLike,
} from "@lencx/minke-im-discord";

const DISCORD_REST_ROUTE =
  "https://discord.com/api/v10/gateway";
const DISCORD_GATEWAY_ROUTE =
  "wss://gateway.discord.gg/?v=10&encoding=json";

export interface DiscordNetworkSettingsStore {
  read(): Promise<unknown>;
  write(settings: DiscordNetworkSettings): Promise<void>;
}

export type DiscordNetworkProxyConfig =
  | {
      readonly mode: "fixed_servers";
      readonly proxyRules: string;
    }
  | {
      readonly mode: "system";
    };

export interface DiscordNetworkSessionPort {
  fetch: typeof globalThis.fetch;
  setProxy(config: DiscordNetworkProxyConfig): Promise<void>;
  closeAllConnections(): Promise<void>;
  resolveProxy(url: string): Promise<string>;
}

export interface DiscordNetworkWebSocketPort {
  create(
    url: string,
    httpProxyUrl: string,
  ): DiscordWebSocketLike;
}

export interface DiscordNetworkRuntimeOptions {
  readonly fallbackProxyUrl: () => string;
  readonly session: DiscordNetworkSessionPort;
  readonly store: DiscordNetworkSettingsStore;
  readonly webSocket: DiscordNetworkWebSocketPort;
}

function snapshot(
  settings: DiscordNetworkSettings,
  proxySource: DiscordProxySource,
): DiscordNetworkSnapshot {
  return Object.freeze({
    httpProxyUrl: settings.httpProxyUrl,
    proxySource,
  });
}

function fixedProxyConfig(
  httpProxyUrl: string,
): DiscordNetworkProxyConfig {
  return {
    mode: "fixed_servers",
    proxyRules: `https=${httpProxyUrl}`,
  };
}

function proxyUrlsFromPacResult(value: string): string[] {
  const urls: string[] = [];
  for (const directive of value.split(";")) {
    const match =
      /^\s*PROXY\s+(\S+)\s*$/iu.exec(
        directive,
      );
    if (match?.[1] === undefined) continue;
    try {
      const normalized = parseDiscordNetworkSettings({
        httpProxyUrl: `http://${match[1]}`,
      }).httpProxyUrl;
      if (!urls.includes(normalized)) urls.push(normalized);
    } catch {
      // Ignore proxy schemes or endpoints unsupported by both transports.
    }
  }
  return urls;
}

function sharedSystemHttpProxy(
  restResult: string,
  gatewayResult: string,
): string | undefined {
  const rest = proxyUrlsFromPacResult(restResult);
  const gateway = new Set(
    proxyUrlsFromPacResult(gatewayResult),
  );
  return rest.find((url) => gateway.has(url));
}

/**
 * Own one Discord route shared by Electron REST fetches and Gateway sockets.
 *
 * Automatic selection prefers one HTTP proxy returned for both Discord
 * endpoints, then the saved Telegram proxy, then the system's direct route.
 * A user setting is an explicit override and bypasses discovery.
 */
export class DiscordNetworkRuntime {
  readonly #fallbackProxyUrl: () => string;
  readonly #session: DiscordNetworkSessionPort;
  readonly #store: DiscordNetworkSettingsStore;
  readonly #webSocket: DiscordNetworkWebSocketPort;
  readonly fetch: typeof globalThis.fetch;
  readonly webSocketFactory: DiscordWebSocketFactory;
  #effectiveProxyUrl = "";
  #snapshot = snapshot(
    DEFAULT_DISCORD_NETWORK_SNAPSHOT,
    DEFAULT_DISCORD_NETWORK_SNAPSHOT.proxySource,
  );
  #initializePromise: Promise<void> | undefined;
  #operationTail: Promise<void> = Promise.resolve();

  constructor(options: DiscordNetworkRuntimeOptions) {
    this.#fallbackProxyUrl = options.fallbackProxyUrl;
    this.#session = options.session;
    this.#store = options.store;
    this.#webSocket = options.webSocket;
    this.fetch = (input, init) =>
      this.#session.fetch(input, init);
    this.webSocketFactory = (url) =>
      this.#webSocket.create(
        url,
        this.#effectiveProxyUrl,
      );
  }

  getSnapshot = (): DiscordNetworkSnapshot =>
    this.#snapshot;

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

  async refresh(): Promise<void> {
    const operation = this.#operationTail.then(async () => {
      await this.initialize();
      if (this.#snapshot.httpProxyUrl !== "") return;
      this.#snapshot = await this.#select({
        httpProxyUrl: "",
      });
    });
    this.#operationTail = operation.catch(() => undefined);
    await operation;
  }

  async configure(value: unknown): Promise<void> {
    const settings = parseDiscordNetworkSettings(value);
    const operation = this.#operationTail.then(async () => {
      await this.initialize();
      const previousSnapshot = this.#snapshot;
      const previousEffectiveProxyUrl =
        this.#effectiveProxyUrl;
      const nextSnapshot = await this.#select(settings);
      try {
        await this.#store.write(settings);
      } catch (error) {
        await this.#restore(
          previousSnapshot,
          previousEffectiveProxyUrl,
          error,
        );
        throw error;
      }
      this.#snapshot = nextSnapshot;
    });
    this.#operationTail = operation.catch(() => undefined);
    await operation;
  }

  async #initialize(): Promise<void> {
    const settings = parseDiscordNetworkSettings(
      await this.#store.read(),
    );
    this.#snapshot = await this.#select(settings);
  }

  async #select(
    settings: DiscordNetworkSettings,
  ): Promise<DiscordNetworkSnapshot> {
    if (settings.httpProxyUrl !== "") {
      await this.#apply(
        fixedProxyConfig(settings.httpProxyUrl),
        settings.httpProxyUrl,
      );
      return snapshot(settings, "manual");
    }

    await this.#apply({ mode: "system" }, "");
    let systemProxyUrl: string | undefined;
    try {
      const [restResult, gatewayResult] =
        await Promise.all([
          this.#session.resolveProxy(DISCORD_REST_ROUTE),
          this.#session.resolveProxy(DISCORD_GATEWAY_ROUTE),
        ]);
      systemProxyUrl = sharedSystemHttpProxy(
        restResult,
        gatewayResult,
      );
    } catch {
      // A failed system lookup continues to the local Telegram fallback.
    }
    if (systemProxyUrl !== undefined) {
      await this.#apply(
        fixedProxyConfig(systemProxyUrl),
        systemProxyUrl,
      );
      return snapshot(settings, "system");
    }

    let fallbackProxyUrl = "";
    try {
      fallbackProxyUrl = parseDiscordNetworkSettings({
        httpProxyUrl: this.#fallbackProxyUrl(),
      }).httpProxyUrl;
    } catch {
      // Treat an invalid cross-channel fallback as unavailable.
    }
    if (fallbackProxyUrl !== "") {
      await this.#apply(
        fixedProxyConfig(fallbackProxyUrl),
        fallbackProxyUrl,
      );
      return snapshot(settings, "telegram");
    }

    return snapshot(settings, "direct");
  }

  async #apply(
    config: DiscordNetworkProxyConfig,
    effectiveProxyUrl: string,
  ): Promise<void> {
    await this.#session.setProxy(config);
    await this.#session.closeAllConnections();
    this.#effectiveProxyUrl = effectiveProxyUrl;
  }

  async #restore(
    previous: DiscordNetworkSnapshot,
    previousEffectiveProxyUrl: string,
    primaryError: unknown,
  ): Promise<void> {
    try {
      await this.#apply(
        previousEffectiveProxyUrl === ""
          ? { mode: "system" }
          : fixedProxyConfig(
              previousEffectiveProxyUrl,
            ),
        previousEffectiveProxyUrl,
      );
      this.#snapshot = previous;
    } catch (rollbackError) {
      throw new AggregateError(
        [primaryError, rollbackError],
        "Discord network persistence failed and live rollback also failed",
      );
    }
  }
}
