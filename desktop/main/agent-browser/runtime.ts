import type {
  Event as ElectronEvent,
  FromPartitionOptions,
  IpcMain,
  IpcMainEvent,
  IpcMainInvokeEvent,
  Session,
  WebContents,
  WebContentsDidStartNavigationEventParams,
  WebContentsWillNavigateEventParams,
  WebContentsWillRedirectEventParams,
  WebPreferences,
} from "electron";
import { randomUUID } from "node:crypto";
import {
  AGENT_BROWSER_CLOSE_CHANNEL,
  AGENT_BROWSER_CONTROL_CHANNEL,
  AGENT_BROWSER_NAVIGATION_CHANNEL,
  AGENT_BROWSER_SESSIONS_CHANGED_CHANNEL,
  AGENT_BROWSER_SESSIONS_READ_CHANNEL,
  normalizeAgentBrowserUrl,
  parseAgentBrowserTarget,
  parseAgentBrowserControlRequest,
  parseAgentBrowserNavigationRequest,
  parseAgentBrowserProcessRequest,
  parseAgentBrowserProjection,
  parseAgentBrowserSessionId,
  type AgentBrowserNavigationCommand,
  type AgentBrowserNavigationState,
  type AgentBrowserOperationResult,
  type AgentBrowserClaimControlResult,
  type AgentBrowserCursorPhase,
  type AgentBrowserCursorProjection,
  type AgentBrowserFindQuery,
  type AgentBrowserFindView,
  type AgentBrowserOwner,
  type AgentBrowserProjection,
  type AgentBrowserRequest,
  type AgentBrowserScrollDirection,
  type AgentBrowserTarget,
  type AgentBrowserSessionResult,
  type AgentBrowserSessionStatus,
} from "@minke/harness-overlay/agent-browser-contract.ts";
import {
  AGENT_BROWSER_HISTORY_CLEAR_CHANNEL,
  AGENT_BROWSER_HISTORY_DELETE_CHANNEL,
  AGENT_BROWSER_HISTORY_READ_CHANNEL,
  normalizeAgentBrowserHistoryFaviconUrl,
  parseAgentBrowserHistoryClearRequest,
  parseAgentBrowserHistoryDeleteRequest,
  parseAgentBrowserHistoryReadRequest,
  type AgentBrowserHistorySnapshot,
  type AgentBrowserNavigationKind,
} from "@minke/harness-overlay/agent-browser-history-contract.ts";
import {
  AGENT_BROWSER_ANNOTATION_COMMIT_CHANNEL,
  AGENT_BROWSER_ANNOTATION_EVENT_CHANNEL,
  AGENT_BROWSER_ANNOTATION_REFRESH_CHANNEL,
  AGENT_BROWSER_ANNOTATION_START_CHANNEL,
  AGENT_BROWSER_ANNOTATION_STOP_CHANNEL,
  parseAgentBrowserAnnotationCommitRequest,
  parseAgentBrowserAnnotationCommitResult,
  parseAgentBrowserAnnotationEvent,
  parseAgentBrowserAnnotationRefreshRequest,
  parseAgentBrowserAnnotationRefreshResult,
  parseAgentBrowserAnnotationSession,
  parseAgentBrowserAnnotationStartRequest,
  parseAgentBrowserAnnotationStopRequest,
  type AgentBrowserAnnotationEvent,
  type AgentBrowserAnnotationPage,
  type AgentBrowserAnnotationRefreshResult,
  type AgentBrowserAnnotationSession,
} from "@minke/harness-overlay/agent-browser-annotation-contract.ts";
import {
  AgentBrowserCdp,
  AgentBrowserError,
  asAgentBrowserError,
  type AgentBrowserCdpPointerTarget,
  type AgentBrowserTargetAction,
} from "./cdp.ts";
import type {
  AgentBrowserHistoryPort,
} from "./history.ts";
import {
  AgentBrowserProcessChannel,
  type AgentBrowserProcessChild,
} from "./process-channel.ts";

const MAX_AGENT_BROWSER_SESSIONS = 32;
const DEFAULT_GUEST_ATTACH_TIMEOUT_MS = 15_000;
const AGENT_PARTITION_PREFIX = "minke-agent-";
const INITIAL_GUEST_URL = "about:blank";
const CURSOR_INITIAL_DURATION_MS = 160;
const CURSOR_SAME_POINT_DURATION_MS = 80;
const CURSOR_MIN_TRAVEL_DURATION_MS = 160;
const CURSOR_MAX_TRAVEL_DURATION_MS = 420;
const CURSOR_FALLBACK_TRAVEL_DURATION_MS = 240;
const CURSOR_CLICK_FEEDBACK_HOLD_MS = 54;

export type AgentBrowserWebviewDecision =
  | "unmatched"
  | "secured"
  | "rejected";

export interface AgentBrowserBinding {
  dispose(): void;
}

export interface AgentBrowserRuntimeOptions {
  readonly sessionFromPartition: (
    partition: string,
    options: FromPartitionOptions,
  ) => Session;
  readonly createToken?: () => string;
  readonly guestAttachTimeoutMs?: number;
  readonly cdpCommandTimeoutMs?: number;
  /** Runtime-owned durable visit log, closed by dispose(). */
  readonly history?: AgentBrowserHistoryPort;
}

type AgentBrowserAuthorization = (
  event: IpcMainEvent | IpcMainInvokeEvent,
) => boolean;

interface AttachmentDeferred {
  readonly promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
  settled: boolean;
}

interface AgentBrowserAnnotationState {
  readonly annotationSessionId: string;
  readonly generation: number;
  page: AgentBrowserAnnotationPage;
  active: boolean;
  ended: boolean;
  operationTail: Promise<void>;
  stopPromise?: Promise<void>;
}

interface AgentBrowserSessionState {
  readonly sessionId: string;
  readonly ownerSessionId: string;
  readonly partition: string;
  readonly session: Session;
  readonly attachment: AttachmentDeferred;
  readonly handleDownload: (event: ElectronEvent) => void;
  owner: AgentBrowserOwner;
  status: AgentBrowserSessionStatus;
  generation: number;
  url?: string;
  title?: string;
  error?: string;
  attachmentClaimed: boolean;
  guest?: WebContents;
  cdp?: AgentBrowserCdp;
  removeGuestListeners?: () => void;
  operationTail: Promise<void>;
  controlTail: Promise<void>;
  controlRevision: number;
  humanTakeoverPending: boolean;
  closing: boolean;
  annotation?: AgentBrowserAnnotationState;
  cursor?: AgentBrowserCursorProjection;
  cursorSequence: number;
  snapshotRequired: boolean;
  navigation: AgentBrowserNavigationState;
  pendingHistoryVisit?: {
    readonly actor: AgentBrowserOwner;
    readonly navigationKind: AgentBrowserNavigationKind;
  };
  historyVisitId?: number;
}

interface WindowProjectionBinding {
  readonly ipc: Pick<
    IpcMain,
    "handle" | "on" | "removeHandler" | "removeListener"
  >;
  readonly embedder: WebContents;
  readonly authorize: AgentBrowserAuthorization;
}

function sessionCrashed(
  state: AgentBrowserSessionState,
): boolean {
  return state.status === "crashed";
}

function positiveTimeout(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const timeoutMs = value ?? fallback;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return timeoutMs;
}

function attachmentDeferred(): AttachmentDeferred {
  const deferred = {
    settled: false,
  } as AttachmentDeferred;
  let resolvePromise = (): void => {};
  let rejectPromise = (_error: Error): void => {};
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  Object.assign(deferred, {
    promise,
    resolve(): void {
      if (deferred.settled) return;
      deferred.settled = true;
      resolvePromise();
    },
    reject(error: Error): void {
      if (deferred.settled) return;
      deferred.settled = true;
      rejectPromise(error);
    },
  });
  return deferred;
}

function abortError(signal?: AbortSignal): AgentBrowserError {
  if (signal?.reason instanceof AgentBrowserError) {
    return signal.reason;
  }
  return new AgentBrowserError(
    "agent_browser_cancelled",
    signal?.reason instanceof Error
      ? signal.reason.message
      : "Agent Browser operation was cancelled",
  );
}

function waitForCursorTravel(
  durationMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<void>((resolve, reject) => {
    const finish = (): void => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    };
    const handleAbort = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", handleAbort);
      reject(abortError(signal));
    };
    const timeout = setTimeout(finish, durationMs);
    signal.addEventListener("abort", handleAbort, {
      once: true,
    });
  });
}

function cursorTravelDurationMs(
  cursor: AgentBrowserCursorProjection | undefined,
  target: AgentBrowserCdpPointerTarget,
): number {
  if (cursor === undefined) {
    return CURSOR_FALLBACK_TRAVEL_DURATION_MS;
  }
  const previousX =
    cursor.point.x / cursor.viewport.width * target.viewport.width;
  const previousY =
    cursor.point.y / cursor.viewport.height * target.viewport.height;
  const distance = Math.hypot(
    target.point.x - previousX,
    target.point.y - previousY,
  );
  if (distance <= 2) return CURSOR_SAME_POINT_DURATION_MS;
  const diagonal = Math.hypot(
    target.viewport.width,
    target.viewport.height,
  );
  const normalizedDistance = Math.min(1, distance / diagonal);
  return Math.round(
    CURSOR_MIN_TRAVEL_DURATION_MS +
      (
        CURSOR_MAX_TRAVEL_DURATION_MS -
        CURSOR_MIN_TRAVEL_DURATION_MS
      ) * Math.sqrt(normalizedDistance),
  );
}

function isSafeGuestUrl(value: string): boolean {
  if (value === INITIAL_GUEST_URL) return true;
  try {
    normalizeAgentBrowserUrl(value);
    return true;
  } catch {
    return false;
  }
}

