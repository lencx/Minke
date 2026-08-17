import { buildLucideDataUri } from "@lucide/icons/build";
import {
  FileDown,
  PanelBottom,
  PanelRight,
} from "@lucide/icons";
import {
  createElement,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  tabsPanelId,
  type TabsPanelPlacement,
} from "./constants.ts";
import type {
  TabsTranslate,
} from "./locales.ts";
import type {
  TabsRuntime,
} from "./runtime.ts";

const FILE_DOWN_ICON_DATA_URL = buildLucideDataUri(FileDown, {
  size: 16,
});
const PANEL_RIGHT_ICON_DATA_URL = buildLucideDataUri(PanelRight, {
  size: 16,
});
const PANEL_BOTTOM_ICON_DATA_URL = buildLucideDataUri(
  PanelBottom,
  {
    size: 16,
  },
);

export const SESSION_HEADER_ACTION_STYLES = `
[data-minke-tabs-layout-actions] {
  display: inline-flex;
  height: 32px;
  flex: none;
  align-items: center;
  gap: 4px;
}

[data-minke-session-log-action],
[data-minke-tabs-header-action] {
  display: inline-grid !important;
  width: 32px;
  min-width: 32px !important;
  height: 32px;
  flex: none;
  place-items: center;
  gap: 0 !important;
  box-sizing: border-box;
  padding: 0 !important;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

[data-minke-session-log-action]:hover:not(:disabled),
[data-minke-tabs-header-action]:hover:not(:disabled),
[data-minke-tabs-header-action][aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover);
}

[data-minke-session-log-action]:focus-visible,
[data-minke-tabs-header-action]:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}

[data-minke-session-log-action]:disabled {
  cursor: wait;
}

[data-minke-new-session-tabs-action] {
  position: absolute;
  top: 12px;
  right: 16px;
  pointer-events: none !important;
}

[data-shell-overlay]:has(
    .minke-tabs-panel[data-placement="right"][data-open]
  )
  [data-minke-new-session-tabs-action] {
  right: calc(var(--minke-tabs-panel-width, 360px) + 16px);
}

[data-minke-new-session-tabs-action]
  > [data-minke-tabs-layout-actions] {
  pointer-events: auto;
}

[data-minke-session-log-action]::before,
[data-minke-tabs-header-action]::before {
  width: 16px;
  height: 16px;
  background: currentColor;
  content: "";
}

[data-minke-session-log-action]::before {
  --minke-file-down-icon: url("${FILE_DOWN_ICON_DATA_URL}");
  -webkit-mask: var(--minke-file-down-icon) center / 16px 16px no-repeat;
  mask: var(--minke-file-down-icon) center / 16px 16px no-repeat;
}

[data-minke-tabs-header-action][data-minke-tabs-placement="right"]::before {
  --minke-panel-right-icon: url("${PANEL_RIGHT_ICON_DATA_URL}");
  -webkit-mask: var(--minke-panel-right-icon) center / 16px 16px no-repeat;
  mask: var(--minke-panel-right-icon) center / 16px 16px no-repeat;
}

[data-minke-tabs-header-action][data-minke-tabs-placement="bottom"]::before {
  --minke-panel-bottom-icon: url("${PANEL_BOTTOM_ICON_DATA_URL}");
  -webkit-mask: var(--minke-panel-bottom-icon) center / 16px 16px no-repeat;
  mask: var(--minke-panel-bottom-icon) center / 16px 16px no-repeat;
}
`;

/** Install styles shared by Minke-owned Session Header utilities. */
export function installSessionHeaderActionStyles(
  root: Document = document,
): () => void {
  const style = root.createElement("style");
  style.dataset.plugin = "@lencx/minke-harness-overlay";
  style.dataset.minkeSessionHeaderActions = "";
  style.textContent = SESSION_HEADER_ACTION_STYLES;
  (root.head ?? root.documentElement).append(style);

  return () => {
    style.remove();
  };
}

export interface SessionLogHeaderActionProps {
  sessionId: string;
  exportSession(sessionId: string): Promise<void>;
  t: TabsTranslate;
}

/** Export the current Session through Electron's native save workflow. */
export function SessionLogHeaderAction({
  sessionId,
  exportSession,
  t,
}: SessionLogHeaderActionProps): ReactNode {
  const [busy, setBusy] = useState(false);
  const label = t("header.sessionLog");

  const handleClick = (): void => {
    if (busy) return;
    setBusy(true);
    void exportSession(sessionId)
      .catch((error: unknown) => {
        console.warn("Minke Session export failed:", error);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return createElement("button", {
    type: "button",
    "data-minke-session-log-action": "",
    "aria-label": label,
    title: label,
    "aria-busy": busy,
    disabled: busy,
    onClick: handleClick,
  });
}

export interface TabsHeaderActionProps {
  runtimes: Readonly<
    Record<TabsPanelPlacement, TabsRuntime>
  >;
  t: TabsTranslate;
}

interface SessionListSelection {
  readonly current: string | undefined;
  readonly byId: Readonly<
    Record<string, { readonly blank?: boolean } | undefined>
  >;
}

interface NewSessionTabsHeaderActionProps
  extends TabsHeaderActionProps {
  useSessions: <T>(
    selector: (state: SessionListSelection) => T,
  ) => T;
}

/** Toggle the independent bottom and right Tabs docks. */
export function TabsHeaderAction({
  runtimes,
  t,
}: TabsHeaderActionProps): ReactNode {
  const bottomSnapshot = useSyncExternalStore(
    runtimes.bottom.subscribe,
    runtimes.bottom.getSnapshot,
    runtimes.bottom.getSnapshot,
  );
  const rightSnapshot = useSyncExternalStore(
    runtimes.right.subscribe,
    runtimes.right.getSnapshot,
    runtimes.right.getSnapshot,
  );

  return createElement(
    "div",
    {
      "data-minke-tabs-layout-actions": "",
      role: "group",
      "aria-label": t("header.placement"),
    },
    (["bottom", "right"] as const).map((placement) => {
      const runtime = runtimes[placement];
      const active =
        placement === "bottom"
          ? bottomSnapshot.visible
          : rightSnapshot.visible;
      const label = t(
        placement === "bottom"
          ? active
            ? "header.closeBottom"
            : "header.openBottom"
          : active
            ? "header.closeRight"
            : "header.openRight",
      );
      return createElement("button", {
        key: placement,
        type: "button",
        "data-minke-tabs-header-action": "",
        "data-minke-tabs-placement": placement,
        "aria-label": label,
        title: label,
        "aria-controls": tabsPanelId(placement),
        "aria-expanded": active,
        "aria-pressed": active,
        onClick: () => runtime.toggle(),
      });
    }),
  );
}

/** Keep the Tabs toggle available while the Session Header is absent. */
export function NewSessionTabsHeaderAction({
  runtimes,
  t,
  useSessions,
}: NewSessionTabsHeaderActionProps): ReactNode {
  const isNewSession = useSessions((state) => {
    if (state.current === undefined) return true;
    return state.byId[state.current]?.blank === true;
  });
  if (!isNewSession) return null;

  return createElement(
    "div",
    { "data-minke-new-session-tabs-action": "" },
    createElement(TabsHeaderAction, { runtimes, t }),
  );
}
