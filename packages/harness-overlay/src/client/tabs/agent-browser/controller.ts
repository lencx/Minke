import {
  parseAgentBrowserProjection,
  parseAgentBrowserProjections,
  type AgentBrowserNavigationCommand,
  type AgentBrowserOwner,
  type AgentBrowserProjection,
} from "@minke/harness-overlay/agent-browser-contract.ts";
import {
  parseAgentBrowserHistoryClearRequest,
  parseAgentBrowserHistoryReadRequest,
  parseAgentBrowserHistorySnapshot,
  type AgentBrowserHistoryReadRequest,
  type AgentBrowserHistorySnapshot,
} from "@minke/harness-overlay/agent-browser-history-contract.ts";
import {
  AGENT_BROWSER_ANNOTATION_COMMENT_LIMIT,
  AGENT_BROWSER_ANNOTATION_TARGET_LIMIT,
  type AgentBrowserAnnotationEvent,
  type AgentBrowserAnnotationPage,
  type AgentBrowserAnnotationTarget,
} from "@minke/harness-overlay/agent-browser-annotation-contract.ts";
import type {
  ManagedTab,
} from "@minke/harness-overlay/client/tabs/types.ts";
import type {
  BrowserAnnotationPhase,
  BrowserAnnotationSnapshot,
} from "@minke/harness-overlay/client/tabs/browser-annotation/types.ts";
import type {
  TabsRuntime,
} from "@minke/harness-overlay/client/tabs/runtime.ts";
import {
  AGENT_BROWSER_TAB_KIND,
  isAgentBrowserTab,
  type AgentBrowserTabPayload,
  type AgentBrowserTabsPort,
} from "./types.ts";
import {
  composeAgentBrowserAnnotationImage,
} from "./annotation-image.ts";
import {
  formatAgentBrowserComments,
  type AgentBrowserChatPort,
  type AgentBrowserChatTarget,
  type AgentBrowserNumberedComment,
} from "./chat.ts";

export type AgentBrowserAnnotationPhase = BrowserAnnotationPhase;
export type AgentBrowserAnnotationSnapshot =
  BrowserAnnotationSnapshot;

interface ActiveAgentBrowserAnnotation
  extends AgentBrowserAnnotationSnapshot {
  readonly sessionId: string;
  readonly annotationSessionId: string;
  readonly generation: number;
  readonly page: AgentBrowserAnnotationPage;
  readonly chatTarget: AgentBrowserChatTarget;
}

export interface AgentBrowserAnnotationDependencies {
  readonly chat: AgentBrowserChatPort;
  readonly composeImage?: typeof composeAgentBrowserAnnotationImage;
}

const IDLE_ANNOTATION_SNAPSHOT: AgentBrowserAnnotationSnapshot =
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

interface AgentBrowserAnnotationLifecycle {
  readonly epoch: number;
  readonly abort: AbortController;
}

type SelectedAgentBrowserAnnotationEvent = Extract<
  AgentBrowserAnnotationEvent,
  { readonly type: "selected" }
>;

function reindexComments(
  comments: readonly AgentBrowserNumberedComment[],
): readonly AgentBrowserNumberedComment[] {
  return comments.map((comment, index) => ({
    ...comment,
    index: index + 1,
  }));
}