function isInitialGuestUrl(value: string): boolean {
  return value === "" || value === INITIAL_GUEST_URL;
}

function annotationPageUrl(value: string | undefined): string {
  if (value === undefined) {
    throw new AgentBrowserError(
      "annotation_unavailable",
      "Agent Browser page is not ready for annotation",
    );
  }
  const url = new URL(normalizeAgentBrowserUrl(value));
  url.search = "";
  url.hash = "";
  return url.toString();
}

function requiredString(
  payload: Record<string, unknown>,
  key: string,
): string {
  const value = payload[key];
  if (typeof value !== "string") {
    throw new AgentBrowserError(
      "bad_request",
      `Agent Browser payload ${key} must be a string`,
    );
  }
  return value;
}

function requiredNumber(
  payload: Record<string, unknown>,
  key: string,
): number {
  const value = payload[key];
  if (!Number.isSafeInteger(value)) {
    throw new AgentBrowserError(
      "bad_request",
      `Agent Browser payload ${key} must be an integer`,
    );
  }
  return Number(value);
}

async function waitForPromise<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  timeoutError: () => AgentBrowserError,
): Promise<T> {
  if (signal?.aborted === true) throw abortError(signal);
  let timeout: NodeJS.Timeout | undefined;
  let removeAbortListener = (): void => {};
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(timeoutError()), timeoutMs);
    timeout.unref();
    if (signal !== undefined) {
      const handleAbort = (): void => reject(abortError(signal));
      signal.addEventListener("abort", handleAbort, { once: true });
      removeAbortListener = () =>
        signal.removeEventListener("abort", handleAbort);
    }
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    removeAbortListener();
  }
}

/**
 * Main-process authority for temporary Agent Browser WebContents.
 *
 * The renderer can only project sessions and instantiate the exact blank
 * partition issued here. Harness can only request semantic operations. This
 * class alone owns Session, guest, debugger, control, and teardown state.
 */
export class AgentBrowserRuntime {
  readonly #options: AgentBrowserRuntimeOptions;
  readonly #attachTimeoutMs: number;
  readonly #cdpTimeoutMs: number;
  readonly #history: AgentBrowserHistoryPort | undefined;
  readonly #states =
    new Map<string, AgentBrowserSessionState>();
  readonly #agentSessions = new WeakSet<Session>();
  readonly #issuedPartitions = new Set<string>();
  readonly #processChannels =
    new Set<AgentBrowserProcessChannel>();
  #windowBinding: WindowProjectionBinding | undefined;
  #windowBindingDisposer: (() => void) | undefined;
  #userAgent: string | undefined;
  #historyWriteFailureReported = false;
  #disposed = false;

