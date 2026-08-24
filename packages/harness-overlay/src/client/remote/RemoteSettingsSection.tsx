import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type ReactNode,
} from "react";
import {
  copyRemoteAddress,
} from "./clipboard.ts";
import type {
  RemoteTranslate,
} from "./locales.ts";
import {
  maskRemoteAddress,
  presentRemoteStatus,
} from "./presentation.ts";
import {
  canEnableRemoteSettings,
  type RemoteSettingsRuntime,
} from "./runtime.ts";

type CopyAddress = typeof copyRemoteAddress;
type CopyState = "idle" | "copying" | "copied" | "error";
const TAILSCALE_SERVE_PERMISSION_ISSUE =
  "https://github.com/tailscale/tailscale/issues/19933";

export interface RemoteSettingsSectionProps {
  runtime?: RemoteSettingsRuntime;
  t?: RemoteTranslate;
  copyAddress?: CopyAddress;
  variant?: "settings" | "hub";
}

/** Desktop-only Settings page for controlled mobile access. */
export function RemoteSettingsSection({
  runtime,
  t,
  copyAddress = copyRemoteAddress,
  variant = "settings",
}: RemoteSettingsSectionProps): ReactNode {
  if (runtime === undefined || t === undefined) return null;
  return (
    <LoadedRemoteSettings
      runtime={runtime}
      t={t}
      copyAddress={copyAddress}
      variant={variant}
    />
  );
}

