import { mainSessionId, type HarnessSessionList } from "../core/sessions.ts";
import { PanelHeaderIcon } from "../core/HeaderIcons.tsx";
import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import {
  createElement,
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
import type {
  RightTabsPresentationPort,
} from "./responsive-right-host.ts";
import type { NativeTabsRuntime } from "./native/runtime.ts";

export interface TabsHeaderActionProps {
  native?: NativeTabsRuntime;
  runtimes: Readonly<
    Record<TabsPanelPlacement, TabsRuntime>
  > & {
    readonly toggleBottom?: () => void;
  };
  presentation?: RightTabsPresentationPort;
  t: TabsTranslate;
}



const ignorePresentationChanges = () => () => {};
const dockedPresentation = () => "docked" as const;

function useRightDrawerOpen(
  runtimes: TabsHeaderActionProps["runtimes"],
  presentation: RightTabsPresentationPort | undefined,
): boolean {
  const rightSnapshot = useSyncExternalStore(
    runtimes.right.subscribe,
    runtimes.right.getSnapshot,
    runtimes.right.getSnapshot,
  );
  const rightPresentation = useSyncExternalStore(
    presentation?.subscribe ?? ignorePresentationChanges,
    presentation?.getSnapshot ?? dockedPresentation,
    presentation?.getSnapshot ?? dockedPresentation,
  );
  return rightSnapshot.visible && rightPresentation === "drawer";
}

interface NewSessionTabsHeaderActionProps
  extends TabsHeaderActionProps {
  useSessions: <T>(
    selector: (state: HarnessSessionList) => T,
  ) => T;
}

/** Toggle the independent bottom and right Tabs docks. */
export function TabsHeaderAction({
  native,
  runtimes,
  presentation,
  t,
}: TabsHeaderActionProps): ReactNode {
  useSyncExternalStore(native?.subscribe ?? ignorePresentationChanges, native?.getSnapshot ?? (() => 0), () => 0);
  const bottomSnapshot = useSyncExternalStore(
    runtimes.bottom.subscribe,
    runtimes.bottom.getSnapshot,
    runtimes.bottom.getSnapshot,
  );
  const rightDrawerOpen = useRightDrawerOpen(
    runtimes,
    presentation,
  );
  const rightSnapshot = runtimes.right.getSnapshot();
  if (rightDrawerOpen) return null;
  return createElement(
    "div",
    {
      "data-minke-tabs-layout-actions": "",
      role: "group",
      "aria-label": t("header.placement"),
    },
    (["bottom", "right"] as const).filter(placement =>
      placement === "bottom" || !native?.active
    ).map((placement) => {
      const runtime = runtimes[placement];
      const active =
        placement === "bottom"
          ? bottomSnapshot.visible
          : native?.connected ? native.active && rightSnapshot.visible : rightSnapshot.visible;
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
        Button,
        {
          key: placement,
          size: "sm",
          type: "button",
          ...{
            "data-minke-icon-button": "",
            "data-minke-tabs-header-action": "",
            "data-minke-tabs-placement": placement,
          },
          "aria-label": label,
          title: label,
          "aria-controls": placement === "right" && native?.connected ? undefined : tabsPanelId(placement),
          "aria-expanded": active,
          "aria-pressed": active,
          onClick: () => {
            if (
              placement === "bottom" &&
              runtimes.toggleBottom !== undefined
            ) {
              runtimes.toggleBottom();
              return;
            }
            if (placement === "right" && native?.connected) {
              native.openNative("guide");
              return;
            }
            runtime.toggle();
          },
        },
        createElement(PanelHeaderIcon, { placement }),
      );
    }),
  );
}

/** Blank Sessions omit utility slots; DSH still owns their Sidebar opener. */
export function NewSessionTabsHeaderAction({
  native,
  runtimes,
  presentation,
  t,
  useSessions,
}: NewSessionTabsHeaderActionProps): ReactNode {
  useSyncExternalStore(native?.subscribe ?? ignorePresentationChanges, native?.getSnapshot ?? (() => 0), () => 0);
  const isNewSession = useSessions((state) => {
    const sessionId = mainSessionId(state);
    return sessionId === undefined || state.byId[sessionId]?.blank === true;
  });
  const rightDrawerOpen = useRightDrawerOpen(
    runtimes,
    presentation,
  );
  const nativeUnavailableOnPage = native?.connected && !native.active;
  if ((!isNewSession && !nativeUnavailableOnPage) || rightDrawerOpen) return null;

  return createElement(
    "div",
    {
      "data-minke-new-session-tabs-action": "",
      "data-native-sidebar": native?.active
        ? runtimes.right.getSnapshot().visible ? "open" : "closed"
        : undefined,
    },
    createElement(TabsHeaderAction, {
      native,
      runtimes,
      presentation,
      t,
    }),
  );
}
