import {
  MessageCircle,
  RadioTower,
  ScanQrCode,
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
  type ReactNode,
} from "react";
import {
  parseTelegramNetworkSettings,
  type BotHubIssue,
  type BotHubSnapshot,
  type RemoteHubCommand,
  type WeixinHubIssue,
  type WeixinHubSnapshot,
} from "@minke/harness-overlay/remote-hub-contract.ts";
import {
  RemoteSettingsSection,
} from "../remote/RemoteSettingsSection.tsx";
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
} from "./runtime.ts";

const FOCUSABLE_SELECTOR = [
  "button:not(:disabled)",
  "input:not(:disabled)",
  '[href]:not([aria-disabled="true"])',
  "[tabindex]:not([tabindex='-1'])",
].join(",");

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
    weixin.state === "degraded" &&
    weixin.issue !== "agent-route-pending"
  ) {
    return "attention";
  }
  if (
    botChannels.some(
      (channel) =>
        channel.state === "degraded" &&
        channel.issue !== "agent-route-pending",
    )
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
        channel.state === "connecting" ||
        channel.state === "pairing",
    ) ||
    remoteState === "starting" ||
    remoteState === "stopping" ||
    remoteState === "retrying"
  ) {
    return "working";
  }
  if (
    weixin.state === "connected" ||
    weixin.state === "degraded" ||
    botChannels.some(
      (channel) =>
        channel.state === "connected" ||
        channel.state === "degraded",
    ) ||
    remoteState === "active" ||
    remoteState === "ready"
  ) {
    return "active";
  }
  return "idle";
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
  const accessibleLabel = t(
    state === "idle"
      ? "triggerIdle"
      : state === "working"
        ? "triggerWorking"
        : state === "active"
          ? "triggerActive"
          : "triggerAttention",
  );
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
      <LucideIcon icon={RadioTower} size={16} />
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

  return (
    <section
      ref={channelRef}
      className="minke-remote-hub__weixin"
      data-state={weixin.state}
      aria-labelledby="minke-remote-hub-weixin-title"
    >
      <div className="minke-remote-hub__channel-heading">
        <span className="minke-remote-hub__channel-icon">
          <LucideIcon icon={ScanQrCode} size={18} />
        </span>
        <span className="minke-remote-hub__channel-copy">
          <strong id="minke-remote-hub-weixin-title">
            {t("weixinTitle")}
          </strong>
          <span>{t("weixinDescription")}</span>
        </span>
        <span
          className="minke-remote-hub__channel-status"
          data-state={weixin.state}
          role="status"
          aria-live="polite"
        >
          {statusLabel(weixin, t)}
        </span>
      </div>

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

      {(weixin.state === "connecting" ||
        weixin.state === "connected" ||
        weixin.state === "degraded") && (
        <div className="minke-remote-hub__channel-detail">
          <strong>
            {t("account").replace(
              "{label}",
              weixin.accountLabel,
            )}
          </strong>
          {weixin.state === "degraded" && (
            <p>{issueText(weixin.issue, t)}</p>
          )}
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
            onClick={() => {
              void runtime.dispatch({
                kind: "weixin/link/start",
              });
            }}
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
            className="minke-remote-hub__button--quiet"
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
    case "pairing":
      return t(
        value.request === undefined
          ? "telegramPairingWaiting"
          : "telegramPairingApprovalRequired",
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
    snapshot.channels.telegramNetwork.httpProxyUrl;
  const [proxyUrl, setProxyUrl] = useState(savedProxyUrl);
  const [confirmReset, setConfirmReset] = useState(false);
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
    parseTelegramNetworkSettings({
      httpProxyUrl: proxyUrl.trim(),
    });
    proxyValid = true;
  } catch {
    proxyValid = false;
  }
  const proxyChanged =
    proxyUrl.trim() !== savedProxyUrl;
  const isTelegramPairing =
    provider === "telegram" &&
    channel.state === "pairing";
  const telegramPairingRequest = isTelegramPairing
    ? channel.request
    : undefined;
  const canConfigure =
    channel.state === "unlinked" ||
    (
      channel.state === "error" &&
      channel.issue !== "credential-read" &&
      channel.issue !== "gateway-store"
    );
  const canReconnect =
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
  const canUnlink =
    channel.state === "connecting" ||
    channel.state === "pairing" ||
    channel.state === "connected" ||
    channel.state === "degraded" ||
    (
      channel.state === "error" &&
      channel.hasStoredCredential
    );
  const canConfigureProxy =
    provider === "telegram" &&
    (
      channel.state === "unlinked" ||
      channel.state === "error"
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

  useEffect(() => {
    setConfirmReset(false);
  }, [
    channel.state,
    channel.state === "error" ? channel.issue : undefined,
  ]);

  useEffect(() => {
    setProxyUrl(savedProxyUrl);
  }, [savedProxyUrl]);

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
    void operation.finally(() => setToken(""));
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
    if (
      provider !== "telegram" ||
      !proxyValid ||
      !proxyChanged ||
      busy
    ) {
      return;
    }
    const command: RemoteHubCommand = {
      kind: "telegram/network/set",
      settings: parseTelegramNetworkSettings({
        httpProxyUrl: proxyUrl.trim(),
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

  const approvePairing = (requestId: string): void => {
    if (provider !== "telegram" || busy) return;
    void runtime.dispatch({
      kind: "telegram/pairing/approve",
      requestId,
    });
  };

  const dismissPairing = (requestId: string): void => {
    if (provider !== "telegram" || busy) return;
    void runtime.dispatch({
      kind: "telegram/pairing/dismiss",
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
      className="minke-remote-hub__weixin minke-remote-hub__bot"
      data-provider={provider}
      data-state={channel.state}
      aria-labelledby={titleId}
    >
      <div className="minke-remote-hub__channel-heading">
        <span className="minke-remote-hub__channel-icon">
          <LucideIcon icon={MessageCircle} size={18} />
        </span>
        <span className="minke-remote-hub__channel-copy">
          <strong id={titleId}>{providerLabel}</strong>
          <span>{description}</span>
        </span>
        <span
          className="minke-remote-hub__channel-status"
          data-state={channel.state}
          role="status"
          aria-live="polite"
        >
          {botStatusLabel(channel, t)}
        </span>
      </div>

      {(channel.state === "connecting" ||
        channel.state === "pairing" ||
        channel.state === "connected" ||
        channel.state === "degraded") && (
        <div className="minke-remote-hub__channel-detail">
          <strong>
            {t("account").replace(
              "{label}",
              channel.accountLabel,
            )}
          </strong>
          {channel.state === "degraded" && (
            <p>
              {botIssueText(
                channel.issue,
                providerLabel,
                t,
              )}
            </p>
          )}
          {isTelegramPairing &&
            (telegramPairingRequest === undefined ? (
              <p>
                {t("telegramPairingInstruction").replace(
                  "{account}",
                  channel.accountLabel,
                )}
              </p>
            ) : (
              <div
                role="group"
                aria-label={t(
                  "telegramPairingRequestLabel",
                )}
              >
                <p>
                  {t("telegramPairingRequestFrom").replace(
                    "{label}",
                    telegramPairingRequest.senderLabel,
                  )}
                </p>
                <p>
                  <strong>
                    {t("telegramPairingCode").replace(
                      "{code}",
                      telegramPairingRequest.code,
                    )}
                  </strong>
                </p>
                <p>
                  <time
                    dateTime={new Date(
                      telegramPairingRequest.expiresAt,
                    ).toISOString()}
                  >
                    {t("telegramPairingExpires").replace(
                      "{time}",
                      new Intl.DateTimeFormat(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(
                        telegramPairingRequest.expiresAt,
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
                        telegramPairingRequest.requestId,
                      )}
                  >
                    {busy
                      ? t("busy")
                      : t("approveTelegramPairing")}
                  </button>
                  <button
                    type="button"
                    className="minke-remote-hub__button--quiet"
                    disabled={busy}
                    onClick={() =>
                      dismissPairing(
                        telegramPairingRequest.requestId,
                      )}
                  >
                    {t("dismissTelegramPairing")}
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

      {canConfigure && (
        <form
          className="minke-remote-hub__bot-token"
          onSubmit={submitToken}
        >
          <label htmlFor={tokenId}>
            {t("botTokenLabel").replace(
              "{provider}",
              providerLabel,
            )}
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
                : t("connectBot").replace(
                    "{provider}",
                    providerLabel,
                  )}
            </button>
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
            {t("telegramProxyLabel")}
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
            {t("telegramProxyHelp")}
          </small>
        </form>
      )}

      <div className="minke-remote-hub__channel-actions">
        {canReconnect && (
          <button
            type="button"
            disabled={busy}
            onClick={reconnect}
          >
            {busy ? t("busy") : t("reconnectBot")}
          </button>
        )}
        {canUnlink && (
          <button
            type="button"
            className="minke-remote-hub__button--quiet"
            disabled={busy}
            onClick={unlink}
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
    </section>
  );
}

function RemoteHubDialog({
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
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

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

        <div
          className="minke-remote-hub__dependencies"
          aria-label={t("dependencyTitle")}
        >
          <span
            data-state={
              snapshot.channels.dependencies
                  .credentialVault
            }
          >
            <LucideIcon icon={ShieldCheck} size={14} />
            {snapshot.channels.dependencies
                .credentialVault === "ready"
              ? t("vaultReady")
              : snapshot.channels.dependencies
                    .credentialVault === "pending"
                ? t("vaultChecking")
                : t("vaultMissing")}
          </span>
          <span
            data-state={
              snapshot.channels.dependencies.agentRoute
            }
          >
            <LucideIcon icon={RadioTower} size={14} />
            {snapshot.channels.dependencies.agentRoute ===
              "ready"
              ? t("agentRouteReadyShort")
              : t("agentRoutePendingShort")}
          </span>
        </div>

        <div className="minke-remote-hub__body">
          <div className="minke-remote-hub__channels">
            <h2>{t("channelsTitle")}</h2>
            {snapshot.error !== undefined && (
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
            <WeixinChannel
              runtime={runtime}
              snapshot={snapshot}
              t={t}
            />
            <BotChannel
              provider="telegram"
              runtime={runtime}
              snapshot={snapshot}
              t={t}
            />
            <BotChannel
              provider="discord"
              runtime={runtime}
              snapshot={snapshot}
              t={t}
            />
          </div>
          <div
            className="minke-remote-hub__access"
            aria-label={t("accessTitle")}
          >
            <RemoteSettingsSection
              runtime={runtime.remote}
              t={remoteT}
            />
          </div>
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