function LoadedRemoteSettings({
  runtime,
  t,
  copyAddress,
  variant,
}: {
  runtime: RemoteSettingsRuntime;
  t: RemoteTranslate;
  copyAddress: CopyAddress;
  variant: "settings" | "hub";
}): ReactNode {
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const titleId = useId();
  const methodName = useId();
  const tailscaleTransportName = useId();
  const cloudflareHostnameName = useId();
  const [copyState, setCopyState] =
    useState<CopyState>("idle");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const copyReset = useRef<number | undefined>(undefined);
  const data = snapshot.data;
  const settings = data.settings;
  const method = settings.method;
  const available = data.available[method];
  const enabled = settings.enabled;
  const presentation = presentRemoteStatus(snapshot);
  const address = presentation.showAddress
    ? data.runtime.url
    : undefined;
  const maskedAddress =
    address === undefined
      ? undefined
      : maskRemoteAddress(address);
  const providerLocked =
    !snapshot.editable ||
    enabled;
  const canEnable =
    enabled ||
    canEnableRemoteSettings(settings, data.available);
  const cloudflare = settings.cloudflare;
  const generatedHostname =
    cloudflare.generatedLabel === "" ||
    cloudflare.domain === ""
      ? ""
      : `${cloudflare.generatedLabel}.${cloudflare.domain}`;
  const configuredHostname =
    cloudflare.hostnameMode === "generated"
      ? generatedHostname
      : cloudflare.customHostname;
  const originAddress =
    `http://127.0.0.1:${String(cloudflare.originPort)}`;
  const compact = variant === "hub";
  const methodBlocked = !available;
  const showTailscaleConfiguration =
    method === "tailscale" && (!compact || advancedOpen);
  const showCloudflareConfiguration =
    method === "cloudflare";

  useEffect(() => {
    setCopyState("idle");
    if (copyReset.current !== undefined) {
      window.clearTimeout(copyReset.current);
      copyReset.current = undefined;
    }
    return () => {
      if (copyReset.current !== undefined) {
        window.clearTimeout(copyReset.current);
      }
    };
  }, [address]);

  useEffect(() => {
    if (
      snapshot.editable &&
      !enabled &&
      method === "cloudflare" &&
      cloudflare.generatedLabel === ""
    ) {
      runtime.regenerateCloudflareHostname();
    }
  }, [
    cloudflare.generatedLabel,
    enabled,
    method,
    runtime,
    snapshot.editable,
  ]);

  const scheduleCopyReset = (): void => {
    if (copyReset.current !== undefined) {
      window.clearTimeout(copyReset.current);
    }
    copyReset.current = window.setTimeout(() => {
      setCopyState("idle");
      copyReset.current = undefined;
    }, 1_500);
  };

  const copy = async (): Promise<void> => {
    if (address === undefined || copyState === "copying") return;
    setCopyState("copying");
    const copied = await copyAddress(address);
    setCopyState(copied ? "copied" : "error");
    scheduleCopyReset();
  };

  const copySelection = (
    event: ClipboardEvent<HTMLElement>,
  ): void => {
    if (address === undefined) return;
    try {
      event.clipboardData.setData("text/plain", address);
      event.preventDefault();
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    scheduleCopyReset();
  };

  return (
    <section
      className={
        compact
          ? "minke-remote minke-remote--hub"
          : "minke-remote"
      }
      aria-labelledby={titleId}
      data-minke-remote
      data-variant={variant}
    >
      <div className="minke-remote__intro">
        <h2 id={titleId} className="minke-remote__title">
          {t("title")}
        </h2>
        <p className="minke-remote__description">
          {t("description")}
        </p>
        {snapshot.error !== undefined && (
          <p className="minke-remote__error" role="alert">
            {t(errorKey(snapshot.error))}
          </p>
        )}
      </div>

      <div className="minke-remote__card">
        {(!compact ||
          enabled ||
          methodBlocked ||
          presentation.helpKey !== undefined) && (
          <div className="minke-remote__card-header">
            <div className="minke-remote__method">
              <span className="minke-remote__method-name">
                {t(
                  method === "tailscale"
                    ? "tailscaleTitle"
                    : "cloudflareTitle",
                )}
              </span>
              <span className="minke-remote__method-description">
                {t(
                  method === "tailscale"
                    ? "tailscaleDescription"
                    : "cloudflareDescription",
                )}
              </span>
            </div>
            <div className="minke-remote__status-actions">
              <span
                className="minke-remote__status"
                data-state={presentation.state}
                role="status"
                aria-live="polite"
              >
                {t(presentation.statusKey)}
              </span>
              {presentation.canRefresh && (
                <button
                  type="button"
                  className="minke-remote__refresh"
                  disabled={
                    snapshot.operation.kind === "refreshing"
                  }
                  aria-busy={
                    snapshot.operation.kind === "refreshing"
                  }
                  onClick={() => {
                    void runtime.refresh();
                  }}
                >
                  {snapshot.operation.kind === "refreshing"
                    ? t("refreshing")
                    : t("refresh")}
                </button>
              )}
            </div>
          </div>
        )}

        {address !== undefined && (
          <div className="minke-remote__address">
            <span className="minke-remote__label">
              {t("address")}
            </span>
            <div className="minke-remote__address-control">
              <a
                className="minke-remote__address-link"
                href={address}
                target="_blank"
                rel="noreferrer"
                aria-label={t("openAddress")}
                onCopy={copySelection}
              >
                <code>{maskedAddress}</code>
              </a>
              <button
                type="button"
                className="minke-remote__copy"
                disabled={copyState === "copying"}
                aria-live="polite"
                onClick={() => {
                  void copy();
                }}
              >
                {copyState === "copying"
                  ? t("copyingAddress")
                  : copyState === "copied"
                    ? t("copiedAddress")
                    : t("copyAddress")}
              </button>
            </div>
            {copyState === "error" && (
              <p className="minke-remote__error" role="alert">
                {t("copyAddressError")}
              </p>
            )}
          </div>
        )}

        {!available && (
          <p className="minke-remote__help">
            {t(
              method === "tailscale"
                ? "unavailableTailscale"
                : "unavailableCloudflare",
            )}
          </p>
        )}
        {presentation.helpKey !== undefined && (
          <div
            className={
              presentation.state === "saving"
                ? "minke-remote__help"
                : "minke-remote__error"
            }
            role={
              presentation.state === "saving"
                ? "status"
                : "alert"
            }
          >
            <p>{t(presentation.helpKey)}</p>
            {data.runtime.error === "serve-permission" && (
              <a
                className="minke-remote__help-link"
                href={TAILSCALE_SERVE_PERMISSION_ISSUE}
                target="_blank"
                rel="noreferrer"
              >
                {t("servePermissionIssue")}
              </a>
            )}
          </div>
        )}

        {(!compact || !enabled) && (
          <fieldset className="minke-remote__fieldset">
            <legend className="minke-remote__fieldset-title">
              {t("methodTitle")}
            </legend>
            <div className="minke-remote__choices">
            <label
              className="minke-remote__choice"
              data-selected={method === "tailscale"}
            >
              <input
                type="radio"
                name={methodName}
                value="tailscale"
                checked={method === "tailscale"}
                disabled={providerLocked}
                onChange={() => {
                  runtime.setMethod("tailscale");
                }}
              />
              <span className="minke-remote__choice-copy">
                <span className="minke-remote__choice-title">
                  {t("tailscaleTitle")}
                  <span className="minke-remote__tag">
                    {t("recommended")}
                  </span>
                </span>
                <span className="minke-remote__help">
                  {t("tailscaleDescription")}
                </span>
              </span>
            </label>
            <label
              className="minke-remote__choice"
              data-selected={method === "cloudflare"}
            >
              <input
                type="radio"
                name={methodName}
                value="cloudflare"
                checked={method === "cloudflare"}
                disabled={providerLocked}
                onChange={() => {
                  runtime.setMethod("cloudflare");
                }}
              />
              <span className="minke-remote__choice-copy">
                <span className="minke-remote__choice-title">
                  {t("cloudflareTitle")}
                  <span className="minke-remote__tag">
                    {t("advanced")}
                  </span>
                </span>
                <span className="minke-remote__help">
                  {t("cloudflareDescription")}
                </span>
              </span>
            </label>
            </div>
          </fieldset>
        )}

        {compact &&
          !enabled &&
          !methodBlocked &&
          method === "tailscale" && (
            <button
              type="button"
              className="minke-remote__advanced-toggle"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((value) => !value)}
            >
              {t(
                advancedOpen
                  ? "hideAdvancedSettings"
                  : "advancedSettings",
              )}
            </button>
          )}

        {(!compact || (!enabled && !methodBlocked)) &&
        method === "tailscale" &&
        showTailscaleConfiguration ? (
          <fieldset className="minke-remote__fieldset">
            <legend className="minke-remote__fieldset-title">
              {t("tailscaleTransportTitle")}
            </legend>
            <div className="minke-remote__choices">
              <label
                className="minke-remote__choice"
                data-selected={
                  settings.tailscale.transport === "serve"
                }
              >
                <input
                  type="radio"
                  name={tailscaleTransportName}
                  value="serve"
                  checked={
                    settings.tailscale.transport === "serve"
                  }
                  disabled={providerLocked}
                  onChange={() => {
                    runtime.setTailscaleTransport("serve");
                  }}
                />
                <span className="minke-remote__choice-copy">
                  <span className="minke-remote__choice-title">
                    {t("serveTitle")}
                    <span className="minke-remote__tag">
                      {t("recommended")}
                    </span>
                  </span>
                  <span className="minke-remote__help">
                    {t("serveDescription")}
                  </span>
                </span>
              </label>
              <label
                className="minke-remote__choice"
                data-selected={
                  settings.tailscale.transport === "direct"
                }
              >
                <input
                  type="radio"
                  name={tailscaleTransportName}
                  value="direct"
                  checked={
                    settings.tailscale.transport === "direct"
                  }
                  disabled={providerLocked}
                  onChange={() => {
                    runtime.setTailscaleTransport("direct");
                  }}
                />
                <span className="minke-remote__choice-copy">
                  <span className="minke-remote__choice-title">
                    {t("directTitle")}
                    <span className="minke-remote__tag">
                      {t("advanced")}
                    </span>
                  </span>
                  <span className="minke-remote__help">
                    {t("directDescription")}
                  </span>
                  <span className="minke-remote__warning">
                    {t("directWarning")}
                  </span>
                </span>
              </label>
            </div>
          </fieldset>
        ) : (!compact || (!enabled && !methodBlocked)) &&
          showCloudflareConfiguration ? (
          <div className="minke-remote__cloudflare">
            <div className="minke-remote__notice">
              <strong>{t("cloudflareSetupTitle")}</strong>
              <span>{t("cloudflareSetupDescription")}</span>
            </div>

            <fieldset className="minke-remote__fieldset">
              <legend className="minke-remote__fieldset-title">
                {t("hostnameModeTitle")}
              </legend>
              <div className="minke-remote__choices">
                <label
                  className="minke-remote__choice"
                  data-selected={
                    cloudflare.hostnameMode === "generated"
                  }
                >
                  <input
                    type="radio"
                    name={cloudflareHostnameName}
                    checked={
                      cloudflare.hostnameMode === "generated"
                    }
                    disabled={providerLocked}
                    onChange={() => {
                      runtime.setCloudflareSettings({
                        hostnameMode: "generated",
                      });
                    }}
                  />
                  <span className="minke-remote__choice-copy">
                    <span className="minke-remote__choice-title">
                      {t("generatedHostnameTitle")}
                      <span className="minke-remote__tag">
                        {t("recommended")}
                      </span>
                    </span>
                    <span className="minke-remote__help">
                      {t("generatedHostnameDescription")}
                    </span>
                  </span>
                </label>
                <label
                  className="minke-remote__choice"
                  data-selected={
                    cloudflare.hostnameMode === "custom"
                  }
                >
                  <input
                    type="radio"
                    name={cloudflareHostnameName}
                    checked={
                      cloudflare.hostnameMode === "custom"
                    }
                    disabled={providerLocked}
                    onChange={() => {
                      runtime.setCloudflareSettings({
                        hostnameMode: "custom",
                      });
                    }}
                  />
                  <span className="minke-remote__choice-copy">
                    <span className="minke-remote__choice-title">
                      {t("customHostnameTitle")}
                    </span>
                    <span className="minke-remote__help">
                      {t("customHostnameDescription")}
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>

            <div className="minke-remote__form-grid">
              {cloudflare.hostnameMode === "generated" ? (
                <>
                  <label className="minke-remote__field">
                    <span>{t("baseDomain")}</span>
                    <input
                      type="text"
                      value={cloudflare.domain}
                      placeholder="example.com"
                      disabled={providerLocked}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      onChange={(event) => {
                        runtime.setCloudflareSettings({
                          domain: event.currentTarget.value
                            .trim()
                            .toLowerCase(),
                        });
                      }}
                    />
                  </label>
                  <label className="minke-remote__field">
                    <span>{t("randomLabel")}</span>
                    <span className="minke-remote__inline-control">
                      <input
                        type="text"
                        value={cloudflare.generatedLabel}
                        readOnly
                      />
                      <button
                        type="button"
                        disabled={providerLocked}
                        onClick={() => {
                          runtime.regenerateCloudflareHostname();
                        }}
                      >
                        {t("regenerateHostname")}
                      </button>
                    </span>
                  </label>
                </>
              ) : (
                <label className="minke-remote__field minke-remote__field--wide">
                  <span>{t("customHostname")}</span>
                  <input
                    type="text"
                    value={cloudflare.customHostname}
                    placeholder="minke.example.com"
                    disabled={providerLocked}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(event) => {
                      runtime.setCloudflareSettings({
                        customHostname:
                          event.currentTarget.value
                            .trim()
                            .toLowerCase(),
                      });
                    }}
                  />
                </label>
              )}

              <div className="minke-remote__field minke-remote__field--wide">
                <span>{t("hostnamePreview")}</span>
                <code>
                  {configuredHostname === ""
                    ? "—"
                    : configuredHostname}
                </code>
                <small>{t("hostnamePrivacyNote")}</small>
              </div>

              <label className="minke-remote__field">
                <span>{t("teamName")}</span>
                <span className="minke-remote__input-suffix">
                  <input
                    type="text"
                    value={cloudflare.teamName}
                    placeholder="my-team"
                    disabled={providerLocked}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(event) => {
                      runtime.setCloudflareSettings({
                        teamName: event.currentTarget.value
                          .trim()
                          .toLowerCase(),
                      });
                    }}
                  />
                  <span>{t("teamNameSuffix")}</span>
                </span>
              </label>

              <label className="minke-remote__field">
                <span>{t("audience")}</span>
                <input
                  type="text"
                  value={cloudflare.audience}
                  disabled={providerLocked}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => {
                    runtime.setCloudflareSettings({
                      audience: event.currentTarget.value.trim(),
                    });
                  }}
                />
              </label>

              <label className="minke-remote__field">
                <span>{t("tunnelName")}</span>
                <input
                  type="text"
                  value={cloudflare.tunnel}
                  disabled={providerLocked}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => {
                    runtime.setCloudflareSettings({
                      tunnel: event.currentTarget.value.trim(),
                    });
                  }}
                />
              </label>

              <label className="minke-remote__field">
                <span>{t("originPort")}</span>
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  value={cloudflare.originPort}
                  disabled={providerLocked}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    if (
                      Number.isInteger(value) &&
                      value >= 1024 &&
                      value <= 65535
                    ) {
                      runtime.setCloudflareSettings({
                        originPort: value,
                      });
                    }
                  }}
                />
              </label>

              <label className="minke-remote__field minke-remote__field--wide">
                <span>{t("configPath")}</span>
                <input
                  type="text"
                  value={cloudflare.configPath}
                  placeholder="/absolute/path/to/config.yml"
                  disabled={providerLocked}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => {
                    runtime.setCloudflareSettings({
                      configPath: event.currentTarget.value,
                    });
                  }}
                />
              </label>

              <div className="minke-remote__field minke-remote__field--wide">
                <span>{t("originAddress")}</span>
                <code>{originAddress}</code>
              </div>
            </div>

            <p className="minke-remote__notice">
              {t("cloudflareAccessRequired")}
            </p>
          </div>
        ) : null}

        {compact ? (
          (enabled || !methodBlocked) && (
            <div className="minke-remote__action-row">
              <p className="minke-remote__help">
                {t("lifecycle")}
              </p>
              <button
                type="button"
                className="minke-remote__primary-action"
                disabled={
                  !snapshot.editable ||
                  (!canEnable && !enabled)
                }
                onClick={() => {
                  runtime.setEnabled(!enabled);
                }}
              >
                {t(enabled ? "disable" : "enable")}
              </button>
            </div>
          )
        ) : (
          <label className="minke-remote__toggle-row">
            <span className="minke-remote__toggle-copy">
              <span className="minke-remote__label">
                {t("enable")}
              </span>
              <span className="minke-remote__help">
                {t("lifecycle")}
              </span>
            </span>
            <span className="minke-remote__switch">
              <input
                type="checkbox"
                checked={enabled}
                disabled={
                  !snapshot.editable ||
                  (!canEnable && !enabled)
                }
                aria-label={t("enable")}
                onChange={(event) => {
                  runtime.setEnabled(
                    event.currentTarget.checked,
                  );
                }}
              />
              <span aria-hidden="true" />
            </span>
          </label>
        )}

      </div>

      {compact ? (
        <details className="minke-remote__security-disclosure">
          <summary>{t("securityTitle")}</summary>
          <p>{t("securityBody")}</p>
        </details>
      ) : (
        <aside className="minke-remote__security">
          <span className="minke-remote__security-title">
            {t("securityTitle")}
          </span>
          <p>{t("securityBody")}</p>
        </aside>
      )}
    </section>
  );
}

function errorKey(
  error: "unavailable" | "read" | "write",
): "readError" | "writeError" {
  return error === "write" ? "writeError" : "readError";
}
