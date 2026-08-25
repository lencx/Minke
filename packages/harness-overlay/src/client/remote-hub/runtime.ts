import {
  DEFAULT_DISCORD_NETWORK_SNAPSHOT,
  DEFAULT_TELEGRAM_NETWORK_SETTINGS,
  parseRemoteHubSnapshot,
  type RemoteHubCommand,
  type RemoteHubSnapshot,
} from "@minke/harness-overlay/remote-hub-contract.ts";
import type {
  DesktopRemoteHubPort,
} from "../desktop/index.ts";
import type {
  RemoteSettingsRuntime,
  RemoteSettingsSnapshot,
} from "../remote/runtime.ts";

export type RemoteHubClientOperation =
  | "idle"
  | "starting-link"
  | "connecting-channel"
  | "copying-token"
  | "verifying"
  | "cancelling"
  | "disconnecting"
  | "reconnecting"
  | "resetting"
  | "unlinking";

export type RemoteHubView =
  | "weixin"
  | "telegram"
  | "discord"
  | "access";

export interface RemoteHubClientSnapshot {
  readonly open: boolean;
  readonly view: RemoteHubView;
  readonly remote: RemoteSettingsSnapshot;
  readonly channels: RemoteHubSnapshot;
  readonly operation: RemoteHubClientOperation;
  readonly error: "command" | "read" | undefined;
}

function initialChannels(
  available: boolean,
): RemoteHubSnapshot {
  return parseRemoteHubSnapshot({
    revision: 0,
    telegramNetwork: {
      ...DEFAULT_TELEGRAM_NETWORK_SETTINGS,
    },
    discordNetwork: {
      ...DEFAULT_DISCORD_NETWORK_SNAPSHOT,
    },
    dependencies: {
      credentialVault: available ? "pending" : "unavailable",
      agentRoute: "pending",
    },
    channels: {
      weixin: available
        ? { state: "loading" }
        : {
            state: "unavailable",
            issue: "vault-unavailable",
          },
      telegram: available
        ? { state: "loading" }
        : {
            state: "unavailable",
            issue: "vault-unavailable",
          },
      discord: available
        ? { state: "loading" }
        : {
            state: "unavailable",
            issue: "vault-unavailable",
          },
    },
  });
}

function operationFor(
  command: RemoteHubCommand,
): RemoteHubClientOperation {
  switch (command.kind) {
    case "refresh":
    case "telegram/network/set":
    case "discord/network/set":
    case "telegram/reconnect":
    case "discord/reconnect":
    case "weixin/reconnect":
      return "reconnecting";
    case "gateway/reset-local":
    case "telegram/reset-local":
    case "discord/reset-local":
    case "weixin/reset-local":
      return "resetting";
    case "telegram/connect":
    case "discord/connect":
      return "connecting-channel";
    case "telegram/token/copy":
    case "discord/token/copy":
      return "copying-token";
    case "weixin/link/start":
      return "starting-link";
    case "weixin/link/verify":
    case "bot/pairing/approve":
      return "verifying";
    case "weixin/link/cancel":
    case "bot/pairing/dismiss":
      return "cancelling";
    case "telegram/disconnect":
    case "discord/disconnect":
      return "disconnecting";
    case "telegram/unlink":
    case "discord/unlink":
    case "weixin/unlink":
      return "unlinking";
  }
}

/** Root-scoped client owner for one Remote Settings and one IM projection. */
export class RemoteHubRuntime {
  readonly remote: RemoteSettingsRuntime;
  readonly #port: DesktopRemoteHubPort;
  readonly #listeners = new Set<() => void>();
  #snapshot: RemoteHubClientSnapshot;
  #initializePromise: Promise<void> | undefined;
  #unsubscribeRemote: (() => void) | undefined;
  #unsubscribeChannels: (() => void) | undefined;
  #returnFocus: HTMLElement | undefined;
  #sessionTriggerCount = 0;
  #commandTail: Promise<void> = Promise.resolve();
  #disposed = false;

