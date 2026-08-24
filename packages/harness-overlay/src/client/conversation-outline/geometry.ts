export const CONVERSATION_OUTLINE_MARKER_HEIGHT = 12;
export const CONVERSATION_OUTLINE_MAX_RAIL_HEIGHT = 288;

const TOOLTIP_VIEWPORT_INSET = 8;

export interface ConversationOutlineRailLayout {
  readonly top: number;
  readonly height: number;
  readonly overflowing: boolean;
}

/** Center a compact marker cluster and cap long histories to 24 rows. */
export function conversationOutlineRailLayout(
  availableTop: number,
  availableHeight: number,
  itemCount: number,
): ConversationOutlineRailLayout {
  const safeHeight = Math.max(0, availableHeight);
  const contentHeight = Math.max(0, itemCount) *
    CONVERSATION_OUTLINE_MARKER_HEIGHT;
  const capacityHeight = Math.floor(
    Math.min(
      safeHeight,
      CONVERSATION_OUTLINE_MAX_RAIL_HEIGHT,
    ) / CONVERSATION_OUTLINE_MARKER_HEIGHT,
  ) * CONVERSATION_OUTLINE_MARKER_HEIGHT;
  const height = Math.min(contentHeight, capacityHeight);
  return {
    top: availableTop + Math.max(0, (safeHeight - height) / 2),
    height,
    overflowing: contentHeight > height,
  };
}

/** Keep a measured tooltip inside the visible chat region. */
export function conversationOutlineTooltipTop(
  markerCenter: number,
  tooltipHeight: number,
  availableTop: number,
  availableBottom: number,
): number {
  const safeTooltipHeight = Math.max(0, tooltipHeight);
  const minimum = availableTop + TOOLTIP_VIEWPORT_INSET;
  const maximum = Math.max(
    minimum,
    availableBottom -
      TOOLTIP_VIEWPORT_INSET -
      safeTooltipHeight,
  );
  return Math.min(
    maximum,
    Math.max(
      minimum,
      markerCenter - safeTooltipHeight / 2,
    ),
  );
}
