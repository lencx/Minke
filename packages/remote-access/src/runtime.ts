/** Live remote-access reconciliation over a running loopback Harness. */
import {
  parseRemoteAvailability,
  parseRemoteBootstrapToken,
  parseRemoteRuntimeSnapshot,
  parseRemoteSettings,
  type RemoteAvailability,
  type RemoteRuntimeError,
  type RemoteRuntimeSnapshot,
  type RemoteSettings,
} from "./contract.ts";
import type {
  RemoteCommands,
} from "./discovery.ts";
import {
  RemoteAccessError,
  type RemoteAccessLifecycle,
  type RemoteCommandExecutor,
  type RemoteProcessSpawner,
} from "./lifecycle.ts";
import {
  RemoteAccessService,
} from "./service.ts";
import {
  parseLoopbackHarnessUrl,
  type TailscaleDirectServerFactory,
} from "./tailscale.ts";
import type {
  CloudflareAccessGateway,
  CloudflareAccessGatewayOptions,
  CloudflareAccessTokenVerifier,
} from "./cloudflare.ts";
import type { connect as connectSocket } from "node:net";

const DEFAULT_RETRY_DELAYS_MS =
  [5_000, 15_000, 30_000, 60_000] as const;

type RemoteAccessServiceFactory = (
  settings: RemoteSettings,
  commands: RemoteCommands,
) => RemoteAccessLifecycle;

export interface RemoteAccessRuntimeOptions {
  settings: RemoteSettings;
  discoverCommands(): Promise<RemoteCommands>;
  replaceTrustedHosts(
    trustedHosts: readonly string[],
  ): Promise<void>;
  retryDelaysMs?: readonly number[];
  execute?: RemoteCommandExecutor;
  spawn?: RemoteProcessSpawner;
  environment?: NodeJS.ProcessEnv;
  statusTimeoutMs?: number;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  createDirectServer?: TailscaleDirectServerFactory;
  connectDirect?: typeof connectSocket;
  verifyCloudflareToken?: CloudflareAccessTokenVerifier;
  createCloudflareGateway?: (
    options: CloudflareAccessGatewayOptions,
  ) => CloudflareAccessGateway;
  createService?: RemoteAccessServiceFactory;
  waitForRetry?: (
    delayMs: number,
    signal: AbortSignal,
  ) => Promise<void>;
}

function transportFor(
  settings: Readonly<RemoteSettings>,
): RemoteRuntimeSnapshot["transport"] {
  return settings.method === "tailscale"
    ? settings.tailscale.transport
    : "access";
}

function snapshotFor(
  settings: Readonly<RemoteSettings>,
  state:
    | "disabled"
    | "unavailable"
    | "starting"
    | "stopping",
): RemoteRuntimeSnapshot {
  return parseRemoteRuntimeSnapshot({
    method: settings.method,
    transport: transportFor(settings),
    state,
  });
}

function retrySnapshot(
  settings: Readonly<RemoteSettings>,
  error: RemoteRuntimeError,
): RemoteRuntimeSnapshot {
  return parseRemoteRuntimeSnapshot({
    method: settings.method,
    transport: transportFor(settings),
    state: "retrying",
    error,
  });
}

function errorSnapshot(
  settings: Readonly<RemoteSettings>,
  error: RemoteRuntimeError,
): RemoteRuntimeSnapshot {
  return parseRemoteRuntimeSnapshot({
    method: settings.method,
    transport: transportFor(settings),
    state: "error",
    error,
  });
}

function rendererSnapshot(
  snapshot: RemoteRuntimeSnapshot,
  launchToken: string | undefined,
): RemoteRuntimeSnapshot {
  const parsed = parseRemoteRuntimeSnapshot(snapshot);
  if (parsed.url === undefined || launchToken === undefined) {
    return parsed;
  }
  const bootstrap = new URL(parsed.url);
  bootstrap.pathname = "/";
  bootstrap.searchParams.set("token", launchToken);
  return parseRemoteRuntimeSnapshot({
    ...parsed,
    bootstrapUrl: bootstrap.href,
  });
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException(
        "The operation was aborted",
        "AbortError",
      );
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

function isAbort(
  error: unknown,
  signal: AbortSignal,
): boolean {
  return (
    signal.aborted ||
    (
      error instanceof Error &&
      error.name === "AbortError"
    )
  );
}

function defaultWaitForRetry(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  return new Promise<void>((resolvePromise, reject) => {
    const finish = (error?: Error): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      if (error === undefined) resolvePromise();
      else reject(error);
    };
    const onAbort = (): void => {
      finish(abortError(signal));
    };
    const timeout = setTimeout(finish, delayMs);
    timeout.unref();
    signal.addEventListener("abort", onAbort, {
      once: true,
    });
  });
}

