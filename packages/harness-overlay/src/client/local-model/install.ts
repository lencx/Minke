import type {
  HarnessClientContext,
} from "../core/context.ts";
import {
  desktopModelRuntimeSettingsStore,
} from "../desktop/index.ts";
import {
  installLocalModelSettings,
  localModelEn,
  localModelZh,
  LocalModelSettingsRuntime,
  type LocalModelLocaleKey,
  type LocalModelTranslate,
} from "./index.ts";

const LOCAL_MODEL_NAMESPACE = "minke.local-model";

/** Install the native local-model settings adapter when supported. */
export function installLocalModel(
  ctx: HarnessClientContext,
): void {
  const modelRuntimeSettingsStore =
    desktopModelRuntimeSettingsStore();
  if (!modelRuntimeSettingsStore.available) return;

  ctx.effect(
    () =>
      ctx.locale.register(LOCAL_MODEL_NAMESPACE, {
        zh: localModelZh,
        en: localModelEn,
      }),
    "minke-overlay: local model settings dictionaries",
  );
  const modelRuntimeSettings = new LocalModelSettingsRuntime(
    modelRuntimeSettingsStore,
  );
  const localModelT = ctx.locale.bind<LocalModelLocaleKey>(
    LOCAL_MODEL_NAMESPACE,
  ) as LocalModelTranslate;
  ctx.effect(
    () => {
      let active = true;
      let disposeView = (): void => {};
      void modelRuntimeSettings.initialize().then(() => {
        if (!active) return;
        disposeView = installLocalModelSettings(
          modelRuntimeSettings,
          localModelT,
        );
      });
      return () => {
        active = false;
        disposeView();
        modelRuntimeSettings.dispose();
      };
    },
    "minke-overlay: local model settings runtime",
  );
}
