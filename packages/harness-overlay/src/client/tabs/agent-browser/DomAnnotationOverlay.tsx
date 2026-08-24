import {
  MessageSquarePlus,
  Send,
  Trash2,
  X,
} from "@lucide/icons";
import {
  useEffect,
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
  AgentBrowserAnnotationSnapshot,
  AgentBrowserTabsController,
} from "./controller.ts";
import type {
  AgentBrowserTabsTranslate,
} from "./locales.ts";

export interface DomAnnotationOverlayProps {
  readonly tabId: string;
  readonly snapshot: AgentBrowserAnnotationSnapshot;
  readonly controller: AgentBrowserTabsController;
  readonly t: AgentBrowserTabsTranslate;
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
  snapshot: AgentBrowserAnnotationSnapshot,
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
  const showAbove = rect.y + rect.height + 70 > viewport.height;
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
  t,
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
      event.key === "Enter" &&
      !event.shiftKey
    ) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <section
      className="minke-agent-browser__annotation-editor"
      style={draftStyle(snapshot)}
      aria-label={t("agentBrowser.annotation.comment.label")}
    >
      <span className="minke-agent-browser__annotation-editor-number">
        {number}
      </span>
      <textarea
        ref={inputRef}
        rows={1}
        maxLength={2_000}
        value={comment}
        aria-label={
          snapshot.editingIndex === undefined
            ? t("agentBrowser.annotation.comment.add")
            : t("agentBrowser.annotation.comment.edit")
        }
        placeholder={t(
          "agentBrowser.annotation.comment.placeholder",
        )}
        onChange={(event) => setComment(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
      {snapshot.editingIndex !== undefined && (
        <button
          type="button"
          className="minke-agent-browser__annotation-delete"
          aria-label={t("agentBrowser.annotation.action.delete")}
          title={t("agentBrowser.annotation.action.delete")}
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
        aria-label={t("agentBrowser.annotation.action.dismiss")}
        title={t("agentBrowser.annotation.action.dismiss")}
        onClick={() => controller.dismissAnnotationDraft(tabId)}
      >
        <LucideIcon icon={X} size={14} />
      </button>
      <button
        type="button"
        className="minke-agent-browser__annotation-add"
        aria-label={t("agentBrowser.annotation.action.add")}
        title={t("agentBrowser.annotation.action.add")}
        disabled={comment.trim() === ""}
        onClick={submit}
      >
        <LucideIcon icon={Send} size={15} />
      </button>
    </section>
  );
}

/** Host-owned marker and inline comment layer over the isolated webview. */
export function DomAnnotationOverlay(
  props: DomAnnotationOverlayProps,
): ReactNode {
  const { tabId, snapshot, controller, t } = props;
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
      <div
        className="minke-agent-browser__annotation-mode"
        role="status"
      >
        <LucideIcon icon={MessageSquarePlus} size={13} />
        <span>{t("agentBrowser.annotation.status.active")}</span>
        <small>
          {snapshot.count === 0
            ? t("agentBrowser.annotation.status.pick")
            : t("agentBrowser.annotation.status.count").replace(
                "{count}",
                String(snapshot.count),
              )}
        </small>
        <button
          type="button"
          aria-label={t("agentBrowser.annotation.action.cancel")}
          title={t("agentBrowser.annotation.action.cancel")}
          onClick={() => {
            void controller.cancelAnnotation(tabId);
          }}
        >
          <LucideIcon icon={X} size={13} />
        </button>
      </div>

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
            aria-label={t(
              "agentBrowser.annotation.action.editNumber",
            ).replace("{number}", String(comment.index))}
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
            ? t("agentBrowser.annotation.error.stale")
            : snapshot.error}
        </div>
      )}
    </div>
  );
}