function validateRetryDelays(
  value: readonly number[] | undefined,
): readonly number[] {
  const delays = value ?? DEFAULT_RETRY_DELAYS_MS;
  if (
    delays.length === 0 ||
    delays.some(
      (delay) =>
        !Number.isSafeInteger(delay) ||
        delay < 0,
    )
  ) {
    throw new RangeError(
      "remote retry delays must be non-negative integers",
    );
  }
  return Object.freeze([...delays]);
}

function runtimeError(error: unknown): RemoteRuntimeError {
  return error instanceof RemoteAccessError
    ? error.kind
    : "harness-control";
}

/**
 * Reconcile persisted remote settings with one already-running Harness.
 *
 * Start authorization precedes transport exposure. Teardown closes the
 * transport before revoking its exact authority. Tailscale status failures
 * retry in the background until settings change or the runtime stops.
 */
export class RemoteAccessRuntime {
  readonly #discoverCommands:
    () => Promise<RemoteCommands>;
  readonly #replaceTrustedHosts:
    (trustedHosts: readonly string[]) => Promise<void>;
  readonly #createService: RemoteAccessServiceFactory;
  readonly #retryDelaysMs: readonly number[];
  readonly #waitForRetry:
    (delayMs: number, signal: AbortSignal) => Promise<void>;
  readonly #listeners = new Set<() => void>();
  #settings: RemoteSettings;
  #snapshot: RemoteRuntimeSnapshot;
  #target: string | undefined;
  #launchToken: string | undefined;
  #active: RemoteAccessLifecycle | undefined;
  #trustedHosts: readonly string[] = [];
  #controller: AbortController | undefined;
  #tail: Promise<void> = Promise.resolve();
  #generation = 0;
  #stopped = false;