  constructor(
    remote: RemoteSettingsRuntime,
    port: DesktopRemoteHubPort,
  ) {
    this.remote = remote;
    this.#port = port;
    this.#snapshot = Object.freeze({
      open: false,
      view: "weixin",
      remote: remote.getSnapshot(),
      channels: initialChannels(port.available),
      operation: "idle",
      error: undefined,
    });
    this.#unsubscribeRemote = remote.subscribe(() => {
      this.#publish({ remote: remote.getSnapshot() });
    });
    this.#unsubscribeChannels = port.subscribe((value) => {
      if (this.#disposed) return;
      const channels = parseRemoteHubSnapshot(value);
      if (
        channels.revision <= this.#snapshot.channels.revision
      ) {
        return;
      }
      this.#publish({ channels, error: undefined });
    });
  }

  getSnapshot = (): RemoteHubClientSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  hasSessionTrigger = (): boolean =>
    this.#sessionTriggerCount > 0;

  registerSessionTrigger(): () => void {
    if (this.#disposed) return () => {};
    this.#sessionTriggerCount += 1;
    this.#notify();
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      this.#sessionTriggerCount = Math.max(
        0,
        this.#sessionTriggerCount - 1,
      );
      this.#notify();
    };
  }

  initialize(): Promise<void> {
    this.#initializePromise ??= this.#initialize();
    return this.#initializePromise;
  }

  open(trigger?: HTMLElement): void {
    if (this.#disposed) return;
    this.#returnFocus = trigger;
    this.#publish({ open: true });
  }

  close(): void {
    if (this.#disposed || !this.#snapshot.open) return;
    this.#publish({ open: false });
    const returnFocus = this.#returnFocus;
    this.#returnFocus = undefined;
    window.requestAnimationFrame(() => {
      if (returnFocus?.isConnected) {
        returnFocus.focus();
        return;
      }
      document
        .querySelector<HTMLElement>(
          "[data-minke-remote-hub-action]",
        )
        ?.focus();
    });
  }

  setView(view: RemoteHubView): void {
    if (this.#disposed || this.#snapshot.view === view) return;
    this.#publish({ view });
  }

  dispatch(command: RemoteHubCommand): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    const run = async (): Promise<void> => {
      this.#publish({
        operation: operationFor(command),
        error: undefined,
      });
      try {
        const channels = parseRemoteHubSnapshot(
          await this.#port.dispatch(command),
        );
        if (
          channels.revision >
          this.#snapshot.channels.revision
        ) {
          this.#publish({ channels });
        }
      } catch {
        this.#publish({ error: "command" });
      } finally {
        this.#publish({ operation: "idle" });
      }
    };
    const operation = this.#commandTail.then(run, run);
    this.#commandTail = operation.catch(() => {});
    return operation;
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribeRemote?.();
    this.#unsubscribeRemote = undefined;
    this.#unsubscribeChannels?.();
    this.#unsubscribeChannels = undefined;
    await this.#commandTail;
    this.#listeners.clear();
    this.#returnFocus = undefined;
  }

  async #initialize(): Promise<void> {
    if (!this.#port.available) {
      return;
    }
    const startingRevision =
      this.#snapshot.channels.revision;
    try {
      const channels = parseRemoteHubSnapshot(
        await this.#port.read(),
      );
      if (
        !this.#disposed &&
        channels.revision >
          this.#snapshot.channels.revision
      ) {
        this.#publish({ channels, error: undefined });
      }
    } catch {
      if (
        !this.#disposed &&
        this.#snapshot.channels.revision <= startingRevision
      ) {
        this.#publish({ error: "read" });
      }
    }
  }

  #publish(
    patch: Partial<RemoteHubClientSnapshot>,
  ): void {
    if (this.#disposed) return;
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      ...patch,
    });
    this.#notify();
  }

  #notify(): void {
    if (this.#disposed) return;
    for (const listener of this.#listeners) listener();
  }
}
