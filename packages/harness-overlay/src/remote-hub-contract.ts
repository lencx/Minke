/** Renderer-safe contract for Minke's desktop Remote Capability Hub. */
export const REMOTE_HUB_READ_CHANNEL = "minke:remote-hub:read";
export const REMOTE_HUB_COMMAND_CHANNEL = "minke:remote-hub:command";
export const REMOTE_HUB_CHANGED_CHANNEL = "minke:remote-hub:changed";
export const MAX_WEIXIN_QR_CONTENT_BYTES = 2_048;

export interface TelegramNetworkSettings {
  readonly httpProxyUrl: string;
}

export const DEFAULT_TELEGRAM_NETWORK_SETTINGS:
  TelegramNetworkSettings = Object.freeze({
    httpProxyUrl: "",
  });

export interface DiscordNetworkSettings {
  /** Empty means automatic system/Telegram proxy discovery. */
  readonly httpProxyUrl: string;
}

export type DiscordProxySource =
  | "pending"
  | "direct"
  | "system"
  | "telegram"
  | "manual";

export interface DiscordNetworkSnapshot
  extends DiscordNetworkSettings {
  readonly proxySource: DiscordProxySource;
}

export const DEFAULT_DISCORD_NETWORK_SETTINGS:
  DiscordNetworkSettings = Object.freeze({
    httpProxyUrl: "",
  });

export const DEFAULT_DISCORD_NETWORK_SNAPSHOT:
  DiscordNetworkSnapshot = Object.freeze({
    ...DEFAULT_DISCORD_NETWORK_SETTINGS,
    proxySource: "pending",
  });

export interface BotDmPairingRequest {
  readonly code: string;
  readonly expiresAt: number;
  readonly requestId: string;
  readonly senderLabel: string;
}

export interface ImConnectionActivity {
  readonly connectedAt: number;
  readonly lastActivityAt?: number;
  readonly receivedMessages: number;
  readonly sentMessages: number;
}

export type RemoteHubDependencyState =
  | "ready"
  | "unavailable"
  | "pending";

export type WeixinHubIssue =
  | "agent"
  | "agent-route-pending"
  | "already-bound"
  | "authorization-missing"
  | "credential-read"
  | "credential-store"
  | "delivery"
  | "gateway-store"
  | "login-network"
  | "login-protocol"
  | "receive"
  | "session-stale"
  | "transport-start"
  | "vault-unavailable";

export type WeixinHubSnapshot =
  | {
      readonly state: "loading";
    }
  | {
      readonly state: "unavailable";
      readonly issue: "vault-unavailable";
    }
  | {
      readonly state: "unlinked";
    }
  | {
      readonly state: "linking";
      readonly flowId: string;
      readonly phase:
        | "waiting"
        | "scanned"
        | "verification-required";
      readonly challenge: {
        /** Transient QR payload. Never persist or log this value. */
        readonly content: string;
        readonly expiresAt: number;
      };
    }
  | {
      readonly state: "connecting";
      readonly accountLabel: string;
    }
  | {
      readonly state: "connected";
      readonly accountLabel: string;
      readonly activity?: ImConnectionActivity;
    }
  | {
      readonly state: "degraded";
      readonly accountLabel: string;
      readonly activity?: ImConnectionActivity;
      readonly issue:
        | "agent"
        | "agent-route-pending"
        | "authorization-missing"
        | "delivery"
        | "receive";
    }
  | {
      readonly state: "error" | "session-stale";
      readonly issue: Exclude<
        WeixinHubIssue,
        | "agent"
        | "agent-route-pending"
        | "authorization-missing"
        | "delivery"
        | "vault-unavailable"
      >;
    };

export type BotHubIssue =
  | "agent"
  | "agent-route-pending"
  | "credential-invalid"
  | "credential-read"
  | "credential-store"
  | "delivery"
  | "gateway-store"
  | "network"
  | "polling-conflict"
  | "privileged-intent"
  | "receive"
  | "transport-fatal"
  | "transport-start"
  | "vault-unavailable";

