import { ListTree } from "@lucide/icons";
import {
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  LucideIcon,
} from "../components/LucideIcon.ts";
import type {
  ManagedTab,
  TabRenderer,
} from "../types.ts";
import {
  DETAILS_TAB_KIND,
  type DetailsTabPayload,
} from "./controller.ts";
import {
  MINKE_DETAILS_PORTAL_EVENT,
} from "./contract.ts";

function isDetailsTab(
  tab: ManagedTab,
): tab is ManagedTab<DetailsTabPayload> {
  const payload = tab.payload as Partial<DetailsTabPayload>;
  return (
    tab.kind === DETAILS_TAB_KIND &&
    typeof payload.sessionId === "string" &&
    typeof payload.callId === "string"
  );
}

function publishPortalTarget(
  view: Window,
  target: HTMLElement | null,
): void {
  view.dispatchEvent(
    new CustomEvent(MINKE_DETAILS_PORTAL_EVENT, {
      detail: { target },
    }),
  );
}

function DetailsTabView(props: {
  readonly tab: ManagedTab<DetailsTabPayload>;
  readonly active: boolean;
}): ReactNode {
  const targetRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const target = targetRef.current;
    const view = target?.ownerDocument.defaultView;
    if (target === null || view === null || view === undefined) {
      return;
    }
    publishPortalTarget(view, target);
    return () => publishPortalTarget(view, null);
  }, []);

  return (
    <section
      id={`minke-tab-view-${props.tab.id}`}
      className="minke-tabs-view minke-details-tab"
      role="tabpanel"
      aria-labelledby={`minke-tab-${props.tab.id}`}
      hidden={!props.active}
      data-session-id={props.tab.payload.sessionId}
      data-call-id={props.tab.payload.callId}
    >
      <div
        ref={targetRef}
        className="minke-details-tab__portal"
        data-minke-details-portal=""
      />
    </section>
  );
}

/** Render the unmodified upstream Details tree inside the managed Tabs shell. */
export function createDetailsTabRenderer(): TabRenderer {
  return {
    kind: DETAILS_TAB_KIND,
    renderIcon: () => (
      <LucideIcon icon={ListTree} size={13} />
    ),
    renderView: (tab, active) =>
      isDetailsTab(tab)
        ? (
          <DetailsTabView
            key={tab.id}
            tab={tab}
            active={active}
          />
        )
        : null,
  };
}
