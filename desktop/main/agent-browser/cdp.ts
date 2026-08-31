import type {
  AgentBrowserCursorPoint,
  AgentBrowserCursorViewport,
  AgentBrowserSnapshotNode,
} from "@minke/harness-overlay/agent-browser-contract.ts";
import type {
  AgentBrowserAnnotationTarget,
  AgentBrowserAnnotationViewport,
} from "@minke/harness-overlay/agent-browser-annotation-contract.ts";

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const MAX_SNAPSHOT_NODES = 300;
const MAX_SCREENSHOT_BASE64_LENGTH = 8 * 1024 * 1024;
const ANNOTATION_HIGHLIGHT_CONFIG = Object.freeze({
  showInfo: false,
  showStyles: false,
  showAccessibilityInfo: false,
  contentColor: Object.freeze({
    r: 93,
    g: 132,
    b: 255,
    a: 0.12,
  }),
  borderColor: Object.freeze({
    r: 93,
    g: 132,
    b: 255,
    a: 1,
  }),
});
const MAX_ANNOTATION_TARGETS = 32;
const MAX_ANNOTATION_REFERENCES = 1_024;
const MIN_POINTER_VISIBLE_AREA = 1;

type AgentBrowserOutcome = "known" | "unknown";

interface CdpDebuggerPort {
  attach(protocolVersion?: string): void;
  detach(): void;
  isAttached(): boolean;
  sendCommand(
    method: string,
    commandParams?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<unknown>;
  on(
    event: "message" | "detach",
    listener: (...args: unknown[]) => void,
  ): unknown;
  off(
    event: "message" | "detach",
    listener: (...args: unknown[]) => void,
  ): unknown;
}

export interface AgentBrowserCdpOptions {
  readonly commandTimeoutMs?: number;
  readonly onGenerationChange?: (
    generation: number,
    reason: AgentBrowserGenerationChangeReason,
  ) => void;
  readonly onDetach?: (reason: string) => void;
}

export type AgentBrowserGenerationChangeReason =
  | "references"
  | "document";

export interface AgentBrowserCdpPointerTarget {
  readonly point: AgentBrowserCursorPoint;
  readonly viewport: AgentBrowserCursorViewport;
}

export interface AgentBrowserCdpClickHooks {
  readonly beforeDispatch?: (
    target: AgentBrowserCdpPointerTarget,
  ) => void | Promise<void>;
  readonly beforePress?: (
    target: AgentBrowserCdpPointerTarget,
  ) => void | Promise<void>;
}

interface AxValue {
  readonly value?: unknown;
}

interface AxNode {
  readonly backendDOMNodeId?: unknown;
  readonly ignored?: unknown;
  readonly role?: AxValue;
  readonly name?: AxValue;
  readonly description?: AxValue;
}

interface DomNode {
  readonly backendNodeId?: unknown;
  readonly localName?: unknown;
  readonly nodeName?: unknown;
  readonly attributes?: unknown;
}

interface AnnotationDomMetadata {
  readonly topDocument?: unknown;
  readonly tag?: unknown;
  readonly text?: unknown;
  readonly ariaLabel?: unknown;
  readonly role?: unknown;
  readonly selector?: unknown;
  readonly path?: unknown;
  readonly viewportWidth?: unknown;
  readonly viewportHeight?: unknown;
}

interface SnapshotReference {
  readonly backendNodeId: number;
}

interface ResolvedReference extends SnapshotReference {
  readonly generation: number;
}

interface AnnotationReference extends SnapshotReference {
  readonly generation: number;
}

export type AgentBrowserAnnotationEndReason =
  | "navigation"
  | "target_gone";

export type AgentBrowserAnnotationTargetCallback = (
  target: AgentBrowserAnnotationTarget,
) => void | Promise<void>;

export type AgentBrowserAnnotationEndedCallback = (
  reason: AgentBrowserAnnotationEndReason,
  message?: string,
) => void;

interface AnnotationPicker {
  readonly generation: number;
  readonly onTarget: AgentBrowserAnnotationTargetCallback;
  readonly onEnded:
    | AgentBrowserAnnotationEndedCallback
    | undefined;
}

interface NavigationEvent {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

interface NavigationObservation {
  readonly events: NavigationEvent[];
  readonly listeners: Set<() => void>;
  failure?: AgentBrowserError;
}

interface KeyDescription {
  readonly key: string;
  readonly code: string;
  readonly windowsVirtualKeyCode: number;
  readonly text?: string;
}

const KEY_DESCRIPTIONS = new Map<string, KeyDescription>([
  ["Enter", {
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    text: "\r",
  }],
  ["Tab", {
    key: "Tab",
    code: "Tab",
    windowsVirtualKeyCode: 9,
  }],
  ["Escape", {
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  }],
  ["Backspace", {
    key: "Backspace",
    code: "Backspace",
    windowsVirtualKeyCode: 8,
  }],
  ["Delete", {
    key: "Delete",
    code: "Delete",
    windowsVirtualKeyCode: 46,
  }],
  ["ArrowLeft", {
    key: "ArrowLeft",
    code: "ArrowLeft",
    windowsVirtualKeyCode: 37,
  }],
  ["ArrowUp", {
    key: "ArrowUp",
    code: "ArrowUp",
    windowsVirtualKeyCode: 38,
  }],
  ["ArrowRight", {
    key: "ArrowRight",
    code: "ArrowRight",
    windowsVirtualKeyCode: 39,
  }],
  ["ArrowDown", {
    key: "ArrowDown",
    code: "ArrowDown",
    windowsVirtualKeyCode: 40,
  }],
  ["Home", {
    key: "Home",
    code: "Home",
    windowsVirtualKeyCode: 36,
  }],
  ["End", {
    key: "End",
    code: "End",
    windowsVirtualKeyCode: 35,
  }],
  ["PageUp", {
    key: "PageUp",
    code: "PageUp",
    windowsVirtualKeyCode: 33,
  }],
  ["PageDown", {
    key: "PageDown",
    code: "PageDown",
    windowsVirtualKeyCode: 34,
  }],
  ["Space", {
    key: " ",
    code: "Space",
    windowsVirtualKeyCode: 32,
    text: " ",
  }],
]);

/**
 * Stable error vocabulary crossing the CDP/runtime/process seams.
 *
 * `unknown` means a mutating CDP command reached Chromium and may have
 * completed even though its acknowledgement was lost.
 */
export class AgentBrowserError extends Error {
  readonly code: string;
  readonly outcome: AgentBrowserOutcome;

