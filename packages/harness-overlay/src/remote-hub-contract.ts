/** Renderer-safe contract for Minke's desktop Remote Capability Hub. */
export const REMOTE_HUB_READ_CHANNEL = "minke:remote-hub:read";
export const REMOTE_HUB_COMMAND_CHANNEL = "minke:remote-hub:command";
export const REMOTE_HUB_CHANGED_CHANNEL = "minke:remote-hub:changed";
export const MAX_WEIXIN_QR_CONTENT_BYTES = 2_048;

export type RemoteHubDependencyState =
  | "ready"
  | "unavailable"
  | "pending";

export type WeixinHubIssue =
  | "agent-route-pending"
  | "already-bound"
  | "credential-read"
  | "credential-store"
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
      readonly state: "degraded";
      readonly accountLabel: string;
      readonly issue: "agent-route-pending" | "receive";
    }
  | {
      readonly state: "error" | "session-stale";
      readonly issue: Exclude<
        WeixinHubIssue,
        "agent-route-pending" | "vault-unavailable"
      >;
    };

export interface RemoteHubSnapshot {
  readonly revision: number;
  readonly dependencies: {
    readonly credentialVault: RemoteHubDependencyState;
    readonly agentRoute: "pending";
  };
  readonly channels: {
    readonly weixin: WeixinHubSnapshot;
    readonly telegram: { readonly state: "planned" };
    readonly discord: { readonly state: "planned" };
  };
}

export type RemoteHubCommand =
  | { readonly kind: "refresh" }
  | { readonly kind: "gateway/reset-local" }
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

function timestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new TypeError("Weixin QR expiry is invalid");
  }
  return Number(value);
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
    case "degraded":
      exactKeys(
        candidate,
        ["state", "accountLabel", "issue"],
        "Weixin degraded snapshot",
      );
      if (
        candidate.issue !== "agent-route-pending" &&
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
          "agent-route-pending" | "vault-unavailable"
        >,
      };
    }
    default:
      throw new TypeError("Weixin Hub state is invalid");
  }
}

/** Reject secret-bearing or forward-incompatible Hub snapshots at preload. */
export function parseRemoteHubSnapshot(
  value: unknown,
): RemoteHubSnapshot {
  const candidate = record(value, "Remote Hub snapshot");
  exactKeys(
    candidate,
    ["revision", "dependencies", "channels"],
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
  if (dependencies.agentRoute !== "pending") {
    throw new TypeError("Remote Hub Agent route state is invalid");
  }
  const channels = record(candidate.channels, "Remote Hub channels");
  exactKeys(
    channels,
    ["weixin", "telegram", "discord"],
    "Remote Hub channels",
  );
  const telegram = record(channels.telegram, "Telegram snapshot");
  const discord = record(channels.discord, "Discord snapshot");
  exactKeys(telegram, ["state"], "Telegram snapshot");
  exactKeys(discord, ["state"], "Discord snapshot");
  if (
    telegram.state !== "planned" ||
    discord.state !== "planned"
  ) {
    throw new TypeError("Remote Hub planned channel state is invalid");
  }
  return {
    revision: revision(candidate.revision),
    dependencies: {
      credentialVault: dependencies.credentialVault,
      agentRoute: "pending",
    },
    channels: {
      weixin: parseWeixinHubSnapshot(channels.weixin),
      telegram: { state: "planned" },
      discord: { state: "planned" },
    },
  };
}

export function parseRemoteHubCommand(
  value: unknown,
): RemoteHubCommand {
  const candidate = record(value, "Remote Hub command");
  switch (candidate.kind) {
    case "refresh":
    case "gateway/reset-local":
    case "weixin/link/start":
    case "weixin/reconnect":
    case "weixin/reset-local":
    case "weixin/unlink":
      exactKeys(candidate, ["kind"], "Remote Hub command");
      return { kind: candidate.kind };
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