export type BotHubSnapshot =
  | {
      readonly state: "loading";
    }
  | {
      readonly state: "unavailable";
      readonly issue: "vault-unavailable";
    }
  | {
      readonly state: "unlinked";
    }
  | {
      readonly state: "connecting";
      readonly accountLabel: string;
    }
  | {
      readonly state: "disconnected";
      readonly accountLabel: string;
    }
  | {
      readonly state: "pairing";
      readonly accountLabel: string;
      readonly activity?: ImConnectionActivity;
      readonly request?: BotDmPairingRequest;
    }
  | {
      readonly state: "connected";
      readonly accountLabel: string;
      readonly activity?: ImConnectionActivity;
    }
  | {
      readonly state: "degraded";
      readonly accountLabel: string;
      readonly activity?: ImConnectionActivity;
      readonly issue:
        | "agent"
        | "agent-route-pending"
        | "delivery"
        | "receive";
    }
  | {
      readonly state: "error";
      readonly hasStoredCredential: boolean;
      readonly issue: Exclude<
        BotHubIssue,
        | "agent"
        | "agent-route-pending"
        | "delivery"
        | "receive"
        | "vault-unavailable"
      >;
    };

export interface RemoteHubSnapshot {
  readonly revision: number;
  readonly telegramNetwork: TelegramNetworkSettings;
  readonly discordNetwork: DiscordNetworkSnapshot;
  readonly dependencies: {
    readonly credentialVault: RemoteHubDependencyState;
    readonly agentRoute: RemoteHubDependencyState;
  };
  readonly channels: {
    readonly weixin: WeixinHubSnapshot;
    readonly telegram: BotHubSnapshot;
    readonly discord: BotHubSnapshot;
  };
}

export type RemoteHubCommand =
  | { readonly kind: "refresh" }
  | { readonly kind: "gateway/reset-local" }
  | {
      readonly kind: "telegram/connect";
      readonly token: string;
    }
  | {
      readonly kind: "telegram/network/set";
      readonly settings: TelegramNetworkSettings;
    }
  | {
      readonly kind: "discord/network/set";
      readonly settings: DiscordNetworkSettings;
    }
  | {
      readonly kind:
        | "bot/pairing/approve"
        | "bot/pairing/dismiss";
      readonly provider: "telegram" | "discord";
      readonly requestId: string;
    }
  | { readonly kind: "telegram/reconnect" }
  | { readonly kind: "telegram/token/copy" }
  | { readonly kind: "telegram/disconnect" }
  | { readonly kind: "telegram/reset-local" }
  | { readonly kind: "telegram/unlink" }
  | {
      readonly kind: "discord/connect";
      readonly token: string;
    }
  | { readonly kind: "discord/reconnect" }
  | { readonly kind: "discord/token/copy" }
  | { readonly kind: "discord/disconnect" }
  | { readonly kind: "discord/reset-local" }
  | { readonly kind: "discord/unlink" }
  | { readonly kind: "weixin/link/start" }
  | {
      readonly kind: "weixin/link/verify";
      readonly flowId: string;
      readonly code: string;
    }
  | {
      readonly kind: "weixin/link/cancel";
      readonly flowId: string;
    }
  | { readonly kind: "weixin/reconnect" }
  | { readonly kind: "weixin/reset-local" }
  | { readonly kind: "weixin/unlink" };

function record(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key))
  ) {
    throw new TypeError(`${label} has unexpected fields`);
  }
}

function boundedText(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function boundedUtf8Text(
  value: unknown,
  label: string,
  maxBytes: number,
): string {
  const text = boundedText(value, label, maxBytes);
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new TypeError(`${label} is invalid`);
  }
  return text;
}

function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError("Remote Hub revision is invalid");
  }
  return Number(value);
}

function timestamp(
  value: unknown,
  label = "Weixin QR expiry",
): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return Number(value);
}

function activityCount(
  value: unknown,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return Number(value);
}

function parseImConnectionActivity(
  value: unknown,
  label: string,
): ImConnectionActivity {
  const candidate = record(value, label);
  exactKeys(
    candidate,
    candidate.lastActivityAt === undefined
      ? ["connectedAt", "receivedMessages", "sentMessages"]
      : [
          "connectedAt",
          "lastActivityAt",
          "receivedMessages",
          "sentMessages",
        ],
    label,
  );
  return {
    connectedAt: timestamp(
      candidate.connectedAt,
      `${label} connection time`,
    ),
    ...(candidate.lastActivityAt === undefined
      ? {}
      : {
          lastActivityAt: timestamp(
            candidate.lastActivityAt,
            `${label} last activity time`,
          ),
        }),
    receivedMessages: activityCount(
      candidate.receivedMessages,
      `${label} received message count`,
    ),
    sentMessages: activityCount(
      candidate.sentMessages,
      `${label} sent message count`,
    ),
  };
}