  constructor(
    code: string,
    message: string,
    outcome: AgentBrowserOutcome = "known",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AgentBrowserError";
    this.code = code;
    this.outcome = outcome;
  }
}

export function asAgentBrowserError(
  error: unknown,
  fallbackCode = "agent_browser_error",
  fallbackOutcome: AgentBrowserOutcome = "known",
): AgentBrowserError {
  if (error instanceof AgentBrowserError) return error;
  return new AgentBrowserError(
    fallbackCode,
    error instanceof Error ? error.message : String(error),
    fallbackOutcome,
    error instanceof Error ? { cause: error } : undefined,
  );
}

function asMutationError(
  error: unknown,
  fallbackCode: string,
  dispatched: boolean,
): AgentBrowserError {
  const browserError = asAgentBrowserError(
    error,
    fallbackCode,
    dispatched ? "unknown" : "known",
  );
  if (!dispatched || browserError.outcome === "unknown") {
    return browserError;
  }
  return new AgentBrowserError(
    browserError.code,
    browserError.message,
    "unknown",
    { cause: browserError },
  );
}

function positiveTimeout(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_COMMAND_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(
      "Agent Browser CDP timeout must be a positive integer",
    );
  }
  return timeoutMs;
}

function boundedText(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.slice(0, maxLength)
    : "";
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
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

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw abortError(signal);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) {
    return Promise.reject(abortError(signal));
  }
  let removeAbortListener = (): void => {};
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    const handleAbort = (): void => {
      clearTimeout(timeout);
      reject(abortError(signal));
    };
    if (signal !== undefined) {
      signal.addEventListener("abort", handleAbort, { once: true });
      removeAbortListener = () =>
        signal.removeEventListener("abort", handleAbort);
    }
    timeout.unref();
  }).finally(() => {
    removeAbortListener();
  });
}

function commandResult<T extends Record<string, unknown>>(
  value: unknown,
): T {
  return record(value) as T;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value > 0
    ? value
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function firstQuad(value: unknown): readonly number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const candidate = Array.isArray(value[0])
    ? value[0]
    : value;
  return candidate.length >= 8 &&
      candidate.slice(0, 8).every((entry) =>
        finiteNumber(entry) !== undefined
      )
    ? candidate.slice(0, 8) as number[]
    : undefined;
}

function boxFromQuad(
  quad: readonly number[],
): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} | undefined {
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  if (
    xs.some((value) => value === undefined) ||
    ys.some((value) => value === undefined)
  ) {
    return undefined;
  }
  const x = Math.min(...xs as number[]);
  const y = Math.min(...ys as number[]);
  const width = Math.max(...xs as number[]) - x;
  const height = Math.max(...ys as number[]) - y;
  return width >= 0.25 && height >= 0.25
    ? { x, y, width, height }
    : undefined;
}

function attribute(
  attributes: unknown,
  name: string,
): string {
  if (!Array.isArray(attributes)) return "";
  for (let index = 0; index + 1 < attributes.length; index += 2) {
    if (
      attributes[index] === name &&
      typeof attributes[index + 1] === "string"
    ) {
      return boundedText(attributes[index + 1], 500);
    }
  }
  return "";
}

/**
 * Narrow semantic adapter over one guest WebContents debugger.
 *
 * It owns attachment, generation-scoped element references, command
 * deadlines, and the known/unknown mutation outcome boundary.
 */
export class AgentBrowserCdp {
  readonly #debugger: CdpDebuggerPort;
  readonly #timeoutMs: number;
  readonly #onGenerationChange:
    | ((
      generation: number,
      reason: AgentBrowserGenerationChangeReason,
    ) => void)
    | undefined;
  readonly #onDetach: ((reason: string) => void) | undefined;
  readonly #references = new Map<string, SnapshotReference>();
  readonly #annotationReferences =
    new Map<string, AnnotationReference>();
  readonly #annotationTargetByBackendNode =
    new Map<number, string>();
  readonly #navigationObservations =
    new Set<NavigationObservation>();
  #annotationPicker: AnnotationPicker | undefined;
  #annotationSelectionTail: Promise<void> = Promise.resolve();
  #annotationOverlayCleanup: Promise<void> = Promise.resolve();
  #annotationTargetSequence = 0;
  #annotationOverlayEnabled = false;
  #generation = 1;
  #attached = false;
  #disposed = false;
  #intentionalDetach = false;

  constructor(
    debuggerPort: CdpDebuggerPort,
    options: AgentBrowserCdpOptions = {},
  ) {
    this.#debugger = debuggerPort;
    this.#timeoutMs = positiveTimeout(options.commandTimeoutMs);
    this.#onGenerationChange = options.onGenerationChange;
    this.#onDetach = options.onDetach;
  }

  get generation(): number {
    return this.#generation;
  }

  async attach(signal?: AbortSignal): Promise<void> {
    if (this.#disposed) {
      throw new AgentBrowserError(
        "target_gone",
        "Agent Browser target is closed",
      );
    }
    if (this.#attached) return;
    if (signal?.aborted === true) throw abortError(signal);

    this.#debugger.on("message", this.#handleMessage);
    this.#debugger.on("detach", this.#handleDetach);
    try {
      this.#debugger.attach("1.3");
      this.#attached = true;
      await Promise.all([
        this.#command("Page.enable", {}, signal),
        this.#command("Runtime.enable", {}, signal),
        this.#command("DOM.enable", {}, signal),
        this.#command("Accessibility.enable", {}, signal),
      ]);
      await this.#command(
        "Page.setLifecycleEventsEnabled",
        { enabled: true },
        signal,
      );
    } catch (error) {
      this.#removeListeners();
      if (this.#debugger.isAttached()) {
        try {
          this.#debugger.detach();
        } catch {
          // Attachment failure is already reported to the caller.
        }
      }
      this.#attached = false;
      throw asAgentBrowserError(
        error,
        "debugger_attach_failed",
      );
    }
  }

