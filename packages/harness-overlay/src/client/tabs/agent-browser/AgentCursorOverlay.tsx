import type {
  CSSProperties,
  ReactNode,
} from "react";
import {
  useEffect,
  useRef,
} from "react";
import {
  MousePointer2,
} from "@lucide/icons";
import type {
  AgentBrowserCursorProjection,
} from "@minke/harness-overlay/agent-browser-contract.ts";
import {
  LucideIcon,
} from "@minke/harness-overlay/client/tabs/components/LucideIcon.ts";

type AgentCursorStyle = CSSProperties & {
  readonly "--minke-agent-cursor-duration": string;
  readonly "--minke-agent-cursor-feedback-delay": string;
  readonly "--minke-agent-cursor-x": string;
  readonly "--minke-agent-cursor-y": string;
};

function viewportPercentage(
  coordinate: number,
  viewportSize: number,
): string {
  const percentage = Math.min(
    100,
    Math.max(0, coordinate / viewportSize * 100),
  );
  return String(Math.round(percentage * 1_000) / 1_000);
}

function sameProjectedPoint(
  first: AgentBrowserCursorProjection,
  second: AgentBrowserCursorProjection,
): boolean {
  return (
    viewportPercentage(
      first.point.x,
      first.viewport.width,
    ) === viewportPercentage(
      second.point.x,
      second.viewport.width,
    ) &&
    viewportPercentage(
      first.point.y,
      first.viewport.height,
    ) === viewportPercentage(
      second.point.y,
      second.viewport.height,
    )
  );
}

export function agentCursorFeedbackDelayMs(
  previous: AgentBrowserCursorProjection | undefined,
  cursor: AgentBrowserCursorProjection,
): number {
  if (
    (
      cursor.phase !== "clicking" &&
      cursor.phase !== "typing"
    ) ||
    previous === undefined ||
    sameProjectedPoint(previous, cursor)
  ) {
    return 0;
  }
  return cursor.durationMs;
}

/**
 * Presentation-only locator for main-owned Agent Browser input.
 *
 * Coordinates stay proportional to the guest CSS viewport while the host
 * resizes. The hotspot stays on the clamped viewport point; near the right
 * or bottom edge, only the pointer body mirrors inward to remain legible.
 */
export function AgentCursorOverlay({
  cursor,
}: {
  readonly cursor: AgentBrowserCursorProjection;
}): ReactNode {
  const previousCursorRef =
    useRef<AgentBrowserCursorProjection | undefined>(undefined);
  const clicking = cursor.phase === "clicking";
  const feedbackDelayMs = agentCursorFeedbackDelayMs(
    previousCursorRef.current,
    cursor,
  );
  const x = viewportPercentage(
    cursor.point.x,
    cursor.viewport.width,
  );
  const y = viewportPercentage(
    cursor.point.y,
    cursor.viewport.height,
  );
  const style: AgentCursorStyle = {
    "--minke-agent-cursor-duration": `${cursor.durationMs}ms`,
    "--minke-agent-cursor-feedback-delay":
      `${feedbackDelayMs}ms`,
    "--minke-agent-cursor-x": x,
    "--minke-agent-cursor-y": y,
  };

  useEffect(() => {
    previousCursorRef.current = cursor;
  }, [cursor]);

  return (
    <div
      className="minke-agent-browser__agent-cursor-layer"
      aria-hidden="true"
      data-agent-cursor=""
      data-flip-x={Number(x) > 82 || undefined}
      data-flip-y={Number(y) > 82 || undefined}
      data-phase={cursor.phase}
      data-sequence={cursor.sequence}
      style={style}
    >
      <span className="minke-agent-browser__agent-cursor-track">
        <span
          key={`${cursor.phase}-${String(cursor.sequence)}`}
          className="minke-agent-browser__agent-cursor-beacon"
          data-pressed={clicking || undefined}
          data-typing={
            cursor.phase === "typing" || undefined
          }
        >
          <span className="minke-agent-browser__agent-cursor-glyph">
            <span
              className={
                "minke-agent-browser__agent-cursor-glyph-layer " +
                "minke-agent-browser__agent-cursor-glyph-layer--halo"
              }
            >
              <LucideIcon icon={MousePointer2} size={34} />
            </span>
            <span
              className={
                "minke-agent-browser__agent-cursor-glyph-layer " +
                "minke-agent-browser__agent-cursor-glyph-layer--outline"
              }
            >
              <LucideIcon icon={MousePointer2} size={34} />
            </span>
            <span
              className={
                "minke-agent-browser__agent-cursor-glyph-layer " +
                "minke-agent-browser__agent-cursor-glyph-layer--body"
              }
            >
              <LucideIcon icon={MousePointer2} size={34} />
            </span>
          </span>
        </span>
      </span>
    </div>
  );
}
