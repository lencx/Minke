import {
  Cast,
  RadioTower,
  ShieldCheck,
  X,
} from "@lucide/icons";
import QRCode from "qrcode";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  parseDiscordNetworkSettings,
  parseTelegramNetworkSettings,
  type BotHubIssue,
  type BotHubSnapshot,
  type ImConnectionActivity,
  type RemoteHubCommand,
  type WeixinHubIssue,
  type WeixinHubSnapshot,
} from "@minke/harness-overlay/remote-hub-contract.ts";
import {
  RemoteSettingsSection,
} from "../remote/RemoteSettingsSection.tsx";
import {
  hasMacOSDesktopSurface,
} from "../desktop/window.ts";
import {
  presentRemoteStatus,
} from "../remote/presentation.ts";
import type {
  RemoteTranslate,
} from "../remote/locales.ts";
import {
  LucideIcon,
} from "../tabs/components/LucideIcon.ts";
import type {
  RemoteHubTranslate,
} from "./locales.ts";
import type {
  RemoteHubRuntime,
  RemoteHubView,
} from "./runtime.ts";

const FOCUSABLE_SELECTOR = [
  "button:not(:disabled)",
  "input:not(:disabled)",
  '[href]:not([aria-disabled="true"])',
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type MessagingProvider = "weixin" | "telegram" | "discord";

const MESSAGING_PROVIDER_ICON_PATHS: Readonly<
  Record<MessagingProvider, readonly string[]>
> = Object.freeze({
  weixin: Object.freeze([
    "M15.85 8.14c.39 0 .77.03 1.14.08C16.31 5.25 13.19 3 9.44 3c-4.25 0-7.7 2.88-7.7 6.43c0 2.05 1.15 3.86 2.94 5.04L3.67 16.5l2.76-1.19c.59.21 1.21.38 1.87.47c-.09-.39-.14-.79-.14-1.21c-.01-3.54 3.44-6.43 7.69-6.43M12 5.89a.96.96 0 1 1 0 1.92a.96.96 0 0 1 0-1.92M6.87 7.82a.96.96 0 1 1 0-1.92a.96.96 0 0 1 0 1.92",
    "M22.26 14.57c0-2.84-2.87-5.14-6.41-5.14s-6.41 2.3-6.41 5.14s2.87 5.14 6.41 5.14c.58 0 1.14-.08 1.67-.2L20.98 21l-1.2-2.4c1.5-.94 2.48-2.38 2.48-4.03m-8.34-.32a.96.96 0 1 1 .96-.96c.01.53-.43.96-.96.96m3.85 0a.96.96 0 1 1 0-1.92a.96.96 0 0 1 0 1.92",
  ]),
  telegram: Object.freeze([
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2m4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19c-.14.75-.42 1-.68 1.03c-.58.05-1.02-.38-1.58-.75c-.88-.58-1.38-.94-2.23-1.5c-.99-.65-.35-1.01.22-1.59c.15-.15 2.71-2.48 2.76-2.69a.2.2 0 0 0-.05-.18c-.06-.05-.14-.03-.21-.02c-.09.02-1.49.95-4.22 2.79c-.4.27-.76.41-1.08.4c-.36-.01-1.04-.2-1.55-.37c-.63-.2-1.12-.31-1.08-.66c.02-.18.27-.36.74-.55c2.92-1.27 4.86-2.11 5.83-2.51c2.78-1.16 3.35-1.36 3.73-1.36c.08 0 .27.02.39.12c.1.08.13.19.14.27c-.01.06.01.24 0 .38",
  ]),
  discord: Object.freeze([
    "M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.1.1 0 0 0-.07.03c-.18.33-.39.76-.53 1.09a16.1 16.1 0 0 0-4.8 0c-.14-.34-.35-.76-.54-1.09c-.01-.02-.04-.03-.07-.03c-1.5.26-2.93.71-4.27 1.33c-.01 0-.02.01-.03.02c-2.72 4.07-3.47 8.03-3.1 11.95c0 .02.01.04.03.05c1.8 1.32 3.53 2.12 5.24 2.65c.03.01.06 0 .07-.02c.4-.55.76-1.13 1.07-1.74c.02-.04 0-.08-.04-.09c-.57-.22-1.11-.48-1.64-.78c-.04-.02-.04-.08-.01-.11c.11-.08.22-.17.33-.25c.02-.02.05-.02.07-.01c3.44 1.57 7.15 1.57 10.55 0c.02-.01.05-.01.07.01c.11.09.22.17.33.26c.04.03.04.09-.01.11c-.52.31-1.07.56-1.64.78c-.04.01-.05.06-.04.09c.32.61.68 1.19 1.07 1.74c.03.01.06.02.09.01c1.72-.53 3.45-1.33 5.25-2.65c.02-.01.03-.03.03-.05c.44-4.53-.73-8.46-3.1-11.95c-.01-.01-.02-.02-.04-.02M8.52 14.91c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12c0 1.17-.84 2.12-1.89 2.12m6.97 0c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12c0 1.17-.83 2.12-1.89 2.12",
  ]),
});

function MessagingProviderIcon({
  provider,
}: {
  readonly provider: MessagingProvider;
}): ReactNode {
  return (
    <svg
      className="minke-remote-hub__brand-icon"
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {MESSAGING_PROVIDER_ICON_PATHS[provider].map((path) => (
        <path key={path} fill="currentColor" d={path} />
      ))}
    </svg>
  );
}

function activityDuration(
  connectedAt: number,
  now: number,
  t: RemoteHubTranslate,
): string {
  const minutes = Math.floor(
    Math.max(0, now - connectedAt) / 60_000,
  );
  if (minutes < 1) return t("activityUnderMinute");
  if (minutes < 60) {
    return t("activityMinutes").replace(
      "{count}",
      String(minutes),
    );
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t("activityHoursMinutes")
      .replace("{hours}", String(hours))
      .replace("{minutes}", String(minutes % 60));
  }
  return t("activityDaysHours")
    .replace("{days}", String(Math.floor(hours / 24)))
    .replace("{hours}", String(hours % 24));
}

function activityTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function ConnectionActivity({
  activity,
  t,
}: {
  readonly activity: ImConnectionActivity;
  readonly t: RemoteHubTranslate;
}): ReactNode {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [activity.connectedAt]);
  const number = new Intl.NumberFormat();
  const lastActivity =
    activity.lastActivityAt === undefined
      ? t("activityNone")
      : activityTime(activity.lastActivityAt);

  return (
    <div
      className="minke-remote-hub__activity"
      role="group"
      aria-label={t("activityTitle")}
    >
      <dl className="minke-remote-hub__activity-grid">
        <div>
          <dt>{t("activityConnectedAt")}</dt>
          <dd>
            <time
              dateTime={new Date(
                activity.connectedAt,
              ).toISOString()}
            >
              {activityTime(activity.connectedAt)}
            </time>
          </dd>
        </div>
        <div>
          <dt>{t("activityUptime")}</dt>
          <dd>
            {activityDuration(activity.connectedAt, now, t)}
          </dd>
        </div>
        <div>
          <dt>{t("activityReceived")}</dt>
          <dd>
            {number.format(activity.receivedMessages)}
          </dd>
        </div>
        <div>
          <dt>{t("activitySent")}</dt>
          <dd>{number.format(activity.sentMessages)}</dd>
        </div>
      </dl>
      <p className="minke-remote-hub__activity-note">
        <span>
          {t("activityLast")}: {lastActivity}
        </span>
        <span>{t("activitySessionNote")}</span>
      </p>
    </div>
  );
}