  invalidateReferences(
    reason: AgentBrowserGenerationChangeReason = "references",
  ): number {
    this.#references.clear();
    this.#clearAnnotationReferences();
    this.#endAnnotationPicker(
      "navigation",
      "The page changed while browser annotation was active",
    );
    this.#generation += 1;
    this.#onGenerationChange?.(this.#generation, reason);
    return this.#generation;
  }

  interruptNavigationForHumanTakeover(): void {
    // A human handoff ends lifecycle observation without disposing the live
    // debugger target; ordinary timeouts still retain fail-closed behavior.
    this.#failNavigationObservations(
      new AgentBrowserError(
        "session_paused",
        "Agent Browser session is under human control",
      ),
    );
  }

  async navigate(
    url: string,
    signal?: AbortSignal,
  ): Promise<void> {
    let dispatched = false;
    const observation = this.#beginNavigationObservation();
    try {
      if (signal?.aborted === true) throw abortError(signal);
      dispatched = true;
      const result = commandResult<{
        errorText?: unknown;
        frameId?: unknown;
        isDownload?: unknown;
        loaderId?: unknown;
      }>(
        await this.#command(
          "Page.navigate",
          { url },
          signal,
        ),
      );
      if (
        typeof result.errorText === "string" &&
        result.errorText !== ""
      ) {
        throw new AgentBrowserError(
          "navigation_failed",
          result.errorText,
          "unknown",
        );
      }
      if (result.isDownload === true) {
        throw new AgentBrowserError(
          "navigation_failed",
          "Agent Browser navigation became a download",
          "unknown",
        );
      }
      if (
        typeof result.frameId !== "string" ||
        result.frameId === ""
      ) {
        throw new AgentBrowserError(
          "navigation_failed",
          "Chromium did not identify the navigated frame",
          "unknown",
        );
      }
      const loaderId =
        typeof result.loaderId === "string" &&
          result.loaderId !== ""
          ? result.loaderId
          : undefined;
      await this.#waitForNavigation(
        observation,
        result.frameId,
        loaderId,
        signal,
      );
      this.invalidateReferences("document");
    } catch (error) {
      throw asMutationError(
        error,
        "navigation_failed",
        dispatched,
      );
    } finally {
      this.#navigationObservations.delete(observation);
    }
  }

  async snapshot(
    signal?: AbortSignal,
  ): Promise<{
    readonly snapshotId: string;
    readonly nodes: readonly AgentBrowserSnapshotNode[];
  }> {
    const result = commandResult<{
      nodes?: unknown;
    }>(
      await this.#command(
        "Accessibility.getFullAXTree",
        {},
        signal,
      ),
    );
    const generation = this.invalidateReferences();
    const nodes: AgentBrowserSnapshotNode[] = [];
    const candidates = Array.isArray(result.nodes)
      ? result.nodes as AxNode[]
      : [];
    for (const candidate of candidates) {
      if (
        nodes.length >= MAX_SNAPSHOT_NODES ||
        candidate.ignored === true ||
        !Number.isSafeInteger(candidate.backendDOMNodeId) ||
        Number(candidate.backendDOMNodeId) <= 0
      ) {
        continue;
      }
      const ref = `s${String(generation)}:e${String(nodes.length + 1)}`;
      this.#references.set(ref, {
        backendNodeId: Number(candidate.backendDOMNodeId),
      });
      const description = boundedText(
        candidate.description?.value,
        500,
      );
      nodes.push({
        ref,
        role:
          boundedText(candidate.role?.value, 80) || "generic",
        name: boundedText(candidate.name?.value, 500),
        ...(description === "" ? {} : { description }),
      });
    }
    return {
      snapshotId: `s${String(generation)}`,
      nodes,
    };
  }

  async click(
    ref: string,
    signal?: AbortSignal,
    hooks?: AgentBrowserCdpClickHooks,
  ): Promise<AgentBrowserCdpPointerTarget> {
    const reference = this.#resolveReference(ref);
    const target = await this.#pointerTarget(
      ref,
      reference,
      signal,
    );
    const { x, y } = target.point;
    let dispatched = false;
    try {
      assertNotAborted(signal);
      this.#assertCurrentReference(ref, reference);
      await hooks?.beforeDispatch?.(target);
      assertNotAborted(signal);
      this.#assertCurrentReference(ref, reference);
      dispatched = true;
      await this.#command(
        "Input.dispatchMouseEvent",
        { type: "mouseMoved", x, y },
        signal,
      );
      this.#assertCurrentReference(ref, reference);
      await hooks?.beforePress?.(target);
      assertNotAborted(signal);
      this.#assertCurrentReference(ref, reference);
      await this.#command(
        "Input.dispatchMouseEvent",
        {
          type: "mousePressed",
          x,
          y,
          button: "left",
          clickCount: 1,
        },
        signal,
      );
      this.#assertCurrentReference(ref, reference);
      await this.#command(
        "Input.dispatchMouseEvent",
        {
          type: "mouseReleased",
          x,
          y,
          button: "left",
          clickCount: 1,
        },
        signal,
      );
      return target;
    } catch (error) {
      throw asMutationError(
        error,
        "click_failed",
        dispatched,
      );
    } finally {
      if (dispatched) this.invalidateReferences();
    }
  }

  async pointerTarget(
    ref: string,
    signal?: AbortSignal,
  ): Promise<AgentBrowserCdpPointerTarget> {
    const reference = this.#resolveReference(ref);
    return await this.#pointerTarget(ref, reference, signal);
  }

  async fill(
    ref: string,
    value: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const reference = this.#resolveReference(ref);
    const { backendNodeId } = reference;
    const resolved = commandResult<{
      object?: unknown;
    }>(
      await this.#command(
        "DOM.resolveNode",
        { backendNodeId },
        signal,
      ),
    );
    this.#assertCurrentReference(ref, reference);
    const objectId = record(resolved.object).objectId;
    if (typeof objectId !== "string" || objectId === "") {
      throw new AgentBrowserError(
        "element_not_interactable",
        `Agent Browser ref ${ref} cannot be resolved`,
      );
    }
    let dispatched = false;
    try {
      if (signal?.aborted === true) throw abortError(signal);
      this.#assertCurrentReference(ref, reference);
      dispatched = true;
      const result = commandResult<{
        exceptionDetails?: unknown;
      }>(
        await this.#command(
          "Runtime.callFunctionOn",
          {
            objectId,
            functionDeclaration: `function(value) {
              const element = this;
              if (element instanceof HTMLInputElement) {
                const setter = Object.getOwnPropertyDescriptor(
                  HTMLInputElement.prototype,
                  "value"
                )?.set;
                setter?.call(element, value);
              } else if (element instanceof HTMLTextAreaElement) {
                const setter = Object.getOwnPropertyDescriptor(
                  HTMLTextAreaElement.prototype,
                  "value"
                )?.set;
                setter?.call(element, value);
              } else if (element.isContentEditable) {
                element.textContent = value;
              } else {
                throw new Error("element is not editable");
              }
              element.dispatchEvent(new Event("input", {
                bubbles: true
              }));
              element.dispatchEvent(new Event("change", {
                bubbles: true
              }));
            }`,
            arguments: [{ value }],
            returnByValue: true,
            awaitPromise: false,
          },
          signal,
        ),
      );
      if (result.exceptionDetails !== undefined) {
        throw new AgentBrowserError(
          "fill_failed",
          `Agent Browser ref ${ref} rejected the fill operation`,
          "unknown",
        );
      }
    } catch (error) {
      throw asMutationError(
        error,
        "fill_failed",
        dispatched,
      );
    } finally {
      if (dispatched) this.invalidateReferences();
    }
  }

  async press(
    key: string,
    ref?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const keyDescription = KEY_DESCRIPTIONS.get(key);
    if (keyDescription === undefined) {
      throw new AgentBrowserError(
        "unsupported_key",
        `Agent Browser does not support key ${key}`,
      );
    }
    if (ref !== undefined) {
      const reference = this.#resolveReference(ref);
      await this.#command(
        "DOM.focus",
        { backendNodeId: reference.backendNodeId },
        signal,
      );
      this.#assertCurrentReference(ref, reference);
    }
    let dispatched = false;
    try {
      if (signal?.aborted === true) throw abortError(signal);
      dispatched = true;
      await this.#command(
        "Input.dispatchKeyEvent",
        {
          type: "keyDown",
          ...keyDescription,
        },
        signal,
      );
      await this.#command(
        "Input.dispatchKeyEvent",
        {
          type: "keyUp",
          key: keyDescription.key,
          code: keyDescription.code,
          windowsVirtualKeyCode:
            keyDescription.windowsVirtualKeyCode,
        },
        signal,
      );
    } catch (error) {
      throw asMutationError(
        error,
        "press_failed",
        dispatched,
      );
    } finally {
      if (dispatched) this.invalidateReferences();
    }
  }

  async waitForText(
    text: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const documentResult = commandResult<{
        result?: unknown;
      }>(
        await this.#command(
          "Runtime.evaluate",
          {
            expression: "document",
            returnByValue: false,
          },
          signal,
          Math.max(
            1,
            Math.min(this.#timeoutMs, deadline - Date.now()),
          ),
        ),
      );
      const objectId = record(documentResult.result).objectId;
      if (typeof objectId !== "string" || objectId === "") {
        throw new AgentBrowserError(
          "target_gone",
          "Agent Browser document is unavailable",
        );
      }
      const containsResult = commandResult<{
        result?: unknown;
        exceptionDetails?: unknown;
      }>(
        await this.#command(
          "Runtime.callFunctionOn",
          {
            objectId,
            functionDeclaration: `function(text) {
              const body = this.body;
              const content = body?.innerText ?? body?.textContent ?? "";
              return content.includes(text);
            }`,
            arguments: [{ value: text }],
            returnByValue: true,
          },
          signal,
          Math.max(
            1,
            Math.min(this.#timeoutMs, deadline - Date.now()),
          ),
        ),
      );
      if (
        containsResult.exceptionDetails === undefined &&
        record(containsResult.result).value === true
      ) {
        return;
      }
      if (Date.now() >= deadline) break;
      await sleep(Math.min(100, deadline - Date.now()), signal);
    }
    throw new AgentBrowserError(
      "timed_out",
      `Agent Browser did not find the requested text within ${String(timeoutMs)} ms`,
    );
  }

  /**
   * Starts Chromium's native DOM inspect mode for the top document.
   *
   * The callback receives a bounded, serializable description. Chromium's
   * backend node id remains private to this adapter and is represented to the
   * caller by a generation-scoped target id.
   */
  async startAnnotationPicker(
    onTarget: AgentBrowserAnnotationTargetCallback,
    onEnded?: AgentBrowserAnnotationEndedCallback,
    signal?: AbortSignal,
  ): Promise<void> {
    if (typeof onTarget !== "function") {
      throw new TypeError(
        "Agent Browser annotation callback must be a function",
      );
    }
    await this.#annotationOverlayCleanup;
    await this.stopAnnotationPicker();
    const picker: AnnotationPicker = {
      generation: this.#generation,
      onTarget,
      onEnded,
    };
    this.#annotationPicker = picker;
    try {
      await this.#command("Overlay.enable", {}, signal);
      this.#annotationOverlayEnabled = true;
      this.#assertCurrentAnnotationPicker(picker);
      await this.#armAnnotationPicker(signal);
    } catch (error) {
      if (this.#annotationPicker === picker) {
        this.#annotationPicker = undefined;
      }
      this.#clearAnnotationReferences();
      try {
        await this.#disableAnnotationOverlay();
      } catch {
        // Preserve the start failure while still clearing local authority.
      }
      throw asAgentBrowserError(
        error,
        "annotation_picker_failed",
      );
    }
  }

  /**
   * Stops inspect mode. Local picker authority is revoked synchronously so an
   * in-flight node description cannot publish after the caller has stopped.
   */
  async stopAnnotationPicker(): Promise<void> {
    this.#annotationPicker = undefined;
    this.#clearAnnotationReferences();
    await this.#annotationOverlayCleanup;
    await this.#disableAnnotationOverlay();
  }

  async annotationViewport(
    signal?: AbortSignal,
  ): Promise<AgentBrowserAnnotationViewport> {
    const result = commandResult<{
      cssVisualViewport?: unknown;
      cssLayoutViewport?: unknown;
      layoutViewport?: unknown;
    }>(
      await this.#command("Page.getLayoutMetrics", {}, signal),
    );
    return this.#annotationViewportFromLayout(result);
  }

  async describeAnnotationTarget(
    targetId: string,
    signal?: AbortSignal,
  ): Promise<AgentBrowserAnnotationTarget> {
    const reference = this.#annotationReferences.get(targetId);
    if (
      reference === undefined ||
      reference.generation !== this.#generation
    ) {
      throw new AgentBrowserError(
        "stale_ref",
        `Agent Browser annotation target ${targetId} is stale or unknown`,
      );
    }
    return await this.#describeAnnotationReference(
      targetId,
      reference,
      signal,
    );
  }

  /**
   * Refreshes selected nodes in input order and omits nodes which no longer
   * resolve. A target-wide debugger failure still propagates to the caller.
   */
  async refreshAnnotationTargets(
    targetIds: readonly string[],
    signal?: AbortSignal,
  ): Promise<readonly AgentBrowserAnnotationTarget[]> {
    const targets: AgentBrowserAnnotationTarget[] = [];
    const uniqueIds = [...new Set(targetIds)].slice(
      0,
      MAX_ANNOTATION_TARGETS,
    );
    for (const targetId of uniqueIds) {
      const reference = this.#annotationReferences.get(targetId);
      if (
        reference === undefined ||
        reference.generation !== this.#generation
      ) {
        continue;
      }
      try {
        targets.push(
          await this.#describeAnnotationReference(
            targetId,
            reference,
            signal,
          ),
        );
      } catch (error) {
        const browserError = asAgentBrowserError(error);
        if (
          browserError.code === "target_gone" ||
          browserError.code === "timed_out" ||
          browserError.code === "agent_browser_cancelled"
        ) {
          throw browserError;
        }
        this.#deleteAnnotationReference(targetId);
      }
    }
    return targets;
  }

  /**
   * Freezes hover inspection while metadata and the screenshot are committed.
   * Generation checks on both sides of capture prevent markers from being
   * paired with pixels from another document.
   */
  async captureAnnotationTargets(
    targetIds: readonly string[],
    signal?: AbortSignal,
  ): Promise<{
    readonly targets: readonly AgentBrowserAnnotationTarget[];
    readonly data: string;
  }> {
    const picker = this.#annotationPicker;
    if (picker === undefined) {
      throw new AgentBrowserError(
        "annotation_picker_inactive",
        "Agent Browser annotation picker is not active",
      );
    }
    const generation = this.#generation;
    let failure: unknown;
    let pageFrozen = false;
    try {
      await this.#command(
        "Overlay.setInspectMode",
        {
          mode: "none",
          highlightConfig: ANNOTATION_HIGHLIGHT_CONFIG,
        },
        signal,
      );
      this.#assertCurrentAnnotationPicker(picker);
      await this.#command("Overlay.hideHighlight", {}, signal);
      this.#assertCurrentAnnotationPicker(picker);
      await this.#command(
        "Page.setWebLifecycleState",
        { state: "frozen" },
        signal,
      );
      pageFrozen = true;
      this.#assertCurrentAnnotationPicker(picker);
      const targets = await this.refreshAnnotationTargets(
        targetIds,
        signal,
      );
      this.#assertAnnotationGeneration(generation);
      this.#assertCurrentAnnotationPicker(picker);
      const data = await this.screenshot(signal);
      this.#assertAnnotationGeneration(generation);
      this.#assertCurrentAnnotationPicker(picker);
      return { targets, data };
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      if (pageFrozen) {
        try {
          await this.#command(
            "Page.setWebLifecycleState",
            { state: "active" },
          );
        } catch (resumeError) {
          if (failure === undefined) throw resumeError;
        }
      }
      if (
        this.#annotationPicker === picker &&
        picker.generation === this.#generation
      ) {
        try {
          await this.#armAnnotationPicker();
        } catch (rearmError) {
          if (failure === undefined) throw rearmError;
        }
      }
    }
  }

  async screenshot(signal?: AbortSignal): Promise<string> {
    const result = commandResult<{
      data?: unknown;
    }>(
      await this.#command(
        "Page.captureScreenshot",
        {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
        },
        signal,
      ),
    );
    if (
      typeof result.data !== "string" ||
      result.data.length === 0 ||
      result.data.length > MAX_SCREENSHOT_BASE64_LENGTH ||
      !/^[a-zA-Z0-9+/]+={0,2}$/u.test(result.data)
    ) {
      throw new AgentBrowserError(
        "screenshot_failed",
        "Chromium returned an invalid Agent Browser screenshot",
      );
    }
    return result.data;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#endAnnotationPicker(
      "target_gone",
      "Agent Browser target is closed",
    );
    this.#disposed = true;
    this.#references.clear();
    this.#failNavigationObservations(
      new AgentBrowserError(
        "target_gone",
        "Agent Browser target is closed",
      ),
    );
    this.#removeListeners();
    if (this.#debugger.isAttached()) {
      this.#intentionalDetach = true;
      try {
        this.#debugger.detach();
      } catch {
        // The target may already have disappeared.
      }
    }
    this.#attached = false;
  }

  readonly #handleMessage = (
    _event: unknown,
    method: unknown,
    params: unknown,
  ): void => {
    if (method === "Overlay.inspectNodeRequested") {
      const backendNodeId = positiveInteger(
        record(params).backendNodeId,
      );
      const picker = this.#annotationPicker;
      if (backendNodeId !== undefined && picker !== undefined) {
        this.#annotationSelectionTail =
          this.#annotationSelectionTail
            .then(async () => {
              await this.#publishAnnotationTarget(
                picker,
                backendNodeId,
              );
            })
            .catch(() => {
              // A stale/unsupported inspected node is ignored. If the picker
              // remains current, publishAnnotationTarget rearms inspection.
            });
      }
      return;
    }
    if (typeof method === "string") {
      this.#recordNavigationEvent(method, params);
    }
    if (
      method === "Page.frameNavigated" ||
      method === "Page.navigatedWithinDocument" ||
      method === "DOM.documentUpdated" ||
      method === "Runtime.executionContextsCleared"
    ) {
      this.invalidateReferences("document");
    }
  };

  readonly #handleDetach = (
    _event: unknown,
    reason: unknown,
  ): void => {
    this.#attached = false;
    this.#references.clear();
    this.#endAnnotationPicker(
      "target_gone",
      typeof reason === "string" && reason !== ""
        ? reason
        : "Debugger detached",
    );
    this.#failNavigationObservations(
      new AgentBrowserError(
        "target_gone",
        typeof reason === "string" && reason !== ""
          ? reason
          : "Debugger detached",
      ),
    );
    if (this.#intentionalDetach || this.#disposed) return;
    this.#onDetach?.(
      typeof reason === "string" && reason !== ""
        ? reason
        : "Debugger detached",
    );
  };

  async #publishAnnotationTarget(
    picker: AnnotationPicker,
    backendNodeId: number,
  ): Promise<void> {
    if (
      this.#annotationPicker !== picker ||
      picker.generation !== this.#generation
    ) {
      return;
    }
    const existingTargetId =
      this.#annotationTargetByBackendNode.get(backendNodeId);
    const existingReference = existingTargetId === undefined
      ? undefined
      : this.#annotationReferences.get(existingTargetId);
    if (
      existingTargetId === undefined &&
      this.#annotationReferences.size >= MAX_ANNOTATION_REFERENCES
    ) {
      this.#endAnnotationPicker(
        "target_gone",
        "Browser annotation reached its element reference limit; "
          + "start a new annotation set",
      );
      return;
    }
    const targetId = existingTargetId ?? (() => {
      this.#annotationTargetSequence += 1;
      return `target-${this.#annotationTargetSequence.toString(36)}`;
    })();
    const reference: AnnotationReference = existingReference ?? {
      backendNodeId,
      generation: picker.generation,
    };
    if (existingReference === undefined) {
      this.#annotationReferences.set(targetId, reference);
      this.#annotationTargetByBackendNode.set(
        backendNodeId,
        targetId,
      );
    }
    try {
      const target = await this.#describeAnnotationReference(
        targetId,
        reference,
      );
      this.#assertCurrentAnnotationPicker(picker);
      await picker.onTarget(target);
    } catch (error) {
      this.#deleteAnnotationReference(targetId);
      throw error;
    } finally {
      if (
        this.#annotationPicker === picker &&
        picker.generation === this.#generation
      ) {
        try {
          await this.#armAnnotationPicker();
        } catch (error) {
          const browserError = asAgentBrowserError(
            error,
            "annotation_picker_failed",
          );
          this.#endAnnotationPicker(
            "target_gone",
            browserError.message,
          );
        }
      }
    }
  }

  async #describeAnnotationReference(
    targetId: string,
    reference: AnnotationReference,
    signal?: AbortSignal,
  ): Promise<AgentBrowserAnnotationTarget> {
    this.#assertCurrentAnnotationReference(targetId, reference);
    const described = commandResult<{
      node?: unknown;
    }>(
      await this.#command(
        "DOM.describeNode",
        {
          backendNodeId: reference.backendNodeId,
          depth: 0,
          pierce: true,
        },
        signal,
      ),
    );
    this.#assertCurrentAnnotationReference(targetId, reference);
    const node = record(described.node) as DomNode;
    if (
      positiveInteger(node.backendNodeId) !==
        reference.backendNodeId
    ) {
      throw new AgentBrowserError(
        "stale_ref",
        `Agent Browser annotation target ${targetId} no longer resolves`,
      );
    }

    const axResult = commandResult<{
      nodes?: unknown;
    }>(
      await this.#command(
        "Accessibility.getPartialAXTree",
        {
          backendNodeId: reference.backendNodeId,
          fetchRelatives: false,
        },
        signal,
      ),
    );
    this.#assertCurrentAnnotationReference(targetId, reference);
    const axCandidates = Array.isArray(axResult.nodes)
      ? axResult.nodes as AxNode[]
      : [];
    const axNode = axCandidates.find((candidate) =>
      candidate.ignored !== true &&
      positiveInteger(candidate.backendDOMNodeId) ===
        reference.backendNodeId
    ) ?? axCandidates.find((candidate) =>
      candidate.ignored !== true
    );

    const quadsResult = commandResult<{
      quads?: unknown;
    }>(
      await this.#command(
        "DOM.getContentQuads",
        { backendNodeId: reference.backendNodeId },
        signal,
      ),
    );
    this.#assertCurrentAnnotationReference(targetId, reference);
    const boxResult = commandResult<{
      model?: unknown;
    }>(
      await this.#command(
        "DOM.getBoxModel",
        { backendNodeId: reference.backendNodeId },
        signal,
      ),
    );
    this.#assertCurrentAnnotationReference(targetId, reference);
    const layoutResult = commandResult<{
      cssVisualViewport?: unknown;
      cssLayoutViewport?: unknown;
      layoutViewport?: unknown;
    }>(
      await this.#command("Page.getLayoutMetrics", {}, signal),
    );
    this.#assertCurrentAnnotationReference(targetId, reference);

    const objectGroup = `minke-annotation-${targetId}`;
    const resolved = commandResult<{
      object?: unknown;
    }>(
      await this.#command(
        "DOM.resolveNode",
        {
          backendNodeId: reference.backendNodeId,
          objectGroup,
        },
        signal,
      ),
    );
    this.#assertCurrentAnnotationReference(targetId, reference);
    const objectId = record(resolved.object).objectId;
    if (typeof objectId !== "string" || objectId === "") {
      throw new AgentBrowserError(
        "element_not_interactable",
        `Agent Browser annotation target ${targetId} cannot be resolved`,
      );
    }
    let metadataResult: {
      result?: unknown;
      exceptionDetails?: unknown;
    };
    try {
      metadataResult = commandResult<{
        result?: unknown;
        exceptionDetails?: unknown;
      }>(
        await this.#command(
          "Runtime.callFunctionOn",
          {
            objectId,
            functionDeclaration: `function() {
            if (!(this instanceof Element)) return null;
            const clean = (value, limit) =>
              String(value ?? "").replace(/\\s+/gu, " ").trim()
                .slice(0, limit);
            const segment = (element) => {
              const tag = clean(element.localName || element.tagName, 80)
                .toLowerCase() || "element";
              const parent = element.parentElement;
              if (!parent) return tag;
              const siblings = Array.from(parent.children).filter(
                (sibling) => sibling.localName === element.localName
              );
              if (siblings.length <= 1) return tag;
              return tag + ":nth-of-type(" +
                String(siblings.indexOf(element) + 1) + ")";
            };
            const selectorParts = [];
            const pathParts = [];
            let current = this;
            for (let depth = 0;
              current instanceof Element && depth < 12;
              depth += 1) {
              selectorParts.unshift(segment(current));
              pathParts.unshift(
                clean(current.localName || current.tagName, 80)
                  .toLowerCase() || "element"
              );
              const root = current.getRootNode();
              current = current.parentElement ??
                (root instanceof ShadowRoot ? root.host : null);
            }
            return {
              topDocument: window === window.top,
              tag: clean(this.localName || this.tagName, 80)
                .toLowerCase(),
              text: clean(this.innerText || this.textContent, 500),
              ariaLabel: clean(this.getAttribute("aria-label"), 500),
              role: clean(this.getAttribute("role"), 80),
              selector: selectorParts.join(" > ").slice(0, 1000),
              path: pathParts.join(" > ").slice(0, 1000),
              viewportWidth: window.innerWidth,
              viewportHeight: window.innerHeight
            };
          }`,
            returnByValue: true,
          },
          signal,
        ),
      );
    } finally {
      await this.#command(
        "Runtime.releaseObjectGroup",
        { objectGroup },
      );
    }
    this.#assertCurrentAnnotationReference(targetId, reference);
    if (metadataResult.exceptionDetails !== undefined) {
      throw new AgentBrowserError(
        "element_not_interactable",
        `Agent Browser annotation target ${targetId} cannot be described`,
      );
    }
    const metadata = record(
      record(metadataResult.result).value,
    ) as AnnotationDomMetadata;
    if (metadata.topDocument !== true) {
      throw new AgentBrowserError(
        "element_not_interactable",
        "Agent Browser annotations currently support the top document only",
      );
    }

    const model = record(boxResult.model);
    const quad =
      firstQuad(quadsResult.quads) ??
      firstQuad(model.border) ??
      firstQuad(model.content);
    const rect = quad === undefined
      ? undefined
      : boxFromQuad(quad);
    if (rect === undefined) {
      throw new AgentBrowserError(
        "element_not_interactable",
        `Agent Browser annotation target ${targetId} has no visible box`,
      );
    }

    const viewport = this.#annotationViewportFromLayout(
      layoutResult,
      metadata,
    );
    const boundedRect = {
      x: Math.max(-100_000, Math.min(100_000, rect.x)),
      y: Math.max(-100_000, Math.min(100_000, rect.y)),
      width: Math.max(
        0.25,
        Math.min(100_000, rect.width),
      ),
      height: Math.max(
        0.25,
        Math.min(100_000, rect.height),
      ),
    };
    const domRole =
      boundedText(metadata.role, 80) ||
      attribute(node.attributes, "role");
    const axRole = boundedText(axNode?.role?.value, 80);
    const role = domRole || axRole;
    const ariaLabel =
      boundedText(metadata.ariaLabel, 500) ||
      attribute(node.attributes, "aria-label");
    const tag = (
      boundedText(metadata.tag, 80) ||
      boundedText(node.localName, 80) ||
      boundedText(node.nodeName, 80)
    ).toLowerCase();
    if (tag === "") {
      throw new AgentBrowserError(
        "element_not_interactable",
        `Agent Browser annotation target ${targetId} has no element tag`,
      );
    }
    const selector =
      boundedText(metadata.selector, 1_000) || tag;
    const path = boundedText(metadata.path, 1_000) || tag;
    const text =
      boundedText(metadata.text, 500) ||
      boundedText(axNode?.name?.value, 500);
    const position = {
      x: Math.max(
        0,
        Math.min(
          viewport.width,
          boundedRect.x + boundedRect.width / 2,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          viewport.height,
          boundedRect.y + boundedRect.height / 2,
        ),
      ),
    };
    return {
      targetId,
      tag,
      ...(role === "" ? {} : { role }),
      text,
      ...(ariaLabel === "" ? {} : { ariaLabel }),
      selector,
      path,
      position,
      rect: boundedRect,
      viewport,
      frame: "top document",
    };
  }

  #annotationViewportFromLayout(
    layoutResult: Record<string, unknown>,
    fallback?: AnnotationDomMetadata,
  ): AgentBrowserAnnotationViewport {
    const visualViewport = record(
      layoutResult.cssVisualViewport,
    );
    const cssLayoutViewport = record(
      layoutResult.cssLayoutViewport,
    );
    const layoutViewport = record(layoutResult.layoutViewport);
    const rawWidth =
      finiteNumber(visualViewport.clientWidth) ??
      finiteNumber(cssLayoutViewport.clientWidth) ??
      finiteNumber(layoutViewport.clientWidth) ??
      finiteNumber(fallback?.viewportWidth);
    const rawHeight =
      finiteNumber(visualViewport.clientHeight) ??
      finiteNumber(cssLayoutViewport.clientHeight) ??
      finiteNumber(layoutViewport.clientHeight) ??
      finiteNumber(fallback?.viewportHeight);
    if (
      rawWidth === undefined ||
      rawHeight === undefined ||
      rawWidth < 1 ||
      rawHeight < 1
    ) {
      throw new AgentBrowserError(
        "element_not_interactable",
        "Agent Browser annotation viewport is unavailable",
      );
    }
    return {
      width: Math.min(100_000, rawWidth),
      height: Math.min(100_000, rawHeight),
    };
  }

  #assertCurrentAnnotationReference(
    targetId: string,
    reference: AnnotationReference,
  ): void {
    const current = this.#annotationReferences.get(targetId);
    if (
      reference.generation !== this.#generation ||
      current?.backendNodeId !== reference.backendNodeId ||
      current.generation !== reference.generation
    ) {
      throw new AgentBrowserError(
        "stale_ref",
        `Agent Browser annotation target ${targetId} became stale`,
      );
    }
  }

  #deleteAnnotationReference(targetId: string): void {
    const reference = this.#annotationReferences.get(targetId);
    this.#annotationReferences.delete(targetId);
    if (
      reference !== undefined &&
      this.#annotationTargetByBackendNode.get(
        reference.backendNodeId,
      ) === targetId
    ) {
      this.#annotationTargetByBackendNode.delete(
        reference.backendNodeId,
      );
    }
  }

  #clearAnnotationReferences(): void {
    this.#annotationReferences.clear();
    this.#annotationTargetByBackendNode.clear();
  }

  #assertAnnotationGeneration(generation: number): void {
    if (generation !== this.#generation) {
      throw new AgentBrowserError(
        "stale_ref",
        "Agent Browser annotation page changed before capture",
      );
    }
  }

  #assertCurrentAnnotationPicker(
    picker: AnnotationPicker,
  ): void {
    if (
      this.#annotationPicker !== picker ||
      picker.generation !== this.#generation
    ) {
      throw new AgentBrowserError(
        "annotation_picker_inactive",
        "Agent Browser annotation picker is no longer active",
      );
    }
  }

  async #armAnnotationPicker(
    signal?: AbortSignal,
  ): Promise<void> {
    await this.#command(
      "Overlay.setInspectMode",
      {
        mode: "searchForNode",
        highlightConfig: ANNOTATION_HIGHLIGHT_CONFIG,
      },
      signal,
    );
  }

  async #disableAnnotationOverlay(
    signal?: AbortSignal,
  ): Promise<void> {
    const shouldDisable = this.#annotationOverlayEnabled;
    this.#annotationOverlayEnabled = false;
    if (
      !shouldDisable ||
      this.#disposed ||
      !this.#attached ||
      !this.#debugger.isAttached()
    ) {
      return;
    }
    let failure: unknown;
    for (const [method, params] of [
      [
        "Overlay.setInspectMode",
        {
          mode: "none",
          highlightConfig: ANNOTATION_HIGHLIGHT_CONFIG,
        },
      ],
      ["Overlay.hideHighlight", {}],
      ["Overlay.disable", {}],
    ] as const) {
      try {
        await this.#command(method, params, signal);
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure !== undefined) throw failure;
  }

  #endAnnotationPicker(
    reason: AgentBrowserAnnotationEndReason,
    message?: string,
  ): void {
    const picker = this.#annotationPicker;
    this.#annotationPicker = undefined;
    this.#clearAnnotationReferences();
    if (picker === undefined) return;
    try {
      picker.onEnded?.(reason, message);
    } catch {
      // A projection callback cannot retain CDP picker authority.
    }
    this.#annotationOverlayCleanup =
      this.#disableAnnotationOverlay().catch(() => {
        // Local picker state is already revoked. The owner will either start a
        // fresh picker or close the target after a debugger failure.
      });
  }

  #resolveReference(ref: string): ResolvedReference {
    const expectedPrefix = `s${String(this.#generation)}:`;
    const reference = ref.startsWith(expectedPrefix)
      ? this.#references.get(ref)
      : undefined;
    if (reference === undefined) {
      throw new AgentBrowserError(
        "stale_ref",
        `Agent Browser ref ${ref} is stale or unknown`,
      );
    }
    return {
      backendNodeId: reference.backendNodeId,
      generation: this.#generation,
    };
  }

  async #pointerTarget(
    ref: string,
    reference: ResolvedReference,
    signal?: AbortSignal,
  ): Promise<AgentBrowserCdpPointerTarget> {
    const { backendNodeId } = reference;
    await this.#command(
      "DOM.scrollIntoViewIfNeeded",
      { backendNodeId },
      signal,
    );
    this.#assertCurrentReference(ref, reference);
    const layoutResult = commandResult<{
      cssVisualViewport?: unknown;
      cssLayoutViewport?: unknown;
      layoutViewport?: unknown;
    }>(
      await this.#command("Page.getLayoutMetrics", {}, signal),
    );
    this.#assertCurrentReference(ref, reference);
    const viewport = this.#annotationViewportFromLayout(
      layoutResult,
    );
    const box = commandResult<{
      model?: unknown;
    }>(
      await this.#command(
        "DOM.getBoxModel",
        { backendNodeId },
        signal,
      ),
    );
    this.#assertCurrentReference(ref, reference);
    const model = record(box.model);
    const quad = Array.isArray(model.content)
      ? model.content
      : Array.isArray(model.border)
        ? model.border
        : undefined;
    if (
      quad === undefined ||
      quad.length < 8 ||
      !quad.slice(0, 8).every((value) =>
        typeof value === "number" && Number.isFinite(value)
      )
    ) {
      throw new AgentBrowserError(
        "element_not_interactable",
        `Agent Browser ref ${ref} has no pointer target`,
      );
    }
    const points = quad.slice(0, 8) as number[];
    const quadLeft = Math.min(
      points[0],
      points[2],
      points[4],
      points[6],
    );
    const quadRight = Math.max(
      points[0],
      points[2],
      points[4],
      points[6],
    );
    const quadTop = Math.min(
      points[1],
      points[3],
      points[5],
      points[7],
    );
    const quadBottom = Math.max(
      points[1],
      points[3],
      points[5],
      points[7],
    );
    // CDP defines both DOM box quads and Input mouse coordinates relative to
    // the main-frame viewport. VisualViewport offsets are relative to the
    // layout/document coordinate spaces, so they must not be added here.
    const visibleLeft = Math.max(0, quadLeft);
    const visibleRight = Math.min(viewport.width, quadRight);
    const visibleTop = Math.max(0, quadTop);
    const visibleBottom = Math.min(
      viewport.height,
      quadBottom,
    );
    const visibleWidth = visibleRight - visibleLeft;
    const visibleHeight = visibleBottom - visibleTop;
    if (
      visibleWidth <= 0 ||
      visibleHeight <= 0 ||
      visibleWidth * visibleHeight <=
        MIN_POINTER_VISIBLE_AREA
    ) {
      throw new AgentBrowserError(
        "element_not_interactable",
        `Agent Browser ref ${ref} has no visible pointer target`,
      );
    }
    return {
      point: {
        x: visibleLeft + visibleWidth / 2,
        y: visibleTop + visibleHeight / 2,
      },
      viewport,
    };
  }

  #assertCurrentReference(
    ref: string,
    reference: ResolvedReference,
  ): void {
    const current = this.#references.get(ref);
    if (
      reference.generation !== this.#generation ||
      current?.backendNodeId !== reference.backendNodeId
    ) {
      throw new AgentBrowserError(
        "stale_ref",
        `Agent Browser ref ${ref} became stale before dispatch`,
      );
    }
  }

  #beginNavigationObservation(): NavigationObservation {
    const observation: NavigationObservation = {
      events: [],
      listeners: new Set(),
    };
    this.#navigationObservations.add(observation);
    return observation;
  }

  #recordNavigationEvent(
    method: string,
    params: unknown,
  ): void {
    if (
      method !== "Page.lifecycleEvent" &&
      method !== "Page.navigatedWithinDocument" &&
      method !== "Page.frameDetached"
    ) {
      return;
    }
    for (const observation of this.#navigationObservations) {
      if (observation.events.length >= 64) {
        observation.events.shift();
      }
      observation.events.push({
        method,
        params: record(params),
      });
      for (const listener of observation.listeners) listener();
    }
  }

  #failNavigationObservations(error: AgentBrowserError): void {
    for (const observation of this.#navigationObservations) {
      observation.failure = error;
      for (const listener of observation.listeners) listener();
    }
  }

  async #waitForNavigation(
    observation: NavigationObservation,
    frameId: string,
    loaderId: string | undefined,
    signal?: AbortSignal,
  ): Promise<void> {
    const timeoutError = new AgentBrowserError(
      "timed_out",
      `Agent Browser navigation did not complete within ${String(this.#timeoutMs)} ms`,
    );
    let abortFailure: AgentBrowserError | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let timeout: NodeJS.Timeout | undefined;
        const finish = (error?: AgentBrowserError): void => {
          if (settled) return;
          settled = true;
          if (timeout !== undefined) clearTimeout(timeout);
          observation.listeners.delete(inspect);
          signal?.removeEventListener("abort", handleAbort);
          if (error === undefined) resolve();
          else reject(error);
        };
        const inspect = (): void => {
          if (observation.failure !== undefined) {
            finish(observation.failure);
            return;
          }
          for (const event of observation.events) {
            if (
              event.method === "Page.frameDetached" &&
              event.params.frameId === frameId
            ) {
              finish(
                new AgentBrowserError(
                  "navigation_failed",
                  "The navigated frame was detached",
                ),
              );
              return;
            }
            if (
              loaderId === undefined &&
              event.method === "Page.navigatedWithinDocument" &&
              event.params.frameId === frameId
            ) {
              finish();
              return;
            }
            if (
              loaderId !== undefined &&
              event.method === "Page.lifecycleEvent" &&
              event.params.frameId === frameId &&
              event.params.loaderId === loaderId &&
              event.params.name === "load"
            ) {
              finish();
              return;
            }
          }
        };
        const handleAbort = (): void => {
          abortFailure = abortError(signal);
          finish(abortFailure);
        };
        observation.listeners.add(inspect);
        if (signal?.aborted === true) {
          handleAbort();
          return;
        }
        signal?.addEventListener("abort", handleAbort, {
          once: true,
        });
        timeout = setTimeout(() => {
          finish(timeoutError);
        }, this.#timeoutMs);
        timeout.unref();
        inspect();
      });
    } catch (error) {
      if (error === timeoutError || error === abortFailure) {
        this.#failClosed(
          error === timeoutError
            ? "Navigation did not reach its load lifecycle before the deadline"
            : "Navigation was cancelled before its load lifecycle",
        );
      }
      throw error;
    }
  }

  async #command(
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    timeoutMs = this.#timeoutMs,
  ): Promise<unknown> {
    if (
      this.#disposed ||
      !this.#attached ||
      !this.#debugger.isAttached()
    ) {
      throw new AgentBrowserError(
        "target_gone",
        "Agent Browser target is unavailable",
      );
    }
    if (signal?.aborted === true) throw abortError(signal);

    let timeout: NodeJS.Timeout | undefined;
    let removeAbortListener = (): void => {};
    const timeoutError = new AgentBrowserError(
      "timed_out",
      `Agent Browser CDP command ${method} timed out`,
    );
    const timeoutDeadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(timeoutError);
      }, timeoutMs);
      timeout.unref();
    });
    let abortFailure: AgentBrowserError | undefined;
    const abortDeadline = signal === undefined
      ? undefined
      : new Promise<never>((_resolve, reject) => {
          const handleAbort = (): void => {
            abortFailure = abortError(signal);
            reject(abortFailure);
          };
          signal.addEventListener("abort", handleAbort, {
            once: true,
          });
          removeAbortListener = () =>
            signal.removeEventListener("abort", handleAbort);
        });
    let commandSettled = false;
    let command: Promise<unknown>;
    try {
      command = this.#debugger
        .sendCommand(method, params)
        .finally(() => {
          commandSettled = true;
        });
    } catch (error) {
      if (timeout !== undefined) clearTimeout(timeout);
      removeAbortListener();
      throw asAgentBrowserError(error, "cdp_command_failed");
    }
    try {
      return await Promise.race([
        command,
        timeoutDeadline,
        ...(abortDeadline === undefined ? [] : [abortDeadline]),
      ]);
    } catch (error) {
      if (error === abortFailure && !commandSettled) {
        try {
          await Promise.race([command, timeoutDeadline]);
        } catch (settleError) {
          if (
            settleError === timeoutError &&
            !commandSettled
          ) {
            this.#failClosed(
              `CDP command ${method} did not settle after cancellation`,
            );
            void command.catch(() => {});
          }
        }
      } else if (error === timeoutError && !commandSettled) {
        this.#failClosed(
          `CDP command ${method} did not settle before its deadline`,
        );
        void command.catch(() => {});
      }
      throw asAgentBrowserError(error, "cdp_command_failed");
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      removeAbortListener();
    }
  }

  #failClosed(reason: string): void {
    if (this.#disposed) return;
    this.#endAnnotationPicker("target_gone", reason);
    this.#disposed = true;
    this.#references.clear();
    this.#failNavigationObservations(
      new AgentBrowserError("target_gone", reason),
    );
    this.#removeListeners();
    if (this.#debugger.isAttached()) {
      this.#intentionalDetach = true;
      try {
        this.#debugger.detach();
      } catch {
        // Main closes the owning guest through the detach callback below.
      }
    }
    this.#attached = false;
    this.#onDetach?.(reason);
  }

  #removeListeners(): void {
    this.#debugger.off("message", this.#handleMessage);
    this.#debugger.off("detach", this.#handleDetach);
  }
}