function parseHttpProxySettings(
  value: unknown,
  provider: "Telegram" | "Discord",
): { readonly httpProxyUrl: string } {
  const candidate = record(
    value,
    `${provider} network settings`,
  );
  exactKeys(
    candidate,
    ["httpProxyUrl"],
    `${provider} network settings`,
  );
  if (candidate.httpProxyUrl === "") {
    return { httpProxyUrl: "" };
  }
  if (
    typeof candidate.httpProxyUrl !== "string" ||
    candidate.httpProxyUrl.length > 2_048
  ) {
    throw new TypeError(`${provider} HTTP proxy URL is invalid`);
  }
  let url: URL;
  try {
    url = new URL(candidate.httpProxyUrl);
  } catch {
    throw new TypeError(`${provider} HTTP proxy URL is invalid`);
  }
  const port = Number(url.port);
  if (
    url.protocol !== "http:" ||
    url.hostname === "" ||
    url.port === "" ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new TypeError(
      `${provider} HTTP proxy must be an unauthenticated http://host:port endpoint`,
    );
  }
  return {
    httpProxyUrl: `http://${url.host}`,
  };
}

export function parseTelegramNetworkSettings(
  value: unknown,
): TelegramNetworkSettings {
  return parseHttpProxySettings(value, "Telegram");
}

export function parseDiscordNetworkSettings(
  value: unknown,
): DiscordNetworkSettings {
  return parseHttpProxySettings(value, "Discord");
}

export function parseDiscordNetworkSnapshot(
  value: unknown,
): DiscordNetworkSnapshot {
  const candidate = record(
    value,
    "Discord network snapshot",
  );
  exactKeys(
    candidate,
    ["httpProxyUrl", "proxySource"],
    "Discord network snapshot",
  );
  const settings = parseDiscordNetworkSettings({
    httpProxyUrl: candidate.httpProxyUrl,
  });
  const sources: readonly DiscordProxySource[] = [
    "pending",
    "direct",
    "system",
    "telegram",
    "manual",
  ];
  if (
    !sources.includes(
      candidate.proxySource as DiscordProxySource,
    )
  ) {
    throw new TypeError("Discord proxy source is invalid");
  }
  return {
    ...settings,
    proxySource: candidate.proxySource as DiscordProxySource,
  };
}

