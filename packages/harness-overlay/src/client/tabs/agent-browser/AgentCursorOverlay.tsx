import type {
  CSSProperties,
  ReactNode,
} from "react";
import {
  useEffect,
  useRef,
} from "react";
import type {
  AgentBrowserCursorProjection,
} from "@minke/harness-overlay/agent-browser-contract.ts";

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
    cursor.phase !== "clicking" ||
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
          key={clicking
            ? `pressed-${cursor.sequence}`
            : "resting"}
          className="minke-agent-browser__agent-cursor-beacon"
          data-pressed={clicking || undefined}
          data-typing={
            cursor.phase === "typing" || undefined
          }
        >
          <svg
            viewBox="0 0 24 28"
            focusable="false"
            aria-hidden="true"
          >
            <path
              className="minke-agent-browser__agent-cursor-body"
              d={
                "M3 2.25 20.1 11.55c1.08.59.72 2.2"
                + "-.51 2.26l-6.1.3 3.82 6.22a1.4 1.4"
                + " 0 0 1-.47 1.93l-2.18 1.31a1.4 1.4"
                + " 0 0 1-1.92-.48L9.13 16.8l-3.55 5.48"
                + "c-.68 1.04-2.29.51-2.22-.73L4.1 3.45"
                + "c.04-.9 1.08-1.63 1.9-1.2Z"
              }
            />
            <path
              className="minke-agent-browser__agent-cursor-accent"
              d="m6.25 5.5 8.15 5.05"
            />
          </svg>
        </span>
        {clicking && (
          <span
            key={`ripple-${cursor.sequence}`}
            className="minke-agent-browser__agent-cursor-ripple"
            data-click-sequence={cursor.sequence}
          />
        )}
      </span>
    </div>
  );
}
