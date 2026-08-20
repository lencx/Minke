import {
  FileDown,
} from "@lucide/icons";
import {
  createElement,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  LucideIcon,
} from "./components/LucideIcon.ts";
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

  return createElement(
    "button",
    {
      type: "button",
      "data-minke-session-log-action": "",
      "aria-label": label,
      title: label,
      "aria-busy": busy,
      disabled: busy,
      onClick: handleClick,
    },
    createElement(LucideIcon, {
      icon: FileDown,
      size: 16,
    }),
  );
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

const PANEL_PLACEMENT_PATHS = {
  bottom:
    "M5.5 3.5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2m1 12h8",
  right:
    "M5.5 3.5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2m10 11v-8",
} as const;

function PanelPlacementIcon(props: {
  placement: TabsPanelPlacement;
}): ReactNode {
  return createElement(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      width: "1em",
      height: "1em",
      viewBox: "0 0 21 21",
      "aria-hidden": "true",
    },
    createElement("path", {
      d: "M0 0h21v21H0z",
      fill: "none",
    }),
    createElement("path", {
      d: PANEL_PLACEMENT_PATHS[props.placement],
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "1.5",
      strokeLinecap: "round",
      strokeLinejoin: "round",
    }),
  );
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
      return createElement(
        "button",
        {
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
        },
        createElement(PanelPlacementIcon, { placement }),
      );
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