function parseWeixinHubSnapshot(
  value: unknown,
): WeixinHubSnapshot {
  const candidate = record(value, "Weixin Hub snapshot");
  switch (candidate.state) {
    case "loading":
      exactKeys(candidate, ["state"], "Weixin loading snapshot");
      return { state: "loading" };
    case "unavailable":
      exactKeys(candidate, ["state", "issue"], "Weixin unavailable snapshot");
      if (candidate.issue !== "vault-unavailable") {
        throw new TypeError("Weixin unavailable issue is invalid");
      }
      return { state: "unavailable", issue: "vault-unavailable" };
    case "unlinked":
      exactKeys(candidate, ["state"], "Weixin unlinked snapshot");
      return { state: "unlinked" };
    case "linking": {
      exactKeys(
        candidate,
        ["state", "flowId", "phase", "challenge"],
        "Weixin linking snapshot",
      );
      if (
        candidate.phase !== "waiting" &&
        candidate.phase !== "scanned" &&
        candidate.phase !== "verification-required"
      ) {
        throw new TypeError("Weixin linking phase is invalid");
      }
      const challenge = record(
        candidate.challenge,
        "Weixin QR challenge",
      );
      exactKeys(
        challenge,
        ["content", "expiresAt"],
        "Weixin QR challenge",
      );
      return {
        state: "linking",
        flowId: boundedText(candidate.flowId, "Weixin flow id", 128),
        phase: candidate.phase,
        challenge: {
          content: boundedUtf8Text(
            challenge.content,
            "Weixin QR content",
            MAX_WEIXIN_QR_CONTENT_BYTES,
          ),
          expiresAt: timestamp(challenge.expiresAt),
        },
      };
    }
    case "connecting":
      exactKeys(
        candidate,
        ["state", "accountLabel"],
        "Weixin connecting snapshot",
      );
      return {
        state: "connecting",
        accountLabel: boundedText(
          candidate.accountLabel,
          "Weixin account label",
          64,
        ),
      };
    case "connected": {
      exactKeys(
        candidate,
        candidate.activity === undefined
          ? ["state", "accountLabel"]
          : ["state", "accountLabel", "activity"],
        "Weixin connected snapshot",
      );
      return {
        state: "connected",
        accountLabel: boundedText(
          candidate.accountLabel,
          "Weixin account label",
          64,
        ),
        ...(candidate.activity === undefined
          ? {}
          : {
              activity: parseImConnectionActivity(
                candidate.activity,
                "Weixin connection activity",
              ),
            }),
      };
    }
    case "degraded":
      exactKeys(
        candidate,
        candidate.activity === undefined
          ? ["state", "accountLabel", "issue"]
          : ["state", "accountLabel", "issue", "activity"],
        "Weixin degraded snapshot",
      );
      if (
        candidate.issue !== "agent" &&
        candidate.issue !== "agent-route-pending" &&
        candidate.issue !== "authorization-missing" &&
        candidate.issue !== "delivery" &&
        candidate.issue !== "receive"
      ) {
        throw new TypeError("Weixin degraded issue is invalid");
      }
      return {
        state: "degraded",
        accountLabel: boundedText(
          candidate.accountLabel,
          "Weixin account label",
          64,
        ),
        ...(candidate.activity === undefined
          ? {}
          : {
              activity: parseImConnectionActivity(
                candidate.activity,
                "Weixin connection activity",
              ),
            }),
        issue: candidate.issue,
      };
    case "error":
    case "session-stale": {
      exactKeys(
        candidate,
        ["state", "issue"],
        "Weixin error snapshot",
      );
      const issues: readonly WeixinHubIssue[] = [
        "already-bound",
        "credential-read",
        "credential-store",
        "gateway-store",
        "login-network",
        "login-protocol",
        "receive",
        "session-stale",
        "transport-start",
      ];
      if (!issues.includes(candidate.issue as WeixinHubIssue)) {
        throw new TypeError("Weixin error issue is invalid");
      }
      return {
        state: candidate.state,
        issue: candidate.issue as Exclude<
          WeixinHubIssue,
          | "agent"
          | "agent-route-pending"
          | "authorization-missing"
          | "delivery"
          | "vault-unavailable"
        >,
      };
    }
    default:
      throw new TypeError("Weixin Hub state is invalid");
  }
}

