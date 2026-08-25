import {
  CircleQuestionMark,
  RotateCw,
} from "@lucide/icons";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type MouseEvent as ReactMouseEvent,
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
  cloudflareBaseDomainAdvisory,
  cloudflareHostnameFields,
  cloudflareHostnameLabelAdvisory,
  tailscaleIpAddressAdvisory,
  type RemoteSettingsRuntime,
} from "./runtime.ts";
import {
  LucideIcon,
} from "../tabs/components/LucideIcon.ts";

type CopyAddress = typeof copyRemoteAddress;
type OpenExternal = (url: string) => void;
type CopyState = "idle" | "copying" | "copied" | "error";
const TAILSCALE_SERVE_PERMISSION_ISSUE =
  "https://github.com/tailscale/tailscale/issues/19933";
const TAILSCALE_SERVE_GUIDE =
  "https://tailscale.com/docs/features/tailscale-serve";
const TAILSCALE_IP_GUIDE =
  "https://tailscale.com/docs/concepts/ip-and-dns-addresses";
const TAILSCALE_ACCESS_CONTROL_GUIDE =
  "https://tailscale.com/docs/features/access-control";
const TAILSCALE_SHARING_GUIDE =
  "https://tailscale.com/docs/features/sharing";
const TAILSCALE_REMOVE_DEVICE_GUIDE =
  "https://tailscale.com/docs/features/access-control/device-management/how-to/remove";
const CLOUDFLARE_TUNNEL_GUIDE =
  "https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/create-local-tunnel/";
const CLOUDFLARE_ACCESS_APP_GUIDE =
  "https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/";
const CLOUDFLARE_AUDIENCE_GUIDE =
  "https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/#get-your-aud-tag";

export interface RemoteSettingsSectionProps {
  runtime?: RemoteSettingsRuntime;
  t?: RemoteTranslate;
  copyAddress?: CopyAddress;
  openExternal?: OpenExternal;
}

/** Desktop-only connection controls for managed remote access. */
export function RemoteSettingsSection({
  runtime,
  t,
  copyAddress = copyRemoteAddress,
  openExternal,
}: RemoteSettingsSectionProps): ReactNode {
  if (runtime === undefined || t === undefined) return null;
  return (
    <LoadedRemoteSettings
      runtime={runtime}
      t={t}
      copyAddress={copyAddress}
      openExternal={openExternal}
    />
  );
}

