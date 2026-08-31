import {
  LOCAL_MODEL_RUNTIMES,
  type LocalModelRuntimeId,
} from "@lencx/minke-model-runtime/contract";
import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type ChangeEvent,
  type ReactNode,
} from "react";
import type {
  SlotService,
} from "../core/context.ts";
import type {
  LocalModelTranslate,
} from "./locales.ts";
import type {
  LocalModelSettingsRuntime,
  LocalModelSettingsSnapshot,
} from "./runtime.ts";

const PI_AI_SETTINGS_NAMESPACE = "llm-pi-ai";
const LOCAL_MODEL_FOOTER_ID = "minke-local-model-runtimes";

type LocalModelRuntimeDescriptor =
  (typeof LOCAL_MODEL_RUNTIMES)[number];

interface ProviderDirectoryEntry {
  readonly provider: string;
}

interface LocalModelSlotInjected {
  readonly runtime: LocalModelSettingsRuntime;
  readonly t: LocalModelTranslate;
}

interface LocalModelProviderCardProps
  extends LocalModelSlotInjected {
  readonly provider: ProviderDirectoryEntry;
  readonly configured: boolean;
  readonly keyConfigured: boolean;
}

function descriptorForProvider(
  provider: string,
): LocalModelRuntimeDescriptor | undefined {
  return LOCAL_MODEL_RUNTIMES.find(
    (descriptor) => descriptor.providerId === provider,
  );
}

function useLocalModelSettings(
  runtime: LocalModelSettingsRuntime,
): LocalModelSettingsSnapshot {
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const retriedRead = useRef(false);
  useEffect(() => {
    if (snapshot.error !== "read") {
      retriedRead.current = false;
      return;
    }
    if (retriedRead.current) return;
    retriedRead.current = true;
    void runtime.retry();
  }, [runtime, snapshot.error]);
  return snapshot;
}

function runtimeStatus(
  id: LocalModelRuntimeId,
  snapshot: LocalModelSettingsSnapshot,
  t: LocalModelTranslate,
): string {
  if (snapshot.error === "read") return t("readError");
  if (snapshot.error === "write") return t("writeError");
  if (snapshot.applying) return t("applying");
  if (!snapshot.available[id]) return t("commandNotFound");
  return t("restartRequired");
}

interface LocalModelRuntimeSwitchProps {
  readonly descriptor: LocalModelRuntimeDescriptor;
  readonly runtime: LocalModelSettingsRuntime;
  readonly snapshot: LocalModelSettingsSnapshot;
  readonly t: LocalModelTranslate;
}

function LocalModelRuntimeSwitch({
  descriptor,
  runtime,
  snapshot,
  t,
}: LocalModelRuntimeSwitchProps): ReactNode {
  const id = descriptor.id;
  const status = runtimeStatus(id, snapshot, t);
  const autoStart = t("autoStart");
  const disabled =
    !snapshot.editable ||
    !snapshot.available[id] ||
    snapshot.applying;
  const onChange = (
    event: ChangeEvent<HTMLInputElement>,
  ): void => {
    try {
      runtime.setEnabled(id, event.currentTarget.checked);
    } catch {
      event.currentTarget.checked =
        snapshot.settings[id].enabled;
    }
  };

  return (
    <span
      data-minke-local-model-settings={id}
      data-error={
        snapshot.error === "read" ||
          snapshot.error === "write"
          ? ""
          : undefined
      }
    >
      <label
        className="minke-local-model-switch"
        title={status}
      >
        <span className="minke-local-model-switch__label">
          {autoStart}
        </span>
        <input
          className="minke-local-model-switch__input"
          type="checkbox"
          role="switch"
          aria-label={`${descriptor.displayName}: ${autoStart}`}
          aria-describedby={`minke-local-model-${id}-status`}
          aria-busy={snapshot.applying}
          checked={snapshot.settings[id].enabled}
          disabled={disabled}
          onChange={onChange}
        />
        <span
          className="minke-local-model-switch__track"
          aria-hidden="true"
        >
          <span className="minke-local-model-switch__thumb" />
        </span>
      </label>
      <span
        className="minke-local-model-switch__status"
        id={`minke-local-model-${id}-status`}
        aria-live="polite"
      >
        {status}
      </span>
    </span>
  );
}

function LocalModelProviderCard({
  provider,
  runtime,
  t,
}: LocalModelProviderCardProps): ReactNode {
  const descriptor = descriptorForProvider(provider.provider);
  if (descriptor === undefined) return null;
  const snapshot = useLocalModelSettings(runtime);
  return (
    <div
      data-minke-local-model-provider-card={descriptor.id}
      className="minke-local-model-provider-card"
    >
      <LocalModelRuntimeSwitch
        descriptor={descriptor}
        runtime={runtime}
        snapshot={snapshot}
        t={t}
      />
    </div>
  );
}

function LocalModelFooter({
  runtime,
  t,
}: LocalModelSlotInjected): ReactNode {
  const snapshot = useLocalModelSettings(runtime);
  return (
    <div
      data-minke-local-model-runtime-settings=""
      className="minke-local-model-runtime-settings"
    >
      <ul className="minke-local-model-runtime-list">
        {LOCAL_MODEL_RUNTIMES.map((descriptor) => (
          <li
            key={descriptor.id}
            data-minke-local-model-footer-row={descriptor.id}
            className="minke-local-model-row"
          >
            <span className="minke-local-model-row__identity">
              <span className="minke-local-model-row__heading">
                <span>{descriptor.displayName}</span>
                <span className="minke-local-model-row__tag">
                  {t("localTag")}
                </span>
              </span>
              <span className="minke-local-model-row__note">
                {snapshot.available[descriptor.id]
                  ? t("noModels")
                  : t("commandNotFound")}
              </span>
            </span>
            <span className="minke-local-model-row__actions">
              <LocalModelRuntimeSwitch
                descriptor={descriptor}
                runtime={runtime}
                snapshot={snapshot}
                t={t}
              />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Register local runtime lifecycle controls into the Models page's public
 * alpha.2 extension seats. The keyed entry handles live provider cards; the
 * footer supplies rows while either local provider is absent.
 */
export function installLocalModelSettings(
  slots: SlotService,
  runtime: LocalModelSettingsRuntime,
  t: LocalModelTranslate,
): () => void {
  const inject = () => ({ runtime, t });
  const disconnectProvider = slots.inject(
    "settings.models.provider-card",
    () =>
      slots.register<LocalModelProviderCardProps>(
        {
          name: "settings.models.provider-card",
          key: PI_AI_SETTINGS_NAMESPACE,
          inject,
        },
        LocalModelProviderCard,
      ),
  );
  try {
    const disconnectFooter = slots.inject(
      "settings.models.footer",
      () =>
        slots.register<LocalModelSlotInjected>(
          {
            name: "settings.models.footer",
            id: LOCAL_MODEL_FOOTER_ID,
            order: 0,
            inject,
          },
          LocalModelFooter,
        ),
    );
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      disconnectFooter();
      disconnectProvider();
    };
  } catch (error) {
    disconnectProvider();
    throw error;
  }
}
