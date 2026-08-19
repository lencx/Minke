import {
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type {
  RemoteRuntimeSnapshot,
} from "@lencx/minke-remote-access/contract";
import type {
  RemoteTranslate,
} from "./locales.ts";
import type {
  RemoteSettingsErrorKind,
  RemoteSettingsRuntime,
} from "./runtime.ts";

export interface RemoteSettingsSectionProps {
  runtime?: RemoteSettingsRuntime;
  t?: RemoteTranslate;
}

/** Desktop-only Settings page for private mobile access. */
export function RemoteSettingsSection({
  runtime,
  t,
}: RemoteSettingsSectionProps): ReactNode {
  if (runtime === undefined || t === undefined) return null;
  return <LoadedRemoteSettings runtime={runtime} t={t} />;
}

function LoadedRemoteSettings({
  runtime,
  t,
}: Required<RemoteSettingsSectionProps>): ReactNode {
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const data = snapshot.data;
  const available = data.available.tailscale;
  const enabled = data.settings.tailscale.enabled;
  const statusHelp =
    data.runtime.state === "error"
      ? data.runtime.error === "serve"
        ? t("serveErrorHelp")
        : t("statusErrorHelp")
      : undefined;

  return (
    <section
      className="minke-remote"
      aria-labelledby="minke-remote-title"
      data-minke-remote
    >
      <div className="minke-remote__intro">
        <h2 id="minke-remote-title" className="minke-remote__title">
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
              {t("tailscaleTitle")}
            </span>
            <span className="minke-remote__method-description">
              {t("tailscaleDescription")}
            </span>
          </div>
          <div className="minke-remote__status-actions">
            <span
              className="minke-remote__status"
              data-state={data.runtime.state}
            >
              {t(statusKey(data.runtime))}
            </span>
            <button
              type="button"
              className="minke-remote__refresh"
              disabled={snapshot.refreshing}
              aria-busy={snapshot.refreshing}
              onClick={() => {
                void runtime.refresh();
              }}
            >
              {snapshot.refreshing
                ? t("refreshing")
                : t("refresh")}
            </button>
          </div>
        </div>

        {(data.runtime.state === "ready" ||
          data.runtime.state === "active") && (
          <div className="minke-remote__address">
            <span className="minke-remote__label">
              {t("address")}
            </span>
            <code>{data.runtime.url}</code>
          </div>
        )}

        {!available && (
          <p className="minke-remote__help">
            {t("unavailable")}
          </p>
        )}
        {statusHelp !== undefined && (
          <p className="minke-remote__error" role="alert">
            {statusHelp}
          </p>
        )}

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
                !snapshot.editable || (!available && !enabled)
              }
              aria-label={t("enable")}
              onChange={(event) => {
                runtime.setTailscaleEnabled(
                  event.currentTarget.checked,
                );
              }}
            />
            <span aria-hidden="true" />
          </span>
        </label>

        {snapshot.restartRequired && (
          <p className="minke-remote__pending" role="status">
            {t("restartRequired")}
          </p>
        )}
      </div>

      <aside className="minke-remote__security">
        <span className="minke-remote__security-title">
          {t("securityTitle")}
        </span>
        <p>{t("securityBody")}</p>
      </aside>
    </section>
  );
}

function statusKey(
  runtime: RemoteRuntimeSnapshot,
):
  | "statusDisabled"
  | "statusUnavailable"
  | "statusReady"
  | "statusActive"
  | "statusError" {
  switch (runtime.state) {
    case "disabled":
      return "statusDisabled";
    case "unavailable":
      return "statusUnavailable";
    case "ready":
      return "statusReady";
    case "active":
      return "statusActive";
    case "error":
      return "statusError";
  }
}

function errorKey(
  error: RemoteSettingsErrorKind,
): "readError" | "writeError" {
  return error === "write" ? "writeError" : "readError";
}