  constructor(options: RemoteAccessRuntimeOptions) {
    this.#settings = parseRemoteSettings(options.settings);
    this.#snapshot = snapshotFor(
      this.#settings,
      this.#settings.enabled ? "starting" : "disabled",
    );
    this.#discoverCommands = options.discoverCommands;
    this.#replaceTrustedHosts =
      options.replaceTrustedHosts;
    this.#retryDelaysMs = validateRetryDelays(
      options.retryDelaysMs,
    );
    this.#waitForRetry =
      options.waitForRetry ?? defaultWaitForRetry;
    this.#createService =
      options.createService ??
      ((settings, commands) =>
        new RemoteAccessService({
          settings,
          commands,
          ...(options.execute === undefined
            ? {}
            : { execute: options.execute }),
          ...(options.spawn === undefined
            ? {}
            : { spawn: options.spawn }),
          ...(options.environment === undefined
            ? {}
            : { environment: options.environment }),
          ...(options.statusTimeoutMs === undefined
            ? {}
            : { statusTimeoutMs: options.statusTimeoutMs }),
          ...(options.startupTimeoutMs === undefined
            ? {}
            : { startupTimeoutMs: options.startupTimeoutMs }),
          ...(options.shutdownTimeoutMs === undefined
            ? {}
            : { shutdownTimeoutMs: options.shutdownTimeoutMs }),
          ...(options.createDirectServer === undefined
            ? {}
            : {
                createDirectServer:
                  options.createDirectServer,
              }),
          ...(options.connectDirect === undefined
            ? {}
            : { connectDirect: options.connectDirect }),
          ...(options.verifyCloudflareToken === undefined
            ? {}
            : {
                verifyCloudflareToken:
                  options.verifyCloudflareToken,
              }),
          ...(options.createCloudflareGateway === undefined
            ? {}
            : {
                createCloudflareGateway:
                  options.createCloudflareGateway,
              }),
        }));
  }

  read(): RemoteRuntimeSnapshot {
    const active = this.#active?.read();
    if (
      active?.state === "error" &&
      this.#snapshot.state === "active"
    ) {
      return rendererSnapshot(active, this.#launchToken);
    }
    return rendererSnapshot(
      this.#snapshot,
      this.#launchToken,
    );
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Discover currently installed provider commands without executing them. */
  async availability(): Promise<RemoteAvailability> {
    const commands = await this.#discoverCommands();
    return parseRemoteAvailability({
      tailscale: commands.tailscale !== undefined,
      cloudflare: commands.cloudflared !== undefined,
    });
  }

  /** Attach the live loopback Harness target and reconcile current settings. */
  start(
    target: string,
    launchToken: string,
  ): Promise<void> {
    this.#assertRunning();
    const parsedTarget = parseLoopbackHarnessUrl(target);
    const parsedLaunchToken =
      parseRemoteBootstrapToken(launchToken);
    this.#target = parsedTarget;
    this.#launchToken = parsedLaunchToken;
    return this.#schedule();
  }

  /** Persisted settings become the desired runtime state immediately. */
  apply(settings: RemoteSettings): Promise<void> {
    this.#assertRunning();
    this.#settings = parseRemoteSettings(settings);
    if (this.#settings.enabled) {
      this.#publish(
        snapshotFor(this.#settings, "starting"),
      );
    } else {
      this.#publish(
        snapshotFor(this.#settings, "stopping"),
      );
    }
    return this.#schedule();
  }

  /** Close remote exposure while keeping settings ready for a new Harness. */
  detach(): Promise<void> {
    this.#assertRunning();
    this.#target = undefined;
    this.#launchToken = undefined;
    return this.#schedule();
  }

  /** Cancel retries, close the provider, and revoke all remote authorities. */
  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#target = undefined;
    this.#launchToken = undefined;
    this.#controller?.abort();
    const generation = ++this.#generation;
    const operation = this.#tail
      .catch(() => {})
      .then(async () => {
        if (generation !== this.#generation) return;
        await this.#deactivate();
        this.#publish(
          snapshotFor(this.#settings, "disabled"),
        );
      });
    this.#tail = operation.catch(() => {});
    await operation;
    this.#listeners.clear();
  }

  #assertRunning(): void {
    if (this.#stopped) {
      throw new Error("remote access runtime is stopped");
    }
  }

  #schedule(): Promise<void> {
    this.#controller?.abort();
    const controller = new AbortController();
    this.#controller = controller;
    const generation = ++this.#generation;
    const operation = this.#tail
      .catch(() => {})
      .then(async () => {
        try {
          await this.#reconcile(
            generation,
            controller.signal,
          );
        } catch (error) {
          if (isAbort(error, controller.signal)) return;
          this.#publish(
            errorSnapshot(
              this.#settings,
              runtimeError(error),
            ),
          );
          throw error;
        }
      });
    this.#tail = operation.catch(() => {});
    return operation;
  }

  async #reconcile(
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    await this.#deactivate();
    throwIfAborted(signal);
    if (
      generation !== this.#generation ||
      !this.#settings.enabled
    ) {
      if (generation === this.#generation) {
        this.#publish(
          snapshotFor(this.#settings, "disabled"),
        );
      }
      return;
    }
    const target = this.#target;
    if (target === undefined) {
      this.#publish(
        snapshotFor(this.#settings, "starting"),
      );
      return;
    }

    let retryIndex = 0;
    while (
      generation === this.#generation &&
      !signal.aborted
    ) {
      const commands = await this.#discoverCommands();
      throwIfAborted(signal);
      const provider = this.#createService(
        this.#settings,
        commands,
      );
      this.#active = provider;
      const unavailable =
        this.#settings.method === "tailscale"
          ? commands.tailscale === undefined
          : commands.cloudflared === undefined;
      if (unavailable) {
        await provider.stop();
        this.#active = undefined;
        this.#publish(
          snapshotFor(this.#settings, "unavailable"),
        );
        if (this.#settings.method !== "tailscale") return;
        await this.#retry(retryIndex++, signal);
        continue;
      }

      this.#publish(
        snapshotFor(this.#settings, "starting"),
      );
      try {
        const plan = await provider.prepare(signal);
        throwIfAborted(signal);
        await this.#replaceTrustedHosts(
          plan.trustedHosts,
        );
        this.#trustedHosts = [...plan.trustedHosts];
        throwIfAborted(signal);
        await provider.start(target, signal);
        throwIfAborted(signal);
        this.#publish(provider.read());
        return;
      } catch (error) {
        await this.#deactivate();
        if (isAbort(error, signal)) throw error;
        const kind = runtimeError(error);
        if (
          this.#settings.method === "tailscale" &&
          kind === "status"
        ) {
          this.#publish(
            retrySnapshot(this.#settings, kind),
          );
          await this.#retry(retryIndex++, signal);
          continue;
        }
        this.#publish(
          errorSnapshot(this.#settings, kind),
        );
        return;
      }
    }
    throwIfAborted(signal);
  }

  async #retry(
    retryIndex: number,
    signal: AbortSignal,
  ): Promise<void> {
    const delay = this.#retryDelaysMs[
      Math.min(
        retryIndex,
        this.#retryDelaysMs.length - 1,
      )
    ];
    await this.#waitForRetry(delay, signal);
  }

  async #deactivate(): Promise<void> {
    const active = this.#active;
    this.#active = undefined;
    let stopError: unknown;
    try {
      await active?.stop();
    } catch (error) {
      stopError = error;
    }
    if (this.#trustedHosts.length > 0) {
      await this.#replaceTrustedHosts([]);
      this.#trustedHosts = [];
    }
    if (stopError !== undefined) throw stopError;
  }

  #publish(snapshot: RemoteRuntimeSnapshot): void {
    const next = parseRemoteRuntimeSnapshot(snapshot);
    if (
      JSON.stringify(next) === JSON.stringify(this.#snapshot)
    ) {
      return;
    }
    this.#snapshot = next;
    for (const listener of this.#listeners) listener();
  }
}