interface SessionListSelection {
  readonly current: string | undefined;
  readonly byId: Readonly<
    Record<string, { readonly blank?: boolean } | undefined>
  >;
}

export interface RemoteHubActionProps {
  readonly location?: "fallback" | "session";
  readonly runtime: RemoteHubRuntime;
  readonly t: RemoteHubTranslate;
}

export interface NewSessionRemoteHubActionProps
  extends RemoteHubActionProps {
  readonly useSessions: <T>(
    selector: (state: SessionListSelection) => T,
  ) => T;
}

export interface RemoteHubDialogHostProps
  extends RemoteHubActionProps {
  readonly openExternal?: (url: string) => void;
  readonly remoteT: RemoteTranslate;
}

function hubState(
  snapshot: ReturnType<RemoteHubRuntime["getSnapshot"]>,
): "idle" | "working" | "active" | "attention" {
  const remoteState = snapshot.remote.data.runtime.state;
  const weixin = snapshot.channels.channels.weixin;
  const botChannels = [
    snapshot.channels.channels.telegram,
    snapshot.channels.channels.discord,
  ];
  if (
    weixin.state === "connected" ||
    weixin.state === "degraded" ||
    botChannels.some(
      (channel) =>
        channel.state === "pairing" ||
        channel.state === "connected" ||
        channel.state === "degraded",
    ) ||
    remoteState === "active" ||
    remoteState === "ready"
  ) {
    return "active";
  }
  if (
    weixin.state === "error" ||
    weixin.state === "session-stale" ||
    botChannels.some((channel) => channel.state === "error") ||
    snapshot.error !== undefined ||
    snapshot.remote.error === "read" ||
    snapshot.remote.error === "write" ||
    remoteState === "error"
  ) {
    return "attention";
  }
  if (
    snapshot.operation !== "idle" ||
    snapshot.remote.operation.kind !== "idle" ||
    weixin.state === "loading" ||
    weixin.state === "linking" ||
    weixin.state === "connecting" ||
    botChannels.some(
      (channel) =>
        channel.state === "loading" ||
        channel.state === "connecting",
    ) ||
    remoteState === "starting" ||
    remoteState === "stopping" ||
    remoteState === "retrying"
  ) {
    return "working";
  }
  return "idle";
}

function connectionTone(
  state: string,
): "success" | undefined {
  return state === "connected" ||
    state === "active" ||
    state === "pairing"
    ? "success"
    : undefined;
}

/** One top-bar entry shared by active and blank Session chrome. */
export function RemoteHubAction({
  location = "session",
  runtime,
  t,
}: RemoteHubActionProps): ReactNode {
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const state = hubState(snapshot);
  const accessibleLabel = t(({
    active: "triggerActive",
    attention: "triggerAttention",
    idle: "triggerIdle",
    working: "triggerWorking",
  } as const)[state]);
  useLayoutEffect(() => {
    if (location !== "session") return;
    return runtime.registerSessionTrigger();
  }, [location, runtime]);
  return (
    <button
      ref={triggerRef}
      type="button"
      data-minke-remote-hub-action
      data-location={location}
      data-state={state}
      aria-label={accessibleLabel}
      aria-haspopup="dialog"
      aria-expanded={snapshot.open}
      title={t("trigger")}
      onClick={() => runtime.open(triggerRef.current ?? undefined)}
    >
      <LucideIcon icon={Cast} size={16} />
      <span aria-hidden="true" data-minke-remote-hub-indicator />
    </button>
  );
}

/** Keep the same Remote entry visible while blank Session chrome is absent. */
export function NewSessionRemoteHubAction({
  runtime,
  t,
  useSessions,
}: NewSessionRemoteHubActionProps): ReactNode {
  const isNewSession = useSessions((state) => {
    if (state.current === undefined) return true;
    return state.byId[state.current]?.blank === true;
  });
  const hasSessionTrigger = useSyncExternalStore(
    runtime.subscribe,
    runtime.hasSessionTrigger,
    runtime.hasSessionTrigger,
  );
  if (!isNewSession || hasSessionTrigger) return null;
  return (
    <div data-minke-new-session-remote-hub-action>
      <RemoteHubAction
        location="fallback"
        runtime={runtime}
        t={t}
      />
    </div>
  );
}

type QrRenderState =
  | { readonly state: "idle" | "loading" | "error" }
  | { readonly state: "ready"; readonly dataUrl: string };

function useQrDataUrl(
  content: string | undefined,
): QrRenderState {
  const [result, setResult] = useState<QrRenderState>({
    state: "idle",
  });
  useEffect(() => {
    let active = true;
    setResult({
      state: content === undefined ? "idle" : "loading",
    });
    if (content === undefined) return () => {
      active = false;
    };
    void Promise.resolve()
      .then(() =>
        QRCode.toDataURL(content, {
          color: {
            dark: "#111827",
            light: "#ffffff",
          },
          errorCorrectionLevel: "M",
          margin: 2,
          width: 224,
        }),
      )
      .then((dataUrl) => {
        if (active) setResult({ state: "ready", dataUrl });
      })
      .catch(() => {
        if (active) setResult({ state: "error" });
      });
    return () => {
      active = false;
    };
  }, [content]);
  return result;
}

function statusLabel(
  value: WeixinHubSnapshot,
  t: RemoteHubTranslate,
): string {
  switch (value.state) {
    case "loading":
      return t("loading");
    case "unavailable":
      return t("unavailable");
    case "unlinked":
      return t("unlinked");
    case "linking":
      switch (value.phase) {
        case "waiting":
          return t("waiting");
        case "scanned":
          return t("scanned");
        case "verification-required":
          return t("verificationRequired");
      }
    case "connecting":
      return t("connecting");
    case "connected":
      return t("connected");
    case "degraded":
      return t(
        value.issue === "agent-route-pending" ||
          value.issue === "authorization-missing"
          ? "linkedLimited"
          : "attention",
      );
    case "error":
    case "session-stale":
      return t("attention");
  }
}

function issueText(
  issue: WeixinHubIssue,
  t: RemoteHubTranslate,
): string {
  switch (issue) {
    case "agent-route-pending":
      return t("agentRoutePending");
    case "authorization-missing":
      return t("authorizationMissing");
    case "agent":
      return t("agentIssue");
    case "delivery":
      return t("deliveryIssue");
    case "receive":
      return t("receiveIssue");
    case "vault-unavailable":
      return t("vaultUnavailable");
    case "already-bound":
      return t("alreadyBound");
    case "credential-read":
      return t("credentialRead");
    case "credential-store":
      return t("credentialStore");
    case "gateway-store":
      return t("gatewayStore");
    case "login-network":
      return t("loginNetwork");
    case "login-protocol":
      return t("loginProtocol");
    case "transport-start":
      return t("transportStart");
    case "session-stale":
      return t("sessionStale");
  }
}

