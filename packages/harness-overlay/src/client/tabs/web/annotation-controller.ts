import {
  AGENT_BROWSER_ANNOTATION_COMMENT_LIMIT,
  AGENT_BROWSER_ANNOTATION_TARGET_LIMIT,
  type AgentBrowserAnnotationPage,
  type AgentBrowserAnnotationTarget,
} from "@minke/harness-overlay/agent-browser-annotation-contract.ts";
import type {
  BrowserAnnotationPhase,
  BrowserAnnotationSnapshot,
} from "@minke/harness-overlay/client/tabs/browser-annotation/types.ts";
import type {
  TabsRuntime,
} from "@minke/harness-overlay/client/tabs/runtime.ts";
import {
  composeAgentBrowserAnnotationImage,
} from "../agent-browser/annotation-image.ts";
import {
  formatAgentBrowserComments,
  type AgentBrowserChatPort,
  type AgentBrowserChatTarget,
  type AgentBrowserNumberedComment,
} from "../agent-browser/chat.ts";
import {
  captureWebAnnotationTargets,
  readWebAnnotationPage,
  refreshWebAnnotationTargets,
  stopWebAnnotationSelection,
  waitForWebAnnotationSelection,
} from "./annotation-guest.ts";
import {
  isWebTab,
  type WebviewHandle,
} from "./types.ts";

interface ActiveWebAnnotation
  extends BrowserAnnotationSnapshot {
  readonly annotationSessionId: string;
  readonly generation: number;
  readonly page: AgentBrowserAnnotationPage;
  readonly chatTarget: AgentBrowserChatTarget;
}

interface WebAnnotationLifecycle {
  readonly epoch: number;
  readonly abort: AbortController;
}

export interface WebAnnotationDependencies {
  readonly chat: AgentBrowserChatPort;
  readonly composeImage?: typeof composeAgentBrowserAnnotationImage;
}

const IDLE_ANNOTATION_SNAPSHOT: BrowserAnnotationSnapshot =
  Object.freeze({
    phase: "idle",
    count: 0,
    comments: Object.freeze([]),
  });

const STALE_TARGET_ERROR =
  "A selected page element is no longer available. "
  + "Delete it or select it again before sending.";