  constructor(options: AgentBrowserRuntimeOptions) {
    this.#options = options;
    this.#attachTimeoutMs = positiveTimeout(
      options.guestAttachTimeoutMs,
      DEFAULT_GUEST_ATTACH_TIMEOUT_MS,
      "Agent Browser guest attach timeout",
    );
    this.#cdpTimeoutMs = positiveTimeout(
      options.cdpCommandTimeoutMs,
      30_000,
      "Agent Browser CDP timeout",
    );
    this.#history = options.history;
  }

  projections(): readonly AgentBrowserProjection[] {
    return [...this.#states.values()].map((state) =>
      this.#projection(state)
    );
  }

  /** Apply one main-owned identity to current and future Agent sessions. */
  setUserAgent(userAgent: string): void {
    const normalized = userAgent.trim();
    if (normalized === "") {
      throw new TypeError("Agent Browser user agent must not be empty");
    }
    if (normalized === this.#userAgent) return;
    this.#userAgent = normalized;
    for (const state of this.#states.values()) {
      state.session.setUserAgent(normalized);
    }
  }

  /**
   * Record a navigation committed by a trusted, human-controlled Web Tab.
   *
   * Ordinary Web Tabs share the same browsing-footprint store as Agent
   * Browser sessions, but they never accept actor attribution from renderer
   * traffic. The main process supplies both the source identity and actor.
   */
  recordHumanNavigation(
    sourceId: string,
    url: string,
    navigationKind: AgentBrowserNavigationKind,
  ): number | undefined {
    if (this.#disposed) return undefined;
    return this.#writeHistoryVisit({
      sessionId: sourceId,
      url,
      actor: "human",
      navigationKind,
      visitedAt: Date.now(),
    });
  }

  /** Attach trusted WebContents title metadata to one committed visit. */
  updateVisitTitle(visitId: number, title: string): void {
    if (this.#disposed) return;
    this.#writeHistoryVisitTitle(visitId, title);
  }

  /** Attach a trusted WebContents favicon to one committed visit. */
  updateVisitFavicon(
    visitId: number,
    pageUrl: string,
    faviconUrl: string,
  ): void {
    if (this.#disposed) return;
    this.#writeHistoryVisitFavicon(
      visitId,
      pageUrl,
      faviconUrl,
    );
  }

  bindChild(
    child: AgentBrowserProcessChild,
  ): AgentBrowserProcessChannel {
    this.#ensureAvailable();
    let channel: AgentBrowserProcessChannel;
    channel = new AgentBrowserProcessChannel(
      child,
      this,
      () => {
        this.#processChannels.delete(channel);
      },
    );
    this.#processChannels.add(channel);
    return channel;
  }

  bindWindowProjection(
    ipc: Pick<
      IpcMain,
      "handle" | "on" | "removeHandler" | "removeListener"
    >,
    embedder: WebContents,
    authorize: AgentBrowserAuthorization,
  ): AgentBrowserBinding {
    this.#ensureAvailable();
    if (this.#windowBinding !== undefined) {
      throw new Error(
        "Agent Browser window projection is already bound",
      );
    }
    const binding: WindowProjectionBinding = {
      ipc,
      embedder,
      authorize,
    };
    this.#windowBinding = binding;

    const handleRead = (
      event: IpcMainInvokeEvent,
    ): readonly AgentBrowserProjection[] => {
      if (!authorize(event)) {
        throw new Error("unauthorized Agent Browser request");
      }
      return this.projections();
    };
    const handleControl = async (
      event: IpcMainInvokeEvent,
      value: unknown,
    ): Promise<AgentBrowserProjection> => {
      if (!authorize(event)) {
        throw new Error("unauthorized Agent Browser request");
      }
      const request = parseAgentBrowserControlRequest(value);
      return await this.setControl(
        request.sessionId,
        request.owner,
      );
    };
    const handleNavigation = async (
      event: IpcMainInvokeEvent,
      value: unknown,
    ): Promise<AgentBrowserProjection> => {
      if (!authorize(event)) {
        throw new Error("unauthorized Agent Browser request");
      }
      const request = parseAgentBrowserNavigationRequest(value);
      return await this.navigateForHuman(
        request.sessionId,
        request.command,
      );
    };
    const handleHistoryRead = (
      event: IpcMainInvokeEvent,
      value: unknown,
    ): AgentBrowserHistorySnapshot => {
      if (!authorize(event)) {
        throw new Error("unauthorized Agent Browser request");
      }
      const request =
        parseAgentBrowserHistoryReadRequest(value);
      if (this.#history === undefined) {
        throw new Error(
          "Agent Browser browsing footprint is unavailable",
        );
      }
      return this.#history.read(request);
    };
    const handleHistoryClear = (
      event: IpcMainInvokeEvent,
      value: unknown,
    ): AgentBrowserHistorySnapshot => {
      if (!authorize(event)) {
        throw new Error("unauthorized Agent Browser request");
      }
      parseAgentBrowserHistoryClearRequest(value);
      if (this.#history === undefined) {
        throw new Error(
          "Agent Browser browsing footprint is unavailable",
        );
      }
      this.#history.clear();
      return {
        totalVisits: 0,
        retainedVisits: 0,
        uniquePaths: 0,
        agentVisits: 0,
        humanVisits: 0,
        visits: [],
      };
    };
    const handleHistoryDelete = (
      event: IpcMainInvokeEvent,
      value: unknown,
    ): void => {
      if (!authorize(event)) {
        throw new Error("unauthorized Agent Browser request");
      }
      const request =
        parseAgentBrowserHistoryDeleteRequest(value);
      if (this.#history === undefined) {
        throw new Error(
          "Agent Browser browsing footprint is unavailable",
        );
      }
      this.#history.deleteVisit(request.visitId);
    };
    const handleAnnotationStart = async (
      event: IpcMainInvokeEvent,
      value: unknown,
    ): Promise<AgentBrowserAnnotationSession> => {
      if (!authorize(event)) {
        throw new Error("unauthorized Agent Browser request");
      }
      const request = parseAgentBrowserAnnotationStartRequest(value);
      return await this.startAnnotation(request.sessionId);
    };
    const handleAnnotationStop = async (
      event: IpcMainInvokeEvent,
      value: unknown,
    ): Promise<void> => {
      if (!authorize(event)) {
        throw new Error("unauthorized Agent Browser request");
      }
      const request = parseAgentBrowserAnnotationStopRequest(value);
      await this.stopAnnotation(
        request.sessionId,
        request.annotationSessionId,
        "cancelled",
      );
    };
    const handleAnnotationRefresh = async (
      event: IpcMainInvokeEvent,
      value: unknown,
    ): Promise<AgentBrowserAnnotationRefreshResult> => {
      if (!authorize(event)) {
        throw new Error("unauthorized Agent Browser request");
      }
      const request =
        parseAgentBrowserAnnotationRefreshRequest(value);
      return await this.refreshAnnotation(request);
    };
    const handleAnnotationCommit = async (
      event: IpcMainInvokeEvent,
      value: unknown,
    ) => {
      if (!authorize(event)) {
        throw new Error("unauthorized Agent Browser request");
      }
      const request =
        parseAgentBrowserAnnotationCommitRequest(value);
      return await this.commitAnnotation(request);
    };
    const handleClose = (
      event: IpcMainEvent,
      value: unknown,
    ): void => {
      if (!authorize(event)) return;
      try {
        void this.closeSession(
          parseAgentBrowserSessionId(value),
        );
      } catch {
        // Invalid renderer traffic cannot affect another session.
      }
    };
    const handleDestroyed = (): void => {
      bindingHandle.dispose();
    };

    ipc.handle(AGENT_BROWSER_SESSIONS_READ_CHANNEL, handleRead);
    ipc.handle(AGENT_BROWSER_CONTROL_CHANNEL, handleControl);
    ipc.handle(AGENT_BROWSER_NAVIGATION_CHANNEL, handleNavigation);
    ipc.handle(
      AGENT_BROWSER_HISTORY_READ_CHANNEL,
      handleHistoryRead,
    );
    ipc.handle(
      AGENT_BROWSER_HISTORY_CLEAR_CHANNEL,
      handleHistoryClear,
    );
    ipc.handle(
      AGENT_BROWSER_HISTORY_DELETE_CHANNEL,
      handleHistoryDelete,
    );
    ipc.handle(
      AGENT_BROWSER_ANNOTATION_START_CHANNEL,
      handleAnnotationStart,
    );
    ipc.handle(
      AGENT_BROWSER_ANNOTATION_STOP_CHANNEL,
      handleAnnotationStop,
    );
    ipc.handle(
      AGENT_BROWSER_ANNOTATION_REFRESH_CHANNEL,
      handleAnnotationRefresh,
    );
    ipc.handle(
      AGENT_BROWSER_ANNOTATION_COMMIT_CHANNEL,
      handleAnnotationCommit,
    );
    ipc.on(AGENT_BROWSER_CLOSE_CHANNEL, handleClose);
    embedder.on("destroyed", handleDestroyed);

    let disposed = false;
    const bindingHandle: AgentBrowserBinding = {
      dispose: (): void => {
        if (disposed) return;
        disposed = true;
        embedder.off("destroyed", handleDestroyed);
        ipc.removeHandler(AGENT_BROWSER_SESSIONS_READ_CHANNEL);
        ipc.removeHandler(AGENT_BROWSER_CONTROL_CHANNEL);
        ipc.removeHandler(AGENT_BROWSER_NAVIGATION_CHANNEL);
        ipc.removeHandler(AGENT_BROWSER_HISTORY_READ_CHANNEL);
        ipc.removeHandler(AGENT_BROWSER_HISTORY_CLEAR_CHANNEL);
        ipc.removeHandler(AGENT_BROWSER_HISTORY_DELETE_CHANNEL);
        ipc.removeHandler(AGENT_BROWSER_ANNOTATION_START_CHANNEL);
        ipc.removeHandler(AGENT_BROWSER_ANNOTATION_STOP_CHANNEL);
        ipc.removeHandler(AGENT_BROWSER_ANNOTATION_REFRESH_CHANNEL);
        ipc.removeHandler(AGENT_BROWSER_ANNOTATION_COMMIT_CHANNEL);
        ipc.removeListener(
          AGENT_BROWSER_CLOSE_CHANNEL,
          handleClose,
        );
        if (this.#windowBinding === binding) {
          this.#windowBinding = undefined;
          this.#windowBindingDisposer = undefined;
          for (const sessionId of [...this.#states.keys()]) {
            void this.closeSession(sessionId);
          }
        }
      },
    };
    this.#windowBindingDisposer = bindingHandle.dispose;
    return bindingHandle;
  }

  /**
   * Admit only an unclaimed, exact, runtime-issued temporary partition.
   *
   * Unknown `minke-agent-*` values are rejected instead of falling through to
   * ordinary Web Tab policy, which prevents namespace smuggling.
   */
  secureWebview(
    webPreferences: WebPreferences,
    params: Record<string, string>,
  ): AgentBrowserWebviewDecision {
    const partition = params.partition;
    if (
      typeof partition !== "string" ||
      !partition.startsWith(AGENT_PARTITION_PREFIX)
    ) {
      return "unmatched";
    }
    const state = [...this.#states.values()].find(
      (candidate) => candidate.partition === partition,
    );
    if (
      state === undefined ||
      state.closing ||
      state.attachmentClaimed ||
      state.guest !== undefined ||
      params.src !== INITIAL_GUEST_URL
    ) {
      return "rejected";
    }

    state.attachmentClaimed = true;
    params.partition = state.partition;
    params.src = INITIAL_GUEST_URL;
    delete params.allowpopups;
    delete params.preload;
    delete params.useragent;
    delete params.webpreferences;

    delete webPreferences.preload;
    webPreferences.partition = state.partition;
    webPreferences.contextIsolation = true;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInWorker = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    webPreferences.webviewTag = false;
    webPreferences.devTools = false;
    webPreferences.navigateOnDragDrop = false;
    webPreferences.spellcheck = false;
    return "secured";
  }

  /**
   * Claim a newly attached guest by Session object identity and expected host.
   *
   * `true` means the guest belongs to the Agent Browser namespace, including
   * invalid/replayed guests that this method has closed.
   */
  attachGuest(
    embedder: WebContents,
    guest: WebContents,
  ): boolean {
    const state = [...this.#states.values()].find(
      (candidate) => candidate.session === guest.session,
    );
    if (state === undefined) {
      if (!this.#agentSessions.has(guest.session)) return false;
      try {
        guest.close({ waitForBeforeUnload: false });
      } catch {
        // A late guest from a closed Agent Browser session stays rejected.
      }
      return true;
    }

    const guestUrl = guest.getURL();
    const invalidReason =
      !state.attachmentClaimed
        ? "Agent Browser guest was not admitted"
        : state.guest !== undefined
          ? "Agent Browser partition was attached more than once"
          : this.#windowBinding?.embedder !== embedder ||
              guest.hostWebContents !== embedder
            ? "Agent Browser guest has an unexpected host"
            : state.session.isPersistent() ||
                state.session.getStoragePath() !== null
              ? "Agent Browser guest did not use temporary storage"
              : !isInitialGuestUrl(guestUrl)
                ? `Agent Browser guest did not start blank (${guestUrl.slice(0, 256)})`
                : undefined;
    if (invalidReason !== undefined) {
      this.#rejectGuest(state, guest, invalidReason);
      return true;
    }

    state.guest = guest;
    this.#protectGuest(state, guest);
    void this.#activateGuest(state, guest);
    return true;
  }

  async handleProcessRequest(
    request: AgentBrowserRequest,
    signal: AbortSignal,
  ): Promise<AgentBrowserOperationResult> {
    this.#ensureAvailable();
    const parsed = parseAgentBrowserProcessRequest(request);
    if (parsed.type !== "request") {
      throw new AgentBrowserError(
        "bad_request",
        "Expected an Agent Browser operation request",
      );
    }

    if (parsed.operation === "open") {
      return await this.#open(
        parsed.ownerSessionId,
        requiredString(parsed.payload, "url"),
        signal,
      );
    }

    const sessionId = requiredString(
      parsed.payload,
      "sessionId",
    );
    const state = this.#stateForAgent(
      sessionId,
      parsed.ownerSessionId,
    );
    if (parsed.operation === "close") {
      return await this.#enqueue(state, signal, async () => {
        await this.closeSession(state.sessionId);
        return {
          sessionId: state.sessionId,
          closed: true as const,
        };
      });
    }

    return await this.#enqueue(state, signal, async () => {
      const cdp = this.#activeCdp(state);
      switch (parsed.operation) {
        case "navigate": {
          const url = requiredString(parsed.payload, "url");
          this.#clearCursor(state);
          state.status = "loading";
          state.url = url;
          delete state.error;
          this.#publish();
          try {
            await cdp.navigate(url, signal);
            state.status = "ready";
            if (
              !await this.#publishCenteredCursor(
                state,
                cdp,
                signal,
              )
            ) {
              this.#publish();
            }
            return this.#sessionResult(state);
          } catch (error) {
            const browserError = asAgentBrowserError(
              error,
              "navigation_failed",
            );
            if (
              !state.closing &&
              this.#states.get(state.sessionId) === state &&
              !sessionCrashed(state)
            ) {
              state.status =
                state.owner === "human" ||
                  state.humanTakeoverPending
                  ? "paused"
                  : "ready";
              if (
                browserError.code === "session_paused" &&
                state.humanTakeoverPending
              ) {
                delete state.error;
              } else {
                state.error = browserError.message.slice(0, 2_048);
              }
              this.#publish();
            }
            throw browserError;
          }
        }
        case "history": {
          const command = requiredString(
            parsed.payload,
            "command",
          ) as AgentBrowserNavigationCommand;
          const guest = state.guest;
          if (guest === undefined || guest.isDestroyed()) {
            throw new AgentBrowserError(
              "target_gone",
              "Agent Browser target is unavailable",
            );
          }
          if (
            (command === "back" &&
              !guest.navigationHistory.canGoBack()) ||
            (command === "forward" &&
              !guest.navigationHistory.canGoForward())
          ) {
            throw new AgentBrowserError(
              "navigation_unavailable",
              `Agent Browser cannot navigate ${command} from the current page`,
            );
          }
          this.#clearCursor(state);
          cdp.invalidateReferences("document");
          state.generation = cdp.generation;
          state.snapshotRequired = true;
          if (command === "stop") {
            guest.stop();
            this.#syncNavigationState(state, false);
            state.status = "ready";
          } else {
            state.navigation = {
              ...state.navigation,
              loading: true,
            };
            state.status = "loading";
            if (command === "back") {
              guest.navigationHistory.goBack();
            } else if (command === "forward") {
              guest.navigationHistory.goForward();
            } else {
              guest.reload();
            }
          }
          this.#publish();
          return this.#sessionResult(state);
        }
        case "snapshot": {
          const snapshot = await cdp.snapshot(signal);
          state.generation = cdp.generation;
          state.snapshotRequired = false;
          return {
            ...this.#sessionResult(state),
            ...snapshot,
          };
        }
        case "find": {
          const findResult = await cdp.find(
            typeof parsed.payload.cursor === "string"
              ? { cursor: parsed.payload.cursor }
              : {
                  query:
                    parsed.payload.query as AgentBrowserFindQuery,
                  view:
                    parsed.payload.view as AgentBrowserFindView,
                  depth: Number(parsed.payload.depth),
                  limit: Number(parsed.payload.limit),
                },
            signal,
          );
          state.generation = cdp.generation;
          state.snapshotRequired = false;
          return {
            ...this.#sessionResult(state),
            ...findResult,
          };
        }
        case "locate": {
          const locateResult = await cdp.locateWithGeneratedCode(
            requiredString(parsed.payload, "code"),
            signal,
          );
          state.generation = cdp.generation;
          state.snapshotRequired = false;
          return {
            ...this.#sessionResult(state),
            ...locateResult,
          };
        }
        case "click": {
          const ref = await this.#resolveActionTarget(
            state,
            cdp,
            parseAgentBrowserTarget(parsed.payload.target),
            "click",
            signal,
          );
          await this.#clickRef(
            state,
            cdp,
            ref,
            signal,
          );
          return this.#sessionResult(state);
        }
        case "fill": {
          const ref = await this.#resolveActionTarget(
            state,
            cdp,
            parseAgentBrowserTarget(parsed.payload.target),
            "fill",
            signal,
          );
          await this.#fillRef(
            state,
            cdp,
            ref,
            requiredString(parsed.payload, "value"),
            signal,
          );
          return this.#sessionResult(state);
        }
        case "press": {
          const requestedTarget = parsed.payload.target === undefined
            ? undefined
            : parseAgentBrowserTarget(parsed.payload.target);
          const ref = requestedTarget === undefined
            ? undefined
            : await this.#resolveActionTarget(
              state,
              cdp,
              requestedTarget,
              "press",
              signal,
            );
          const pointerTarget = ref === undefined
            ? undefined
            : await this.#pointerTargetForProjection(
              state,
              cdp,
              ref,
              signal,
            );
          if (pointerTarget !== undefined) {
            const targetGeneration = cdp.generation;
            const travelDurationMs = cursorTravelDurationMs(
              state.cursor,
              pointerTarget,
            );
            this.#publishCursor(
              state,
              "moving",
              pointerTarget,
              travelDurationMs,
            );
            await waitForCursorTravel(
              travelDurationMs,
              signal,
            );
            if (cdp.generation === targetGeneration) {
              this.#publishCursor(
                state,
                "typing",
                pointerTarget,
                travelDurationMs,
              );
            }
          }
          await cdp.press(
            requiredString(parsed.payload, "key"),
            ref,
            signal,
          );
          return this.#sessionResult(state);
        }
        case "scroll": {
          const withinRef =
            typeof parsed.payload.withinRef === "string"
              ? parsed.payload.withinRef
              : undefined;
          if (withinRef !== undefined) {
            this.#requireFreshSnapshot(state);
          }
          const scroll = await cdp.scroll(
            requiredString(
              parsed.payload,
              "direction",
            ) as AgentBrowserScrollDirection,
            typeof parsed.payload.amount === "number"
              ? parsed.payload.amount
              : undefined,
            withinRef,
            signal,
          );
          state.generation = cdp.generation;
          return {
            ...this.#sessionResult(state),
            ...scroll,
          };
        }
        case "wait":
          await cdp.waitForText(
            requiredString(parsed.payload, "text"),
            requiredNumber(parsed.payload, "timeoutMs"),
            signal,
          );
          return this.#sessionResult(state);
        case "screenshot":
          return {
            ...this.#sessionResult(state),
            mimeType: "image/png",
            data: await cdp.screenshot(signal),
          };
        case "open":
        case "close":
          throw new AgentBrowserError(
            "bad_request",
            "Invalid Agent Browser operation state",
          );
      }
    });
  }

  async claimControl(
    ownerSessionId: string,
    sessionId: string,
    expectedControlRevision: number,
    signal: AbortSignal,
  ): Promise<AgentBrowserClaimControlResult> {
    this.#ensureAvailable();
    if (signal.aborted) throw abortError(signal);
    const state = this.#states.get(sessionId);
    if (
      state === undefined ||
      state.closing ||
      state.ownerSessionId !== ownerSessionId
    ) {
      throw new AgentBrowserError(
        "session_not_found",
        "Agent Browser session was not found",
      );
    }
    if (state.status === "crashed") {
      throw new AgentBrowserError(
        "target_gone",
        state.error ?? "Agent Browser target crashed",
      );
    }
    if (
      state.controlRevision !== expectedControlRevision &&
      (
        state.controlRevision <= expectedControlRevision ||
        state.owner !== "agent" ||
        state.humanTakeoverPending ||
        !state.snapshotRequired
      )
    ) {
      throw new AgentBrowserError(
        "control_superseded",
        "A newer human control intent superseded the automatic Agent Browser claim",
      );
    }
    let cancellation: Promise<void> | undefined;
    const retainHumanControl = (): void => {
      if (
        signal.reason instanceof AgentBrowserError &&
        (
          signal.reason.code === "owner_released" ||
          signal.reason.code === "channel_closed"
        )
      ) {
        // Teardown already revokes the complete owner/session lifetime. A
        // compensating human handoff here would publish a late control event
        // for a session that is being destroyed.
        return;
      }
      cancellation ??= this.setControl(
        sessionId,
        "human",
      ).then(
        () => {},
        () => {},
      );
    };
    signal.addEventListener("abort", retainHumanControl, {
      once: true,
    });
    if (signal.aborted) retainHumanControl();
    try {
      if (state.controlRevision === expectedControlRevision) {
        await this.setControl(
          sessionId,
          "agent",
          expectedControlRevision,
        );
      }
      if (signal.aborted) {
        await cancellation;
        throw abortError(signal);
      }
      const result = this.#sessionResult(state);
      if (
        result.owner !== "agent" ||
        result.snapshotRequired !== true
      ) {
        throw new AgentBrowserError(
          "control_superseded",
          "Agent Browser control changed before the automatic claim completed",
        );
      }
      return {
        ...result,
        owner: "agent",
        snapshotRequired: true,
        controlRevision: state.controlRevision,
      };
    } catch (error) {
      if (signal.aborted) {
        await cancellation;
        throw abortError(signal);
      }
      throw error;
    } finally {
      signal.removeEventListener("abort", retainHumanControl);
    }
  }

  async setControl(
    sessionId: string,
    owner: AgentBrowserOwner,
    expectedControlRevision?: number,
  ): Promise<AgentBrowserProjection> {
    this.#ensureAvailable();
    const state = this.#states.get(sessionId);
    if (state === undefined || state.closing) {
      throw new AgentBrowserError(
        "session_not_found",
        "Agent Browser session was not found",
      );
    }
    if (
      expectedControlRevision !== undefined &&
      state.controlRevision !== expectedControlRevision
    ) {
      throw new AgentBrowserError(
        "control_superseded",
        "Agent Browser control changed before the automatic claim was admitted",
      );
    }
    const controlRevision = state.controlRevision + 1;
    if (!Number.isSafeInteger(controlRevision)) {
      throw new AgentBrowserError(
        "control_revision_exhausted",
        "Agent Browser control revision space is exhausted",
      );
    }
    state.controlRevision = controlRevision;
    if (owner === "human") {
      // Close the admission gate synchronously. The transition is projected
      // only after already-admitted work reaches a terminal result.
      state.humanTakeoverPending = true;
      state.cdp?.interruptNavigationForHumanTakeover();
      if (this.#clearCursor(state)) this.#publish();
      for (const channel of this.#processChannels) {
        channel.publishControlChanged(
          state.ownerSessionId,
          state.sessionId,
          "human",
          controlRevision,
        );
      }
    }
    const transition = state.controlTail
      .catch(() => {})
      .then(async () => {
        if (owner === "human") {
          await state.operationTail.catch(() => {});
        }
        if (
          state.closing ||
          this.#states.get(sessionId) !== state
        ) {
          throw new AgentBrowserError(
            "session_not_found",
            "Agent Browser session was not found",
          );
        }
        if (state.controlRevision !== controlRevision) {
          throw new AgentBrowserError(
            "control_superseded",
            "A newer Agent Browser control intent superseded this transition",
          );
        }
        const controlEpochChanged =
          state.owner !== owner ||
          (
            owner === "agent" &&
            (
              state.humanTakeoverPending ||
              expectedControlRevision !== undefined
            )
          );
        if (controlEpochChanged) {
          if (owner === "agent") {
            await this.stopAnnotation(
              state.sessionId,
              state.annotation?.annotationSessionId,
              "control_changed",
            );
            if (state.controlRevision !== controlRevision) {
              throw new AgentBrowserError(
                "control_superseded",
                "A newer Agent Browser control intent superseded this transition",
              );
            }
          }
          this.#clearCursor(state);
          state.owner = owner;
          state.cdp?.invalidateReferences();
          state.generation =
            state.cdp?.generation ?? state.generation + 1;
          state.snapshotRequired = owner === "agent";
          if (state.status !== "crashed") {
            state.status =
              owner === "human"
                ? "paused"
                : state.cdp === undefined
                  ? "pending"
                  : "ready";
          }
          if (owner !== "human") {
            state.humanTakeoverPending = false;
            for (const channel of this.#processChannels) {
              channel.publishControlChanged(
                state.ownerSessionId,
                state.sessionId,
                owner,
                controlRevision,
              );
            }
          }
          this.#publish();
          if (
            owner === "agent" &&
            state.cdp !== undefined
          ) {
            void this.#publishCenteredCursor(state, state.cdp);
          }
        }
        if (owner === "human") {
          state.humanTakeoverPending = false;
        }
        return this.#projection(state);
      });
    state.controlTail = transition.then(
      () => {},
      () => {},
    );
    try {
      return await transition;
    } finally {
      if (
        owner === "human" &&
        state.owner !== "human" &&
        state.controlRevision === controlRevision
      ) {
        state.humanTakeoverPending = false;
      }
    }
  }

  async navigateForHuman(
    sessionId: string,
    command: AgentBrowserNavigationCommand,
  ): Promise<AgentBrowserProjection> {
    this.#ensureAvailable();
    const state = this.#states.get(sessionId);
    if (state === undefined || state.closing) {
      throw new AgentBrowserError(
        "session_not_found",
        "Agent Browser session was not found",
      );
    }
    const navigation = state.controlTail
      .catch(() => {})
      .then(() => {
        if (
          state.closing ||
          this.#states.get(sessionId) !== state
        ) {
          throw new AgentBrowserError(
            "session_not_found",
            "Agent Browser session was not found",
          );
        }
        if (
          state.owner !== "human" ||
          state.humanTakeoverPending
        ) {
          throw new AgentBrowserError(
            "navigation_requires_human_control",
            "Take control of the Agent Browser tab before using browser navigation",
          );
        }
        const guest = state.guest;
        if (guest === undefined || guest.isDestroyed()) {
          throw new AgentBrowserError(
            "target_gone",
            "Agent Browser target is unavailable",
          );
        }
        switch (command) {
          case "back":
            if (guest.navigationHistory.canGoBack()) {
              guest.navigationHistory.goBack();
            }
            break;
          case "forward":
            if (guest.navigationHistory.canGoForward()) {
              guest.navigationHistory.goForward();
            }
            break;
          case "reload":
            guest.reload();
            break;
          case "stop":
            guest.stop();
            break;
        }
        this.#syncNavigationState(state);
        this.#publish();
        return this.#projection(state);
      });
    state.controlTail = navigation.then(
      () => {},
      () => {},
    );
    return await navigation;
  }

  async startAnnotation(
    sessionId: string,
  ): Promise<AgentBrowserAnnotationSession> {
    this.#ensureAvailable();
    const state = this.#stateForAnnotation(sessionId);
    if (state.owner !== "human" || state.humanTakeoverPending) {
      throw new AgentBrowserError(
        "annotation_requires_human_control",
        "Take control of the Agent Browser tab before annotating it",
      );
    }
    if (state.annotation !== undefined) {
      await this.stopAnnotation(
        state.sessionId,
        state.annotation.annotationSessionId,
        "cancelled",
      );
    }
    const cdp = this.#activeCdp(state);
    const generation = cdp.generation;
    const viewport = await cdp.annotationViewport();
    if (generation !== cdp.generation) {
      throw new AgentBrowserError(
        "annotation_stale",
        "The page changed while annotation was starting",
      );
    }
    const annotation = {
      annotationSessionId:
        `annotation-${randomUUID().replaceAll("-", "")}`,
      generation,
      page: {
        url: annotationPageUrl(state.url),
        title: state.title ?? "",
        viewport,
      },
      active: true,
      ended: false,
      operationTail: Promise.resolve(),
    };
    state.annotation = annotation;
    try {
      await this.#enqueueAnnotationOperation(
        state,
        annotation,
        cdp,
        async () => {
          await cdp.startAnnotationPicker(
            async (target) => {
              if (
                state.closing ||
                state.annotation !== annotation ||
                !annotation.active ||
                cdp.generation !== annotation.generation
              ) {
                return;
              }
              annotation.page = {
                ...annotation.page,
                viewport: target.viewport,
              };
              this.#publishAnnotationEvent({
                type: "selected",
                sessionId: state.sessionId,
                annotationSessionId:
                  annotation.annotationSessionId,
                generation: annotation.generation,
                page: annotation.page,
                target,
              });
            },
            (reason, message) => {
              if (
                state.annotation !== annotation ||
                !annotation.active
              ) {
                return;
              }
              annotation.active = false;
              state.annotation = undefined;
              if (annotation.ended) return;
              annotation.ended = true;
              this.#publishAnnotationEvent({
                type: "ended",
                sessionId: state.sessionId,
                annotationSessionId:
                  annotation.annotationSessionId,
                generation: annotation.generation,
                reason:
                  reason === "navigation"
                    ? "navigation"
                    : "target_gone",
                ...(message === undefined ? {} : { message }),
              });
            },
          );
          this.#assertAnnotationAuthority(
            state,
            annotation,
            cdp,
          );
        },
      );
    } catch (error) {
      if (state.annotation === annotation) {
        annotation.active = false;
        annotation.ended = true;
        state.annotation = undefined;
      }
      throw asAgentBrowserError(
        error,
        "annotation_unavailable",
      );
    }
    return parseAgentBrowserAnnotationSession({
      sessionId: state.sessionId,
      annotationSessionId: annotation.annotationSessionId,
      generation: annotation.generation,
      page: annotation.page,
    });
  }

  async stopAnnotation(
    sessionId: string,
    annotationSessionId: string | undefined,
    reason:
      | "cancelled"
      | "control_changed"
      | "target_gone",
  ): Promise<void> {
    const state = this.#states.get(sessionId);
    const annotation = state?.annotation;
    if (
      state === undefined ||
      annotation === undefined ||
      (
        annotationSessionId !== undefined &&
        annotation.annotationSessionId !== annotationSessionId
      )
    ) {
      if (annotationSessionId !== undefined) {
        throw new AgentBrowserError(
          "annotation_not_found",
          "Agent Browser annotation session was not found",
        );
      }
      return;
    }
    if (!annotation.active) {
      if (annotation.stopPromise !== undefined) {
        await annotation.stopPromise;
        return;
      }
      throw new AgentBrowserError(
        "annotation_not_found",
        "Agent Browser annotation session was not found",
      );
    }
    annotation.active = false;
    const stop = (async () => {
      await annotation.operationTail.catch(() => {});
      try {
        await state.cdp?.stopAnnotationPicker();
      } finally {
        if (state.annotation === annotation) {
          state.annotation = undefined;
        }
        if (!annotation.ended) {
          annotation.ended = true;
          this.#publishAnnotationEvent({
            type: "ended",
            sessionId: state.sessionId,
            annotationSessionId:
              annotation.annotationSessionId,
            generation: annotation.generation,
            reason,
          });
        }
      }
    })();
    annotation.stopPromise = stop;
    await stop;
  }

  async refreshAnnotation(
    request: {
      readonly sessionId: string;
      readonly annotationSessionId: string;
      readonly targetIds: readonly string[];
    },
  ): Promise<AgentBrowserAnnotationRefreshResult> {
    const { state, annotation, cdp } =
      this.#annotationAuthority(request);
    return await this.#enqueueAnnotationOperation(
      state,
      annotation,
      cdp,
      async () => {
        const targets = await cdp.refreshAnnotationTargets(
          request.targetIds,
        );
        const viewport =
          targets[0]?.viewport ??
          await cdp.annotationViewport();
        this.#assertAnnotationAuthority(
          state,
          annotation,
          cdp,
        );
        annotation.page = {
          url: annotationPageUrl(state.url),
          title: state.title ?? "",
          viewport,
        };
        return parseAgentBrowserAnnotationRefreshResult({
          sessionId: state.sessionId,
          annotationSessionId:
            annotation.annotationSessionId,
          generation: annotation.generation,
          page: annotation.page,
          targets,
        });
      },
    );
  }

  async commitAnnotation(
    request: {
      readonly sessionId: string;
      readonly annotationSessionId: string;
      readonly targetIds: readonly string[];
    },
  ) {
    const { state, annotation, cdp } =
      this.#annotationAuthority(request);
    return await this.#enqueueAnnotationOperation(
      state,
      annotation,
      cdp,
      async () => {
        const captured = await cdp.captureAnnotationTargets(
          request.targetIds,
        );
        const viewport =
          captured.targets[0]?.viewport ??
          await cdp.annotationViewport();
        this.#assertAnnotationAuthority(
          state,
          annotation,
          cdp,
        );
        annotation.page = {
          url: annotationPageUrl(state.url),
          title: state.title ?? "",
          viewport,
        };
        return parseAgentBrowserAnnotationCommitResult({
          sessionId: state.sessionId,
          annotationSessionId:
            annotation.annotationSessionId,
          generation: annotation.generation,
          page: annotation.page,
          targets: captured.targets,
          mimeType: "image/png",
          data: captured.data,
        });
      },
    );
  }

  async closeSession(sessionId: string): Promise<void> {
    const state = this.#states.get(sessionId);
    if (state === undefined) return;
    this.#states.delete(sessionId);
    await this.#releaseState(state, true);
    this.#publish();
  }

  async closeOwner(ownerSessionId: string): Promise<void> {
    const owned = [...this.#states.values()].filter(
      (state) => state.ownerSessionId === ownerSessionId,
    );
    await Promise.all(
      owned.map(async (state) => {
        await this.closeSession(state.sessionId);
      }),
    );
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#windowBindingDisposer?.();
    this.#windowBindingDisposer = undefined;
    for (const channel of this.#processChannels) {
      channel.dispose();
    }
    this.#processChannels.clear();
    for (const state of this.#states.values()) {
      void this.#releaseState(state, true);
    }
    this.#states.clear();
    this.#windowBinding = undefined;
    this.#history?.close();
  }

  async #open(
    ownerSessionId: string,
    url: string,
    signal: AbortSignal,
  ): Promise<AgentBrowserSessionResult> {
    if (this.#states.size >= MAX_AGENT_BROWSER_SESSIONS) {
      throw new AgentBrowserError(
        "session_limit",
        "Agent Browser session limit reached",
      );
    }
    const token = this.#uniqueToken();
    const sessionId = `agent-${token}`;
    const partition = `${AGENT_PARTITION_PREFIX}${token}`;
    this.#issuedPartitions.add(partition);
    const browserSession = this.#options.sessionFromPartition(
      partition,
      { cache: false },
    );
    if (this.#userAgent !== undefined) {
      browserSession.setUserAgent(this.#userAgent);
    }
    this.#agentSessions.add(browserSession);
    if (
      browserSession.isPersistent() ||
      browserSession.getStoragePath() !== null
    ) {
      throw new AgentBrowserError(
        "persistent_partition",
        "Agent Browser requires an in-memory partition",
      );
    }

    const handleDownload = (event: ElectronEvent): void => {
      event.preventDefault();
    };
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    );
    browserSession.setSpellCheckerEnabled(false);
    browserSession.on("will-download", handleDownload);

    const state: AgentBrowserSessionState = {
      sessionId,
      ownerSessionId,
      partition,
      session: browserSession,
      attachment: attachmentDeferred(),
      handleDownload,
      owner: "agent",
      status: "pending",
      generation: 1,
      attachmentClaimed: false,
      operationTail: Promise.resolve(),
      controlTail: Promise.resolve(),
      controlRevision: 0,
      humanTakeoverPending: false,
      closing: false,
      cursorSequence: 0,
      snapshotRequired: false,
      navigation: {
        loading: false,
        canGoBack: false,
        canGoForward: false,
      },
    };
    this.#states.set(sessionId, state);
    this.#publish();

    const initialize = (async () => {
      await waitForPromise(
        state.attachment.promise,
        this.#attachTimeoutMs,
        signal,
        () => new AgentBrowserError(
          "tab_attach_timeout",
          `Agent Browser tab did not attach within ${String(this.#attachTimeoutMs)} ms`,
        ),
      );
      const cdp = this.#activeCdp(state);
      state.status = "loading";
      state.url = url;
      this.#publish();
      await cdp.navigate(url, signal);
      state.status = "ready";
      delete state.error;
      if (
        !await this.#publishCenteredCursor(
          state,
          cdp,
          signal,
        )
      ) {
        this.#publish();
      }
      return this.#sessionResult(state);
    })();
    state.operationTail = initialize.then(
      () => {},
      () => {},
    );
    try {
      return await initialize;
    } catch (error) {
      const browserError = asAgentBrowserError(error);
      if (
        browserError.code === "session_paused" &&
        !state.closing &&
        this.#states.get(sessionId) === state &&
        (
          state.owner === "human" ||
          state.humanTakeoverPending
        )
      ) {
        throw browserError;
      }
      await this.closeSession(sessionId);
      throw browserError;
    }
  }

  #stateForAgent(
    sessionId: string,
    ownerSessionId: string,
  ): AgentBrowserSessionState {
    const state = this.#states.get(sessionId);
    if (
      state === undefined ||
      state.closing ||
      state.ownerSessionId !== ownerSessionId
    ) {
      throw new AgentBrowserError(
        "session_not_found",
        "Agent Browser session was not found",
      );
    }
    if (
      state.owner !== "agent" ||
      state.humanTakeoverPending
    ) {
      throw new AgentBrowserError(
        "session_paused",
        "Agent Browser session is under human control",
      );
    }
    if (state.status === "crashed") {
      throw new AgentBrowserError(
        "target_gone",
        state.error ?? "Agent Browser target crashed",
      );
    }
    return state;
  }

  #stateForAnnotation(
    sessionId: string,
  ): AgentBrowserSessionState {
    const state = this.#states.get(sessionId);
    if (
      state === undefined ||
      state.closing ||
      state.status === "crashed"
    ) {
      throw new AgentBrowserError(
        "session_not_found",
        "Agent Browser session was not found",
      );
    }
    return state;
  }

  #annotationAuthority(request: {
    readonly sessionId: string;
    readonly annotationSessionId: string;
  }): {
    readonly state: AgentBrowserSessionState;
    readonly annotation: NonNullable<
      AgentBrowserSessionState["annotation"]
    >;
    readonly cdp: AgentBrowserCdp;
  } {
    const state = this.#stateForAnnotation(request.sessionId);
    const annotation = state.annotation;
    const cdp = this.#activeCdp(state);
    if (
      state.owner !== "human" ||
      annotation === undefined ||
      !annotation.active ||
      annotation.annotationSessionId !==
        request.annotationSessionId ||
      annotation.generation !== cdp.generation
    ) {
      throw new AgentBrowserError(
        "annotation_not_found",
        "Agent Browser annotation session is stale or unavailable",
      );
    }
    return { state, annotation, cdp };
  }

  #assertAnnotationAuthority(
    state: AgentBrowserSessionState,
    annotation: NonNullable<
      AgentBrowserSessionState["annotation"]
    >,
    cdp: AgentBrowserCdp,
  ): void {
    if (
      state.closing ||
      this.#states.get(state.sessionId) !== state ||
      state.annotation !== annotation ||
      !annotation.active ||
      state.owner !== "human" ||
      cdp.generation !== annotation.generation
    ) {
      throw new AgentBrowserError(
        "annotation_stale",
        "The page changed while browser annotations were being committed",
      );
    }
  }

  async #enqueueAnnotationOperation<T>(
    state: AgentBrowserSessionState,
    annotation: AgentBrowserAnnotationState,
    cdp: AgentBrowserCdp,
    operation: () => Promise<T>,
  ): Promise<T> {
    const queued = annotation.operationTail
      .catch(() => {})
      .then(async () => {
        this.#assertAnnotationAuthority(
          state,
          annotation,
          cdp,
        );
        return await operation();
      });
    annotation.operationTail = queued.then(
      () => {},
      () => {},
    );
    return await queued;
  }

  #activeCdp(state: AgentBrowserSessionState): AgentBrowserCdp {
    if (
      state.closing ||
      state.cdp === undefined ||
      state.guest?.isDestroyed() !== false
    ) {
      throw new AgentBrowserError(
        "target_gone",
        "Agent Browser target is unavailable",
      );
    }
    return state.cdp;
  }

  async #enqueue<T>(
    state: AgentBrowserSessionState,
    signal: AbortSignal,
    operation: () => Promise<T>,
  ): Promise<T> {
    const queued = state.operationTail
      .catch(() => {})
      .then(async () => {
        if (signal.aborted) throw abortError(signal);
        if (
          state.closing ||
          this.#states.get(state.sessionId) !== state
        ) {
          throw new AgentBrowserError(
            "target_gone",
            "Agent Browser target is unavailable",
          );
        }
        if (
          state.owner !== "agent" ||
          state.humanTakeoverPending
        ) {
          throw new AgentBrowserError(
            "session_paused",
            "Agent Browser session is under human control",
          );
        }
        return await operation();
      });
    state.operationTail = queued.then(
      () => {},
      () => {},
    );
    return await queued;
  }

  async #activateGuest(
    state: AgentBrowserSessionState,
    guest: WebContents,
  ): Promise<void> {
    const cdp = new AgentBrowserCdp(guest.debugger, {
      commandTimeoutMs: this.#cdpTimeoutMs,
      onGenerationChange: (generation, reason) => {
        if (state.closing) return;
        state.generation = generation;
        if (state.owner === "agent") {
          state.snapshotRequired = true;
        }
        if (reason === "document") {
          this.#clearCursor(state);
        }
        this.#publish();
      },
      onReferencesDirty: (reason) => {
        if (state.closing) return;
        state.snapshotRequired = true;
        if (reason === "document" && this.#clearCursor(state)) {
          this.#publish();
        }
      },
      onDetach: (reason) => {
        this.#crash(state, `Debugger detached: ${reason}`);
      },
    });
    state.cdp = cdp;
    try {
      await cdp.attach();
      if (
        state.closing ||
        this.#states.get(state.sessionId) !== state ||
        guest.isDestroyed()
      ) {
        throw new AgentBrowserError(
          "target_gone",
          "Agent Browser guest closed while attaching",
        );
      }
      state.generation = cdp.generation;
      state.snapshotRequired = false;
      state.status =
        state.owner === "human" ? "paused" : "ready";
      state.attachment.resolve();
      this.#publish();
    } catch (error) {
      const browserError = asAgentBrowserError(
        error,
        "debugger_attach_failed",
      );
      state.attachment.reject(browserError);
      this.#crash(state, browserError.message);
    }
  }

  #protectGuest(
    state: AgentBrowserSessionState,
    guest: WebContents,
  ): void {
    guest.setWindowOpenHandler(() => ({ action: "deny" }));

    const handleWillNavigate = (
      details: ElectronEvent<WebContentsWillNavigateEventParams>,
    ): void => {
      if (
        details.isMainFrame &&
        !isSafeGuestUrl(details.url)
      ) {
        details.preventDefault();
      }
    };
    const handleWillRedirect = (
      details: ElectronEvent<WebContentsWillRedirectEventParams>,
    ): void => {
      if (
        details.isMainFrame &&
        !isSafeGuestUrl(details.url)
      ) {
        details.preventDefault();
      }
    };
    const handleLogin = (
      event: ElectronEvent,
      _details: Electron.AuthenticationResponseDetails,
      _authInfo: Electron.AuthInfo,
      callback: (username?: string, password?: string) => void,
    ): void => {
      event.preventDefault();
      callback();
    };
    const handleDidNavigate = (
      _event: ElectronEvent,
      navigatedUrl: string,
    ): void => {
      if (!isSafeGuestUrl(navigatedUrl)) return;
      this.#clearCursor(state);
      if (navigatedUrl !== INITIAL_GUEST_URL) {
        state.url = normalizeAgentBrowserUrl(navigatedUrl);
        this.#recordHistoryVisit(
          state,
          navigatedUrl,
          "document",
        );
      }
      delete state.error;
      this.#syncNavigationState(state);
      this.#publish();
    };
    const handleDidNavigateInPage = (
      _event: ElectronEvent,
      navigatedUrl: string,
      isMainFrame: boolean,
    ): void => {
      if (!isMainFrame || !isSafeGuestUrl(navigatedUrl)) return;
      this.#clearCursor(state);
      if (navigatedUrl !== INITIAL_GUEST_URL) {
        state.url = normalizeAgentBrowserUrl(navigatedUrl);
        this.#recordHistoryVisit(
          state,
          navigatedUrl,
          "same-document",
        );
      }
      delete state.error;
      this.#syncNavigationState(state);
      this.#publish();
    };
    const handleTitle = (
      _event: ElectronEvent,
      title: string,
    ): void => {
      const bounded = title.slice(0, 160);
      if (bounded === "") delete state.title;
      else {
        state.title = bounded;
        const visitId = state.historyVisitId;
        if (visitId !== undefined) {
          this.#writeHistoryVisitTitle(visitId, bounded);
        }
      }
      this.#publish();
    };
    const handleFavicon = (
      _event: ElectronEvent,
      favicons: string[],
    ): void => {
      const visitId = state.historyVisitId;
      const pageUrl = state.url;
      if (visitId === undefined || pageUrl === undefined) return;
      let currentUrl: string;
      try {
        currentUrl = normalizeAgentBrowserUrl(guest.getURL());
      } catch {
        return;
      }
      if (currentUrl !== pageUrl) return;
      const faviconUrl = favicons
        .map((candidate) =>
          normalizeAgentBrowserHistoryFaviconUrl(
            candidate,
            pageUrl,
          ))
        .find((candidate) => candidate !== undefined);
      if (faviconUrl === undefined) return;
      this.#writeHistoryVisitFavicon(
        visitId,
        pageUrl,
        faviconUrl,
      );
    };
    const handleDidStartNavigation = (
      details: ElectronEvent<
        WebContentsDidStartNavigationEventParams
      >,
    ): void => {
      if (
        !details.isMainFrame ||
        isInitialGuestUrl(details.url) ||
        !isSafeGuestUrl(details.url)
      ) {
        return;
      }
      state.pendingHistoryVisit = {
        actor: state.owner,
        navigationKind: details.isSameDocument
          ? "same-document"
          : "document",
      };
    };
    const handleStartLoading = (): void => {
      if (state.status === "crashed") return;
      this.#clearCursor(state);
      state.navigation = {
        ...state.navigation,
        loading: true,
      };
      if (state.owner === "agent") state.status = "loading";
      this.#publish();
    };
    const handleStopLoading = (): void => {
      if (state.status !== "crashed") {
        this.#syncNavigationState(state, false);
        state.status =
          state.owner === "human" ? "paused" : "ready";
        this.#publish();
        if (
          state.owner === "agent" &&
          state.cdp !== undefined
        ) {
          void this.#publishCenteredCursor(state, state.cdp);
        }
      }
    };
    const handleFailLoad = (
      _event: ElectronEvent,
      errorCode: number,
      errorDescription: string,
      _validatedUrl: string,
      isMainFrame: boolean,
    ): void => {
      if (!isMainFrame) return;
      state.pendingHistoryVisit = undefined;
      if (errorCode === -3) return;
      state.error =
        (errorDescription || `Navigation failed (${String(errorCode)})`)
          .slice(0, 2_048);
      this.#syncNavigationState(state, false);
      if (state.owner === "agent") state.status = "ready";
      this.#publish();
      if (
        state.owner === "agent" &&
        state.cdp !== undefined
      ) {
        void this.#publishCenteredCursor(state, state.cdp);
      }
    };
    const handleDestroyed = (): void => {
      this.#crash(state, "Agent Browser guest was destroyed");
    };
    const handleRenderGone = (
      _event: ElectronEvent,
      details: Electron.RenderProcessGoneDetails,
    ): void => {
      this.#crash(
        state,
        `Agent Browser renderer exited: ${details.reason}`,
      );
    };
    const handleUnresponsive = (): void => {
      this.#crash(state, "Agent Browser guest became unresponsive");
    };

    guest.on("will-navigate", handleWillNavigate);
    guest.on("will-redirect", handleWillRedirect);
    guest.on("did-start-navigation", handleDidStartNavigation);
    guest.on("login", handleLogin);
    guest.on("did-navigate", handleDidNavigate);
    guest.on("did-navigate-in-page", handleDidNavigateInPage);
    guest.on("page-title-updated", handleTitle);
    guest.on("page-favicon-updated", handleFavicon);
    guest.on("did-start-loading", handleStartLoading);
    guest.on("did-stop-loading", handleStopLoading);
    guest.on("did-fail-load", handleFailLoad);
    guest.on("destroyed", handleDestroyed);
    guest.on("render-process-gone", handleRenderGone);
    guest.on("unresponsive", handleUnresponsive);
    state.removeGuestListeners = () => {
      guest.off("will-navigate", handleWillNavigate);
      guest.off("will-redirect", handleWillRedirect);
      guest.off("did-start-navigation", handleDidStartNavigation);
      guest.off("login", handleLogin);
      guest.off("did-navigate", handleDidNavigate);
      guest.off("did-navigate-in-page", handleDidNavigateInPage);
      guest.off("page-title-updated", handleTitle);
      guest.off("page-favicon-updated", handleFavicon);
      guest.off("did-start-loading", handleStartLoading);
      guest.off("did-stop-loading", handleStopLoading);
      guest.off("did-fail-load", handleFailLoad);
      guest.off("destroyed", handleDestroyed);
      guest.off("render-process-gone", handleRenderGone);
      guest.off("unresponsive", handleUnresponsive);
    };
  }

  #rejectGuest(
    state: AgentBrowserSessionState,
    guest: WebContents,
    reason: string,
  ): void {
    try {
      guest.close({ waitForBeforeUnload: false });
    } catch {
      // Invalid guest may already be gone.
    }
    this.#crash(state, reason, "guest_rejected");
  }

  #crash(
    state: AgentBrowserSessionState,
    reason: string,
    code = "target_gone",
  ): void {
    if (
      state.closing ||
      this.#states.get(state.sessionId) !== state
    ) {
      return;
    }
    if (state.status === "crashed") return;
    this.#clearCursor(state);
    state.status = "crashed";
    state.navigation = {
      ...state.navigation,
      loading: false,
    };
    state.error = (reason || "Agent Browser target crashed")
      .slice(0, 2_048);
    state.attachment.reject(
      new AgentBrowserError(code, state.error),
    );
    state.cdp?.dispose();
    if (
      state.guest !== undefined &&
      !state.guest.isDestroyed()
    ) {
      try {
        state.guest.close({ waitForBeforeUnload: false });
      } catch {
        // A crashed guest may already be tearing itself down.
      }
    }
    this.#publish();
  }

  async #releaseState(
    state: AgentBrowserSessionState,
    closeGuest: boolean,
  ): Promise<void> {
    if (state.closing) return;
    state.closing = true;
    this.#clearCursor(state);
    if (state.annotation !== undefined) {
      const annotation = state.annotation;
      annotation.active = false;
      state.annotation = undefined;
      if (!annotation.ended) {
        annotation.ended = true;
        this.#publishAnnotationEvent({
          type: "ended",
          sessionId: state.sessionId,
          annotationSessionId:
            annotation.annotationSessionId,
          generation: annotation.generation,
          reason: "target_gone",
        });
      }
    }
    state.attachment.reject(
      new AgentBrowserError(
        "target_gone",
        "Agent Browser session closed",
      ),
    );
    state.removeGuestListeners?.();
    state.removeGuestListeners = undefined;
    state.cdp?.dispose();
    state.cdp = undefined;
    if (
      closeGuest &&
      state.guest !== undefined &&
      !state.guest.isDestroyed()
    ) {
      try {
        state.guest.close({ waitForBeforeUnload: false });
      } catch {
        // Guest teardown remains best-effort.
      }
    }
    state.guest = undefined;
    state.session.off(
      "will-download",
      state.handleDownload,
    );
    state.session.setPermissionCheckHandler(null);
    state.session.setPermissionRequestHandler(null);
    await Promise.allSettled([
      state.session.closeAllConnections(),
      state.session.clearStorageData(),
    ]);
  }

  #sessionResult(
    state: AgentBrowserSessionState,
  ): AgentBrowserSessionResult {
    const projection = this.#projection(state);
    return {
      sessionId: projection.sessionId,
      generation: projection.generation,
      owner: projection.owner,
      status: projection.status,
      snapshotRequired: state.snapshotRequired,
      ...(projection.url === undefined
        ? {}
        : { url: projection.url }),
      ...(projection.title === undefined
        ? {}
        : { title: projection.title }),
    };
  }

  #recordHistoryVisit(
    state: AgentBrowserSessionState,
    url: string,
    navigationKind: AgentBrowserNavigationKind,
  ): void {
    const history = this.#history;
    if (history === undefined) {
      state.pendingHistoryVisit = undefined;
      return;
    }
    const pending = state.pendingHistoryVisit;
    state.pendingHistoryVisit = undefined;
    const visitActor =
      pending?.navigationKind === navigationKind
        ? pending.actor
        : state.owner;
    state.historyVisitId = this.#writeHistoryVisit({
      sessionId: state.sessionId,
      url,
      ...(navigationKind === "same-document" &&
          state.title !== undefined
        ? { title: state.title }
        : {}),
      actor: visitActor,
      navigationKind,
      visitedAt: Date.now(),
    });
  }

  #writeHistoryVisit(
    visit: Parameters<AgentBrowserHistoryPort["recordVisit"]>[0],
  ): number | undefined {
    const history = this.#history;
    if (history === undefined) return undefined;
    try {
      return history.recordVisit(visit);
    } catch (error) {
      if (this.#historyWriteFailureReported) return;
      this.#historyWriteFailureReported = true;
      console.warn(
        "Minke could not record browsing history:",
        error instanceof Error ? error.message : String(error),
      );
      return undefined;
    }
  }

  #writeHistoryVisitTitle(visitId: number, title: string): void {
    const history = this.#history;
    if (history === undefined) return;
    try {
      history.updateVisitTitle(visitId, title);
    } catch (error) {
      if (this.#historyWriteFailureReported) return;
      this.#historyWriteFailureReported = true;
      console.warn(
        "Minke could not update browsing history title:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  #writeHistoryVisitFavicon(
    visitId: number,
    pageUrl: string,
    faviconUrl: string,
  ): void {
    const history = this.#history;
    if (history === undefined) return;
    try {
      history.updateVisitFavicon(
        visitId,
        pageUrl,
        faviconUrl,
      );
    } catch (error) {
      if (this.#historyWriteFailureReported) return;
      this.#historyWriteFailureReported = true;
      console.warn(
        "Minke could not update browsing history favicon:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async #resolveActionTarget(
    state: AgentBrowserSessionState,
    cdp: AgentBrowserCdp,
    target: AgentBrowserTarget,
    action: AgentBrowserTargetAction,
    signal: AbortSignal,
  ): Promise<string> {
    if ("ref" in target) {
      this.#requireFreshSnapshot(state);
      return target.ref;
    }
    const resolved = await cdp.resolveSemanticTarget(
      target,
      action,
      signal,
    );
    state.generation = cdp.generation;
    state.snapshotRequired = false;
    return resolved.ref;
  }

  #requireFreshSnapshot(state: AgentBrowserSessionState): void {
    if (!state.snapshotRequired) return;
    throw new AgentBrowserError(
      "snapshot_required",
      "The page or control authority changed since the last observation. "
        + "Call browser_snapshot before another element action.",
    );
  }

  #syncNavigationState(
    state: AgentBrowserSessionState,
    loading = state.navigation.loading,
  ): void {
    const guest = state.guest;
    let canGoBack = false;
    let canGoForward = false;
    if (guest !== undefined && !guest.isDestroyed()) {
      try {
        canGoBack = guest.navigationHistory.canGoBack();
        canGoForward = guest.navigationHistory.canGoForward();
      } catch {
        // Chromium may be tearing down the navigation controller.
      }
    }
    state.navigation = {
      loading,
      canGoBack,
      canGoForward,
    };
  }

  async #clickRef(
    state: AgentBrowserSessionState,
    cdp: AgentBrowserCdp,
    ref: string,
    signal: AbortSignal,
  ): Promise<void> {
    let travelDurationMs = CURSOR_FALLBACK_TRAVEL_DURATION_MS;
    const cursorHooks = this.#canProjectCursor(state)
      ? {
        beforeDispatch: async (
          pointerTarget: AgentBrowserCdpPointerTarget,
        ): Promise<void> => {
          travelDurationMs = cursorTravelDurationMs(
            state.cursor,
            pointerTarget,
          );
          this.#publishCursor(
            state,
            "moving",
            pointerTarget,
            travelDurationMs,
          );
          await waitForCursorTravel(
            travelDurationMs,
            signal,
          );
        },
        beforePress: async (
          pointerTarget: AgentBrowserCdpPointerTarget,
        ): Promise<void> => {
          this.#publishCursor(
            state,
            "clicking",
            pointerTarget,
            travelDurationMs,
          );
          await waitForCursorTravel(
            CURSOR_CLICK_FEEDBACK_HOLD_MS,
            signal,
          );
        },
      }
      : undefined;
    await cdp.click(ref, signal, cursorHooks);
  }

  async #fillRef(
    state: AgentBrowserSessionState,
    cdp: AgentBrowserCdp,
    ref: string,
    value: string,
    signal: AbortSignal,
  ): Promise<void> {
    const target = await this.#pointerTargetForProjection(
      state,
      cdp,
      ref,
      signal,
    );
    if (target !== undefined) {
      const targetGeneration = cdp.generation;
      const travelDurationMs = cursorTravelDurationMs(
        state.cursor,
        target,
      );
      this.#publishCursor(
        state,
        "moving",
        target,
        travelDurationMs,
      );
      await waitForCursorTravel(
        travelDurationMs,
        signal,
      );
      if (cdp.generation === targetGeneration) {
        this.#publishCursor(
          state,
          "typing",
          target,
          travelDurationMs,
        );
      }
    }
    await cdp.fill(ref, value, signal);
  }

  async #pointerTargetForProjection(
    state: AgentBrowserSessionState,
    cdp: AgentBrowserCdp,
    ref: string,
    signal: AbortSignal,
  ): Promise<AgentBrowserCdpPointerTarget | undefined> {
    if (!this.#canProjectCursor(state)) return undefined;
    return await cdp.pointerTarget(ref, signal);
  }

  async #publishCenteredCursor(
    state: AgentBrowserSessionState,
    cdp: AgentBrowserCdp,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (!this.#canProjectCursor(state)) return false;
    const generation = state.generation;
    const cursorSequence = state.cursorSequence;
    let viewport: AgentBrowserCdpPointerTarget["viewport"];
    try {
      viewport = await cdp.annotationViewport(signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      return false;
    }
    if (
      state.cdp !== cdp ||
      state.generation !== generation ||
      state.cursorSequence !== cursorSequence ||
      !this.#canProjectCursor(state)
    ) {
      return false;
    }
    this.#publishCursor(
      state,
      "idle",
      {
        point: {
          x: viewport.width / 2,
          y: viewport.height / 2,
        },
        viewport,
      },
      CURSOR_INITIAL_DURATION_MS,
    );
    return state.cursorSequence !== cursorSequence;
  }

  #canProjectCursor(state: AgentBrowserSessionState): boolean {
    const binding = this.#windowBinding;
    return (
      binding !== undefined &&
      !binding.embedder.isDestroyed() &&
      !state.closing &&
      state.owner === "agent" &&
      !state.humanTakeoverPending &&
      state.status === "ready"
    );
  }

  #publishCursor(
    state: AgentBrowserSessionState,
    phase: AgentBrowserCursorPhase,
    target: AgentBrowserCdpPointerTarget,
    durationMs: number,
  ): void {
    if (
      !this.#canProjectCursor(state) ||
      state.cursorSequence >= Number.MAX_SAFE_INTEGER
    ) {
      return;
    }
    state.cursorSequence += 1;
    state.cursor = {
      sequence: state.cursorSequence,
      phase,
      point: {
        x: target.point.x,
        y: target.point.y,
      },
      viewport: {
        width: target.viewport.width,
        height: target.viewport.height,
      },
      durationMs,
    };
    this.#publish();
  }

  #clearCursor(state: AgentBrowserSessionState): boolean {
    if (state.cursor === undefined) return false;
    delete state.cursor;
    return true;
  }

  #projection(
    state: AgentBrowserSessionState,
  ): AgentBrowserProjection {
    return parseAgentBrowserProjection({
      sessionId: state.sessionId,
      partition: state.partition,
      generation: state.generation,
      owner: state.owner,
      status: state.status,
      navigation: state.navigation,
      ...(state.url === undefined ? {} : { url: state.url }),
      ...(state.title === undefined ? {} : { title: state.title }),
      ...(state.error === undefined ? {} : { error: state.error }),
      ...(state.cursor === undefined
        ? {}
        : { cursor: state.cursor }),
    });
  }

  #publish(): void {
    const binding = this.#windowBinding;
    if (
      binding === undefined ||
      binding.embedder.isDestroyed()
    ) {
      return;
    }
    binding.embedder.send(
      AGENT_BROWSER_SESSIONS_CHANGED_CHANNEL,
      this.projections(),
    );
  }

  #publishAnnotationEvent(
    value: AgentBrowserAnnotationEvent,
  ): void {
    const binding = this.#windowBinding;
    if (
      binding === undefined ||
      binding.embedder.isDestroyed()
    ) {
      return;
    }
    binding.embedder.send(
      AGENT_BROWSER_ANNOTATION_EVENT_CHANNEL,
      parseAgentBrowserAnnotationEvent(value),
    );
  }

  #uniqueToken(): string {
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const token = (
        this.#options.createToken?.() ??
        randomUUID().replaceAll("-", "")
      );
      if (!/^[a-zA-Z0-9]+$/u.test(token)) {
        throw new TypeError(
          "Agent Browser token must be alphanumeric",
        );
      }
      if (
        !this.#states.has(`agent-${token}`) &&
        !this.#issuedPartitions.has(
          `${AGENT_PARTITION_PREFIX}${token}`,
        )
      ) {
        return token;
      }
    }
    throw new AgentBrowserError(
      "session_id_collision",
      "Could not allocate a unique Agent Browser session",
    );
  }

  #ensureAvailable(): void {
    if (this.#disposed) {
      throw new AgentBrowserError(
        "runtime_closed",
        "Agent Browser runtime is closed",
      );
    }
  }
}
