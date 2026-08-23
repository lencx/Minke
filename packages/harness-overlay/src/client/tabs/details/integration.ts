import type {
  HarnessClientContext,
  SlotService,
} from "../../core/context.ts";
import {
  createElement,
} from "react";
import type {
  TabRendererRegistry,
} from "../registry.ts";
import type {
  TabsRuntime,
} from "../runtime.ts";
import {
  DetailsTabsController,
} from "./controller.ts";
import type {
  DshDetailsPresentation,
} from "./contract.ts";
import {
  DetailsPresentationAdapter,
} from "./presentation.tsx";
import {
  DetailsPresentationRuntime,
} from "./presentation-runtime.ts";
import {
  createDetailsTabRenderer,
} from "./renderer.tsx";

export interface DetailsTabsIntegrationOptions {
  readonly runtime: TabsRuntime;
  readonly renderers: TabRendererRegistry;
  readonly slots: SlotService;
  readonly layout: Pick<HarnessClientContext["layout"], "details">;
  readonly schedule?: (task: () => void) => void;
}

/**
 * Adapt Harness's semantic Details state and presentation slot to Minke Tabs.
 * Harness retains the panel tree and state; Minke owns only its host surface.
 */
export function installDetailsTabs({
  runtime,
  renderers,
  slots,
  layout,
  schedule,
}: DetailsTabsIntegrationOptions): () => void {
  const presentation = new DetailsPresentationRuntime();
  const controller = new DetailsTabsController(runtime, {
    releaseHost: layout.details.close,
    ...(schedule === undefined ? {} : { schedule }),
  });
  const unregisterRenderer = renderers.register(
    createDetailsTabRenderer(
      presentation,
      layout.details.close,
    ),
  );
  let disconnectPresentation: (() => void) | undefined;
  try {
    disconnectPresentation = slots.inject(
      "conversation.details.presentation",
      () => {
        const releasePresentationHost =
          layout.details.registerHost();
        try {
          const unregisterPresentation =
            slots.register<DshDetailsPresentation>(
              {
                name: "conversation.details.presentation",
                id: "minke-details-tabs",
              },
              (props) =>
                createElement(DetailsPresentationAdapter, {
                  ...props,
                  controller,
                  presentation,
                }),
            );
          return () => {
            try {
              unregisterPresentation();
            } finally {
              releasePresentationHost();
            }
          };
        } catch (error) {
          releasePresentationHost();
          throw error;
        }
      },
    );
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      try {
        disconnectPresentation?.();
      } finally {
        controller.dispose();
        presentation.setTarget(null);
        unregisterRenderer();
      }
    };
  } catch (error) {
    controller.dispose();
    unregisterRenderer();
    throw error;
  }
}
