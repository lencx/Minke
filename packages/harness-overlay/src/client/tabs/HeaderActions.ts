import { buildLucideDataUri } from "@lucide/icons/build";
import { FileDown, PanelRight } from "@lucide/icons";
import {
  createElement,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { TABS_PANEL_ID } from "./constants.ts";
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

export const SESSION_HEADER_ACTION_STYLES = `
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
  color: var(--dsw-alias-label-primary);
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

[data-shell-overlay]:has(.minke-tabs-panel[data-open])
  [data-minke-new-session-tabs-action] {
  right: calc(var(--minke-tabs-panel-width, 360px) + 16px);
}

[data-minke-new-session-tabs-action] > [data-minke-tabs-header-action] {
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

[data-minke-tabs-header-action]::before {
  --minke-panel-right-icon: url("${PANEL_RIGHT_ICON_DATA_URL}");
  -webkit-mask: var(--minke-panel-right-icon) center / 16px 16px no-repeat;
  mask: var(--minke-panel-right-icon) center / 16px 16px no-repeat;
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
  runtime: TabsRuntime;
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

/** Toggle the resident Tabs side panel from the Session Header utility group. */
export function TabsHeaderAction({
  runtime,
  t,
}: TabsHeaderActionProps): ReactNode {
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const label = t(
    snapshot.visible ? "header.close" : "header.open",
  );

  return createElement("button", {
    type: "button",
    "data-minke-tabs-header-action": "",
    "aria-label": label,
    title: label,
    "aria-controls": TABS_PANEL_ID,
    "aria-expanded": snapshot.visible,
    "aria-pressed": snapshot.visible,
    onClick: () => runtime.toggle(),
  });
}

/** Keep the Tabs toggle available while the Session Header is absent. */
export function NewSessionTabsHeaderAction({
  runtime,
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
    createElement(TabsHeaderAction, { runtime, t }),
  );
}