function parseBotHubSnapshot(
  value: unknown,
  provider: "Telegram" | "Discord",
): BotHubSnapshot {
  const candidate = record(value, `${provider} Hub snapshot`);
  switch (candidate.state) {
    case "loading":
      exactKeys(
        candidate,
        ["state"],
        `${provider} loading snapshot`,
      );
      return { state: "loading" };
    case "unavailable":
      exactKeys(
        candidate,
        ["state", "issue"],
        `${provider} unavailable snapshot`,
      );
      if (candidate.issue !== "vault-unavailable") {
        throw new TypeError(
          `${provider} unavailable issue is invalid`,
        );
      }
      return {
        state: "unavailable",
        issue: "vault-unavailable",
      };
    case "unlinked":
      exactKeys(
        candidate,
        ["state"],
        `${provider} unlinked snapshot`,
      );
      return { state: "unlinked" };
    case "connecting":
      exactKeys(
        candidate,
        ["state", "accountLabel"],
        `${provider} connecting snapshot`,
      );
      return {
        state: "connecting",
        accountLabel: boundedText(
          candidate.accountLabel,
          `${provider} account label`,
          128,
        ),
      };
    case "disconnected":
      exactKeys(
        candidate,
        ["state", "accountLabel"],
        `${provider} disconnected snapshot`,
      );
      return {
        state: "disconnected",
        accountLabel: boundedText(
          candidate.accountLabel,
          `${provider} account label`,
          128,
        ),
      };
    case "pairing": {
      const pairingKeys = ["state", "accountLabel"];
      if (candidate.request !== undefined) {
        pairingKeys.push("request");
      }
      if (candidate.activity !== undefined) {
        pairingKeys.push("activity");
      }
      exactKeys(
        candidate,
        pairingKeys,
        `${provider} pairing snapshot`,
      );
      let request: BotDmPairingRequest | undefined;
      if (candidate.request !== undefined) {
        const pairing = record(
          candidate.request,
          `${provider} pairing request`,
        );
        exactKeys(
          pairing,
          ["code", "expiresAt", "requestId", "senderLabel"],
          `${provider} pairing request`,
        );
        if (
          typeof pairing.code !== "string" ||
          !/^[A-HJ-NP-Z2-9]{8}$/u.test(pairing.code)
        ) {
          throw new TypeError(
            `${provider} pairing code is invalid`,
          );
        }
        request = {
          code: pairing.code,
          expiresAt: timestamp(pairing.expiresAt),
          requestId: boundedText(
            pairing.requestId,
            `${provider} pairing request id`,
            128,
          ),
          senderLabel: boundedText(
            pairing.senderLabel,
            `${provider} pairing sender label`,
            128,
          ),
        };
      }
      return {
        state: "pairing",
        accountLabel: boundedText(
          candidate.accountLabel,
          `${provider} account label`,
          128,
        ),
        ...(candidate.activity === undefined
          ? {}
          : {
              activity: parseImConnectionActivity(
                candidate.activity,
                `${provider} connection activity`,
              ),
            }),
        ...(request === undefined ? {} : { request }),
      };
    }
    case "connected":
      exactKeys(
        candidate,
        candidate.activity === undefined
          ? ["state", "accountLabel"]
          : ["state", "accountLabel", "activity"],
        `${provider} connected snapshot`,
      );
      return {
        state: "connected",
        accountLabel: boundedText(
          candidate.accountLabel,
          `${provider} account label`,
          128,
        ),
        ...(candidate.activity === undefined
          ? {}
          : {
              activity: parseImConnectionActivity(
                candidate.activity,
                `${provider} connection activity`,
              ),
            }),
      };
    case "degraded":
      exactKeys(
        candidate,
        candidate.activity === undefined
          ? ["state", "accountLabel", "issue"]
          : ["state", "accountLabel", "issue", "activity"],
        `${provider} degraded snapshot`,
      );
      if (
        candidate.issue !== "agent" &&
        candidate.issue !== "agent-route-pending" &&
        candidate.issue !== "delivery" &&
        candidate.issue !== "receive"
      ) {
        throw new TypeError(
          `${provider} degraded issue is invalid`,
        );
      }
      return {
        state: "degraded",
        accountLabel: boundedText(
          candidate.accountLabel,
          `${provider} account label`,
          128,
        ),
        ...(candidate.activity === undefined
          ? {}
          : {
              activity: parseImConnectionActivity(
                candidate.activity,
                `${provider} connection activity`,
              ),
            }),
        issue: candidate.issue,
      };
    case "error": {
      exactKeys(
        candidate,
        ["state", "issue", "hasStoredCredential"],
        `${provider} error snapshot`,
      );
      const issues = [
        "credential-invalid",
        "credential-read",
        "credential-store",
        "gateway-store",
        "network",
        "polling-conflict",
        "privileged-intent",
        "transport-fatal",
        "transport-start",
      ] as const;
      if (
        typeof candidate.hasStoredCredential !== "boolean" ||
        !issues.includes(
          candidate.issue as (typeof issues)[number],
        )
      ) {
        throw new TypeError(`${provider} error issue is invalid`);
      }
      return {
        state: "error",
        hasStoredCredential: candidate.hasStoredCredential,
        issue: candidate.issue as (typeof issues)[number],
      };
    }
    default:
      throw new TypeError(`${provider} Hub state is invalid`);
  }
}

/** Reject secret-bearing or forward-incompatible Hub snapshots at preload. */
export function parseRemoteHubSnapshot(
  value: unknown,
): RemoteHubSnapshot {
  const candidate = record(value, "Remote Hub snapshot");
  exactKeys(
    candidate,
    [
      "revision",
      "telegramNetwork",
      "discordNetwork",
      "dependencies",
      "channels",
    ],
    "Remote Hub snapshot",
  );
  const dependencies = record(
    candidate.dependencies,
    "Remote Hub dependencies",
  );
  exactKeys(
    dependencies,
    ["credentialVault", "agentRoute"],
    "Remote Hub dependencies",
  );
  if (
    dependencies.credentialVault !== "ready" &&
    dependencies.credentialVault !== "unavailable" &&
    dependencies.credentialVault !== "pending"
  ) {
    throw new TypeError("Remote Hub vault state is invalid");
  }
  if (
    dependencies.agentRoute !== "ready" &&
    dependencies.agentRoute !== "unavailable" &&
    dependencies.agentRoute !== "pending"
  ) {
    throw new TypeError("Remote Hub Agent route state is invalid");
  }
  const channels = record(candidate.channels, "Remote Hub channels");
  exactKeys(
    channels,
    ["weixin", "telegram", "discord"],
    "Remote Hub channels",
  );
  return {
    revision: revision(candidate.revision),
    telegramNetwork: parseTelegramNetworkSettings(
      candidate.telegramNetwork,
    ),
    discordNetwork: parseDiscordNetworkSnapshot(
      candidate.discordNetwork,
    ),
    dependencies: {
      credentialVault: dependencies.credentialVault,
      agentRoute: dependencies.agentRoute,
    },
    channels: {
      weixin: parseWeixinHubSnapshot(channels.weixin),
      telegram: parseBotHubSnapshot(
        channels.telegram,
        "Telegram",
      ),
      discord: parseBotHubSnapshot(
        channels.discord,
        "Discord",
      ),
    },
  };
}

