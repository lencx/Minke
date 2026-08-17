export const TABS_PANEL_ID = "minke-tabs-panel";
export const TABS_BOTTOM_PANEL_ID = "minke-tabs-panel-bottom";
export type TabsPanelPlacement = "right" | "bottom";

export function tabsPanelId(
  placement: TabsPanelPlacement,
): string {
  return placement === "bottom"
    ? TABS_BOTTOM_PANEL_ID
    : TABS_PANEL_ID;
}
