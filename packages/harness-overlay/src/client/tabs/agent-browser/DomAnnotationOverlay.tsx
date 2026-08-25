import {
  Check,
  Trash2,
  X,
} from "@lucide/icons";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  LucideIcon,
} from "@minke/harness-overlay/client/tabs/components/LucideIcon.ts";
import type {
  AgentBrowserAnnotationTarget,
} from "@minke/harness-overlay/agent-browser-annotation-contract.ts";
import type {
  BrowserAnnotationController,
  BrowserAnnotationLabels,
  BrowserAnnotationSnapshot,
} from "@minke/harness-overlay/client/tabs/browser-annotation/types.ts";

export interface DomAnnotationOverlayProps {
  readonly tabId: string;
  readonly snapshot: BrowserAnnotationSnapshot;
  readonly controller: BrowserAnnotationController;
  readonly labels: BrowserAnnotationLabels;
}

export interface AnnotationCommentEditorLayout {
  readonly height: number;
  readonly overflowY: "auto" | "hidden";
}

const ANNOTATION_COMMENT_EDITOR_MIN_HEIGHT = 48;
const ANNOTATION_COMMENT_EDITOR_MAX_HEIGHT = 102;

/** Resolve the two-line editor height without coupling tests to hook source. */
export function annotationCommentEditorLayout(
  contentHeight: number,
): AnnotationCommentEditorLayout {
  return {
    height: Math.max(
      ANNOTATION_COMMENT_EDITOR_MIN_HEIGHT,
      Math.min(
        contentHeight,
        ANNOTATION_COMMENT_EDITOR_MAX_HEIGHT,
      ),
    ),
    overflowY:
      contentHeight > ANNOTATION_COMMENT_EDITOR_MAX_HEIGHT
        ? "auto"
        : "hidden",
  };
}

/** Plain Enter submits; Shift+Enter remains available for a new line. */
export function shouldSubmitAnnotationComment(
  key: string,
  shiftKey: boolean,
): boolean {
  return key === "Enter" && !shiftKey;
}