function LoadedRemoteSettings({
  runtime,
  t,
  copyAddress,
  openExternal,
}: {
  runtime: RemoteSettingsRuntime;
  t: RemoteTranslate;
  copyAddress: CopyAddress;
  openExternal: OpenExternal | undefined;
}): ReactNode {
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const titleId = useId();
  const methodName = useId();
  const tailscaleTransportName = useId();
  const tailscaleIpInputId = useId();
  const tailscaleIpHintId = useId();
  const tailscaleIpAdvisoryId = useId();
  const baseDomainInputId = useId();
  const baseDomainHintId = useId();
  const baseDomainAdvisoryId = useId();
  const generatedLabelInputId = useId();
  const generatedLabelAdvisoryId = useId();
  const securityCleanupTitleId = useId();
  const [copyState, setCopyState] =
    useState<CopyState>("idle");
  const [baseDomainHelpHovered, setBaseDomainHelpHovered] =
    useState(false);
  const [baseDomainHelpFocused, setBaseDomainHelpFocused] =
    useState(false);
  const [baseDomainHelpDismissed, setBaseDomainHelpDismissed] =
    useState(false);
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
  const hostnameFields =
    cloudflareHostnameFields(cloudflare);
  const generatedHostname =
    hostnameFields.label === "" ||
    hostnameFields.baseDomain === ""
      ? ""
      : `${hostnameFields.label}.${hostnameFields.baseDomain}`;
  const configuredHostname =
    generatedHostname !== ""
      ? generatedHostname
      : cloudflare.hostnameMode === "custom"
        ? cloudflare.customHostname
        : "";
  const baseDomainAdvisory =
    cloudflareBaseDomainAdvisory(
      hostnameFields.baseDomain,
    );
  const generatedLabelAdvisory =
    cloudflareHostnameLabelAdvisory(
      hostnameFields.label,
    );
  const tailscaleIpAdvisory =
    tailscaleIpAddressAdvisory(
      settings.tailscale.ipAddress,
    );
  const baseDomainDescriptionIds =
    baseDomainAdvisory === undefined
      ? baseDomainHintId
      : `${baseDomainHintId} ${baseDomainAdvisoryId}`;
  const baseDomainHelpOpen =
    !baseDomainHelpDismissed &&
    (baseDomainHelpHovered || baseDomainHelpFocused);
  const originAddress =
    `http://127.0.0.1:${String(cloudflare.originPort)}`;

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
      className="minke-remote minke-remote--connections"
      aria-labelledby={titleId}
      data-minke-remote
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
              <ExternalReferenceLink
                className="minke-remote__help-link"
                href={TAILSCALE_SERVE_PERMISSION_ISSUE}
                openExternal={openExternal}
              >
                {t("servePermissionIssue")}
              </ExternalReferenceLink>
            )}
          </div>
        )}
        {enabled && (
          <p className="minke-remote__help">
            {t("configurationLocked")}
          </p>
        )}

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

        {method === "tailscale" ? (
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
            {settings.tailscale.transport === "direct" && (
              <div className="minke-remote__direct-settings">
                <div className="minke-remote__field">
                  <label htmlFor={tailscaleIpInputId}>
                    {t("tailscaleIpAddress")}
                  </label>
                  <input
                    id={tailscaleIpInputId}
                    type="text"
                    inputMode="decimal"
                    value={settings.tailscale.ipAddress}
                    placeholder={t("tailscaleIpPlaceholder")}
                    disabled={providerLocked}
                    maxLength={15}
                    aria-describedby={
                      tailscaleIpAdvisory === undefined
                        ? tailscaleIpHintId
                        : `${tailscaleIpHintId} ${tailscaleIpAdvisoryId}`
                    }
                    aria-invalid={
                      tailscaleIpAdvisory === "invalid"
                        ? true
                        : undefined
                    }
                    autoCapitalize="none"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(event) => {
                      runtime.setTailscaleSettings({
                        ipAddress:
                          event.currentTarget.value.trim(),
                      });
                    }}
                  />
                  <small id={tailscaleIpHintId}>
                    {t("tailscaleIpHint")}
                  </small>
                  {tailscaleIpAdvisory !== undefined && (
                    <small
                      id={tailscaleIpAdvisoryId}
                      className="minke-remote__field-warning"
                      role="status"
                    >
                      {t("tailscaleIpInvalidWarning")}
                    </small>
                  )}
                </div>
              </div>
            )}
            <nav
              className="minke-remote__references minke-remote__references--tailscale"
              aria-label={t("tailscaleReferencesTitle")}
            >
              <span className="minke-remote__references-title">
                {t("tailscaleReferencesTitle")}
              </span>
              <ul>
                <li>
                  <ExternalReferenceLink
                    href={TAILSCALE_SERVE_GUIDE}
                    openExternal={openExternal}
                  >
                    {t("tailscaleServeReference")}
                  </ExternalReferenceLink>
                </li>
                <li>
                  <ExternalReferenceLink
                    href={TAILSCALE_IP_GUIDE}
                    openExternal={openExternal}
                  >
                    {t("tailscaleIpReference")}
                  </ExternalReferenceLink>
                </li>
                <li>
                  <ExternalReferenceLink
                    href={TAILSCALE_ACCESS_CONTROL_GUIDE}
                    openExternal={openExternal}
                  >
                    {t("tailscaleAccessControlReference")}
                  </ExternalReferenceLink>
                </li>
                <li>
                  <ExternalReferenceLink
                    href={TAILSCALE_SHARING_GUIDE}
                    openExternal={openExternal}
                  >
                    {t("tailscaleSharingReference")}
                  </ExternalReferenceLink>
                </li>
                <li>
                  <ExternalReferenceLink
                    href={TAILSCALE_REMOVE_DEVICE_GUIDE}
                    openExternal={openExternal}
                  >
                    {t("tailscaleRemoveDeviceReference")}
                  </ExternalReferenceLink>
                </li>
              </ul>
            </nav>
          </fieldset>
        ) : (
          <div className="minke-remote__cloudflare">
            <div className="minke-remote__notice">
              <strong>{t("cloudflareSetupTitle")}</strong>
              <span>{t("cloudflareSetupDescription")}</span>
              <nav
                className="minke-remote__references"
                aria-label={t("cloudflareReferencesTitle")}
              >
                <span className="minke-remote__references-title">
                  {t("cloudflareReferencesTitle")}
                </span>
                <ul>
                  <li>
                    <ExternalReferenceLink
                      href={CLOUDFLARE_TUNNEL_GUIDE}
                      openExternal={openExternal}
                    >
                      {t("cloudflareTunnelReference")}
                    </ExternalReferenceLink>
                  </li>
                  <li>
                    <ExternalReferenceLink
                      href={CLOUDFLARE_ACCESS_APP_GUIDE}
                      openExternal={openExternal}
                    >
                      {t("cloudflareAccessAppReference")}
                    </ExternalReferenceLink>
                  </li>
                  <li>
                    <ExternalReferenceLink
                      href={CLOUDFLARE_AUDIENCE_GUIDE}
                      openExternal={openExternal}
                    >
                      {t("cloudflareAudienceReference")}
                    </ExternalReferenceLink>
                  </li>
                </ul>
              </nav>
            </div>

            <div className="minke-remote__form-grid">
              <div className="minke-remote__field">
                <label htmlFor={baseDomainInputId}>
                  {t("baseDomain")}
                </label>
                <span
                  className="minke-remote__input-help"
                  onMouseEnter={() => {
                    setBaseDomainHelpHovered(true);
                    setBaseDomainHelpDismissed(false);
                  }}
                  onMouseLeave={() => {
                    setBaseDomainHelpHovered(false);
                    setBaseDomainHelpDismissed(false);
                  }}
                >
                  <input
                    id={baseDomainInputId}
                    type="text"
                    value={hostnameFields.baseDomain}
                    placeholder="example.com"
                    disabled={providerLocked}
                    aria-describedby={baseDomainDescriptionIds}
                    aria-invalid={
                      baseDomainAdvisory === "invalid"
                        ? true
                        : undefined
                    }
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(event) => {
                      runtime.setCloudflareSettings({
                        hostnameMode: "generated",
                        domain:
                          event.currentTarget.value
                            .trim()
                            .toLowerCase(),
                        generatedLabel: hostnameFields.label,
                      });
                    }}
                  />
                  <button
                    type="button"
                    className="minke-remote__help-trigger"
                    aria-label={t("baseDomainHelpLabel")}
                    aria-describedby={baseDomainHintId}
                    onFocus={() => {
                      setBaseDomainHelpFocused(true);
                      setBaseDomainHelpDismissed(false);
                    }}
                    onBlur={() => {
                      setBaseDomainHelpFocused(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Escape") return;
                      event.preventDefault();
                      event.stopPropagation();
                      setBaseDomainHelpDismissed(true);
                    }}
                  >
                    <LucideIcon
                      icon={CircleQuestionMark}
                      size={15}
                    />
                  </button>
                  <span
                    id={baseDomainHintId}
                    className="minke-remote__help-tooltip"
                    role="tooltip"
                    data-open={baseDomainHelpOpen}
                  >
                    {t("baseDomainHint")}
                  </span>
                </span>
                {baseDomainAdvisory !== undefined && (
                  <small
                    id={baseDomainAdvisoryId}
                    className="minke-remote__field-warning"
                    role="status"
                  >
                    {t(
                      baseDomainAdvisory === "invalid"
                        ? "baseDomainInvalidWarning"
                        : "baseDomainNestedWarning",
                    )}
                  </small>
                )}
              </div>
              <div className="minke-remote__field">
                <label htmlFor={generatedLabelInputId}>
                  {t("randomLabel")}
                </label>
                <span className="minke-remote__inline-control">
                  <input
                    id={generatedLabelInputId}
                    type="text"
                    value={hostnameFields.label}
                    disabled={providerLocked}
                    maxLength={63}
                    aria-describedby={
                      generatedLabelAdvisory === undefined
                        ? undefined
                        : generatedLabelAdvisoryId
                    }
                    aria-invalid={
                      generatedLabelAdvisory === "invalid"
                        ? true
                        : undefined
                    }
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(event) => {
                      runtime.setCloudflareSettings({
                        hostnameMode: "generated",
                        domain: hostnameFields.baseDomain,
                        generatedLabel:
                          event.currentTarget.value
                            .trim()
                            .toLowerCase(),
                      });
                    }}
                  />
                  <button
                    type="button"
                    className="minke-remote__regenerate"
                    disabled={providerLocked}
                    aria-label={t("regenerateHostname")}
                    title={t("regenerateHostname")}
                    onClick={() => {
                      runtime.regenerateCloudflareHostname();
                    }}
                  >
                    <LucideIcon icon={RotateCw} size={16} />
                  </button>
                </span>
                {generatedLabelAdvisory !== undefined && (
                  <small
                    id={generatedLabelAdvisoryId}
                    className="minke-remote__field-warning"
                    role="status"
                  >
                    {t("randomLabelInvalidWarning")}
                  </small>
                )}
              </div>

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
        )}

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
      </div>

      <details
        className="minke-remote__security-disclosure"
        open
      >
        <summary>{t("securityTitle")}</summary>
        <div className="minke-remote__security-content">
          <p>
            {t(
              method === "tailscale"
                ? "tailscaleSecurityBody"
                : "securityBody",
            )}
          </p>
          <section
            className="minke-remote__security-cleanup"
            role="note"
            aria-labelledby={securityCleanupTitleId}
          >
            <strong
              id={securityCleanupTitleId}
              className="minke-remote__security-cleanup-title"
            >
              {t(
                method === "cloudflare"
                  ? "securityCleanupTitle"
                  : "tailscaleCleanupTitle",
              )}
            </strong>
            <p>
              {t(
                method === "cloudflare"
                  ? "securityCleanupIntro"
                  : "tailscaleCleanupIntro",
              )}
            </p>
            {method === "cloudflare" ? (
              <ol>
                <li>{t("securityCleanupStepDisable")}</li>
                <li>{t("securityCleanupStepProcess")}</li>
                <li>{t("securityCleanupStepDns")}</li>
                <li>{t("securityCleanupStepAccess")}</li>
                <li>{t("securityCleanupStepTunnel")}</li>
              </ol>
            ) : (
              <ol>
                <li>{t("tailscaleCleanupStepDisable")}</li>
                <li>
                  {t(
                    settings.tailscale.transport === "serve"
                      ? "tailscaleCleanupStepServe"
                      : "tailscaleCleanupStepDirect",
                  )}
                </li>
                <li>{t("tailscaleCleanupStepAccess")}</li>
                <li>{t("tailscaleCleanupStepDevice")}</li>
              </ol>
            )}
            <p className="minke-remote__security-cleanup-note">
              {t(
                method === "cloudflare"
                  ? "securityCleanupNote"
                  : "tailscaleCleanupNote",
              )}
            </p>
          </section>
        </div>
      </details>
    </section>
  );
}

function ExternalReferenceLink({
  children,
  className,
  href,
  openExternal,
}: {
  children: ReactNode;
  className?: string;
  href: string;
  openExternal: OpenExternal | undefined;
}): ReactNode {
  const handleClick = (
    event: ReactMouseEvent<HTMLAnchorElement>,
  ): void => {
    if (openExternal === undefined) return;
    event.preventDefault();
    openExternal(href);
  };
  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noreferrer"
      data-minke-open-external="system"
      onClick={handleClick}
    >
      {children}
    </a>
  );
}

function errorKey(
  error: "unavailable" | "read" | "write",
): "readError" | "writeError" {
  return error === "write" ? "writeError" : "readError";
}