function projectionTitle(
  projection: AgentBrowserProjection,
): string {
  if (projection.title !== undefined) return projection.title;
  if (projection.url !== undefined) {
    try {
      return new URL(projection.url).hostname.replace(/^www\./u, "") ||
        "Agent Browser";
    } catch {
      // The shared contract already validates URLs; retain a safe fallback.
    }
  }
  return "Agent Browser";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Projects main-owned Agent Browser sessions into the generic right Tabs
 * runtime. Main remains authoritative for navigation, ownership, and guest
 * lifetime; this controller owns only presentation state and close reaping.
 */
export class AgentBrowserTabsController {
  readonly #tabs: TabsRuntime;
  readonly #port: AgentBrowserTabsPort;
  readonly #chat: AgentBrowserChatPort;
  readonly #composeImage: typeof composeAgentBrowserAnnotationImage;
  readonly #tabBySession = new Map<string, string>();
  readonly #sessionByTab = new Map<string, string>();
  readonly #controlPending = new Set<string>();
  readonly #controlErrors = new Map<string, string>();
  readonly #locallyClosed = new Set<string>();
  readonly #closeSent = new Set<string>();
  readonly #unsubscribePort: () => void;
  readonly #unsubscribeAnnotation: () => void;
  readonly #unsubscribeTabs: () => void;
  readonly #annotations =
    new Map<string, AgentBrowserAnnotationSnapshot>();
  readonly #annotationListeners =
    new Map<string, Set<() => void>>();
  readonly #annotationRefreshTimers =
    new Map<string, ReturnType<typeof setTimeout>>();
  readonly #annotationLifecycles =
    new Map<string, AgentBrowserAnnotationLifecycle>();
  readonly #pendingAnnotationSelections =
    new Map<string, SelectedAgentBrowserAnnotationEvent>();
  #initializePromise: Promise<void> | undefined;
  #projectionEpoch = 0;
  #annotationEpoch = 0;
  #disposed = false;

  constructor(
    tabs: TabsRuntime,
    port: AgentBrowserTabsPort,
    dependencies?: AgentBrowserAnnotationDependencies,
  ) {
    this.#tabs = tabs;
    this.#port = port;
    this.#chat = dependencies?.chat ?? UNAVAILABLE_CHAT;
    this.#composeImage =
      dependencies?.composeImage ?? composeAgentBrowserAnnotationImage;
    this.#unsubscribePort = port.available
      ? port.subscribe((projections) => {
          this.#projectionEpoch += 1;
          try {
            this.#applySnapshot(projections);
          } catch {
            // Invalid renderer projections never replace the last good state.
          }
        })
      : () => {};
    this.#unsubscribeAnnotation = port.available
      ? port.subscribeAnnotationEvents((event) => {
          try {
            this.#handleAnnotationEvent(event);
          } catch {
            // Invalid or stale annotation events never replace local intent.
          }
        })
      : () => {};
    this.#unsubscribeTabs = tabs.subscribe(
      () => this.#releaseClosedTabs(),
    );
  }

  initialize(): Promise<void> {
    this.#initializePromise ??= this.#initialize();
    return this.#initializePromise;
  }

  getAnnotationSnapshot(
    tabId: string,
  ): AgentBrowserAnnotationSnapshot {
    return this.#annotations.get(tabId) ??
      IDLE_ANNOTATION_SNAPSHOT;
  }

  subscribeAnnotation(
    tabId: string,
    listener: () => void,
  ): () => void {
    let listeners = this.#annotationListeners.get(tabId);
    if (listeners === undefined) {
      listeners = new Set();
      this.#annotationListeners.set(tabId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) {
        this.#annotationListeners.delete(tabId);
      }
    };
  }

  async startAnnotation(tabId: string): Promise<void> {
    const tab = this.#tabs.tab(tabId);
    const current = this.getAnnotationSnapshot(tabId);
    if (
      this.#disposed ||
      tab === undefined ||
      !isAgentBrowserTab(tab) ||
      current.phase === "starting" ||
      current.phase === "active" ||
      current.phase === "sending" ||
      tab.payload.status === "crashed"
    ) {
      return;
    }
    const chatTarget = this.#chat.currentTarget();
    if (chatTarget === undefined) {
      this.#setAnnotation(tabId, {
        phase: "error",
        count: 0,
        comments: [],
        error: "Open a Chat before annotating this page",
      });
      return;
    }
    const lifecycle = this.#beginAnnotationLifecycle(tabId);
    this.#setAnnotation(tabId, {
      phase: "starting",
      count: 0,
      comments: [],
      chatTarget,
    });
    try {
      if (tab.payload.owner !== "human") {
        await this.setOwner(tabId, "human");
      }
      if (!this.#isAnnotationLifecycleCurrent(tabId, lifecycle)) {
        return;
      }
      const controlled = this.#tabs.tab(tabId);
      if (
        controlled === undefined ||
        !isAgentBrowserTab(controlled) ||
        controlled.payload.owner !== "human" ||
        controlled.payload.controlPending
      ) {
        throw new Error(
          controlled !== undefined &&
              isAgentBrowserTab(controlled) &&
              controlled.payload.controlError !== undefined
            ? controlled.payload.controlError
            : "Could not take control of this browser tab",
        );
      }
      const session = await this.#port.startAnnotation(
        controlled.payload.sessionId,
      );
      if (!this.#isAnnotationLifecycleCurrent(tabId, lifecycle)) {
        try {
          await this.#port.stopAnnotation({
            sessionId: session.sessionId,
            annotationSessionId: session.annotationSessionId,
          });
        } catch {
          // Cancellation already revoked the renderer lifecycle.
        }
        return;
      }
      if (session.sessionId !== controlled.payload.sessionId) {
        throw new Error(
          "Agent Browser annotation changed session identity",
        );
      }
      this.#setAnnotation(tabId, {
        ...session,
        phase: "active",
        count: 0,
        comments: [],
        chatTarget,
      });
      const pending =
        this.#pendingAnnotationSelections.get(tabId);
      this.#pendingAnnotationSelections.delete(tabId);
      if (pending !== undefined) {
        this.#handleAnnotationEvent(pending);
      }
      this.#scheduleAnnotationRefresh(tabId);
    } catch (error) {
      if (this.#isAnnotationLifecycleCurrent(tabId, lifecycle)) {
        this.#invalidateAnnotationLifecycle(tabId);
        this.#setAnnotation(tabId, {
          phase: "error",
          count: 0,
          comments: [],
          chatTarget,
          error: errorMessage(error),
        });
      }
    }
  }

  async cancelAnnotation(tabId: string): Promise<void> {
    const state = this.#activeAnnotation(tabId);
    this.#invalidateAnnotationLifecycle(tabId);
    this.#setAnnotation(tabId, IDLE_ANNOTATION_SNAPSHOT);
    if (state === undefined) return;
    try {
      await this.#port.stopAnnotation({
        sessionId: state.sessionId,
        annotationSessionId: state.annotationSessionId,
      });
    } catch {
      // Main also tears the picker down on navigation/control/guest close.
    }
  }

  commitAnnotation(tabId: string, comment: string): void {
    const state = this.#activeAnnotation(tabId);
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
    this.#setAnnotation(tabId, {
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
    const state = this.#activeAnnotation(tabId);
    if (state === undefined || state.draft === undefined) return;
    const retainedTargetIds = new Set(
      state.comments.map((comment) => comment.target.targetId),
    );
    const staleTargetIds = state.staleTargetIds?.filter(
      (targetId) => retainedTargetIds.has(targetId),
    );
    this.#setAnnotation(tabId, {
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
    const state = this.#activeAnnotation(tabId);
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
    this.#setAnnotation(tabId, {
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
    const state = this.#activeAnnotation(tabId);
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
    this.#setAnnotation(tabId, {
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

  async sendAnnotations(tabId: string): Promise<void> {
    const state = this.#activeAnnotation(tabId);
    if (
      state === undefined ||
      state.phase !== "active" ||
      state.comments.length === 0 ||
      state.draft !== undefined ||
      (state.staleTargetIds?.length ?? 0) > 0
    ) {
      return;
    }
    const lifecycle = this.#annotationLifecycles.get(tabId);
    if (
      lifecycle === undefined ||
      !this.#isAnnotationLifecycleCurrent(tabId, lifecycle)
    ) {
      return;
    }
    this.#clearAnnotationRefresh(tabId);
    this.#setAnnotation(tabId, {
      ...state,
      phase: "sending",
      error: undefined,
    });
    try {
      const committed = await this.#port.commitAnnotation({
        sessionId: state.sessionId,
        annotationSessionId: state.annotationSessionId,
        targetIds: state.comments.map(
          (comment) => comment.target.targetId,
        ),
      });
      this.#requireAnnotationOperation(
        tabId,
        lifecycle,
        "sending",
      );
      if (
        committed.generation !== state.generation ||
        committed.targets.length !== state.comments.length
      ) {
        throw new Error(
          "The page changed before the annotations could be sent",
        );
      }
      const targetById = new Map(
        committed.targets.map((target) => [
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
      const data = await this.#composeImage(committed, comments);
      this.#requireAnnotationOperation(
        tabId,
        lifecycle,
        "sending",
      );
      await this.#chat.sendScreenshot(
        {
          data,
          text: formatAgentBrowserComments({
            sessionId: state.sessionId,
            annotationSessionId: state.annotationSessionId,
            generation: state.generation,
            page: committed.page,
            comments,
          }),
        },
        state.chatTarget,
        { signal: lifecycle.abort.signal },
      );
      this.#requireAnnotationOperation(
        tabId,
        lifecycle,
        "sending",
      );
      try {
        await this.#port.stopAnnotation({
          sessionId: state.sessionId,
          annotationSessionId: state.annotationSessionId,
        });
      } catch {
        // The explicit Chat handoff succeeded; teardown is best-effort.
      }
      if (!this.#isAnnotationLifecycleCurrent(tabId, lifecycle)) {
        return;
      }
      this.#invalidateAnnotationLifecycle(tabId);
      this.#setAnnotation(tabId, IDLE_ANNOTATION_SNAPSHOT);
    } catch (error) {
      if (
        lifecycle.abort.signal.aborted ||
        !this.#isAnnotationLifecycleCurrent(tabId, lifecycle)
      ) {
        return;
      }
      const current = this.#activeAnnotation(tabId);
      if (current !== undefined && !this.#disposed) {
        this.#setAnnotation(tabId, {
          ...current,
          phase: "active",
          error: errorMessage(error),
        });
        this.#scheduleAnnotationRefresh(tabId);
      }
    }
  }

  async setOwner(
    tabId: string,
    owner: AgentBrowserOwner,
  ): Promise<void> {
    if (owner === "agent") {
      await this.cancelAnnotation(tabId);
    }
    const tab = this.#tabs.tab(tabId);
    if (
      this.#disposed ||
      tab === undefined ||
      !isAgentBrowserTab(tab) ||
      tab.payload.owner === owner ||
      this.#controlPending.has(tab.payload.sessionId)
    ) {
      return;
    }

    const sessionId = tab.payload.sessionId;
    this.#controlPending.add(sessionId);
    this.#controlErrors.delete(sessionId);
    this.#refreshPresentation(sessionId);
    try {
      const projection = parseAgentBrowserProjection(
        await this.#port.setControl(sessionId, owner),
      );
      if (projection.sessionId !== sessionId) {
        throw new Error(
          "Agent Browser control response changed session identity",
        );
      }
      this.#upsert(projection);
    } catch (error) {
      if (!this.#disposed && !this.#locallyClosed.has(sessionId)) {
        this.#controlErrors.set(sessionId, errorMessage(error));
      }
    } finally {
      this.#controlPending.delete(sessionId);
      this.#refreshPresentation(sessionId);
    }
  }

  async navigate(
    tabId: string,
    command: AgentBrowserNavigationCommand,
  ): Promise<void> {
    const tab = this.#tabs.tab(tabId);
    if (
      this.#disposed ||
      tab === undefined ||
      !isAgentBrowserTab(tab) ||
      tab.payload.owner !== "human" ||
      tab.payload.controlPending ||
      tab.payload.status !== "paused"
    ) {
      return;
    }
    try {
      const projection = parseAgentBrowserProjection(
        await this.#port.navigate(tab.payload.sessionId, command),
      );
      if (projection.sessionId !== tab.payload.sessionId) return;
      this.#upsert(projection);
    } catch {
      // A control race or guest teardown is reflected by the next main-owned
      // projection; toolbar clicks must not create unhandled rejections.
    }
  }

  async readHistory(
    request: AgentBrowserHistoryReadRequest,
  ): Promise<AgentBrowserHistorySnapshot> {
    if (this.#disposed || !this.#port.available) {
      throw new Error("Agent Browser history is unavailable");
    }
    return parseAgentBrowserHistorySnapshot(
      await this.#port.readHistory(
        parseAgentBrowserHistoryReadRequest(request),
      ),
    );
  }

  async clearHistory(): Promise<AgentBrowserHistorySnapshot> {
    if (this.#disposed || !this.#port.available) {
      throw new Error("Agent Browser history is unavailable");
    }
    return parseAgentBrowserHistorySnapshot(
      await this.#port.clearHistory(
        parseAgentBrowserHistoryClearRequest({ confirm: true }),
      ),
    );
  }

  beforeClose(tab: ManagedTab): boolean {
    if (isAgentBrowserTab(tab)) this.#requestClose(tab.id);
    return true;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribePort();
    this.#unsubscribeAnnotation();
    this.#unsubscribeTabs();

    const sessions = new Set([
      ...this.#tabBySession.keys(),
      ...this.#tabs.getSnapshot().tabs
        .filter(isAgentBrowserTab)
        .map((tab) => tab.payload.sessionId),
    ]);
    const tabIds = this.#tabs.getSnapshot().tabs
      .filter(isAgentBrowserTab)
      .map((tab) => tab.id);
    this.#tabBySession.clear();
    this.#sessionByTab.clear();
    for (const sessionId of sessions) this.#closeOnce(sessionId);
    for (const tabId of tabIds) this.#tabs.close(tabId);
    this.#controlPending.clear();
    this.#controlErrors.clear();
    this.#locallyClosed.clear();
    for (const tabId of this.#annotationRefreshTimers.keys()) {
      this.#clearAnnotationRefresh(tabId);
    }
    for (const tabId of this.#annotationLifecycles.keys()) {
      this.#invalidateAnnotationLifecycle(tabId);
    }
    this.#pendingAnnotationSelections.clear();
    this.#annotations.clear();
    this.#annotationListeners.clear();
  }

  async #initialize(): Promise<void> {
    if (this.#disposed || !this.#port.available) return;
    const epoch = this.#projectionEpoch;
    try {
      const projections = await this.#port.read();
      if (
        this.#disposed ||
        epoch !== this.#projectionEpoch
      ) {
        return;
      }
      this.#applySnapshot(projections);
    } catch {
      // A later main-process projection can still hydrate the Tabs surface.
    }
  }

  #applySnapshot(
    value: readonly AgentBrowserProjection[],
  ): void {
    if (this.#disposed) return;
    const projections = parseAgentBrowserProjections(value);
    const incoming = new Map(
      projections.map((projection) => [
        projection.sessionId,
        projection,
      ]),
    );

    for (const [sessionId, tabId] of this.#tabBySession) {
      if (incoming.has(sessionId)) continue;
      this.#forget(sessionId, tabId);
      this.#tabs.close(tabId);
    }
    for (const projection of incoming.values()) {
      if (!this.#locallyClosed.has(projection.sessionId)) {
        this.#upsert(projection);
      }
    }
  }

  #upsert(projection: AgentBrowserProjection): void {
    if (this.#disposed) return;
    const sessionId = projection.sessionId;
    const tabId = this.#tabBySession.get(sessionId);
    const current = tabId === undefined
      ? undefined
      : this.#tabs.tab(tabId);
    if (
      current !== undefined &&
      isAgentBrowserTab(current) &&
      current.payload.generation > projection.generation
    ) {
      return;
    }
    const payload: AgentBrowserTabPayload = {
      ...projection,
      controlPending: this.#controlPending.has(sessionId),
      ...(this.#controlErrors.get(sessionId) === undefined
        ? {}
        : { controlError: this.#controlErrors.get(sessionId) }),
    };
    if (
      tabId !== undefined &&
      current !== undefined &&
      isAgentBrowserTab(current)
    ) {
      this.#tabs.update<AgentBrowserTabPayload>(tabId, {
        title: projectionTitle(projection),
        payload,
      });
      return;
    }

    const opened = this.#tabs.open<AgentBrowserTabPayload>({
      kind: AGENT_BROWSER_TAB_KIND,
      key: `session:${sessionId}`,
      title: projectionTitle(projection),
      payload,
    });
    if (opened === undefined) {
      this.#closeOnce(sessionId);
      return;
    }
    this.#tabBySession.set(sessionId, opened);
    this.#sessionByTab.set(opened, sessionId);
  }

  #refreshPresentation(sessionId: string): void {
    const tabId = this.#tabBySession.get(sessionId);
    const tab = tabId === undefined ? undefined : this.#tabs.tab(tabId);
    if (tab === undefined || !isAgentBrowserTab(tab)) return;
    const controlError = this.#controlErrors.get(sessionId);
    this.#tabs.update<AgentBrowserTabPayload>(tab.id, {
      payload: {
        ...tab.payload,
        controlPending: this.#controlPending.has(sessionId),
        controlError,
      },
    });
  }

  #requestClose(tabId: string): void {
    const sessionId = this.#sessionByTab.get(tabId);
    if (sessionId === undefined) return;
    this.#locallyClosed.add(sessionId);
    this.#forget(sessionId, tabId);
    this.#closeOnce(sessionId);
  }

  #releaseClosedTabs(): void {
    for (const [tabId, sessionId] of this.#sessionByTab) {
      if (this.#tabs.tab(tabId) !== undefined) continue;
      this.#locallyClosed.add(sessionId);
      this.#forget(sessionId, tabId);
      this.#closeOnce(sessionId);
    }
  }

  #forget(sessionId: string, tabId: string): void {
    this.#tabBySession.delete(sessionId);
    this.#sessionByTab.delete(tabId);
    this.#controlPending.delete(sessionId);
    this.#controlErrors.delete(sessionId);
    this.#invalidateAnnotationLifecycle(tabId);
    this.#annotations.delete(tabId);
    this.#emitAnnotation(tabId);
  }

  #closeOnce(sessionId: string): void {
    if (this.#closeSent.has(sessionId)) return;
    this.#closeSent.add(sessionId);
    try {
      this.#port.close(sessionId);
    } catch {
      // Guest destruction in main remains the final lifecycle backstop.
    }
  }

  #activeAnnotation(
    tabId: string,
  ): ActiveAgentBrowserAnnotation | undefined {
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
    if (tab === undefined || !isAgentBrowserTab(tab)) {
      return undefined;
    }
    return {
      ...state,
      sessionId: tab.payload.sessionId,
      annotationSessionId: state.annotationSessionId,
      generation: state.generation,
      page: state.page,
      chatTarget: state.chatTarget,
    };
  }

  #setAnnotation(
    tabId: string,
    state: AgentBrowserAnnotationSnapshot,
  ): void {
    if (state.phase === "idle") this.#annotations.delete(tabId);
    else this.#annotations.set(tabId, state);
    this.#emitAnnotation(tabId);
  }

  #emitAnnotation(tabId: string): void {
    for (const listener of this.#annotationListeners.get(tabId) ?? []) {
      listener();
    }
  }

  #handleAnnotationEvent(
    event: AgentBrowserAnnotationEvent,
  ): void {
    const tabId = this.#tabBySession.get(event.sessionId);
    if (tabId === undefined) return;
    const snapshot = this.#annotations.get(tabId);
    if (
      event.type === "selected" &&
      snapshot?.phase === "starting"
    ) {
      if (!this.#pendingAnnotationSelections.has(tabId)) {
        this.#pendingAnnotationSelections.set(tabId, event);
      }
      return;
    }
    const state = this.#activeAnnotation(tabId);
    if (
      state === undefined ||
      state.annotationSessionId !== event.annotationSessionId ||
      state.generation !== event.generation
    ) {
      return;
    }
    if (event.type === "ended") {
      this.#invalidateAnnotationLifecycle(tabId);
      if (event.reason === "cancelled") {
        this.#setAnnotation(tabId, IDLE_ANNOTATION_SNAPSHOT);
      } else {
        this.#setAnnotation(tabId, {
          phase: "error",
          count: 0,
          comments: [],
          error:
            event.message ??
            "The page changed, so its annotations were cleared",
        });
      }
      return;
    }
    const existing = state.comments.find(
      (comment) =>
        comment.target.targetId === event.target.targetId,
    );
    if (
      state.phase !== "active" ||
      (
        existing === undefined &&
        state.comments.length >=
          AGENT_BROWSER_ANNOTATION_TARGET_LIMIT
      )
    ) {
      return;
    }
    const staleTargetIds = state.staleTargetIds?.filter(
      (targetId) => targetId !== event.target.targetId,
    );
    this.#setAnnotation(tabId, {
      ...state,
      page: event.page,
      draft: event.target,
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

  #scheduleAnnotationRefresh(tabId: string): void {
    this.#clearAnnotationRefresh(tabId);
    const state = this.#activeAnnotation(tabId);
    if (
      state === undefined ||
      state.phase !== "active"
    ) {
      return;
    }
    const timer = setTimeout(() => {
      this.#annotationRefreshTimers.delete(tabId);
      void this.#refreshAnnotation(tabId);
    }, 700);
    this.#annotationRefreshTimers.set(tabId, timer);
  }

  async #refreshAnnotation(tabId: string): Promise<void> {
    const state = this.#activeAnnotation(tabId);
    if (state === undefined || state.phase !== "active") return;
    const lifecycle = this.#annotationLifecycles.get(tabId);
    if (
      lifecycle === undefined ||
      !this.#isAnnotationLifecycleCurrent(tabId, lifecycle)
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
      this.#scheduleAnnotationRefresh(tabId);
      return;
    }
    try {
      const result = await this.#port.refreshAnnotation({
        sessionId: state.sessionId,
        annotationSessionId: state.annotationSessionId,
        targetIds: [...new Set(targetIds)],
      });
      const current = this.#activeAnnotation(tabId);
      if (
        current === undefined ||
        current.phase !== "active" ||
        !this.#isAnnotationLifecycleCurrent(tabId, lifecycle) ||
        current.annotationSessionId !== result.annotationSessionId ||
        current.generation !== result.generation
      ) {
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
      this.#setAnnotation(tabId, {
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
      // Navigation/target loss is delivered through the authoritative event.
    } finally {
      if (this.#isAnnotationLifecycleCurrent(tabId, lifecycle)) {
        this.#scheduleAnnotationRefresh(tabId);
      }
    }
  }

  #clearAnnotationRefresh(tabId: string): void {
    const timer = this.#annotationRefreshTimers.get(tabId);
    if (timer !== undefined) clearTimeout(timer);
    this.#annotationRefreshTimers.delete(tabId);
  }

  #beginAnnotationLifecycle(
    tabId: string,
  ): AgentBrowserAnnotationLifecycle {
    this.#invalidateAnnotationLifecycle(tabId);
    const lifecycle = {
      epoch: this.#annotationEpoch + 1,
      abort: new AbortController(),
    };
    this.#annotationEpoch = lifecycle.epoch;
    this.#annotationLifecycles.set(tabId, lifecycle);
    return lifecycle;
  }

  #invalidateAnnotationLifecycle(tabId: string): void {
    const lifecycle = this.#annotationLifecycles.get(tabId);
    lifecycle?.abort.abort();
    this.#annotationLifecycles.delete(tabId);
    this.#pendingAnnotationSelections.delete(tabId);
    this.#clearAnnotationRefresh(tabId);
  }

  #isAnnotationLifecycleCurrent(
    tabId: string,
    lifecycle: AgentBrowserAnnotationLifecycle,
  ): boolean {
    return (
      !this.#disposed &&
      !lifecycle.abort.signal.aborted &&
      this.#annotationLifecycles.get(tabId)?.epoch ===
        lifecycle.epoch
    );
  }

  #requireAnnotationOperation(
    tabId: string,
    lifecycle: AgentBrowserAnnotationLifecycle,
    phase: AgentBrowserAnnotationPhase,
  ): void {
    if (
      !this.#isAnnotationLifecycleCurrent(tabId, lifecycle) ||
      this.getAnnotationSnapshot(tabId).phase !== phase
    ) {
      throw new DOMException(
        "The annotation operation was cancelled",
        "AbortError",
      );
    }
  }
}
