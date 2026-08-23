import type {
  TabRendererRegistry,
} from "../registry.ts";
import type {
  TabsRuntime,
} from "../runtime.ts";
import {
  DetailsTabsController,
  installDetailsLayoutOpenBridge,
  installDetailsTabsBridge,
} from "./controller.ts";
import {
  createDetailsTabRenderer,
} from "./renderer.tsx";

interface DetailsStateEventHost extends EventTarget {
  readonly [key: string]: unknown;
}

export interface DetailsTabsLayoutHost {
  openDetails(): void;
  closeDetails(): void;
}

export interface DetailsTabsIntegrationOptions {
  readonly runtime: TabsRuntime;
  readonly renderers: TabRendererRegistry;
  readonly layout: DetailsTabsLayoutHost;
  readonly host?: DetailsStateEventHost;
  readonly schedule?: (task: () => void) => void;
}

/**
 * Own the complete Details/Tabs integration lifecycle behind one seam:
 * renderer registration, upstream state reconciliation, layout interception,
 * and cleanup ordering.
 */
export function installDetailsTabs({
  runtime,
  renderers,
  layout,
  host,
  schedule,
}: DetailsTabsIntegrationOptions): () => void {
  const controller = new DetailsTabsController(runtime, {
    releaseHost: layout.closeDetails.bind(layout),
    ...(schedule === undefined ? {} : { schedule }),
  });
  const unregisterRenderer = renderers.register(
    createDetailsTabRenderer(),
  );
  let restoreLayout: (() => void) | undefined;
  try {
    restoreLayout = installDetailsLayoutOpenBridge(
      layout,
      controller,
      host,
    );
    const disconnectState = installDetailsTabsBridge(
      controller,
      host,
    );
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      try {
        restoreLayout?.();
      } finally {
        try {
          disconnectState();
        } finally {
          unregisterRenderer();
        }
      }
    };
  } catch (error) {
    try {
      restoreLayout?.();
    } finally {
      controller.dispose();
      unregisterRenderer();
    }
    throw error;
  }
}