function clamp(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function targetStyle(
  target: AgentBrowserAnnotationTarget,
): CSSProperties {
  const { rect, viewport } = target;
  const left = clamp(rect.x, 0, viewport.width);
  const top = clamp(rect.y, 0, viewport.height);
  const right = clamp(rect.x + rect.width, 0, viewport.width);
  const bottom = clamp(rect.y + rect.height, 0, viewport.height);
  if (right <= left || bottom <= top) return { display: "none" };
  return {
    left: `${String(left / viewport.width * 100)}%`,
    top: `${String(top / viewport.height * 100)}%`,
    width: `${String((right - left) / viewport.width * 100)}%`,
    height: `${String((bottom - top) / viewport.height * 100)}%`,
  };
}

function draftStyle(
  snapshot: BrowserAnnotationSnapshot,
): CSSProperties {
  const target = snapshot.draft;
  if (target === undefined) return { display: "none" };
  const { rect, viewport } = target;
  const horizontalMargin = Math.min(227, viewport.width / 2);
  const center = clamp(
    rect.x + rect.width / 2,
    horizontalMargin,
    Math.max(horizontalMargin, viewport.width - horizontalMargin),
  );
  const showAbove =
    rect.y + rect.height + 124 > viewport.height;
  return {
    left: `${String(center / viewport.width * 100)}%`,
    top: showAbove
      ? `${String(clamp(rect.y, 0, viewport.height) /
          viewport.height * 100)}%`
      : `${String(clamp(
          rect.y + rect.height,
          0,
          viewport.height,
        ) / viewport.height * 100)}%`,
    transform: showAbove
      ? "translate(-50%, calc(-100% - 8px))"
      : "translate(-50%, 8px)",
  };
}

function CommentEditor({
  tabId,
  snapshot,
  controller,
  labels,
}: DomAnnotationOverlayProps): ReactNode {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [comment, setComment] = useState(
    snapshot.draftComment ?? "",
  );
  const number =
    snapshot.editingIndex ?? snapshot.comments.length + 1;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input === null) return;
    input.style.height = "0px";
    const layout = annotationCommentEditorLayout(
      input.scrollHeight,
    );
    input.style.height = `${String(layout.height)}px`;
    input.style.overflowY = layout.overflowY;
  }, [comment]);

  const submit = (): void => {
    if (comment.trim() === "") return;
    controller.commitAnnotation(tabId, comment);
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      controller.dismissAnnotationDraft(tabId);
      return;
    }
    if (
      shouldSubmitAnnotationComment(
        event.key,
        event.shiftKey,
      )
    ) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <section
      className="minke-agent-browser__annotation-editor"
      style={draftStyle(snapshot)}
      aria-label={labels.commentLabel}
    >
      <span className="minke-agent-browser__annotation-editor-number">
        {number}
      </span>
      <textarea
        ref={inputRef}
        rows={2}
        maxLength={2_000}
        value={comment}
        aria-label={
          snapshot.editingIndex === undefined
            ? labels.commentAdd
            : labels.commentEdit
        }
        placeholder={labels.commentPlaceholder}
        onChange={(event) => setComment(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
      {snapshot.editingIndex !== undefined && (
        <button
          type="button"
          className="minke-agent-browser__annotation-delete"
          aria-label={labels.actionDelete}
          title={labels.actionDelete}
          onClick={() => {
            controller.removeAnnotation(
              tabId,
              snapshot.editingIndex as number,
            );
          }}
        >
          <LucideIcon icon={Trash2} size={14} />
        </button>
      )}
      <button
        type="button"
        className="minke-agent-browser__annotation-dismiss"
        aria-label={labels.actionDismiss}
        title={labels.actionDismiss}
        onClick={() => controller.dismissAnnotationDraft(tabId)}
      >
        <LucideIcon icon={X} size={14} />
      </button>
      <button
        type="button"
        className="minke-agent-browser__annotation-add"
        aria-label={
          snapshot.editingIndex === undefined
            ? labels.actionAdd
            : labels.actionSave
        }
        title={
          snapshot.editingIndex === undefined
            ? labels.actionAdd
            : labels.actionSave
        }
        disabled={comment.trim() === ""}
        onClick={submit}
      >
        <LucideIcon icon={Check} size={15} />
      </button>
    </section>
  );
}

/** Host-owned marker and inline comment layer over the isolated webview. */
export function DomAnnotationOverlay(
  props: DomAnnotationOverlayProps,
): ReactNode {
  const { tabId, snapshot, controller, labels } = props;
  if (
    snapshot.phase !== "active" &&
    snapshot.phase !== "sending"
  ) {
    return snapshot.phase === "error" &&
        snapshot.error !== undefined
      ? (
          <div
            className="minke-agent-browser__annotation-error"
            role="alert"
          >
            {snapshot.error}
          </div>
        )
      : null;
  }

  return (
    <div
      className="minke-agent-browser__annotation-layer"
      data-phase={snapshot.phase}
    >
      {snapshot.comments.map((comment) => (
        <div
          key={comment.target.targetId}
          className="minke-agent-browser__annotation-target"
          data-stale={
            snapshot.staleTargetIds?.includes(
              comment.target.targetId,
            ) || undefined
          }
          style={targetStyle(comment.target)}
        >
          <button
            type="button"
            aria-label={labels.actionEditNumber(comment.index)}
            onClick={() =>
              controller.editAnnotation(tabId, comment.index)}
          >
            {comment.index}
          </button>
        </div>
      ))}

      {snapshot.draft !== undefined && (
        <>
          <div
            className="minke-agent-browser__annotation-target"
            data-draft=""
            data-stale={
              snapshot.staleTargetIds?.includes(
                snapshot.draft.targetId,
              ) || undefined
            }
            style={targetStyle(snapshot.draft)}
            aria-hidden="true"
          />
          <CommentEditor
            key={`${snapshot.draft.targetId}:${
              snapshot.editingIndex ?? "new"
            }`}
            {...props}
          />
        </>
      )}
      {snapshot.error !== undefined && (
        <div
          className="minke-agent-browser__annotation-error"
          role="alert"
        >
          {(snapshot.staleTargetIds?.length ?? 0) > 0
            ? labels.errorStale
            : snapshot.error}
        </div>
      )}
    </div>
  );
}
