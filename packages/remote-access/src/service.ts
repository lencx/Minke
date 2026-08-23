/** Select exactly one configured remote provider and own its lifecycle. */
import type { RemoteCommands } from "./discovery.ts";
import {
  parseRemoteSettings,
  type RemoteRuntimeSnapshot,
  type RemoteSettings,
} from "./contract.ts";
import {
  CloudflareAccessService,
  type CloudflareAccessGateway,
  type CloudflareAccessGatewayOptions,
  type CloudflareAccessTokenVerifier,
} from "./cloudflare.ts";
import type {
  RemoteAccessLifecycle,
  RemoteCommandExecutor,
  RemoteLaunchPlan,
  RemoteProcessSpawner,
} from "./lifecycle.ts";
import {
  TailscaleDirectService,
  TailscaleServeService,
  type TailscaleDirectServerFactory,
} from "./tailscale.ts";
import type { connect as connectSocket } from "node:net";

export interface RemoteAccessServiceOptions {
  commands?: RemoteCommands;
  /** @deprecated Use commands.tailscale. */
  command?: string;
  settings: RemoteSettings;
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
}

export class RemoteAccessService
implements RemoteAccessLifecycle {
  readonly #active: RemoteAccessLifecycle;

  constructor(options: RemoteAccessServiceOptions) {
    const settings = parseRemoteSettings(options.settings);
    const tailscaleCommand =
      options.commands?.tailscale ?? options.command;
    if (settings.method === "cloudflare") {
      this.#active = new CloudflareAccessService({
        command: options.commands?.cloudflared,
        settings,
        ...(options.spawn === undefined
          ? {}
          : { spawn: options.spawn }),
        ...(options.environment === undefined
          ? {}
          : { environment: options.environment }),
        ...(options.startupTimeoutMs === undefined
          ? {}
          : { startupTimeoutMs: options.startupTimeoutMs }),
        ...(options.shutdownTimeoutMs === undefined
          ? {}
          : { shutdownTimeoutMs: options.shutdownTimeoutMs }),
        ...(options.verifyCloudflareToken === undefined
          ? {}
          : {
              verifyToken:
                options.verifyCloudflareToken,
            }),
        ...(options.createCloudflareGateway === undefined
          ? {}
          : {
              createGateway:
                options.createCloudflareGateway,
            }),
      });
      return;
    }
    if (settings.tailscale.transport === "direct") {
      this.#active = new TailscaleDirectService({
        command: tailscaleCommand,
        settings,
        ...(options.execute === undefined
          ? {}
          : { execute: options.execute }),
        ...(options.environment === undefined
          ? {}
          : { environment: options.environment }),
        ...(options.statusTimeoutMs === undefined
          ? {}
          : { statusTimeoutMs: options.statusTimeoutMs }),
        ...(options.createDirectServer === undefined
          ? {}
          : { createServer: options.createDirectServer }),
        ...(options.connectDirect === undefined
          ? {}
          : { connect: options.connectDirect }),
      });
      return;
    }
    this.#active = new TailscaleServeService({
      command: tailscaleCommand,
      settings,
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
    });
  }

  read(): RemoteRuntimeSnapshot {
    return this.#active.read();
  }

  prepare(signal?: AbortSignal): Promise<RemoteLaunchPlan> {
    return this.#active.prepare(signal);
  }

  start(target: string, signal?: AbortSignal): Promise<void> {
    return this.#active.start(target, signal);
  }

  stop(): Promise<void> {
    return this.#active.stop();
  }
}