function WeixinChannel({
  runtime,
  snapshot,
  t,
}: {
  readonly runtime: RemoteHubRuntime;
  readonly snapshot: ReturnType<RemoteHubRuntime["getSnapshot"]>;
  readonly t: RemoteHubTranslate;
}): ReactNode {
  const weixin = snapshot.channels.channels.weixin;
  const [code, setCode] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const previousConfirmResetRef = useRef(false);
  const channelRef = useRef<HTMLElement>(null);
  const resetTriggerRef = useRef<HTMLButtonElement>(null);
  const resetConfirmRef = useRef<HTMLButtonElement>(null);
  const codeId = useId();
  const qrContent =
    weixin.state === "linking"
      ? weixin.challenge.content
      : undefined;
  const qr = useQrDataUrl(qrContent);
  const busy = snapshot.operation !== "idle";

  useEffect(() => {
    if (
      weixin.state !== "linking" ||
      weixin.phase !== "verification-required"
    ) {
      setCode("");
    }
  }, [
    weixin.state,
    weixin.state === "linking"
      ? weixin.flowId
      : undefined,
    weixin.state === "linking"
      ? weixin.phase
      : undefined,
  ]);

  useEffect(() => {
    setConfirmReset(false);
  }, [
    weixin.state,
    weixin.state === "error" ? weixin.issue : undefined,
  ]);

  useEffect(() => {
    const previous = previousConfirmResetRef.current;
    previousConfirmResetRef.current = confirmReset;
    if (confirmReset && !previous) {
      resetConfirmRef.current?.focus();
    } else if (!confirmReset && previous) {
      const resetTrigger = resetTriggerRef.current;
      if (resetTrigger !== null) {
        resetTrigger.focus();
      } else {
        channelRef.current
          ?.closest<HTMLElement>(
            "[data-minke-remote-hub-dialog]",
          )
          ?.querySelector<HTMLElement>(
            ".minke-remote-hub__close",
          )
          ?.focus();
      }
    }
  }, [confirmReset]);

  const submitVerification = (
    event: FormEvent<HTMLFormElement>,
  ): void => {
    event.preventDefault();
    if (
      weixin.state !== "linking" ||
      weixin.phase !== "verification-required" ||
      !/^[0-9]{1,32}$/u.test(code) ||
      busy
    ) {
      return;
    }
    void runtime.dispatch({
      kind: "weixin/link/verify",
      flowId: weixin.flowId,
      code,
    });
  };

  const canStart =
    weixin.state === "unlinked" ||
    weixin.state === "session-stale" ||
    (
      weixin.state === "error" &&
      weixin.issue !== "credential-read" &&
      weixin.issue !== "gateway-store" &&
      weixin.issue !== "transport-start"
    );
  const canReconnect =
    weixin.state === "connected" ||
    weixin.state === "degraded" ||
    (
      weixin.state === "error" &&
      weixin.issue === "transport-start"
    );
  const canUnlink =
    weixin.state === "connecting" ||
    weixin.state === "connected" ||
    weixin.state === "degraded" ||
    weixin.state === "error" ||
    weixin.state === "session-stale";
  const canReset =
    weixin.state === "error" &&
    (
      weixin.issue === "credential-read" ||
      weixin.issue === "credential-store" ||
      weixin.issue === "gateway-store" ||
      weixin.issue === "transport-start"
    );
  const resetGateway =
    weixin.state === "error" &&
    weixin.issue === "gateway-store";
  const startLink = (): void => {
    void runtime.dispatch({
      kind: "weixin/link/start",
    });
  };

  return (
    <section
      ref={channelRef}
      className="minke-remote-hub__channel-panel minke-remote-hub__weixin"
      data-state={weixin.state}
      aria-labelledby="minke-remote-hub-weixin-title"
    >
      <div className="minke-remote-hub__channel-heading">
        <span className="minke-remote-hub__channel-icon">
          <MessagingProviderIcon provider="weixin" />
        </span>
        <span className="minke-remote-hub__channel-copy">
          <strong
            id="minke-remote-hub-weixin-title"
            role="status"
            aria-live="polite"
          >
            {t("weixinTitle")} · {statusLabel(weixin, t)}
          </strong>
          <span>{t("weixinDescription")}</span>
        </span>
        {weixin.state === "unlinked" && (
          <span className="minke-remote-hub__channel-controls">
            <button
              type="button"
              disabled={busy}
              onClick={startLink}
            >
              {busy ? t("busy") : t("connectWeixin")}
            </button>
          </span>
        )}
      </div>

      {weixin.state !== "unlinked" && (
        <div className="minke-remote-hub__channel-body">
          {(weixin.state === "connected" ||
            weixin.state === "degraded") &&
            weixin.activity !== undefined && (
              <ConnectionActivity
                activity={weixin.activity}
                t={t}
              />
            )}
          {weixin.state === "linking" && (
            <div className="minke-remote-hub__link-flow">
              <div className="minke-remote-hub__qr-frame">
                {qr.state === "ready" ? (
                  <img
                    src={qr.dataUrl}
                    alt={t("qrAlt")}
                    width="224"
                    height="224"
                  />
                ) : qr.state === "error" ? (
                  <span role="alert">{t("qrRenderError")}</span>
                ) : (
                  <span role="status">{t("qrPreparing")}</span>
                )}
              </div>
              <div className="minke-remote-hub__link-copy">
                <p>
                  {weixin.phase === "waiting"
                    ? t("qrInstruction")
                    : weixin.phase === "scanned"
                      ? t("scannedInstruction")
                      : t("verificationInstruction")}
                </p>
                <small>
                  {t("qrExpires").replace(
                    "{time}",
                    new Intl.DateTimeFormat(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(weixin.challenge.expiresAt),
                  )}
                </small>
                {weixin.phase === "verification-required" && (
                  <form
                    className="minke-remote-hub__verify"
                    onSubmit={submitVerification}
                  >
                    <label htmlFor={codeId}>
                      {t("verificationCodeLabel")}
                    </label>
                    <div>
                      <input
                        id={codeId}
                        type="text"
                        value={code}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{1,32}"
                        placeholder={t("verificationCodePlaceholder")}
                        disabled={busy}
                        onChange={(event) =>
                          setCode(
                            event.currentTarget.value
                              .replace(/\D/gu, "")
                              .slice(0, 32),
                          )}
                      />
                      <button
                        type="submit"
                        disabled={
                          busy || !/^[0-9]{1,32}$/u.test(code)
                        }
                      >
                        {busy ? t("busy") : t("verifyCode")}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}

          {weixin.state === "degraded" && (
            <div className="minke-remote-hub__channel-detail">
              <p>{issueText(weixin.issue, t)}</p>
            </div>
          )}

          {(weixin.state === "unavailable" ||
            weixin.state === "error" ||
            weixin.state === "session-stale") && (
            <p className="minke-remote-hub__issue" role="alert">
              {issueText(weixin.issue, t)}
            </p>
          )}

          <div className="minke-remote-hub__channel-actions">
            {canStart && (
              <button
                type="button"
                disabled={busy}
                onClick={startLink}
              >
                {busy ? t("busy") : t("connectWeixin")}
              </button>
            )}
            {canReconnect && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void runtime.dispatch({
                    kind: "weixin/reconnect",
                  });
                }}
              >
                {busy ? t("busy") : t("reconnectWeixin")}
              </button>
            )}
            {weixin.state === "linking" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void runtime.dispatch({
                    kind: "weixin/link/cancel",
                    flowId: weixin.flowId,
                  });
                }}
              >
                {busy ? t("busy") : t("cancelLink")}
              </button>
            )}
            {canUnlink && (
              <button
                type="button"
                className="minke-remote-hub__button--danger"
                disabled={busy}
                onClick={() => {
                  void runtime.dispatch({
                    kind: "weixin/unlink",
                  });
                }}
              >
                {t("unlinkWeixin")}
              </button>
            )}
            {canReset && !confirmReset && (
              <button
                ref={resetTriggerRef}
                type="button"
                className="minke-remote-hub__button--quiet"
                disabled={busy}
                onClick={() => setConfirmReset(true)}
              >
                {t(resetGateway ? "resetGateway" : "resetLocal")}
              </button>
            )}
          </div>
          {confirmReset && (
            <div
              className="minke-remote-hub__reset-confirmation"
              role="alert"
            >
              <p>
                {t(
                  resetGateway
                    ? "resetGatewayWarning"
                    : "resetLocalWarning",
                )}
              </p>
              <div className="minke-remote-hub__channel-actions">
                <button
                  ref={resetConfirmRef}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void runtime.dispatch({
                      kind: resetGateway
                        ? "gateway/reset-local"
                        : "weixin/reset-local",
                    });
                  }}
                >
                  {busy
                    ? t("busy")
                    : t(
                        resetGateway
                          ? "confirmResetGateway"
                          : "confirmResetLocal",
                      )}
                </button>
                <button
                  type="button"
                  className="minke-remote-hub__button--quiet"
                  disabled={busy}
                  onClick={() => setConfirmReset(false)}
                >
                  {t("keepLocalData")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function botStatusLabel(
  value: BotHubSnapshot,
  t: RemoteHubTranslate,
): string {
  switch (value.state) {
    case "loading":
      return t("loading");
    case "unavailable":
      return t("unavailable");
    case "unlinked":
      return t("unlinked");
    case "connecting":
      return t("connecting");
    case "disconnected":
      return t("disconnected");
    case "pairing":
      return t(
        value.request === undefined
          ? "botPairingWaiting"
          : "botPairingApprovalRequired",
      );
    case "connected":
      return t("connected");
    case "degraded":
      return t(
        value.issue === "agent-route-pending"
          ? "linkedLimited"
          : "attention",
      );
    case "error":
      return t("attention");
  }
}

function botIssueText(
  issue: BotHubIssue,
  providerLabel: string,
  t: RemoteHubTranslate,
): string {
  const replaceProvider = (value: string): string =>
    value.replace("{provider}", providerLabel);
  switch (issue) {
    case "agent":
      return replaceProvider(t("botAgentIssue"));
    case "agent-route-pending":
      return t("agentRoutePending");
    case "delivery":
      return replaceProvider(t("botDeliveryIssue"));
    case "receive":
      return replaceProvider(t("botReceiveIssue"));
    case "vault-unavailable":
      return replaceProvider(t("botVaultUnavailable"));
    case "credential-invalid":
      return replaceProvider(t("botCredentialInvalid"));
    case "credential-read":
      return replaceProvider(t("botCredentialRead"));
    case "credential-store":
      return replaceProvider(t("botCredentialStore"));
    case "gateway-store":
      return t("gatewayStore");
    case "network":
      return replaceProvider(t("botNetwork"));
    case "polling-conflict":
      return t("botPollingConflict");
    case "privileged-intent":
      return t("botPrivilegedIntent");
    case "transport-fatal":
      return replaceProvider(t("botTransportFatal"));
    case "transport-start":
      return replaceProvider(t("botTransportStart"));
  }
}

function BotChannel({
  provider,
  runtime,
  snapshot,
  t,
}: {
  readonly provider: "telegram" | "discord";
  readonly runtime: RemoteHubRuntime;
  readonly snapshot: ReturnType<RemoteHubRuntime["getSnapshot"]>;
  readonly t: RemoteHubTranslate;
}): ReactNode {
  const channel = snapshot.channels.channels[provider];
  const providerLabel = t(
    provider === "telegram"
      ? "telegramTitle"
      : "discordTitle",
  );
  const description = t(
    provider === "telegram"
      ? "telegramDescription"
      : "discordDescription",
  );
  const [token, setToken] = useState("");
  const savedProxyUrl =
    provider === "telegram"
      ? snapshot.channels.telegramNetwork.httpProxyUrl
      : snapshot.channels.discordNetwork.httpProxyUrl;
  const discordProxySource =
    snapshot.channels.discordNetwork.proxySource;
  const [proxyUrl, setProxyUrl] = useState(savedProxyUrl);
  const [editingToken, setEditingToken] = useState(false);
  const [confirmClearToken, setConfirmClearToken] =
    useState(false);
  const [copyTokenState, setCopyTokenState] = useState<
    "idle" | "copying" | "copied" | "error"
  >("idle");
  const [confirmReset, setConfirmReset] = useState(false);
  const copyTokenResetRef = useRef<number | undefined>(
    undefined,
  );
  const previousConfirmResetRef = useRef(false);
  const channelRef = useRef<HTMLElement>(null);
  const resetTriggerRef = useRef<HTMLButtonElement>(null);
  const tokenId = useId();
  const tokenHelpId = useId();
  const proxyId = useId();
  const proxyHelpId = useId();
  const titleId = useId();
  const resetConfirmRef = useRef<HTMLButtonElement>(null);
  const busy = snapshot.operation !== "idle";
  const tokenValid =
    token.length >= 20 &&
    token.length <= 4_096 &&
    !/\s/u.test(token);
  let proxyValid = false;
  try {
    (
      provider === "telegram"
        ? parseTelegramNetworkSettings
        : parseDiscordNetworkSettings
    )({
      httpProxyUrl: proxyUrl.trim(),
    });
    proxyValid = true;
  } catch {
    proxyValid = false;
  }
  const proxyChanged =
    proxyUrl.trim() !== savedProxyUrl;
  const pairingRequest = channel.state === "pairing"
    ? channel.request
    : undefined;
  const hasSavedToken =
    channel.state === "disconnected" ||
    channel.state === "pairing" ||
    channel.state === "connected" ||
    channel.state === "degraded" ||
    (
      channel.state === "error" &&
      channel.hasStoredCredential
    );
  const canConfigure =
    channel.state === "unlinked" ||
    editingToken ||
    (
      channel.state === "error" &&
      !channel.hasStoredCredential &&
      channel.issue !== "credential-read" &&
      channel.issue !== "gateway-store"
    );
  const canReconnect =
    channel.state === "disconnected" ||
    channel.state === "degraded" ||
    (
      channel.state === "error" &&
      channel.hasStoredCredential &&
      (
        channel.issue === "network" ||
        channel.issue === "polling-conflict" ||
        channel.issue === "privileged-intent" ||
        channel.issue === "transport-fatal" ||
        channel.issue === "transport-start"
      )
    );
  const canDisconnect =
    channel.state === "pairing" ||
    channel.state === "connected" ||
    channel.state === "degraded";
  const canUpdateToken =
    hasSavedToken && !editingToken;
  const canClearToken = hasSavedToken;
  const canConfigureProxy =
    (
      provider === "telegram" &&
      (
        channel.state === "unlinked" ||
        channel.state === "disconnected" ||
        channel.state === "error"
      )
    ) ||
    (
      provider === "discord" &&
      (
        (
          channel.state === "error" &&
          channel.issue === "network"
        ) ||
        (
          savedProxyUrl !== "" &&
          (
            channel.state === "unlinked" ||
            channel.state === "disconnected" ||
            channel.state === "error"
          )
        )
      )
    );
  const canReset =
    channel.state === "error" &&
    (
      channel.issue === "credential-read" ||
      channel.issue === "credential-store" ||
      channel.issue === "gateway-store" ||
      channel.issue === "transport-start"
    );
  const resetGateway =
    channel.state === "error" &&
    channel.issue === "gateway-store";
  const accountSummary =
    channel.state === "connecting" ||
    channel.state === "disconnected" ||
    channel.state === "pairing" ||
    channel.state === "connected" ||
    channel.state === "degraded"
      ? t("account").replace(
          "{label}",
          channel.accountLabel,
        )
      : undefined;
  useEffect(() => {
    setConfirmReset(false);
    setConfirmClearToken(false);
    if (channel.state === "unlinked") {
      setEditingToken(false);
      setToken("");
    }
  }, [
    channel.state,
    channel.state === "error" ? channel.issue : undefined,
  ]);

  useEffect(() => {
    setProxyUrl(savedProxyUrl);
  }, [savedProxyUrl]);

  useEffect(() => {
    return () => {
      if (copyTokenResetRef.current !== undefined) {
        window.clearTimeout(copyTokenResetRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const previous = previousConfirmResetRef.current;
    previousConfirmResetRef.current = confirmReset;
    if (confirmReset && !previous) {
      resetConfirmRef.current?.focus();
    } else if (!confirmReset && previous) {
      const resetTrigger = resetTriggerRef.current;
      if (resetTrigger !== null) {
        resetTrigger.focus();
      } else {
        channelRef.current
          ?.closest<HTMLElement>(
            "[data-minke-remote-hub-dialog]",
          )
          ?.querySelector<HTMLElement>(
            ".minke-remote-hub__close",
          )
          ?.focus();
      }
    }
  }, [confirmReset]);

  const submitToken = (
    event: FormEvent<HTMLFormElement>,
  ): void => {
    event.preventDefault();
    if (!tokenValid || busy) return;
    const operation =
      provider === "telegram"
        ? runtime.dispatch({
            kind: "telegram/connect",
            token,
          })
        : runtime.dispatch({
            kind: "discord/connect",
            token,
          });
    void operation.finally(() => {
      setToken("");
      setEditingToken(false);
    });
  };

  const reconnect = (): void => {
    void runtime.dispatch(
      provider === "telegram"
        ? { kind: "telegram/reconnect" }
        : { kind: "discord/reconnect" },
    );
  };

  const configureProxy = (
    event: FormEvent<HTMLFormElement>,
  ): void => {
    event.preventDefault();
    if (!proxyValid || !proxyChanged || busy) {
      return;
    }
    const command: RemoteHubCommand = {
      ...(provider === "telegram"
        ? {
            kind: "telegram/network/set",
            settings: parseTelegramNetworkSettings({
              httpProxyUrl: proxyUrl.trim(),
            }),
          }
        : {
            kind: "discord/network/set",
            settings: parseDiscordNetworkSettings({
              httpProxyUrl: proxyUrl.trim(),
            }),
          }),
    };
    void runtime.dispatch(command);
  };

  const unlink = (): void => {
    void runtime.dispatch(
      provider === "telegram"
        ? { kind: "telegram/unlink" }
        : { kind: "discord/unlink" },
    );
  };

  const disconnect = (): void => {
    void runtime.dispatch(
      provider === "telegram"
        ? { kind: "telegram/disconnect" }
        : { kind: "discord/disconnect" },
    );
  };

  const copyToken = (): void => {
    if (busy || copyTokenState === "copying") return;
    if (copyTokenResetRef.current !== undefined) {
      window.clearTimeout(copyTokenResetRef.current);
      copyTokenResetRef.current = undefined;
    }
    setCopyTokenState("copying");
    void runtime
      .dispatch(
        provider === "telegram"
          ? { kind: "telegram/token/copy" }
          : { kind: "discord/token/copy" },
      )
      .then(() => {
        setCopyTokenState(
          runtime.getSnapshot().error === undefined
            ? "copied"
            : "error",
        );
        copyTokenResetRef.current = window.setTimeout(() => {
          setCopyTokenState("idle");
          copyTokenResetRef.current = undefined;
        }, 3_000);
      });
  };

  const approvePairing = (requestId: string): void => {
    if (busy) return;
    void runtime.dispatch({
      kind: "bot/pairing/approve",
      provider,
      requestId,
    });
  };

  const dismissPairing = (requestId: string): void => {
    if (busy) return;
    void runtime.dispatch({
      kind: "bot/pairing/dismiss",
      provider,
      requestId,
    });
  };

  const reset = (): void => {
    void runtime.dispatch(
      resetGateway
        ? { kind: "gateway/reset-local" }
        : provider === "telegram"
          ? { kind: "telegram/reset-local" }
          : { kind: "discord/reset-local" },
    );
  };

  return (
    <section
      ref={channelRef}
      className="minke-remote-hub__channel-panel minke-remote-hub__weixin minke-remote-hub__bot"
      data-provider={provider}
      data-state={channel.state}
      aria-labelledby={titleId}
    >
      <div className="minke-remote-hub__channel-heading">
        <span className="minke-remote-hub__channel-icon">
          <MessagingProviderIcon provider={provider} />
        </span>
        <span className="minke-remote-hub__channel-copy">
          <strong id={titleId}>{providerLabel}</strong>
          <span>{accountSummary ?? description}</span>
        </span>
        <span className="minke-remote-hub__channel-controls">
          <span
            className="minke-remote-hub__channel-status"
            data-state={channel.state}
            data-tone={connectionTone(channel.state)}
            role="status"
            aria-live="polite"
          >
            {botStatusLabel(channel, t)}
          </span>
        </span>
      </div>

      <div className="minke-remote-hub__channel-body">
        {(channel.state === "connecting" ||
          channel.state === "disconnected" ||
          channel.state === "pairing" ||
          channel.state === "connected" ||
          channel.state === "degraded") && (
          <p className="minke-remote-hub__channel-description">
            {description}
          </p>
        )}
        {(channel.state === "pairing" ||
          channel.state === "connected" ||
          channel.state === "degraded") &&
          channel.activity !== undefined && (
            <ConnectionActivity
              activity={channel.activity}
              t={t}
            />
          )}
        {hasSavedToken && !editingToken && (
          <div className="minke-remote-hub__saved-token">
            <div>
              <p className="minke-remote-hub__saved-token-hint">
                {t("savedTokenHint")}
              </p>
              <small>{t("copyBotTokenWarning")}</small>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={copyToken}
              aria-live="polite"
            >
              {t(
                copyTokenState === "copying"
                  ? "copyingBotToken"
                  : copyTokenState === "copied"
                    ? "copiedBotToken"
                    : copyTokenState === "error"
                      ? "copyBotTokenError"
                      : "copyBotToken",
              )}
            </button>
          </div>
        )}
        {(channel.state === "pairing" ||
          channel.state === "degraded") && (
          <div className="minke-remote-hub__channel-detail">
            {channel.state === "degraded" && (
              <p>
                {botIssueText(
                  channel.issue,
                  providerLabel,
                  t,
                )}
              </p>
            )}
            {channel.state === "pairing" &&
              (pairingRequest === undefined ? (
                <p>
                  {t("botPairingInstruction")
                    .replace("{account}", channel.accountLabel)
                    .replace("{provider}", providerLabel)}
                </p>
              ) : (
                <div
                  role="group"
                  aria-label={t("botPairingRequestLabel").replace(
                    "{provider}",
                    providerLabel,
                  )}
                >
                  <p>
                    {t("botPairingRequestFrom").replace(
                      "{label}",
                      pairingRequest.senderLabel,
                    )}
                  </p>
                  <p>
                    <strong>
                      {t("botPairingCode").replace(
                        "{code}",
                        pairingRequest.code,
                      )}
                    </strong>
                  </p>
                  <p>
                    <time
                      dateTime={new Date(
                        pairingRequest.expiresAt,
                      ).toISOString()}
                    >
                      {t("botPairingExpires").replace(
                        "{time}",
                        new Intl.DateTimeFormat(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(
                          pairingRequest.expiresAt,
                        ),
                      )}
                    </time>
                  </p>
                  <div className="minke-remote-hub__channel-actions">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        approvePairing(
                          pairingRequest.requestId,
                        )}
                    >
                      {busy
                        ? t("busy")
                        : t("approveBotPairing")}
                    </button>
                    <button
                      type="button"
                      className="minke-remote-hub__button--quiet"
                      disabled={busy}
                      onClick={() =>
                        dismissPairing(
                          pairingRequest.requestId,
                        )}
                    >
                      {t("dismissBotPairing")}
                    </button>
                  </div>
                </div>
              ))}
          </div>
        )}

        {(channel.state === "unavailable" ||
          channel.state === "error") && (
          <p className="minke-remote-hub__issue" role="alert">
            {botIssueText(channel.issue, providerLabel, t)}
          </p>
        )}

        {provider === "discord" &&
          discordProxySource !== "pending" && (
            <p className="minke-remote-hub__network-status">
              {t(
                discordProxySource === "direct"
                  ? "discordProxyDirect"
                  : discordProxySource === "system"
                    ? "discordProxySystem"
                    : discordProxySource === "telegram"
                      ? "discordProxyTelegram"
                      : "discordProxyManual",
              )}
            </p>
          )}

        {canConfigure && (
          <form
            className="minke-remote-hub__bot-token"
            onSubmit={submitToken}
          >
            <label htmlFor={tokenId}>
              {t(
                editingToken
                  ? "updateBotTokenLabel"
                  : "botTokenLabel",
              ).replace("{provider}", providerLabel)}
            </label>
            <div>
              <input
                id={tokenId}
                type="password"
                value={token}
                minLength={20}
                maxLength={4_096}
                autoComplete="off"
                autoCapitalize="none"
                aria-describedby={tokenHelpId}
                spellCheck={false}
                placeholder={t("botTokenPlaceholder")}
                disabled={busy}
                onChange={(event) =>
                  setToken(event.currentTarget.value)}
              />
              <button
                type="submit"
                disabled={busy || !tokenValid}
              >
                {busy
                  ? t("busy")
                  : editingToken
                    ? t("updateBotTokenSubmit")
                    : t("connectBot").replace(
                        "{provider}",
                        providerLabel,
                      )}
              </button>
              {editingToken && (
                <button
                  type="button"
                  className="minke-remote-hub__button--quiet"
                  disabled={busy}
                  onClick={() => {
                    setToken("");
                    setEditingToken(false);
                  }}
                >
                  {t("cancelTokenUpdate")}
                </button>
              )}
            </div>
            <small id={tokenHelpId}>
              {t(
                provider === "telegram"
                  ? "telegramTokenHelp"
                  : "discordTokenHelp",
              )}
            </small>
          </form>
        )}

        {canConfigureProxy && (
          <form
            className="minke-remote-hub__bot-token minke-remote-hub__telegram-proxy"
            onSubmit={configureProxy}
          >
            <label htmlFor={proxyId}>
              {t(
                provider === "telegram"
                  ? "telegramProxyLabel"
                  : "discordProxyLabel",
              )}
            </label>
            <div>
              <input
                id={proxyId}
                type="url"
                value={proxyUrl}
                maxLength={2_048}
                autoComplete="off"
                autoCapitalize="none"
                aria-describedby={proxyHelpId}
                spellCheck={false}
                placeholder={t("telegramProxyPlaceholder")}
                disabled={busy}
                onChange={(event) =>
                  setProxyUrl(event.currentTarget.value)}
              />
              <button
                type="submit"
                disabled={
                  busy || !proxyValid || !proxyChanged
                }
              >
                {busy ? t("busy") : t("applyTelegramProxy")}
              </button>
            </div>
            <small id={proxyHelpId}>
              {t(
                provider === "telegram"
                  ? "telegramProxyHelp"
                  : "discordProxyHelp",
              )}
            </small>
          </form>
        )}

        <div className="minke-remote-hub__channel-actions">
          {canReconnect && !editingToken && (
            <button
              type="button"
              disabled={busy}
              onClick={reconnect}
            >
              {busy ? t("busy") : t("reconnectBot")}
            </button>
          )}
          {canDisconnect && !editingToken && (
            <button
              type="button"
              disabled={busy}
              onClick={disconnect}
            >
              {busy ? t("busy") : t("disconnectBot")}
            </button>
          )}
          {canUpdateToken && (
            <button
              type="button"
              className="minke-remote-hub__button--quiet"
              disabled={busy}
              onClick={() => {
                setConfirmClearToken(false);
                setEditingToken(true);
              }}
            >
              {t("updateBotToken")}
            </button>
          )}
          {canClearToken &&
            !editingToken &&
            !confirmClearToken && (
              <button
                type="button"
                className="minke-remote-hub__button--danger-quiet"
                disabled={busy}
                onClick={() => {
                  setConfirmReset(false);
                  setConfirmClearToken(true);
                }}
              >
                {t("unlinkBot")}
              </button>
            )}
          {canReset && !confirmReset && (
            <button
              ref={resetTriggerRef}
              type="button"
              className="minke-remote-hub__button--quiet"
              disabled={busy}
              onClick={() => setConfirmReset(true)}
            >
              {t(resetGateway ? "resetGateway" : "resetLocal")}
            </button>
          )}
        </div>

        {confirmClearToken && (
          <div
            className="minke-remote-hub__reset-confirmation"
            role="alert"
          >
            <p>
              {t("clearBotTokenWarning").replace(
                "{provider}",
                providerLabel,
              )}
            </p>
            <div className="minke-remote-hub__channel-actions">
              <button
                type="button"
                className="minke-remote-hub__button--danger"
                disabled={busy}
                onClick={unlink}
              >
                {busy ? t("busy") : t("confirmClearBotToken")}
              </button>
              <button
                type="button"
                className="minke-remote-hub__button--quiet"
                disabled={busy}
                onClick={() => setConfirmClearToken(false)}
              >
                {t("keepLocalData")}
              </button>
            </div>
          </div>
        )}

        {confirmReset && (
          <div
            className="minke-remote-hub__reset-confirmation"
            role="alert"
          >
            <p>
              {resetGateway
                ? t("resetGatewayWarning")
                : t("resetBotLocalWarning").replace(
                    "{provider}",
                    providerLabel,
                  )}
            </p>
            <div className="minke-remote-hub__channel-actions">
              <button
                ref={resetConfirmRef}
                type="button"
                disabled={busy}
                onClick={reset}
              >
                {busy
                  ? t("busy")
                  : t(
                      resetGateway
                        ? "confirmResetGateway"
                        : "confirmResetLocal",
                    )}
              </button>
              <button
                type="button"
                className="minke-remote-hub__button--quiet"
                disabled={busy}
                onClick={() => setConfirmReset(false)}
              >
                {t("keepLocalData")}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function RemoteHubDialog({
  openExternal,
  runtime,
  remoteT,
  t,
}: RemoteHubDialogHostProps): ReactNode {
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const titleId = useId();
  const descriptionId = useId();
  const credentialAuthorizationTitleId = useId();
  const detailPanelId = useId();
  const weixinNavigationId = useId();
  const telegramNavigationId = useId();
  const discordNavigationId = useId();
  const accessNavigationId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const weixinNavigationRef = useRef<HTMLButtonElement>(null);
  const telegramNavigationRef = useRef<HTMLButtonElement>(null);
  const discordNavigationRef = useRef<HTMLButtonElement>(null);
  const accessNavigationRef = useRef<HTMLButtonElement>(null);
  const remotePresentation = presentRemoteStatus(snapshot.remote);
  const credentialVaultState =
    snapshot.channels.dependencies.credentialVault;
  const authorizingCredentials =
    snapshot.operation === "authorizing-credentials";
  const credentialAuthorizationFailed =
    snapshot.error === "credential-authorization";
  const macOSDesktop =
    typeof window !== "undefined" &&
    hasMacOSDesktopSurface();
  const dependenciesReady =
    credentialVaultState === "ready" &&
    snapshot.channels.dependencies.agentRoute === "ready";

  const navigationIds: Record<RemoteHubView, string> = {
    weixin: weixinNavigationId,
    telegram: telegramNavigationId,
    discord: discordNavigationId,
    access: accessNavigationId,
  };
  const navigationRefs = {
    weixin: weixinNavigationRef,
    telegram: telegramNavigationRef,
    discord: discordNavigationRef,
    access: accessNavigationRef,
  };
  const navigationOrder: readonly RemoteHubView[] = [
    "weixin",
    "telegram",
    "discord",
    "access",
  ];

  const selectView = (
    view: RemoteHubView,
    focus = false,
  ): void => {
    runtime.setView(view);
    if (focus) {
      window.requestAnimationFrame(() => {
        navigationRefs[view].current?.focus();
      });
    }
  };

  const handleNavigationKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    view: RemoteHubView,
  ): void => {
    const currentIndex = navigationOrder.indexOf(view);
    let nextIndex: number | undefined;
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowRight"
    ) {
      nextIndex = (currentIndex + 1) % navigationOrder.length;
    } else if (
      event.key === "ArrowUp" ||
      event.key === "ArrowLeft"
    ) {
      nextIndex =
        (currentIndex - 1 + navigationOrder.length) %
        navigationOrder.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = navigationOrder.length - 1;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    selectView(navigationOrder[nextIndex], true);
  };

  const navigationButton = ({
    icon,
    kind,
    label,
    state,
    status,
    view,
  }: {
    readonly icon: ReactNode;
    readonly kind: "messaging" | "access";
    readonly label: string;
    readonly state: string;
    readonly status: string;
    readonly view: RemoteHubView;
  }): ReactNode => (
    <button
      ref={navigationRefs[view]}
      id={navigationIds[view]}
      type="button"
      className="minke-remote-hub__navigation-item"
      data-kind={kind}
      data-state={state}
      aria-controls={detailPanelId}
      aria-current={
        snapshot.view === view ? "page" : undefined
      }
      tabIndex={snapshot.view === view ? 0 : -1}
      onClick={() => selectView(view)}
      onKeyDown={(event) =>
        handleNavigationKeyDown(event, view)}
    >
      <span className="minke-remote-hub__navigation-icon">
        {icon}
      </span>
      <span className="minke-remote-hub__navigation-copy">
        <strong>{label}</strong>
        <small>{status}</small>
      </span>
      <span
        className="minke-remote-hub__navigation-indicator"
        data-state={state}
        data-tone={connectionTone(state)}
        aria-hidden="true"
      />
    </button>
  );

  useEffect(() => {
    closeRef.current?.focus();
    const containFocus = (event: FocusEvent): void => {
      const panel = panelRef.current;
      if (
        panel !== null &&
        !panel.contains(event.target as Node | null)
      ) {
        closeRef.current?.focus();
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        runtime.close();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      const focusable = [
        ...(panel?.querySelectorAll<HTMLElement>(
          FOCUSABLE_SELECTOR,
        ) ?? []),
      ];
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      const active = document.activeElement;
      if (panel === null || !panel.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("focusin", containFocus, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("focusin", containFocus, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [runtime]);

  useEffect(() => {
    const panel = panelRef.current;
    if (
      panel !== null &&
      !panel.contains(document.activeElement)
    ) {
      closeRef.current?.focus();
    }
  }, [
    snapshot.channels,
    snapshot.operation,
    snapshot.remote,
  ]);

  return (
    <div
      className="minke-remote-hub__overlay"
      data-minke-remote-hub-overlay
      role="presentation"
    >
      <div
        className="minke-remote-hub__mask"
        aria-hidden="true"
        onClick={() => runtime.close()}
      />
      <section
        ref={panelRef}
        className="minke-remote-hub__dialog"
        data-minke-remote-hub-dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header className="minke-remote-hub__header">
          <div>
            <h1 id={titleId}>{t("title")}</h1>
            <p id={descriptionId}>{t("description")}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="minke-remote-hub__close"
            aria-label={t("close")}
            title={t("close")}
            onClick={() => runtime.close()}
          >
            <LucideIcon icon={X} size={17} />
          </button>
        </header>

        <div className="minke-remote-hub__body">
          <aside className="minke-remote-hub__sidebar">
            <nav
              className="minke-remote-hub__navigation"
              aria-label={t("title")}
            >
              <div className="minke-remote-hub__navigation-group">
                <h2>{t("channelsTitle")}</h2>
                {navigationButton({
                  view: "weixin",
                  kind: "messaging",
                  label: t("weixinTitle"),
                  status: statusLabel(
                    snapshot.channels.channels.weixin,
                    t,
                  ),
                  state:
                    snapshot.channels.channels.weixin.state,
                  icon: (
                    <MessagingProviderIcon provider="weixin" />
                  ),
                })}
                {navigationButton({
                  view: "telegram",
                  kind: "messaging",
                  label: t("telegramTitle"),
                  status: botStatusLabel(
                    snapshot.channels.channels.telegram,
                    t,
                  ),
                  state:
                    snapshot.channels.channels.telegram.state,
                  icon: (
                    <MessagingProviderIcon provider="telegram" />
                  ),
                })}
                {navigationButton({
                  view: "discord",
                  kind: "messaging",
                  label: t("discordTitle"),
                  status: botStatusLabel(
                    snapshot.channels.channels.discord,
                    t,
                  ),
                  state:
                    snapshot.channels.channels.discord.state,
                  icon: (
                    <MessagingProviderIcon provider="discord" />
                  ),
                })}
              </div>

              <div
                className="minke-remote-hub__navigation-group minke-remote-hub__navigation-group--access"
              >
                <h2>{t("deviceAccessTitle")}</h2>
                {navigationButton({
                  view: "access",
                  kind: "access",
                  label: t("accessTitle"),
                  status:
                    credentialVaultState === "pending"
                      ? t("authorizationRequiredShort")
                      : remoteT(remotePresentation.statusKey),
                  state:
                    credentialVaultState === "pending"
                      ? "authorization-required"
                      : remotePresentation.state,
                  icon: (
                    <LucideIcon icon={RadioTower} size={18} />
                  ),
                })}
              </div>
            </nav>

            <div
              className="minke-remote-hub__dependencies"
              aria-label={t("dependencyTitle")}
            >
              {dependenciesReady ? (
                <span data-state="ready">
                  <LucideIcon icon={ShieldCheck} size={14} />
                  {t("systemReady")}
                </span>
              ) : (
                <>
                  {credentialVaultState === "initializing" && (
                    <span data-state={credentialVaultState}>
                      <LucideIcon
                        icon={ShieldCheck}
                        size={14}
                      />
                      {t("vaultChecking")}
                    </span>
                  )}
                  {credentialVaultState === "unavailable" && (
                    <span
                      data-state={credentialVaultState}
                    >
                      <LucideIcon
                        icon={ShieldCheck}
                        size={14}
                      />
                      {t("vaultMissing")}
                    </span>
                  )}
                  {snapshot.channels.dependencies.agentRoute !==
                    "ready" && (
                    <span
                      data-state={
                        snapshot.channels.dependencies.agentRoute
                      }
                    >
                      <LucideIcon
                        icon={RadioTower}
                        size={14}
                      />
                      {t("agentRoutePendingShort")}
                    </span>
                  )}
                </>
              )}
            </div>
          </aside>

          <section
            id={detailPanelId}
            className="minke-remote-hub__detail"
            role="region"
            aria-labelledby={navigationIds[snapshot.view]}
            tabIndex={0}
          >
            {credentialVaultState === "pending" && (
              <section
                className="minke-remote-hub__authorization"
                data-minke-remote-hub-credential-authorization
                aria-labelledby={credentialAuthorizationTitleId}
              >
                <span
                  className="minke-remote-hub__authorization-icon"
                  aria-hidden="true"
                >
                  <LucideIcon icon={ShieldCheck} size={21} />
                </span>
                <div className="minke-remote-hub__authorization-copy">
                  <h2 id={credentialAuthorizationTitleId}>
                    {t("credentialAuthorizationTitle")}
                  </h2>
                  <p>{t("credentialAuthorizationDescription")}</p>
                  {macOSDesktop && (
                    <p className="minke-remote-hub__authorization-instruction">
                      {t(
                        "credentialAuthorizationMacInstruction",
                      )}
                    </p>
                  )}
                  {credentialAuthorizationFailed && (
                    <p
                      className="minke-remote-hub__authorization-failure"
                      role="alert"
                    >
                      {t(
                        macOSDesktop
                          ? "credentialAuthorizationMacFailed"
                          : "credentialAuthorizationFailed",
                      )}
                    </p>
                  )}
                  <small>
                    {t("credentialAuthorizationPending")}
                  </small>
                </div>
                <button
                  type="button"
                  className="minke-remote-hub__authorization-action"
                  data-minke-remote-hub-authorize-credentials
                  disabled={snapshot.operation !== "idle"}
                  aria-busy={authorizingCredentials}
                  onClick={() => {
                    void runtime.dispatch({
                      kind: "credential-vault/authorize",
                    });
                  }}
                >
                  {authorizingCredentials
                    ? t("authorizingCredentialVault")
                    : t(
                        credentialAuthorizationFailed
                          ? "retryCredentialVault"
                          : "authorizeCredentialVault",
                      )}
                </button>
              </section>
            )}
            {snapshot.error !== undefined &&
              snapshot.error !== "credential-authorization" && (
              <p
                className="minke-remote-hub__global-issue"
                role="alert"
              >
                {t(
                  snapshot.error === "read"
                    ? "readError"
                    : "commandError",
                )}
              </p>
            )}
            {snapshot.view === "weixin" ? (
              <WeixinChannel
                runtime={runtime}
                snapshot={snapshot}
                t={t}
              />
            ) : snapshot.view === "telegram" ? (
              <BotChannel
                provider="telegram"
                runtime={runtime}
                snapshot={snapshot}
                t={t}
              />
            ) : snapshot.view === "discord" ? (
              <BotChannel
                provider="discord"
                runtime={runtime}
                snapshot={snapshot}
                t={t}
              />
            ) : (
              <div className="minke-remote-hub__access">
                <RemoteSettingsSection
                  openExternal={openExternal}
                  runtime={runtime.remote}
                  t={remoteT}
                />
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

/** Root-level dialog host; opening state survives Session changes. */
export function RemoteHubDialogHost(
  props: RemoteHubDialogHostProps,
): ReactNode {
  const snapshot = useSyncExternalStore(
    props.runtime.subscribe,
    props.runtime.getSnapshot,
    props.runtime.getSnapshot,
  );
  return snapshot.open ? <RemoteHubDialog {...props} /> : null;
}
