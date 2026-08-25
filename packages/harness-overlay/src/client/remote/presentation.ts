import type {
  RemoteRuntimeState,
} from "@lencx/minke-remote-access/contract";
import type {
  RemoteLocaleKey,
} from "./locales.ts";
import type {
  RemoteSettingsSnapshot,
} from "./runtime.ts";

export interface RemoteStatusPresentation {
  state: RemoteRuntimeState | "saving";
  statusKey: RemoteLocaleKey;
  helpKey: RemoteLocaleKey | undefined;
  canRefresh: boolean;
  showAddress: boolean;
}

const MASKED_REMOTE_ADDRESS = "https://••••";

/** Keep the endpoint recognizable without rendering its full private name. */
export function maskRemoteAddress(value: string): string {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return MASKED_REMOTE_ADDRESS;
    }
    const parts = url.hostname.split(".");
    const maskedHost =
      parts.length === 4 &&
      parts.every((part) => /^\d{1,3}$/u.test(part))
        ? `${parts[0]}.•••.•••.${parts[3]}`
        : url.hostname.length >= 16
          ? `${url.hostname.slice(0, 8)}••••${url.hostname.slice(-8)}`
          : "••••";
    const port =
      url.port === "" ? "" : `:${url.port}`;
    return `${url.protocol}//${maskedHost}${port}`;
  } catch {
    return MASKED_REMOTE_ADDRESS;
  }
}

/** Project persistence and live provider state into one status presentation. */
export function presentRemoteStatus(
  snapshot: RemoteSettingsSnapshot,
): RemoteStatusPresentation {
  const runtime = snapshot.data.runtime;
  const hasAddress =
    runtime.state === "ready" || runtime.state === "active";
  if (snapshot.operation.kind === "saving") {
    return {
      state: "saving",
      statusKey: "statusSaving",
      helpKey: "savingChange",
      canRefresh: false,
      showAddress: hasAddress,
    };
  }

  return {
    state: runtime.state,
    statusKey: statusKey(runtime.state),
    helpKey:
      (
        runtime.state === "error" ||
        runtime.state === "retrying"
      )
        ? errorHelpKey(runtime.error)
        : undefined,
    canRefresh: true,
    showAddress: hasAddress,
  };
}

function statusKey(
  state: RemoteRuntimeState,
): RemoteLocaleKey {
  switch (state) {
    case "disabled":
      return "statusDisabled";
    case "unavailable":
      return "statusUnavailable";
    case "starting":
      return "statusStarting";
    case "stopping":
      return "statusStopping";
    case "retrying":
      return "statusRetrying";
    case "ready":
      return "statusReady";
    case "active":
      return "statusActive";
    case "error":
      return "statusError";
  }
}

function errorHelpKey(
  error: RemoteSettingsSnapshot["data"]["runtime"]["error"],
): RemoteLocaleKey {
  switch (error) {
    case "status":
      return "statusErrorHelp";
    case "serve-conflict":
      return "serveConflictErrorHelp";
    case "serve-https":
      return "serveHttpsErrorHelp";
    case "serve-permission":
      return "servePermissionErrorHelp";
    case "direct-ip":
      return "directIpErrorHelp";
    case "direct-bind":
      return "directBindErrorHelp";
    case "harness-control":
      return "harnessControlErrorHelp";
    case "cloudflare-config":
      return "cloudflareConfigErrorHelp";
    case "cloudflare-access":
      return "cloudflareAccessErrorHelp";
    case "cloudflare-tunnel":
      return "cloudflareTunnelErrorHelp";
    case "serve":
    case undefined:
      return "serveErrorHelp";
  }
}