const UNAVAILABLE_CHAT: AgentBrowserChatPort = {
  currentTarget: () => undefined,
  async sendScreenshot() {
    throw new Error("Minke Chat is unavailable");
  },
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reindexComments(
  comments: readonly AgentBrowserNumberedComment[],
): readonly AgentBrowserNumberedComment[] {
  return comments.map((comment, index) => ({
    ...comment,
    index: index + 1,
  }));
}

/**
 * Renderer-owned annotation state for ordinary, human-controlled Web tabs.
 *
 * The guest adapter only returns bounded DOM evidence. This controller keeps
 * Chat authority, comments, screenshots, and every visible marker in the
 * trusted Harness document.
 */
export class WebTabAnnotationController {
  readonly #tabs: TabsRuntime;
  readonly #chat: AgentBrowserChatPort;
  readonly #composeImage: typeof composeAgentBrowserAnnotationImage;
  readonly #views = new Map<string, WebviewHandle>();
  readonly #annotations =
    new Map<string, BrowserAnnotationSnapshot>();
  readonly #listeners = new Map<string, Set<() => void>>();
  readonly #refreshTimers =
    new Map<string, ReturnType<typeof setTimeout>>();
  readonly #lifecycles =
    new Map<string, WebAnnotationLifecycle>();
  #annotationSequence = 0;
  #lifecycleEpoch = 0;
  #disposed = false;

  constructor(
    tabs: TabsRuntime,
    dependencies?: WebAnnotationDependencies,
  ) {
    this.#tabs = tabs;
    this.#chat = dependencies?.chat ?? UNAVAILABLE_CHAT;
    this.#composeImage =
      dependencies?.composeImage ?? composeAgentBrowserAnnotationImage;
  }

  attach(tabId: string, view: WebviewHandle): () => void {
    this.#views.set(tabId, view);
    return () => {
      if (this.#views.get(tabId) !== view) return;
      this.#views.delete(tabId);
      this.#invalidateLifecycle(tabId);
      this.#annotations.delete(tabId);
      this.#emit(tabId);
    };
  }

  getSnapshot(tabId: string): BrowserAnnotationSnapshot {
    return this.#annotations.get(tabId) ??
      IDLE_ANNOTATION_SNAPSHOT;
  }

  subscribe(tabId: string, listener: () => void): () => void {
    let listeners = this.#listeners.get(tabId);
    if (listeners === undefined) {
      listeners = new Set();
      this.#listeners.set(tabId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) this.#listeners.delete(tabId);
    };
  }

  async start(tabId: string): Promise<void> {
    const tab = this.#tabs.tab(tabId);
    const current = this.getSnapshot(tabId);
    const view = this.#views.get(tabId);
    if (
      this.#disposed ||
      tab === undefined ||
      !isWebTab(tab) ||
      view === undefined ||
      current.phase === "starting" ||
      current.phase === "active" ||
      current.phase === "sending"
    ) {
      return;
    }
    const chatTarget = this.#chat.currentTarget();
    if (chatTarget === undefined) {
      this.#set(tabId, {
        phase: "error",
        count: 0,
        comments: [],
        error: "Open a Chat before annotating this page",
      });
      return;
    }
    const lifecycle = this.#beginLifecycle(tabId);
    this.#set(tabId, {
      phase: "starting",
      count: 0,
      comments: [],
      chatTarget,
    });
    try {
      await stopWebAnnotationSelection(view);
      const page = await readWebAnnotationPage(view);
      if (!this.#isCurrent(tabId, lifecycle)) return;
      this.#annotationSequence += 1;
      const annotationSessionId =
        `annotation-web${this.#annotationSequence.toString(36)}`;
      this.#set(tabId, {
        phase: "active",
        count: 0,
        comments: [],
        annotationSessionId,
        generation: this.#annotationSequence,
        page,
        chatTarget,
      });
      this.#armSelection(tabId, lifecycle);
      this.#scheduleRefresh(tabId);
    } catch (error) {
      if (!this.#isCurrent(tabId, lifecycle)) return;
      this.#invalidateLifecycle(tabId);
      this.#set(tabId, {
        phase: "error",
        count: 0,
        comments: [],
        chatTarget,
        error: errorMessage(error),
      });
    }
  }

  async cancel(tabId: string): Promise<void> {
    const view = this.#views.get(tabId);
    this.#invalidateLifecycle(tabId);
    this.#set(tabId, IDLE_ANNOTATION_SNAPSHOT);
    if (view === undefined) return;
    try {
      await stopWebAnnotationSelection(view);
    } catch {
      // Navigation or detach also destroys the guest-side picker.
    }
  }

  pageChanged(tabId: string): void {
    const state = this.#annotations.get(tabId);
    if (
      state === undefined ||
      state.phase === "idle" ||
      state.phase === "error"
    ) {
      return;
    }
    const view = this.#views.get(tabId);
    this.#invalidateLifecycle(tabId);
    this.#set(tabId, {
      phase: "error",
      count: 0,
      comments: [],
      error: "The page changed, so its annotations were cleared",
    });
    if (view !== undefined) {
      void stopWebAnnotationSelection(view).catch(() => {});
    }
  }

  commitAnnotation(tabId: string, comment: string): void {
    const state = this.#active(tabId);
    const normalized = comment.trim();
    if (
      state === undefined ||
      state.phase !== "active" ||
      state.draft === undefined ||
      normalized === "" ||
      normalized.length > AGENT_BROWSER_ANNOTATION_COMMENT_LIMIT
    ) {
      return;
    }
    const next = state.editingIndex === undefined
      ? [
          ...state.comments,
          {
            index: state.comments.length + 1,
            comment: normalized,
            target: state.draft,
          },
        ]
      : state.comments.map((item) =>
          item.index === state.editingIndex
            ? {
                ...item,
                comment: normalized,
                target: state.draft as AgentBrowserAnnotationTarget,
              }
            : item
        );
    this.#set(tabId, {
      ...state,
      count: next.length,
      comments: next,
      draft: undefined,
      draftComment: undefined,
      editingIndex: undefined,
      error:
        (state.staleTargetIds?.length ?? 0) > 0
          ? STALE_TARGET_ERROR
          : undefined,
    });
  }

  dismissAnnotationDraft(tabId: string): void {
    const state = this.#active(tabId);
    if (state === undefined || state.draft === undefined) return;
    const retainedTargetIds = new Set(
      state.comments.map((comment) => comment.target.targetId),
    );
    const staleTargetIds = state.staleTargetIds?.filter(
      (targetId) => retainedTargetIds.has(targetId),
    );
    this.#set(tabId, {
      ...state,
      draft: undefined,
      draftComment: undefined,
      editingIndex: undefined,
      staleTargetIds:
        staleTargetIds?.length === 0 ? undefined : staleTargetIds,
      error:
        (staleTargetIds?.length ?? 0) > 0
          ? STALE_TARGET_ERROR
          : undefined,
    });
  }

  editAnnotation(tabId: string, index: number): void {
    const state = this.#active(tabId);
    const comment = state?.comments.find(
      (candidate) => candidate.index === index,
    );
    if (
      state === undefined ||
      state.phase !== "active" ||
      comment === undefined
    ) {
      return;
    }
    this.#set(tabId, {
      ...state,
      draft: comment.target,
      draftComment: comment.comment,
      editingIndex: comment.index,
      error: state.staleTargetIds?.includes(
        comment.target.targetId,
      )
        ? STALE_TARGET_ERROR
        : undefined,
    });
  }

  removeAnnotation(tabId: string, index: number): void {
    const state = this.#active(tabId);
    if (state === undefined || state.phase !== "active") return;
    if (!state.comments.some((comment) => comment.index === index)) {
      return;
    }
    const comments = reindexComments(
      state.comments.filter((comment) => comment.index !== index),
    );
    const removed = state.comments.find(
      (comment) => comment.index === index,
    );
    const editingIndex = state.editingIndex === undefined
      ? undefined
      : state.editingIndex === index
        ? undefined
        : state.editingIndex -
          (index < state.editingIndex ? 1 : 0);
    const retainedTargetIds = new Set(
      comments.map((comment) => comment.target.targetId),
    );
    if (
      state.editingIndex !== index &&
      state.draft !== undefined
    ) {
      retainedTargetIds.add(state.draft.targetId);
    }
    const staleTargetIds = state.staleTargetIds?.filter(
      (targetId) =>
        targetId !== removed?.target.targetId ||
        retainedTargetIds.has(targetId),
    );
    this.#set(tabId, {
      ...state,
      count: comments.length,
      comments,
      draft:
        state.editingIndex === index ? undefined : state.draft,
      draftComment:
        state.editingIndex === index
          ? undefined
          : state.draftComment,
      editingIndex,
      staleTargetIds:
        staleTargetIds?.length === 0 ? undefined : staleTargetIds,
      error:
        (staleTargetIds?.length ?? 0) > 0
          ? STALE_TARGET_ERROR
          : undefined,
    });
  }

  async send(tabId: string): Promise<void> {
    const state = this.#active(tabId);
    const view = this.#views.get(tabId);
    const lifecycle = this.#lifecycles.get(tabId);
    if (
      state === undefined ||
      view === undefined ||
      lifecycle === undefined ||
      state.phase !== "active" ||
      state.comments.length === 0 ||
      state.draft !== undefined ||
      (state.staleTargetIds?.length ?? 0) > 0 ||
      !this.#isCurrent(tabId, lifecycle)
    ) {
      return;
    }
    this.#clearRefresh(tabId);
    this.#set(tabId, {
      ...state,
      phase: "sending",
      error: undefined,
    });
    try {
      const captured = await captureWebAnnotationTargets(
        view,
        state.comments.map(
          (comment) => comment.target.targetId,
        ),
      );
      this.#require(tabId, lifecycle, "sending");
      if (captured.page.url !== state.page.url) {
        this.pageChanged(tabId);
        return;
      }
      if (captured.targets.length !== state.comments.length) {
        throw new Error(
          "The page changed before the annotations could be sent",
        );
      }
      const targetById = new Map(
        captured.targets.map((target) => [
          target.targetId,
          target,
        ]),
      );
      const comments = state.comments.map((comment) => {
        const target = targetById.get(comment.target.targetId);
        if (target === undefined) {
          throw new Error(
            "A selected page element is no longer available",
          );
        }
        return { ...comment, target };
      });
      const data = await this.#composeImage(captured, comments);
      this.#require(tabId, lifecycle, "sending");
      await this.#chat.sendScreenshot(
        {
          data,
          text: formatAgentBrowserComments({
            sessionId: `web:${tabId}`,
            annotationSessionId: state.annotationSessionId,
            generation: state.generation,
            page: captured.page,
            comments,
          }),
        },
        state.chatTarget,
        { signal: lifecycle.abort.signal },
      );
      this.#require(tabId, lifecycle, "sending");
      try {
        await stopWebAnnotationSelection(view);
      } catch {
        // The Chat handoff succeeded; picker teardown is best-effort.
      }
      if (!this.#isCurrent(tabId, lifecycle)) return;
      this.#invalidateLifecycle(tabId);
      this.#set(tabId, IDLE_ANNOTATION_SNAPSHOT);
    } catch (error) {
      if (
        lifecycle.abort.signal.aborted ||
        !this.#isCurrent(tabId, lifecycle)
      ) {
        return;
      }
      const current = this.#active(tabId);
      if (current !== undefined && !this.#disposed) {
        this.#set(tabId, {
          ...current,
          phase: "active",
          error: errorMessage(error),
        });
        this.#armSelection(tabId, lifecycle);
        this.#scheduleRefresh(tabId);
      }
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const tabId of this.#lifecycles.keys()) {
      this.#invalidateLifecycle(tabId);
    }
    for (const [tabId, view] of this.#views) {
      void stopWebAnnotationSelection(view).catch(() => {});
      this.#annotations.delete(tabId);
      this.#emit(tabId);
    }
    this.#views.clear();
    this.#annotations.clear();
    this.#listeners.clear();
  }

  #armSelection(
    tabId: string,
    lifecycle: WebAnnotationLifecycle,
  ): void {
    const view = this.#views.get(tabId);
    if (
      view === undefined ||
      !this.#isCurrent(tabId, lifecycle) ||
      this.getSnapshot(tabId).phase !== "active"
    ) {
      return;
    }
    void waitForWebAnnotationSelection(view)
      .then((selection) => {
        if (
          !this.#isCurrent(tabId, lifecycle) ||
          this.getSnapshot(tabId).phase !== "active"
        ) {
          return;
        }
        if (selection === undefined) {
          void this.cancel(tabId);
          return;
        }
        this.#acceptSelection(
          tabId,
          selection.page,
          selection.target,
        );
        this.#armSelection(tabId, lifecycle);
      })
      .catch((error: unknown) => {
        if (!this.#isCurrent(tabId, lifecycle)) return;
        this.#invalidateLifecycle(tabId);
        this.#set(tabId, {
          phase: "error",
          count: 0,
          comments: [],
          error: errorMessage(error),
        });
      });
  }

  #acceptSelection(
    tabId: string,
    page: AgentBrowserAnnotationPage,
    target: AgentBrowserAnnotationTarget,
  ): void {
    const state = this.#active(tabId);
    if (
      state === undefined ||
      state.phase !== "active"
    ) {
      return;
    }
    if (page.url !== state.page.url) {
      this.pageChanged(tabId);
      return;
    }
    const existing = state.comments.find(
      (comment) =>
        comment.target.targetId === target.targetId,
    );
    if (
      existing === undefined &&
      state.comments.length >=
        AGENT_BROWSER_ANNOTATION_TARGET_LIMIT
    ) {
      return;
    }
    const staleTargetIds = state.staleTargetIds?.filter(
      (targetId) => targetId !== target.targetId,
    );
    this.#set(tabId, {
      ...state,
      page,
      draft: target,
      draftComment: existing?.comment,
      editingIndex: existing?.index,
      staleTargetIds:
        staleTargetIds?.length === 0 ? undefined : staleTargetIds,
      error:
        (staleTargetIds?.length ?? 0) > 0
          ? STALE_TARGET_ERROR
          : undefined,
    });
  }

  #scheduleRefresh(tabId: string): void {
    this.#clearRefresh(tabId);
    const state = this.#active(tabId);
    if (state === undefined || state.phase !== "active") return;
    const timer = setTimeout(() => {
      this.#refreshTimers.delete(tabId);
      void this.#refresh(tabId);
    }, 700);
    this.#refreshTimers.set(tabId, timer);
  }

  async #refresh(tabId: string): Promise<void> {
    const state = this.#active(tabId);
    const view = this.#views.get(tabId);
    const lifecycle = this.#lifecycles.get(tabId);
    if (
      state === undefined ||
      view === undefined ||
      lifecycle === undefined ||
      state.phase !== "active" ||
      !this.#isCurrent(tabId, lifecycle)
    ) {
      return;
    }
    const targetIds = [
      ...state.comments.map((comment) => comment.target.targetId),
      ...(state.draft === undefined
        ? []
        : [state.draft.targetId]),
    ];
    if (targetIds.length === 0) {
      this.#scheduleRefresh(tabId);
      return;
    }
    try {
      const result = await refreshWebAnnotationTargets(
        view,
        [...new Set(targetIds)],
      );
      const current = this.#active(tabId);
      if (
        current === undefined ||
        current.phase !== "active" ||
        !this.#isCurrent(tabId, lifecycle)
      ) {
        return;
      }
      if (result.page.url !== current.page.url) {
        this.pageChanged(tabId);
        return;
      }
      const targetById = new Map(
        result.targets.map((target) => [
          target.targetId,
          target,
        ]),
      );
      const staleTargetIds = [...new Set(targetIds)].filter(
        (targetId) => !targetById.has(targetId),
      );
      this.#set(tabId, {
        ...current,
        page: result.page,
        comments: current.comments.map((comment) => ({
          ...comment,
          target:
            targetById.get(comment.target.targetId) ??
            comment.target,
        })),
        draft:
          current.draft === undefined
            ? undefined
            : targetById.get(current.draft.targetId) ??
              current.draft,
        staleTargetIds:
          staleTargetIds.length === 0
            ? undefined
            : staleTargetIds,
        error:
          staleTargetIds.length > 0
            ? STALE_TARGET_ERROR
            : current.error === STALE_TARGET_ERROR
              ? undefined
              : current.error,
      });
    } catch {
      // Navigation and detach invalidate the owning lifecycle separately.
    } finally {
      if (this.#isCurrent(tabId, lifecycle)) {
        this.#scheduleRefresh(tabId);
      }
    }
  }

  #active(tabId: string): ActiveWebAnnotation | undefined {
    const state = this.#annotations.get(tabId);
    if (
      state === undefined ||
      state.annotationSessionId === undefined ||
      state.generation === undefined ||
      state.page === undefined ||
      state.chatTarget === undefined
    ) {
      return undefined;
    }
    const tab = this.#tabs.tab(tabId);
    if (tab === undefined || !isWebTab(tab)) return undefined;
    return {
      ...state,
      annotationSessionId: state.annotationSessionId,
      generation: state.generation,
      page: state.page,
      chatTarget: state.chatTarget,
    };
  }

  #set(tabId: string, state: BrowserAnnotationSnapshot): void {
    if (state.phase === "idle") this.#annotations.delete(tabId);
    else this.#annotations.set(tabId, state);
    this.#emit(tabId);
  }

  #emit(tabId: string): void {
    for (const listener of this.#listeners.get(tabId) ?? []) {
      listener();
    }
  }

  #beginLifecycle(tabId: string): WebAnnotationLifecycle {
    this.#invalidateLifecycle(tabId);
    const lifecycle = {
      epoch: this.#lifecycleEpoch + 1,
      abort: new AbortController(),
    };
    this.#lifecycleEpoch = lifecycle.epoch;
    this.#lifecycles.set(tabId, lifecycle);
    return lifecycle;
  }

  #invalidateLifecycle(tabId: string): void {
    const lifecycle = this.#lifecycles.get(tabId);
    lifecycle?.abort.abort();
    this.#lifecycles.delete(tabId);
    this.#clearRefresh(tabId);
  }

  #isCurrent(
    tabId: string,
    lifecycle: WebAnnotationLifecycle,
  ): boolean {
    return (
      !this.#disposed &&
      !lifecycle.abort.signal.aborted &&
      this.#lifecycles.get(tabId)?.epoch === lifecycle.epoch
    );
  }

  #require(
    tabId: string,
    lifecycle: WebAnnotationLifecycle,
    phase: BrowserAnnotationPhase,
  ): void {
    if (
      !this.#isCurrent(tabId, lifecycle) ||
      this.getSnapshot(tabId).phase !== phase
    ) {
      throw new DOMException(
        "The annotation operation was cancelled",
        "AbortError",
      );
    }
  }

  #clearRefresh(tabId: string): void {
    const timer = this.#refreshTimers.get(tabId);
    if (timer !== undefined) clearTimeout(timer);
    this.#refreshTimers.delete(tabId);
  }
}