function botToken(value: unknown, provider: string): string {
  if (
    typeof value !== "string" ||
    value.length < 20 ||
    value.length > 4_096 ||
    /\s/u.test(value) ||
    new TextEncoder().encode(value).byteLength > 4_096
  ) {
    throw new TypeError(`${provider} bot token is invalid`);
  }
  return value;
}

export function parseRemoteHubCommand(
  value: unknown,
): RemoteHubCommand {
  const candidate = record(value, "Remote Hub command");
  switch (candidate.kind) {
    case "refresh":
    case "gateway/reset-local":
    case "telegram/reconnect":
    case "telegram/token/copy":
    case "telegram/disconnect":
    case "telegram/reset-local":
    case "telegram/unlink":
    case "discord/reconnect":
    case "discord/token/copy":
    case "discord/disconnect":
    case "discord/reset-local":
    case "discord/unlink":
    case "weixin/link/start":
    case "weixin/reconnect":
    case "weixin/reset-local":
    case "weixin/unlink":
      exactKeys(candidate, ["kind"], "Remote Hub command");
      return { kind: candidate.kind };
    case "telegram/network/set":
      exactKeys(
        candidate,
        ["kind", "settings"],
        "Remote Hub Telegram network command",
      );
      return {
        kind: candidate.kind,
        settings: parseTelegramNetworkSettings(
          candidate.settings,
        ),
      };
    case "discord/network/set":
      exactKeys(
        candidate,
        ["kind", "settings"],
        "Remote Hub Discord network command",
      );
      return {
        kind: candidate.kind,
        settings: parseDiscordNetworkSettings(
          candidate.settings,
        ),
      };
    case "bot/pairing/approve":
    case "bot/pairing/dismiss":
      exactKeys(
        candidate,
        ["kind", "provider", "requestId"],
        "Remote Hub bot pairing command",
      );
      if (
        candidate.provider !== "telegram" &&
        candidate.provider !== "discord"
      ) {
        throw new TypeError(
          "Remote Hub pairing provider is invalid",
        );
      }
      return {
        kind: candidate.kind,
        provider: candidate.provider,
        requestId: boundedText(
          candidate.requestId,
          "Bot pairing request id",
          128,
        ),
      };
    case "telegram/connect":
    case "discord/connect": {
      exactKeys(
        candidate,
        ["kind", "token"],
        "Remote Hub bot connect command",
      );
      const provider =
        candidate.kind === "telegram/connect"
          ? "Telegram"
          : "Discord";
      return {
        kind: candidate.kind,
        token: botToken(candidate.token, provider),
      };
    }
    case "weixin/link/cancel":
      exactKeys(
        candidate,
        ["kind", "flowId"],
        "Remote Hub cancel command",
      );
      return {
        kind: candidate.kind,
        flowId: boundedText(candidate.flowId, "Weixin flow id", 128),
      };
    case "weixin/link/verify":
      exactKeys(
        candidate,
        ["kind", "flowId", "code"],
        "Remote Hub verification command",
      );
      if (
        typeof candidate.code !== "string" ||
        !/^[0-9]{1,32}$/u.test(candidate.code)
      ) {
        throw new TypeError("Weixin verification code is invalid");
      }
      return {
        kind: candidate.kind,
        flowId: boundedText(candidate.flowId, "Weixin flow id", 128),
        code: candidate.code,
      };
    default:
      throw new TypeError("Remote Hub command kind is invalid");
  }
}
