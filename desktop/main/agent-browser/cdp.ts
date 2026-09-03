import {
  inferAgentBrowserNodeActions,
  MAX_AGENT_BROWSER_SCROLL_COORDINATE,
  type AgentBrowserCursorPoint,
  type AgentBrowserCursorViewport,
  type AgentBrowserFindQuery,
  type AgentBrowserFindView,
  type AgentBrowserNodeAction,
  type AgentBrowserScrollDirection,
  type AgentBrowserSemanticTarget,
  type AgentBrowserSnapshotNode,
} from "@minke/harness-overlay/agent-browser-contract.ts";
import type {
  AgentBrowserAnnotationTarget,
  AgentBrowserAnnotationViewport,
} from "@minke/harness-overlay/agent-browser-annotation-contract.ts";
import {
  GENERATED_LOCATOR_RESOLVER_FUNCTION,
  parseGeneratedLocatorCode,
} from "./experimental-generated-locator.ts";

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const MAX_SNAPSHOT_NODES = 300;
const MAX_INDEX_NODES = 50_000;
const MAX_DOM_FALLBACK_NODES = 100_000;
const MAX_FIND_CURSORS = 128;
const MAX_SNAPSHOT_DEPTH = 128;
const MAX_SNAPSHOT_URL_LENGTH = 8_192;
const MAX_SCREENSHOT_BASE64_LENGTH = 8 * 1024 * 1024;
const GENERATED_LOCATOR_COMMAND_TIMEOUT_MS = 2_000;
const GENERATED_LOCATOR_WORLD_NAME =
  "minke-agent-browser-generated-locator";
const SCROLL_WORLD_NAME = "minke-agent-browser-scroll";
const SCROLL_FUNCTION = `function minkeScroll(direction, amount) {
  const target = this?.nodeType === 9
    ? (this.scrollingElement || this.documentElement || this.body)
    : this;
  if (!target) return null;
  const maxX = Math.max(
    0,
    Math.round(Number(target.scrollWidth) - Number(target.clientWidth)),
  );
  const maxY = Math.max(
    0,
    Math.round(Number(target.scrollHeight) - Number(target.clientHeight)),
  );
  const rtl = getComputedStyle(target).direction === "rtl";
  const normalizedX = () => Math.max(
    0,
    Math.min(
      maxX,
      Math.round(
        rtl
          ? maxX + Number(target.scrollLeft)
          : Number(target.scrollLeft),
      ),
    ),
  );
  const normalizedY = () => Math.max(
    0,
    Math.min(maxY, Math.round(Number(target.scrollTop))),
  );
  const beforeX = normalizedX();
  const beforeY = normalizedY();
  let nextX = beforeX;
  let nextY = beforeY;
  if (direction === "left") nextX -= amount;
  if (direction === "right") nextX += amount;
  if (direction === "up") nextY -= amount;
  if (direction === "down") nextY += amount;
  if (direction === "top") nextY = 0;
  if (direction === "bottom") nextY = maxY;
  nextX = Math.max(0, Math.min(maxX, nextX));
  nextY = Math.max(0, Math.min(maxY, nextY));
  const rawX = rtl ? nextX - maxX : nextX;
  if (typeof target.scrollTo === "function") {
    target.scrollTo({
      left: rawX,
      top: nextY,
      behavior: "instant",
    });
  } else {
    target.scrollLeft = rawX;
    target.scrollTop = nextY;
  }
  const afterX = normalizedX();
  const afterY = normalizedY();
  return {
    beforeX,
    beforeY,
    afterX,
    afterY,
    maxX,
    maxY,
    moved: beforeX !== afterX || beforeY !== afterY,
  };
}`;
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
const INTERACTIVE_AX_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "iframe",
  "link",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);
const OUTLINE_AX_ROLES = new Set([
  "alert",
  "alertdialog",
  "article",
  "banner",
  "complementary",
  "contentinfo",
  "dialog",
  "document",
  "feed",
  "form",
  "grid",
  "heading",
  "list",
  "main",
  "navigation",
  "region",
  "rootwebarea",
  "rowgroup",
  "search",
  "table",
  "tablist",
  "toolbar",
  "tree",
  "treegrid",
  "webarea",
]);

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
  readonly onReferencesDirty?: (
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

export interface AgentBrowserCdpScrollResult {
  /** "page" or the exact current ref of a scroll container. */
  readonly scope: string;
  readonly beforeX: number;
  readonly beforeY: number;
  readonly afterX: number;
  readonly afterY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly moved: boolean;
}

export type AgentBrowserTargetAction = AgentBrowserNodeAction;

interface AxValue {
  readonly value?: unknown;
  readonly sources?: unknown;
}

interface AxValueSource {
  readonly attribute?: unknown;
  readonly attributeValue?: AxValue;
}

interface AxProperty {
  readonly name?: unknown;
  readonly value?: AxValue;
}

interface AxNode {
  readonly backendDOMNodeId?: unknown;
  readonly ignored?: unknown;
  readonly nodeId?: unknown;
  readonly parentId?: unknown;
  readonly role?: AxValue;
  readonly name?: AxValue;
  readonly description?: AxValue;
  readonly value?: AxValue;
  readonly properties?: unknown;
}

interface InteractionTargetInspection {
  readonly connected?: unknown;
  readonly directlyInteractive?: unknown;
  readonly nestedInteractive?: unknown;
  readonly nestedRole?: unknown;
  readonly nestedName?: unknown;
  readonly disabled?: unknown;
}

interface FillTargetInspection {
  readonly editable?: unknown;
  readonly disabled?: unknown;
  readonly readOnly?: unknown;
}

interface HitTargetInspection {
  readonly targetOrDescendant?: unknown;
  readonly tag?: unknown;
  readonly name?: unknown;
}

interface DomNode {
  readonly backendNodeId?: unknown;
  readonly localName?: unknown;
  readonly nodeName?: unknown;
  readonly attributes?: unknown;
}

interface DomSnapshotNodeTable {
  readonly parentIndex?: unknown;
  readonly nodeType?: unknown;
  readonly nodeName?: unknown;
  readonly nodeValue?: unknown;
  readonly backendNodeId?: unknown;
  readonly attributes?: unknown;
}

interface DomSnapshotDocument {
  readonly nodes?: unknown;
}

interface DomSnapshotCandidate {
  readonly backendNodeId: number;
  readonly parentBackendNodeId?: number;
  readonly role: string;
  readonly name: string;
  readonly actionable: boolean;
  readonly disabled: boolean;
  readonly url?: string;
}

interface DomSnapshotIndex {
  readonly candidates: readonly DomSnapshotCandidate[];
  readonly orderByBackendNodeId: ReadonlyMap<number, number>;
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
  readonly role: string;
  readonly name: string;
  readonly actionable: boolean;
  readonly disabled: boolean;
  readonly actions: readonly AgentBrowserNodeAction[];
}

interface SnapshotCacheEntry extends SnapshotReference {
  readonly ref: string;
  readonly parentIndex?: number;
  readonly depth?: number;
  readonly value?: string;
  readonly placeholder?: string;
  readonly url?: string;
  readonly description?: string;
  readonly source?: "accessibility" | "dom" | "accessibility+dom";
  readonly confidence?: "high" | "medium";
  readonly semanticKey: string;
}

interface PendingSnapshotEntry extends SnapshotReference {
  readonly nodeId?: string;
  readonly parentId?: string;
  readonly depth?: number;
  readonly value?: string;
  readonly placeholder?: string;
  readonly url?: string;
  readonly description?: string;
  readonly parentBackendNodeId?: number;
  readonly source?: "accessibility" | "dom" | "accessibility+dom";
  readonly confidence?: "high" | "medium";
}

interface SnapshotCache {
  readonly snapshotId: string;
  readonly entries: readonly SnapshotCacheEntry[];
  readonly indexTruncated: boolean;
}

interface FindCursorState {
  readonly snapshotId: string;
  readonly query: AgentBrowserFindQuery;
  readonly view: AgentBrowserFindView;
  readonly depth: number;
  readonly limit: number;
  readonly offset: number;
}

interface ResolvedReference extends SnapshotReference {
  readonly generation: number;
}

interface AnnotationReference {
  readonly backendNodeId: number;
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

function optionalBoundedText(
  value: unknown,
  maxLength: number,
): string | undefined {
  return typeof value === "string"
    ? value.slice(0, maxLength)
    : undefined;
}

function normalizedSemanticText(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLowerCase();
}

function semanticTextMatches(
  actual: string,
  expected: string,
  exact: boolean,
): boolean {
  const normalizedActual = normalizedSemanticText(actual);
  const normalizedExpected = normalizedSemanticText(expected);
  return exact
    ? normalizedActual === normalizedExpected
    : normalizedActual.includes(normalizedExpected);
}

function semanticUrlMatches(
  actual: string,
  expected: string,
  exact: boolean,
): boolean {
  const normalizedExpected = expected.trim();
  return exact
    ? actual === normalizedExpected
    : actual.includes(normalizedExpected);
}

function snapshotNodes(
  entries: readonly SnapshotCacheEntry[],
  selectedIndices?: ReadonlySet<number>,
): AgentBrowserSnapshotNode[] {
  const indices = selectedIndices === undefined
    ? entries.map((_entry, index) => index)
    : [...selectedIndices].sort((left, right) => left - right);
  const exposed = selectedIndices ??
    new Set(indices);
  return indices.map((index) => {
    const entry = entries[index] as SnapshotCacheEntry;
    let parentIndex = entry.parentIndex;
    const visited = new Set<number>();
    while (
      parentIndex !== undefined &&
      (
        !exposed.has(parentIndex) ||
        parentIndex >= index
      ) &&
      !visited.has(parentIndex) &&
      visited.size < MAX_SNAPSHOT_DEPTH
    ) {
      visited.add(parentIndex);
      parentIndex = entries[parentIndex]?.parentIndex;
    }
    const parentRef = parentIndex === undefined
      ? undefined
      : entries[parentIndex]?.ref;
    return {
      ref: entry.ref,
      role: entry.role,
      name: entry.name,
      ...(entry.depth === undefined ? {} : { depth: entry.depth }),
      ...(parentRef === undefined ? {} : { parentRef }),
      actionable: entry.actionable,
      disabled: entry.disabled,
      ...(entry.actions.length === 0 ? {} : { actions: entry.actions }),
      ...(entry.value === undefined ? {} : { value: entry.value }),
      ...(entry.placeholder === undefined
        ? {}
        : { placeholder: entry.placeholder }),
      ...(entry.url === undefined ? {} : { url: entry.url }),
      ...(entry.description === undefined
        ? {}
        : { description: entry.description }),
      ...(entry.source === undefined ? {} : { source: entry.source }),
      ...(entry.confidence === undefined
        ? {}
        : { confidence: entry.confidence }),
    };
  });
}

function outlineSnapshotNodes(
  entries: readonly SnapshotCacheEntry[],
): AgentBrowserSnapshotNode[] {
  if (entries.length <= MAX_SNAPSHOT_NODES) {
    return snapshotNodes(entries);
  }
  const selected = new Set<number>();
  const add = (index: number | undefined): void => {
    if (
      index === undefined ||
      selected.size >= MAX_SNAPSHOT_NODES
    ) {
      return;
    }
    selected.add(index);
  };
  add(0);

  // Reserve the first part of the projection for document structure. This
  // keeps the overview useful even on pages with thousands of controls.
  const outlineBudget = Math.min(120, MAX_SNAPSHOT_NODES);
  for (
    let index = 0;
    index < entries.length && selected.size < outlineBudget;
    index += 1
  ) {
    const entry = entries[index];
    if (
      entry !== undefined &&
      OUTLINE_AX_ROLES.has(entry.role.toLowerCase())
    ) {
      add(index);
    }
  }

  const actionableIndices = entries.flatMap((entry, index) =>
    entry.actionable && !entry.disabled ? [index] : []
  );
  const remaining = MAX_SNAPSHOT_NODES - selected.size;
  if (actionableIndices.length <= remaining) {
    for (const index of actionableIndices) add(index);
  } else if (remaining > 0) {
    // Sample across the whole document rather than exposing only the first
    // viewport-sized prefix. browser_find provides lossless refinement.
    for (let slot = 0; slot < remaining; slot += 1) {
      const sampleIndex = remaining === 1
        ? 0
        : Math.floor(
          slot * (actionableIndices.length - 1) / (remaining - 1),
        );
      add(actionableIndices[sampleIndex]);
    }
  }

  for (
    let index = 0;
    index < entries.length &&
      selected.size < MAX_SNAPSHOT_NODES;
    index += 1
  ) {
    add(index);
  }
  return snapshotNodes(entries, selected);
}

function axPropertyValue(
  node: AxNode,
  name: string,
): unknown {
  if (!Array.isArray(node.properties)) return undefined;
  const property = (node.properties as AxProperty[]).find(
    (candidate) => candidate.name === name,
  );
  return property?.value?.value;
}

function axNameSourceValue(
  node: AxNode,
  attributeName: string,
): string | undefined {
  if (!Array.isArray(node.name?.sources)) return undefined;
  const source = (node.name.sources as AxValueSource[]).find(
    (candidate) =>
      candidate.attribute === attributeName,
  );
  return optionalBoundedText(
    source?.attributeValue?.value,
    500,
  );
}

function axNodeDepth(
  node: AxNode,
  nodesById: ReadonlyMap<string, AxNode>,
): number {
  let depth = 0;
  let parentId =
    typeof node.parentId === "string" ? node.parentId : undefined;
  const visited = new Set<string>();
  while (
    parentId !== undefined &&
    depth < MAX_SNAPSHOT_DEPTH &&
    !visited.has(parentId)
  ) {
    visited.add(parentId);
    const parent = nodesById.get(parentId);
    if (parent === undefined) break;
    depth += 1;
    parentId =
      typeof parent.parentId === "string"
        ? parent.parentId
        : undefined;
  }
  return depth;
}

function domSnapshotIndex(
  value: unknown,
): DomSnapshotIndex {
  const result = record(value);
  const strings = Array.isArray(result.strings)
    ? result.strings
    : [];
  const documents = Array.isArray(result.documents)
    ? result.documents as DomSnapshotDocument[]
    : [];
  const stringValue = (
    index: unknown,
    maxLength = 500,
  ): string =>
    Number.isSafeInteger(index) &&
      typeof strings[Number(index)] === "string"
      ? boundedText(strings[Number(index)], maxLength)
      : "";
  const candidates: DomSnapshotCandidate[] = [];
  const orderByBackendNodeId = new Map<number, number>();
  let documentOrderBase = 0;
  for (const document of documents) {
    const nodes = record(document.nodes) as DomSnapshotNodeTable;
    const backendIds = Array.isArray(nodes.backendNodeId)
      ? nodes.backendNodeId
      : [];
    const parentIndices = Array.isArray(nodes.parentIndex)
      ? nodes.parentIndex
      : [];
    const nodeTypes = Array.isArray(nodes.nodeType)
      ? nodes.nodeType
      : [];
    const nodeNames = Array.isArray(nodes.nodeName)
      ? nodes.nodeName
      : [];
    const nodeValues = Array.isArray(nodes.nodeValue)
      ? nodes.nodeValue
      : [];
    const attributeTables = Array.isArray(nodes.attributes)
      ? nodes.attributes
      : [];
    const length = Math.min(
      backendIds.length,
      MAX_DOM_FALLBACK_NODES,
    );
    for (let index = 0; index < length; index += 1) {
      const backendNodeId = Number(backendIds[index]);
      if (
        Number.isSafeInteger(backendNodeId) &&
        backendNodeId > 0 &&
        !orderByBackendNodeId.has(backendNodeId)
      ) {
        orderByBackendNodeId.set(
          backendNodeId,
          documentOrderBase + index,
        );
      }
    }
    const textContent = Array.from(
      { length },
      (_unused, index) =>
        nodeTypes[index] === 3
          ? stringValue(nodeValues[index], 500)
          : "",
    );
    for (let index = length - 1; index >= 0; index -= 1) {
      const parentIndex = Number(parentIndices[index]);
      const text = textContent[index];
      if (
        text === "" ||
        !Number.isSafeInteger(parentIndex) ||
        parentIndex < 0 ||
        parentIndex >= length
      ) {
        continue;
      }
      textContent[parentIndex] = boundedText(
        `${textContent[parentIndex] ?? ""} ${text}`,
        500,
      ).replace(/\s+/gu, " ").trim();
    }
    for (let index = 0; index < length; index += 1) {
      if (nodeTypes[index] !== 1) continue;
      const backendNodeId = Number(backendIds[index]);
      if (
        !Number.isSafeInteger(backendNodeId) ||
        backendNodeId <= 0
      ) {
        continue;
      }
      const rawAttributes = Array.isArray(attributeTables[index])
        ? attributeTables[index] as unknown[]
        : [];
      const attributes = new Map<string, string>();
      for (
        let attributeIndex = 0;
        attributeIndex + 1 < rawAttributes.length;
        attributeIndex += 2
      ) {
        const name = stringValue(
          rawAttributes[attributeIndex],
          160,
        ).toLowerCase();
        if (name === "") continue;
        attributes.set(
          name,
          stringValue(rawAttributes[attributeIndex + 1], 8_192),
        );
      }
      const tag = stringValue(nodeNames[index], 80).toLowerCase();
      const explicitRole = boundedText(
        attributes.get("role"),
        80,
      ).toLowerCase();
      const inputType = boundedText(
        attributes.get("type"),
        80,
      ).toLowerCase();
      const href = boundedText(
        attributes.get("href"),
        MAX_SNAPSHOT_URL_LENGTH,
      );
      const disabled =
        attributes.has("disabled") ||
        attributes.get("aria-disabled") === "true" ||
        attributes.has("inert");
      const hidden =
        attributes.has("hidden") ||
        attributes.get("aria-hidden") === "true" ||
        inputType === "hidden";
      const standardInteractive =
        (tag === "a" && href !== "") ||
        tag === "button" ||
        tag === "select" ||
        tag === "textarea" ||
        tag === "summary" ||
        (tag === "input" && inputType !== "hidden");
      const customInteractive =
        INTERACTIVE_AX_ROLES.has(explicitRole) ||
        attributes.has("onclick") ||
        (
          attributes.has("tabindex") &&
          attributes.get("tabindex") !== "-1"
        ) ||
        (
          attributes.has("contenteditable") &&
          attributes.get("contenteditable") !== "false"
        );
      const actionable =
        !hidden &&
        !disabled &&
        (standardInteractive || customInteractive);
      if (!actionable) continue;
      const inferredRole =
        explicitRole ||
        (
          tag === "a"
            ? "link"
            : tag === "button" || tag === "summary"
              ? "button"
              : tag === "select"
                ? "combobox"
                : tag === "textarea"
                  ? "textbox"
                  : inputType === "checkbox"
                    ? "checkbox"
                    : inputType === "radio"
                      ? "radio"
                      : inputType === "range"
                        ? "slider"
                        : tag === "input"
                          ? "textbox"
                          : "button"
        );
      const name = (
        boundedText(attributes.get("aria-label"), 500) ||
        boundedText(attributes.get("title"), 500) ||
        boundedText(attributes.get("alt"), 500) ||
        boundedText(attributes.get("placeholder"), 500) ||
        boundedText(textContent[index], 500) ||
        boundedText(attributes.get("value"), 500)
      ).replace(/\s+/gu, " ").trim();
      const parentIndex = Number(parentIndices[index]);
      const parentBackendNodeId =
        Number.isSafeInteger(parentIndex) &&
          parentIndex >= 0 &&
          parentIndex < length &&
          Number.isSafeInteger(backendIds[parentIndex]) &&
          Number(backendIds[parentIndex]) > 0
          ? Number(backendIds[parentIndex])
          : undefined;
      candidates.push({
        backendNodeId,
        ...(parentBackendNodeId === undefined
          ? {}
          : { parentBackendNodeId }),
        role: inferredRole,
        name,
        actionable: true,
        disabled: false,
        ...(href === "" ? {} : { url: href }),
      });
    }
    documentOrderBase += length;
  }
  return { candidates, orderByBackendNodeId };
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

function boundedScrollCoordinate(
  value: unknown,
): number | undefined {
  return typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= MAX_AGENT_BROWSER_SCROLL_COORDINATE
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
  readonly #onReferencesDirty:
    | ((reason: AgentBrowserGenerationChangeReason) => void)
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
  #referencesDirty = false;
  #scrollSequence = 0;
  #snapshotCache: SnapshotCache | undefined;
  readonly #findCursors = new Map<string, FindCursorState>();
  #findCursorSequence = 0;
  #generatedLocatorSequence = 0;
  #mainFrameId: string | undefined;
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
    this.#onReferencesDirty = options.onReferencesDirty;
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
    this.#snapshotCache = undefined;
    this.#findCursors.clear();
    this.#referencesDirty = false;
    this.#clearAnnotationReferences();
    this.#endAnnotationPicker(
      "navigation",
      "The page changed while browser annotation was active",
    );
    this.#generation += 1;
    this.#onGenerationChange?.(this.#generation, reason);
    return this.#generation;
  }

  markReferencesDirty(
    reason: AgentBrowserGenerationChangeReason = "references",
  ): void {
    const changed = !this.#referencesDirty;
    this.#referencesDirty = true;
    this.#clearAnnotationReferences();
    this.#endAnnotationPicker(
      "navigation",
      "The page changed while browser annotation was active",
    );
    if (changed) this.#onReferencesDirty?.(reason);
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
      this.#mainFrameId = result.frameId;
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
    readonly view: "outline";
    readonly totalNodes: number;
    readonly actionableNodes: number;
    readonly indexTruncated: boolean;
  }> {
    if (!this.#referencesDirty && this.#snapshotCache !== undefined) {
      const cached = this.#snapshotCache;
      return {
        snapshotId: cached.snapshotId,
        nodes: outlineSnapshotNodes(cached.entries),
        view: "outline",
        totalNodes: cached.entries.length,
        actionableNodes: cached.entries.filter(
          (entry) => entry.actionable && !entry.disabled,
        ).length,
        indexTruncated: cached.indexTruncated,
      };
    }
    const [axValue, domValue] = await Promise.all([
      this.#command(
        "Accessibility.getFullAXTree",
        {},
        signal,
      ),
      this.#command(
        "DOMSnapshot.captureSnapshot",
        {
          computedStyles: [],
          includePaintOrder: false,
          includeDOMRects: false,
        },
        signal,
      ).catch((error: unknown) => {
        if (signal?.aborted === true) throw error;
        // Accessibility remains authoritative when an older Chromium target
        // does not expose DOMSnapshot.
        return undefined;
      }),
    ]);
    const result = commandResult<{
      nodes?: unknown;
    }>(axValue);
    const domIndex = domValue === undefined
      ? undefined
      : domSnapshotIndex(domValue);
    const domCandidates = domIndex?.candidates ?? [];
    const candidates = Array.isArray(result.nodes)
      ? result.nodes as AxNode[]
      : [];
    const nodesById = new Map<string, AxNode>();
    for (const candidate of candidates) {
      if (typeof candidate.nodeId === "string") {
        nodesById.set(candidate.nodeId, candidate);
      }
    }
    const duplicateStructuralWrappers = new Set<string>();
    const actionableNamesByNodeId = new Map<string, string>();
    for (const candidate of candidates) {
      const role =
        boundedText(candidate.role?.value, 80) || "generic";
      const name = boundedText(candidate.name?.value, 500);
      const disabled = axPropertyValue(candidate, "disabled") === true;
      const actionable =
        !disabled &&
        (
          INTERACTIVE_AX_ROLES.has(role.toLowerCase()) ||
          axPropertyValue(candidate, "focusable") === true
        );
      if (!actionable || name === "") continue;
      if (typeof candidate.nodeId === "string") {
        actionableNamesByNodeId.set(
          candidate.nodeId,
          normalizedSemanticText(name),
        );
      }
      let parentId =
        typeof candidate.parentId === "string"
          ? candidate.parentId
          : undefined;
      const visited = new Set<string>();
      while (
        parentId !== undefined &&
        !visited.has(parentId) &&
        visited.size < MAX_SNAPSHOT_DEPTH
      ) {
        visited.add(parentId);
        duplicateStructuralWrappers.add(
          JSON.stringify([
            parentId,
            normalizedSemanticText(name),
          ]),
        );
        const parent = nodesById.get(parentId);
        parentId =
          typeof parent?.parentId === "string"
            ? parent.parentId
            : undefined;
      }
    }
    const eligibleEntries: PendingSnapshotEntry[] = [];
    for (const candidate of candidates) {
      if (
        candidate.ignored === true ||
        !Number.isSafeInteger(candidate.backendDOMNodeId) ||
        Number(candidate.backendDOMNodeId) <= 0
      ) {
        continue;
      }
      const role =
        boundedText(candidate.role?.value, 80) || "generic";
      const name = boundedText(candidate.name?.value, 500);
      const description = boundedText(
        candidate.description?.value,
        500,
      );
      const depth = axNodeDepth(candidate, nodesById);
      const disabled = axPropertyValue(candidate, "disabled") === true;
      const actionable =
        !disabled &&
        (
          INTERACTIVE_AX_ROLES.has(role.toLowerCase()) ||
          axPropertyValue(candidate, "focusable") === true
        );
      let duplicatesActionableAncestor = false;
      if (
        !actionable &&
        name !== "" &&
        typeof candidate.parentId === "string"
      ) {
        let parentId: string | undefined = candidate.parentId;
        const visited = new Set<string>();
        const normalizedName = normalizedSemanticText(name);
        while (
          parentId !== undefined &&
          !visited.has(parentId) &&
          visited.size < MAX_SNAPSHOT_DEPTH
        ) {
          visited.add(parentId);
          if (
            actionableNamesByNodeId.get(parentId) === normalizedName
          ) {
            duplicatesActionableAncestor = true;
            break;
          }
          const parent = nodesById.get(parentId);
          parentId =
            typeof parent?.parentId === "string"
              ? parent.parentId
              : undefined;
        }
      }
      if (
        duplicatesActionableAncestor ||
        (
          !actionable &&
          name !== "" &&
          typeof candidate.nodeId === "string" &&
          duplicateStructuralWrappers.has(
            JSON.stringify([
              candidate.nodeId,
              normalizedSemanticText(name),
            ]),
          )
        )
      ) {
        continue;
      }
      const value = optionalBoundedText(
        candidate.value?.value,
        2_000,
      );
      const placeholder = axNameSourceValue(
        candidate,
        "placeholder",
      );
      const url = boundedText(
        axPropertyValue(candidate, "url"),
        MAX_SNAPSHOT_URL_LENGTH,
      );
      eligibleEntries.push({
        backendNodeId: Number(candidate.backendDOMNodeId),
        ...(typeof candidate.nodeId === "string"
          ? { nodeId: candidate.nodeId }
          : {}),
        ...(typeof candidate.parentId === "string"
          ? { parentId: candidate.parentId }
          : {}),
        role,
        name,
        depth,
        actionable,
        disabled,
        actions: inferAgentBrowserNodeActions({
          role,
          actionable,
          disabled,
        }),
        ...(value === undefined ? {} : { value }),
        ...(placeholder === undefined ? {} : { placeholder }),
        ...(url === "" ? {} : { url }),
        ...(description === "" ? {} : { description }),
      });
    }
    const eligibleIndexByBackendId = new Map<number, number>();
    eligibleEntries.forEach((entry, index) => {
      eligibleIndexByBackendId.set(entry.backendNodeId, index);
    });
    for (const domCandidate of domCandidates) {
      const existingIndex = eligibleIndexByBackendId.get(
        domCandidate.backendNodeId,
      );
      if (existingIndex !== undefined) {
        const existing = eligibleEntries[existingIndex];
        if (existing === undefined) continue;
        const existingRole = existing.role.toLowerCase();
        const domAddsActionability =
          !existing.actionable && domCandidate.actionable;
        const fusedRole =
          domAddsActionability &&
            (
              existingRole === "generic" ||
              existingRole === "statictext"
            )
            ? domCandidate.role
            : existing.role;
        const fusedActionable =
          existing.actionable || domCandidate.actionable;
        const fusedDisabled =
          existing.disabled || domCandidate.disabled;
        eligibleEntries[existingIndex] = {
          ...existing,
          role: fusedRole,
          name: existing.name || domCandidate.name,
          actionable: fusedActionable,
          disabled: fusedDisabled,
          actions: inferAgentBrowserNodeActions({
            role: fusedRole,
            actionable: fusedActionable,
            disabled: fusedDisabled,
          }),
          ...(existing.url !== undefined
            ? { url: existing.url }
            : domCandidate.url === undefined
              ? {}
              : { url: domCandidate.url }),
          source: "accessibility+dom",
          confidence:
            existing.actionable && domCandidate.actionable
              ? "high"
              : "medium",
        };
        continue;
      }
      if (!domCandidate.actionable) continue;
      const index = eligibleEntries.length;
      eligibleEntries.push({
        backendNodeId: domCandidate.backendNodeId,
        ...(domCandidate.parentBackendNodeId === undefined
          ? {}
          : {
              parentBackendNodeId:
                domCandidate.parentBackendNodeId,
            }),
        role: domCandidate.role,
        name: domCandidate.name,
        actionable: true,
        disabled: false,
        actions: inferAgentBrowserNodeActions({
          role: domCandidate.role,
          actionable: true,
          disabled: false,
        }),
        ...(domCandidate.url === undefined
          ? {}
          : { url: domCandidate.url }),
        source: "dom",
        confidence: "medium",
      });
      eligibleIndexByBackendId.set(
        domCandidate.backendNodeId,
        index,
      );
    }
    if (domIndex !== undefined) {
      eligibleEntries.sort((left, right) => {
        const leftOrder = domIndex.orderByBackendNodeId.get(
          left.backendNodeId,
        );
        const rightOrder = domIndex.orderByBackendNodeId.get(
          right.backendNodeId,
        );
        if (leftOrder === undefined) {
          return rightOrder === undefined ? 0 : 1;
        }
        return rightOrder === undefined
          ? -1
          : leftOrder - rightOrder;
      });
    }
    eligibleIndexByBackendId.clear();
    eligibleEntries.forEach((entry, index) => {
      eligibleIndexByBackendId.set(entry.backendNodeId, index);
    });
    const eligibleIndexByNodeId = new Map<string, number>();
    eligibleEntries.forEach((entry, index) => {
      if (entry.nodeId !== undefined) {
        eligibleIndexByNodeId.set(entry.nodeId, index);
      }
    });
    const selectedIndices = new Set<number>();
    const select = (index: number | undefined): void => {
      if (
        index === undefined ||
        selectedIndices.size >= MAX_INDEX_NODES
      ) {
        return;
      }
      selectedIndices.add(index);
    };
    for (let index = 0; index < eligibleEntries.length; index += 1) {
      if (eligibleEntries[index]?.actionable === true) {
        select(index);
      }
    }
    for (let index = 0; index < eligibleEntries.length; index += 1) {
      if (
        eligibleEntries[index]?.actionable !== true ||
        selectedIndices.size >= MAX_INDEX_NODES
      ) {
        continue;
      }
      select(
        eligibleEntries[index]?.parentBackendNodeId === undefined
          ? undefined
          : eligibleIndexByBackendId.get(
            eligibleEntries[index]?.parentBackendNodeId as number,
          ),
      );
      let parentId = eligibleEntries[index]?.parentId;
      const visited = new Set<string>();
      while (
        parentId !== undefined &&
        !visited.has(parentId) &&
        visited.size < MAX_SNAPSHOT_DEPTH &&
        selectedIndices.size < MAX_INDEX_NODES
      ) {
        visited.add(parentId);
        select(eligibleIndexByNodeId.get(parentId));
        const parent = nodesById.get(parentId);
        parentId =
          typeof parent?.parentId === "string"
            ? parent.parentId
            : undefined;
      }
    }
    for (
      let index = 0;
      index < eligibleEntries.length &&
        selectedIndices.size < MAX_INDEX_NODES;
      index += 1
    ) {
      select(index);
    }
    const pendingEntries = eligibleEntries.filter(
      (_entry, index) => selectedIndices.has(index),
    );
    const entryIndexByNodeId = new Map<string, number>();
    const entryIndexByBackendNodeId = new Map<number, number>();
    pendingEntries.forEach((entry, index) => {
      entryIndexByBackendNodeId.set(entry.backendNodeId, index);
      if (entry.nodeId !== undefined) {
        entryIndexByNodeId.set(entry.nodeId, index);
      }
    });
    const entries: Omit<SnapshotCacheEntry, "ref">[] =
      pendingEntries.map((pending) => {
        let parentId = pending.parentId;
        let parentIndex =
          pending.parentBackendNodeId === undefined
            ? undefined
            : entryIndexByBackendNodeId.get(
              pending.parentBackendNodeId,
            );
        const visited = new Set<string>();
        while (
          parentIndex === undefined &&
          parentId !== undefined &&
          !visited.has(parentId) &&
          visited.size < MAX_SNAPSHOT_DEPTH
        ) {
          visited.add(parentId);
          parentIndex = entryIndexByNodeId.get(parentId);
          if (parentIndex !== undefined) break;
          const parent = nodesById.get(parentId);
          parentId =
            typeof parent?.parentId === "string"
              ? parent.parentId
              : undefined;
        }
        const {
          nodeId: _nodeId,
          parentId: _parentId,
          parentBackendNodeId: _parentBackendNodeId,
          ...entry
        } = pending;
        return {
          ...entry,
          ...(parentIndex === undefined ? {} : { parentIndex }),
          semanticKey: JSON.stringify([
            entry.role,
            entry.name,
            entry.description ?? "",
            entry.depth,
            parentIndex,
            entry.actionable,
            entry.disabled,
            entry.actions,
            entry.value,
            entry.placeholder,
            entry.url,
            entry.source,
            entry.confidence,
          ]),
        };
      });

    const previous = this.#snapshotCache;
    const semanticMatch =
      previous !== undefined &&
      previous.entries.length === entries.length &&
      entries.every(
        (entry, index) =>
          previous.entries[index]?.semanticKey === entry.semanticKey,
      );
    if (previous !== undefined && semanticMatch) {
      this.#references.clear();
      const reboundEntries = entries.map((entry, index) => ({
        ...entry,
        ref: previous.entries[index]?.ref ??
          `s${String(this.#generation)}:e${String(index + 1)}`,
      }));
      for (const entry of reboundEntries) {
        this.#references.set(entry.ref, {
          backendNodeId: entry.backendNodeId,
          role: entry.role,
          name: entry.name,
          actionable: entry.actionable ?? false,
          disabled: entry.disabled ?? false,
          actions: entry.actions,
        });
      }
      this.#referencesDirty = false;
      this.#snapshotCache = {
        snapshotId: previous.snapshotId,
        entries: reboundEntries,
        indexTruncated:
          eligibleEntries.length > reboundEntries.length,
      };
      return {
        snapshotId: previous.snapshotId,
        nodes: outlineSnapshotNodes(reboundEntries),
        view: "outline",
        totalNodes: reboundEntries.length,
        actionableNodes: reboundEntries.filter(
          (entry) => entry.actionable && !entry.disabled,
        ).length,
        indexTruncated:
          eligibleEntries.length > reboundEntries.length,
      };
    }

    if (previous !== undefined || this.#references.size > 0) {
      this.invalidateReferences();
    }
    const generation = this.#generation;
    this.#references.clear();
    const snapshotEntries = entries.map((entry, index) => ({
      ...entry,
      ref: `s${String(generation)}:e${String(index + 1)}`,
    }));
    for (const entry of snapshotEntries) {
      this.#references.set(entry.ref, {
        backendNodeId: entry.backendNodeId,
        role: entry.role,
        name: entry.name,
        actionable: entry.actionable ?? false,
        disabled: entry.disabled ?? false,
        actions: entry.actions,
      });
    }
    this.#referencesDirty = false;
    this.#snapshotCache = {
      snapshotId: `s${String(generation)}`,
      entries: snapshotEntries,
      indexTruncated:
        eligibleEntries.length > snapshotEntries.length,
    };
    return {
      snapshotId: `s${String(generation)}`,
      nodes: outlineSnapshotNodes(snapshotEntries),
      view: "outline",
      totalNodes: snapshotEntries.length,
      actionableNodes: snapshotEntries.filter(
        (entry) => entry.actionable && !entry.disabled,
      ).length,
      indexTruncated:
        eligibleEntries.length > snapshotEntries.length,
    };
  }

  async find(
    request:
      | {
          readonly query: AgentBrowserFindQuery;
          readonly view: AgentBrowserFindView;
          readonly depth: number;
          readonly limit: number;
        }
      | { readonly cursor: string },
    signal?: AbortSignal,
  ): Promise<{
    readonly snapshotId: string;
    readonly nodes: readonly AgentBrowserSnapshotNode[];
    readonly view: AgentBrowserFindView;
    readonly totalNodes: number;
    readonly actionableNodes: number;
    readonly totalMatches: number;
    readonly offset: number;
    readonly indexTruncated: boolean;
    readonly nextCursor?: string;
  }> {
    await this.snapshot(signal);
    const cache = this.#snapshotCache;
    if (cache === undefined) {
      throw new AgentBrowserError(
        "snapshot_required",
        "Agent Browser could not retain the current page index",
      );
    }

    let query: AgentBrowserFindQuery;
    let view: AgentBrowserFindView;
    let depth: number;
    let limit: number;
    let offset: number;
    if ("cursor" in request) {
      const cursor = this.#findCursors.get(request.cursor);
      if (
        cursor === undefined ||
        cursor.snapshotId !== cache.snapshotId
      ) {
        throw new AgentBrowserError(
          "stale_ref",
          "Agent Browser find cursor is stale or unknown; start a new browser_find query",
        );
      }
      ({ query, view, depth, limit, offset } = cursor);
    } else {
      ({ query, view, depth, limit } = request);
      offset = 0;
    }
    if (
      query.index !== undefined &&
      cache.indexTruncated
    ) {
      throw new AgentBrowserError(
        "index_truncated",
        "Agent Browser cannot resolve an ordinal against a truncated "
          + "page index. Resolve a unique item without ordinal, or use "
          + "browser_locate for a live structural position; do not guess.",
      );
    }

    const entries = cache.entries;
    const allNodes = snapshotNodes(entries);
    const childrenByParent = new Map<number, number[]>();
    entries.forEach((entry, index) => {
      if (entry.parentIndex === undefined) return;
      const children =
        childrenByParent.get(entry.parentIndex) ?? [];
      children.push(index);
      childrenByParent.set(entry.parentIndex, children);
    });
    const withinIndex = query.withinRef === undefined
      ? undefined
      : entries.findIndex((entry) => entry.ref === query.withinRef);
    if (withinIndex === -1) {
      throw new AgentBrowserError(
        "stale_ref",
        `Agent Browser scope ref ${String(query.withinRef)} is stale or unknown`,
      );
    }
    const ancestorDistance = (
      entryIndex: number,
      ancestorIndex: number,
    ): number | undefined => {
      if (entryIndex === ancestorIndex) return 0;
      let parentIndex = entries[entryIndex]?.parentIndex;
      const visited = new Set<number>();
      let distance = 1;
      while (
        parentIndex !== undefined &&
        !visited.has(parentIndex) &&
        visited.size < MAX_SNAPSHOT_DEPTH
      ) {
        if (parentIndex === ancestorIndex) return distance;
        visited.add(parentIndex);
        parentIndex = entries[parentIndex]?.parentIndex;
        distance += 1;
      }
      return undefined;
    };
    const scopeOnly =
      withinIndex !== undefined &&
      query.role === undefined &&
      query.name === undefined &&
      query.text === undefined &&
      query.placeholder === undefined &&
      query.url === undefined &&
      query.actionable === undefined;
    const matches = allNodes.flatMap((node, index) => {
      if (
        withinIndex !== undefined &&
        ancestorDistance(index, withinIndex) === undefined
      ) {
        return [];
      }
      if (scopeOnly) return index === withinIndex ? [index] : [];
      const textFields = [
        node.role,
        node.name,
        node.value ?? "",
        node.placeholder ?? "",
        node.url ?? "",
        node.description ?? "",
      ];
      const matched =
        (
          query.role === undefined ||
          normalizedSemanticText(node.role) ===
            normalizedSemanticText(query.role)
        ) &&
        (
          query.name === undefined ||
          semanticTextMatches(node.name, query.name, query.exact)
        ) &&
        (
          query.text === undefined ||
          textFields.some((field) =>
            semanticTextMatches(field, query.text as string, query.exact)
          )
        ) &&
        (
          query.placeholder === undefined ||
          semanticTextMatches(
            node.placeholder ?? "",
            query.placeholder,
            query.exact,
          )
        ) &&
        (
          query.url === undefined ||
          semanticUrlMatches(
            node.url ?? "",
            query.url,
            query.exact,
          )
        ) &&
        (
          query.actionable === undefined ||
          (
            node.actionable === true &&
            node.disabled !== true
          ) === query.actionable
        );
      return matched ? [index] : [];
    });
    const pageMatches = query.index === undefined
      ? matches.slice(offset, offset + limit)
      : matches.slice(query.index, query.index + 1);
    const resultOffset = query.index ?? offset;
    const selected = new Set<number>();
    const add = (index: number | undefined): void => {
      if (
        index === undefined ||
        selected.size >= MAX_SNAPSHOT_NODES
      ) {
        return;
      }
      selected.add(index);
    };
    for (const index of pageMatches) add(index);
    const addDescendants = (
      rootIndex: number,
      maximumDepth: number,
    ): void => {
      const queue = (childrenByParent.get(rootIndex) ?? [])
        .map((index) => ({ index, depth: 1 }));
      for (
        let cursor = 0;
        cursor < queue.length &&
          selected.size < MAX_SNAPSHOT_NODES;
        cursor += 1
      ) {
        const candidate = queue[cursor];
        if (
          candidate === undefined ||
          candidate.depth > maximumDepth
        ) {
          continue;
        }
        add(candidate.index);
        if (candidate.depth >= maximumDepth) continue;
        for (
          const child of childrenByParent.get(candidate.index) ?? []
        ) {
          queue.push({
            index: child,
            depth: candidate.depth + 1,
          });
        }
      }
    };

    if (view === "subtree") {
      for (const rootIndex of pageMatches) {
        addDescendants(rootIndex, depth);
      }
    } else if (view === "context") {
      for (const matchIndex of pageMatches) {
        let ancestorIndex: number | undefined = matchIndex;
        const roots: number[] = [];
        for (let level = 0; level <= depth; level += 1) {
          if (ancestorIndex === undefined) break;
          roots.push(ancestorIndex);
          add(ancestorIndex);
          ancestorIndex = entries[ancestorIndex]?.parentIndex;
        }
        const contextRoot = roots.at(-1);
        if (contextRoot !== undefined) {
          addDescendants(contextRoot, depth + 1);
        }
        for (
          let index = Math.max(0, matchIndex - 6);
          index <= Math.min(entries.length - 1, matchIndex + 6);
          index += 1
        ) {
          add(index);
        }
      }
    }

    const nextOffset = offset + pageMatches.length;
    let nextCursor: string | undefined;
    if (
      query.index === undefined &&
      nextOffset < matches.length
    ) {
      nextCursor =
        `f${String(this.#generation)}:c${
          String(++this.#findCursorSequence)
        }`;
      this.#findCursors.set(nextCursor, {
        snapshotId: cache.snapshotId,
        query,
        view,
        depth,
        limit,
        offset: nextOffset,
      });
      while (this.#findCursors.size > MAX_FIND_CURSORS) {
        const oldest = this.#findCursors.keys().next().value;
        if (typeof oldest !== "string") break;
        this.#findCursors.delete(oldest);
      }
    }
    return {
      snapshotId: cache.snapshotId,
      nodes: (() => {
        const matchedRefs = new Set(
          pageMatches.map((index) => entries[index]?.ref),
        );
        return snapshotNodes(entries, selected).map((node) =>
          matchedRefs.has(node.ref)
            ? { ...node, match: true }
            : node
        );
      })(),
      view,
      totalNodes: entries.length,
      actionableNodes: entries.filter(
        (entry) => entry.actionable && !entry.disabled,
      ).length,
      totalMatches: matches.length,
      offset: resultOffset,
      indexTruncated: cache.indexTruncated,
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
  }

  async locateWithGeneratedCode(
    code: string,
    signal?: AbortSignal,
  ): Promise<{
    readonly snapshotId: string;
    readonly node: AgentBrowserSnapshotNode;
  }> {
    let plan;
    try {
      plan = parseGeneratedLocatorCode(code);
    } catch (error) {
      throw new AgentBrowserError(
        "invalid_locator_code",
        error instanceof Error ? error.message : String(error),
      );
    }
    await this.snapshot(signal);
    const cache = this.#snapshotCache;
    if (cache === undefined) {
      throw new AgentBrowserError(
        "snapshot_required",
        "Agent Browser could not retain the current page index",
      );
    }
    const generation = this.#generation;
    const assertLocatorObservationCurrent = (): void => {
      if (
        this.#generation !== generation ||
        this.#snapshotCache !== cache ||
        this.#referencesDirty
      ) {
        throw new AgentBrowserError(
          "snapshot_required",
          "Page evidence changed while the generated locator was resolving",
        );
      }
    };
    assertLocatorObservationCurrent();

    const locatorTimeoutMs = Math.min(
      GENERATED_LOCATOR_COMMAND_TIMEOUT_MS,
      this.#timeoutMs,
    );
    let frameId = this.#mainFrameId;
    if (frameId === undefined) {
      const frameTreeResult = commandResult<{
        frameTree?: unknown;
      }>(
        await this.#command(
          "Page.getFrameTree",
          {},
          signal,
          locatorTimeoutMs,
        ),
      );
      assertLocatorObservationCurrent();
      const discoveredFrameId =
        record(record(frameTreeResult.frameTree).frame).id;
      if (
        typeof discoveredFrameId !== "string" ||
        discoveredFrameId === ""
      ) {
        throw new AgentBrowserError(
          "target_gone",
          "Agent Browser main frame is unavailable",
        );
      }
      frameId = discoveredFrameId;
      this.#mainFrameId = discoveredFrameId;
    }
    const isolatedWorldResult = commandResult<{
      executionContextId?: unknown;
    }>(
      await this.#command(
        "Page.createIsolatedWorld",
        {
          frameId,
          worldName: GENERATED_LOCATOR_WORLD_NAME,
        },
        signal,
        locatorTimeoutMs,
      ),
    );
    assertLocatorObservationCurrent();
    const executionContextId = positiveInteger(
      isolatedWorldResult.executionContextId,
    );
    if (executionContextId === undefined) {
      throw new AgentBrowserError(
        "locator_code_failed",
        "Chromium did not create an isolated generated-locator world",
      );
    }

    const objectGroup =
      `minke-agent-browser-generated-locator-${cache.snapshotId}-${
        String(++this.#generatedLocatorSequence)
      }`;
    let located:
      | {
          readonly snapshotId: string;
          readonly node: AgentBrowserSnapshotNode;
        }
      | undefined;
    let operationFailed = false;
    try {
      const documentResult = commandResult<{
        exceptionDetails?: unknown;
        result?: unknown;
      }>(
        await this.#command(
          "Runtime.evaluate",
          {
            expression: "document",
            contextId: executionContextId,
            returnByValue: false,
            objectGroup,
          },
          signal,
          locatorTimeoutMs,
        ),
      );
      assertLocatorObservationCurrent();
      if (documentResult.exceptionDetails !== undefined) {
        throw new AgentBrowserError(
          "locator_code_failed",
          "Generated locator could not access the isolated document",
        );
      }
      const documentObjectId = record(documentResult.result).objectId;
      if (
        typeof documentObjectId !== "string" ||
        documentObjectId === ""
      ) {
        throw new AgentBrowserError(
          "target_gone",
          "Agent Browser document is unavailable",
        );
      }

      const bindingResult = commandResult<{
        exceptionDetails?: unknown;
        result?: unknown;
      }>(
        await this.#command(
          "Runtime.callFunctionOn",
          {
            objectId: documentObjectId,
            functionDeclaration:
              GENERATED_LOCATOR_RESOLVER_FUNCTION,
            arguments: [{ value: plan }],
            returnByValue: false,
            awaitPromise: false,
            objectGroup,
          },
          signal,
          locatorTimeoutMs,
        ),
      );
      assertLocatorObservationCurrent();
      if (bindingResult.exceptionDetails !== undefined) {
        const details = record(bindingResult.exceptionDetails);
        throw new AgentBrowserError(
          "locator_code_failed",
          `Generated locator failed: ${
            boundedText(
              details.text ??
                record(details.exception).description,
              1_000,
            ) || "page-side resolver rejected the locator"
          }`,
        );
      }
      const bindingObjectId = record(bindingResult.result).objectId;
      if (
        typeof bindingObjectId !== "string" ||
        bindingObjectId === ""
      ) {
        throw new AgentBrowserError(
          "locator_code_failed",
          "Generated locator returned an invalid binding",
        );
      }

      const propertiesResult = commandResult<{
        result?: unknown;
      }>(
        await this.#command(
          "Runtime.getProperties",
          {
            objectId: bindingObjectId,
            ownProperties: true,
            accessorPropertiesOnly: false,
            generatePreview: false,
          },
          signal,
          locatorTimeoutMs,
        ),
      );
      assertLocatorObservationCurrent();
      if (!Array.isArray(propertiesResult.result)) {
        throw new AgentBrowserError(
          "locator_code_failed",
          "Generated locator returned unreadable binding properties",
        );
      }
      const properties =
        new Map<string, Record<string, unknown>>();
      for (const rawDescriptor of propertiesResult.result) {
        const descriptor = record(rawDescriptor);
        if (typeof descriptor.name !== "string") continue;
        properties.set(descriptor.name, record(descriptor.value));
      }

      const truncated = properties.get("truncated")?.value;
      if (truncated === true) {
        throw new AgentBrowserError(
          "locator_code_failed",
          "Generated locator exceeded its candidate budget and was truncated",
        );
      }
      if (truncated !== false) {
        throw new AgentBrowserError(
          "locator_code_failed",
          "Generated locator returned an invalid truncation status",
        );
      }

      const rawCount = properties.get("count")?.value;
      if (
        typeof rawCount !== "number" ||
        !Number.isSafeInteger(rawCount) ||
        rawCount < 0 ||
        rawCount > MAX_INDEX_NODES
      ) {
        throw new AgentBrowserError(
          "locator_code_failed",
          "Generated locator returned an invalid candidate count",
        );
      }
      const rawSamples = properties.get("samplesText")?.value;
      if (
        typeof rawSamples !== "string" ||
        rawSamples.length > 1_000
      ) {
        throw new AgentBrowserError(
          "locator_code_failed",
          "Generated locator returned invalid candidate diagnostics",
        );
      }
      if (rawCount === 0) {
        throw new AgentBrowserError(
          "element_not_found",
          "Generated locator matched no elements. Revise the code from "
            + "fresh page evidence; do not substitute another action.",
        );
      }
      if (rawCount !== 1) {
        throw new AgentBrowserError(
          "ambiguous_target",
          `Generated locator matched ${String(rawCount)} elements${
            rawSamples === "" ? "" : `: ${rawSamples}`
          }. Refine the code until it resolves exactly one requested control.`,
        );
      }

      const elementObjectId = properties.get("element")?.objectId;
      if (
        typeof elementObjectId !== "string" ||
        elementObjectId === ""
      ) {
        throw new AgentBrowserError(
          "locator_code_failed",
          "Generated locator did not atomically bind its unique element",
        );
      }
      const description = commandResult<{
        node?: unknown;
      }>(
        await this.#command(
          "DOM.describeNode",
          { objectId: elementObjectId },
          signal,
          locatorTimeoutMs,
        ),
      );
      assertLocatorObservationCurrent();
      const backendNodeId =
        positiveInteger(record(description.node).backendNodeId);
      if (backendNodeId === undefined) {
        throw new AgentBrowserError(
          "locator_code_failed",
          "Generated locator did not resolve to a DOM element",
        );
      }
      const entryIndex = cache.entries.findIndex(
        (entry) => entry.backendNodeId === backendNodeId,
      );
      const node = entryIndex < 0
        ? undefined
        : snapshotNodes(cache.entries)[entryIndex];
      if (
        node === undefined ||
        node.actionable !== true ||
        node.disabled === true
      ) {
        throw new AgentBrowserError(
          "element_not_actionable",
          cache.indexTruncated
            ? "Generated locator resolved outside the retained actionable index"
            : "Generated locator resolved to an element that is not an enabled actionable control",
        );
      }
      located = {
        snapshotId: cache.snapshotId,
        node: { ...node, match: true },
      };
    } catch (error) {
      operationFailed = true;
      throw error;
    } finally {
      try {
        await this.#command(
          "Runtime.releaseObjectGroup",
          { objectGroup },
          undefined,
          locatorTimeoutMs,
        );
      } catch (cleanupError) {
        if (!operationFailed) throw cleanupError;
      }
    }

    assertNotAborted(signal);
    assertLocatorObservationCurrent();
    if (located === undefined) {
      throw new AgentBrowserError(
        "locator_code_failed",
        "Generated locator completed without a retained binding",
      );
    }
    const retainedEntry = cache.entries.find(
      (entry) => entry.ref === located.node.ref,
    );
    if (
      retainedEntry === undefined ||
      this.#references.get(located.node.ref)?.backendNodeId !==
        retainedEntry.backendNodeId
    ) {
      throw new AgentBrowserError(
        "snapshot_required",
        "Generated locator binding is no longer in the retained page index",
      );
    }
    return located;
  }

  async resolveSemanticTarget(
    target: AgentBrowserSemanticTarget,
    action: AgentBrowserTargetAction,
    signal?: AbortSignal,
  ): Promise<AgentBrowserSnapshotNode> {
    await this.snapshot(signal);
    const entries = this.#snapshotCache?.entries;
    if (entries === undefined) {
      throw new AgentBrowserError(
        "snapshot_required",
        "Agent Browser could not retain the current observation",
      );
    }
    const withinIndex = target.withinRef === undefined
      ? undefined
      : entries.findIndex((entry) => entry.ref === target.withinRef);
    if (withinIndex === -1) {
      throw new AgentBrowserError(
        "stale_ref",
        `Agent Browser scope ref ${String(target.withinRef)} is stale or unknown`,
      );
    }
    const isWithinScope = (entryIndex: number): boolean => {
      if (withinIndex === undefined) return true;
      let parentIndex = entries[entryIndex]?.parentIndex;
      const visited = new Set<number>();
      while (
        parentIndex !== undefined &&
        !visited.has(parentIndex) &&
        visited.size < MAX_SNAPSHOT_DEPTH
      ) {
        if (parentIndex === withinIndex) return true;
        visited.add(parentIndex);
        parentIndex = entries[parentIndex]?.parentIndex;
      }
      return false;
    };
    const matches = snapshotNodes(entries).filter((node, index) => {
      if (!isWithinScope(index)) return false;
      if (node.disabled === true || node.actionable !== true) {
        return false;
      }
      if (!node.actions?.includes(action)) {
        return false;
      }
      return (
        (
          target.role === undefined ||
          normalizedSemanticText(node.role) ===
            normalizedSemanticText(target.role)
        ) &&
        (
          target.name === undefined ||
          semanticTextMatches(node.name, target.name, target.exact)
        ) &&
        (
          target.placeholder === undefined ||
          semanticTextMatches(
            node.placeholder ?? "",
            target.placeholder,
            target.exact,
          )
        ) &&
        (
          target.url === undefined ||
          semanticUrlMatches(
            node.url ?? "",
            target.url,
            target.exact,
          )
        )
      );
    });
    if (target.index !== undefined) {
      const indexed = matches[target.index];
      if (indexed !== undefined) return indexed;
      throw new AgentBrowserError(
        "element_not_found",
        `Agent Browser semantic target matched ${String(matches.length)} `
          + `elements, so requested match position ${
            String(target.index + 1)
          } does not exist. Refine the target constraints.`,
      );
    }
    if (matches.length === 1) return matches[0] as AgentBrowserSnapshotNode;
    const locator = JSON.stringify(target);
    if (matches.length === 0) {
      throw new AgentBrowserError(
        "element_not_found",
        `Agent Browser found no actionable element matching ${locator}`,
      );
    }
    const candidates = matches.slice(0, 5).map((node) =>
      `[${node.ref}] ${node.role} ${JSON.stringify(node.name)}${
        node.url === undefined ? "" : ` → ${JSON.stringify(node.url)}`
      }`
    );
    throw new AgentBrowserError(
      "ambiguous_target",
      `Agent Browser target ${locator} matched `
        + `${String(matches.length)} elements: ${candidates.join("; ")}. `
        + "Add a scope or a more exact semantic constraint. Use a positional "
        + "constraint only when the user's ordinal applies to this exact "
        + "action-control match set.",
    );
  }

  async click(
    ref: string,
    signal?: AbortSignal,
    hooks?: AgentBrowserCdpClickHooks,
  ): Promise<AgentBrowserCdpPointerTarget> {
    const reference = this.#resolveReference(ref);
    await this.#assertClickable(ref, reference, signal);
    this.#assertActionCapability(ref, reference, "click");
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
      if (dispatched) this.markReferencesDirty();
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
    this.#assertActionCapability(ref, reference, "fill");
    if (reference.disabled) {
      throw new AgentBrowserError(
        "element_not_interactable",
        `Agent Browser ref ${ref} is disabled`,
      );
    }
    const { backendNodeId } = reference;
    const objectGroup = `minke-agent-browser-fill-${ref}`;
    await this.#command(
      "DOM.scrollIntoViewIfNeeded",
      { backendNodeId },
      signal,
    );
    this.#assertCurrentReference(ref, reference);
    const resolved = commandResult<{
      object?: unknown;
    }>(
      await this.#command(
        "DOM.resolveNode",
        { backendNodeId, objectGroup },
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
      assertNotAborted(signal);
      this.#assertCurrentReference(ref, reference);
      await this.#command(
        "DOM.focus",
        { backendNodeId },
        signal,
      );
      this.#assertCurrentReference(ref, reference);
      const preparation = commandResult<{
        result?: unknown;
        exceptionDetails?: unknown;
      }>(
        await this.#command(
          "Runtime.callFunctionOn",
          {
            objectId,
            functionDeclaration: `function minkePrepareFill() {
              if (!(this instanceof Element) || !this.isConnected) {
                return { editable: false };
              }
              const input = this instanceof HTMLInputElement;
              const textarea = this instanceof HTMLTextAreaElement;
              const editable = input || textarea ||
                this.isContentEditable;
              const disabled = "disabled" in this &&
                this.disabled === true;
              const readOnly = "readOnly" in this &&
                this.readOnly === true;
              if (editable && !disabled && !readOnly) {
                this.focus({ preventScroll: true });
                if (input || textarea) {
                  this.select();
                } else if (this.isContentEditable) {
                  const selection = window.getSelection();
                  const range = document.createRange();
                  range.selectNodeContents(this);
                  selection?.removeAllRanges();
                  selection?.addRange(range);
                }
              }
              return { editable, disabled, readOnly };
            }`,
            returnByValue: true,
            awaitPromise: false,
          },
          signal,
        ),
      );
      if (preparation.exceptionDetails !== undefined) {
        throw new AgentBrowserError(
          "element_not_interactable",
          `Agent Browser ref ${ref} cannot be prepared for text input`,
        );
      }
      const inspection = record(
        record(preparation.result).value,
      ) as FillTargetInspection;
      if (
        inspection.editable !== true ||
        inspection.disabled === true ||
        inspection.readOnly === true
      ) {
        const reason = inspection.disabled === true
          ? "disabled"
          : inspection.readOnly === true
            ? "read-only"
            : "not editable";
        throw new AgentBrowserError(
          "element_not_interactable",
          `Agent Browser ref ${ref} is ${reason}`,
        );
      }
      assertNotAborted(signal);
      this.#assertCurrentReference(ref, reference);
      dispatched = true;
      const selectAllModifier = process.platform === "darwin" ? 4 : 2;
      await this.#command(
        "Input.dispatchKeyEvent",
        {
          type: "keyDown",
          key: "a",
          code: "KeyA",
          windowsVirtualKeyCode: 65,
          nativeVirtualKeyCode: 65,
          modifiers: selectAllModifier,
        },
        signal,
      );
      this.#assertCurrentReference(ref, reference);
      await this.#command(
        "Input.dispatchKeyEvent",
        {
          type: "keyUp",
          key: "a",
          code: "KeyA",
          windowsVirtualKeyCode: 65,
          nativeVirtualKeyCode: 65,
          modifiers: selectAllModifier,
        },
        signal,
      );
      this.#assertCurrentReference(ref, reference);
      if (value === "") {
        await this.#command(
          "Input.dispatchKeyEvent",
          {
            type: "keyDown",
            key: "Backspace",
            code: "Backspace",
            windowsVirtualKeyCode: 8,
          },
          signal,
        );
        await this.#command(
          "Input.dispatchKeyEvent",
          {
            type: "keyUp",
            key: "Backspace",
            code: "Backspace",
            windowsVirtualKeyCode: 8,
          },
          signal,
        );
      } else {
        await this.#command(
          "Input.insertText",
          { text: value },
          signal,
        );
      }
    } catch (error) {
      throw asMutationError(
        error,
        "fill_failed",
        dispatched,
      );
    } finally {
      if (dispatched) this.markReferencesDirty();
      await this.#command(
        "Runtime.releaseObjectGroup",
        { objectGroup },
      ).catch(() => {
        // The target or execution context may have gone away after input.
      });
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
      if (!reference.actionable || reference.disabled) {
        throw new AgentBrowserError(
          "element_not_actionable",
          `Agent Browser ref ${ref} (${reference.role} `
            + `${JSON.stringify(reference.name)}) is not a valid `
            + "keyboard target",
        );
      }
      this.#assertActionCapability(ref, reference, "press");
      await this.#command(
        "DOM.scrollIntoViewIfNeeded",
        { backendNodeId: reference.backendNodeId },
        signal,
      );
      this.#assertCurrentReference(ref, reference);
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
      if (dispatched) this.markReferencesDirty();
    }
  }

  async scroll(
    direction: AgentBrowserScrollDirection,
    amount: number | undefined,
    withinRef?: string,
    signal?: AbortSignal,
  ): Promise<AgentBrowserCdpScrollResult> {
    const scopedReference = withinRef === undefined
      ? undefined
      : {
          ref: withinRef,
          reference: this.#resolveReference(withinRef),
        };
    let frameId = this.#mainFrameId;
    if (frameId === undefined) {
      const frameTree = commandResult<{
        frameTree?: unknown;
      }>(
        await this.#command(
          "Page.getFrameTree",
          {},
          signal,
        ),
      );
      const discoveredFrameId =
        record(record(frameTree.frameTree).frame).id;
      if (
        typeof discoveredFrameId !== "string" ||
        discoveredFrameId === ""
      ) {
        throw new AgentBrowserError(
          "target_gone",
          "Agent Browser main frame is unavailable",
        );
      }
      frameId = discoveredFrameId;
      this.#mainFrameId = discoveredFrameId;
    }
    const world = commandResult<{
      executionContextId?: unknown;
    }>(
      await this.#command(
        "Page.createIsolatedWorld",
        {
          frameId,
          worldName: SCROLL_WORLD_NAME,
        },
        signal,
      ),
    );
    const executionContextId = positiveInteger(
      world.executionContextId,
    );
    if (executionContextId === undefined) {
      throw new AgentBrowserError(
        "scroll_failed",
        "Chromium did not create an isolated scroll world",
      );
    }
    const objectGroup =
      `minke-agent-browser-scroll-${String(this.#generation)}-${
        String(++this.#scrollSequence)
      }`;
    let dispatched = false;
    try {
      let objectId: unknown;
      if (scopedReference === undefined) {
        const documentResult = commandResult<{
          result?: unknown;
          exceptionDetails?: unknown;
        }>(
          await this.#command(
            "Runtime.evaluate",
            {
              expression: "document",
              contextId: executionContextId,
              returnByValue: false,
              objectGroup,
            },
            signal,
          ),
        );
        if (documentResult.exceptionDetails !== undefined) {
          throw new AgentBrowserError(
            "scroll_failed",
            "Agent Browser could not access the page scroll root",
          );
        }
        objectId = record(documentResult.result).objectId;
      } else {
        this.#assertCurrentReference(
          scopedReference.ref,
          scopedReference.reference,
        );
        const resolved = commandResult<{
          object?: unknown;
        }>(
          await this.#command(
            "DOM.resolveNode",
            {
              backendNodeId:
                scopedReference.reference.backendNodeId,
              executionContextId,
              objectGroup,
            },
            signal,
          ),
        );
        this.#assertCurrentReference(
          scopedReference.ref,
          scopedReference.reference,
        );
        objectId = record(resolved.object).objectId;
      }
      if (typeof objectId !== "string" || objectId === "") {
        throw new AgentBrowserError(
          "target_gone",
          "Agent Browser scroll target is unavailable",
        );
      }
      assertNotAborted(signal);
      dispatched = true;
      const call = commandResult<{
        result?: unknown;
        exceptionDetails?: unknown;
      }>(
        await this.#command(
          "Runtime.callFunctionOn",
          {
            objectId,
            functionDeclaration: SCROLL_FUNCTION,
            arguments: [
              { value: direction },
              { value: amount ?? 0 },
            ],
            returnByValue: true,
            awaitPromise: false,
            objectGroup,
          },
          signal,
        ),
      );
      if (call.exceptionDetails !== undefined) {
        throw new AgentBrowserError(
          "scroll_failed",
          "Agent Browser could not scroll the requested target",
        );
      }
      const value = record(record(call.result).value);
      const beforeX = boundedScrollCoordinate(value.beforeX);
      const beforeY = boundedScrollCoordinate(value.beforeY);
      const afterX = boundedScrollCoordinate(value.afterX);
      const afterY = boundedScrollCoordinate(value.afterY);
      const maxX = boundedScrollCoordinate(value.maxX);
      const maxY = boundedScrollCoordinate(value.maxY);
      if (
        beforeX === undefined ||
        beforeY === undefined ||
        afterX === undefined ||
        afterY === undefined ||
        maxX === undefined ||
        maxY === undefined ||
        beforeX > maxX ||
        afterX > maxX ||
        beforeY > maxY ||
        afterY > maxY ||
        typeof value.moved !== "boolean" ||
        value.moved !==
          (beforeX !== afterX || beforeY !== afterY)
      ) {
        throw new AgentBrowserError(
          "scroll_failed",
          "Chromium returned invalid Agent Browser scroll evidence",
        );
      }
      if (value.moved) this.markReferencesDirty();
      return {
        scope: withinRef ?? "page",
        beforeX,
        beforeY,
        afterX,
        afterY,
        maxX,
        maxY,
        moved: value.moved,
      };
    } catch (error) {
      if (dispatched) this.markReferencesDirty();
      throw asMutationError(error, "scroll_failed", dispatched);
    } finally {
      await this.#command(
        "Runtime.releaseObjectGroup",
        { objectGroup },
      ).catch(() => {
        // The target or execution context may have gone away after scrolling.
      });
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
    this.#snapshotCache = undefined;
    this.#referencesDirty = true;
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
    if (method === "Page.frameNavigated") {
      const frame = record(record(params).frame);
      const frameId =
        typeof frame.id === "string" && frame.id !== ""
          ? frame.id
          : undefined;
      const parentId =
        typeof frame.parentId === "string" && frame.parentId !== ""
          ? frame.parentId
          : undefined;
      if (frameId !== undefined && parentId === undefined) {
        this.#mainFrameId = frameId;
        this.invalidateReferences("document");
      } else {
        this.markReferencesDirty("document");
      }
      return;
    }
    if (method === "Page.navigatedWithinDocument") {
      const frameId = record(params).frameId;
      this.markReferencesDirty(
        frameId === this.#mainFrameId ? "document" : "references",
      );
      return;
    }
    if (
      method === "DOM.documentUpdated" ||
      method === "Runtime.executionContextsCleared"
    ) {
      this.markReferencesDirty("document");
      return;
    }
    if (method === "Accessibility.loadComplete") {
      if (this.#annotationPicker === undefined) {
        this.markReferencesDirty("document");
      }
      return;
    }
    if (method === "Accessibility.nodesUpdated") {
      // Enabling or moving the human annotation overlay can update the AX
      // tree by itself. Agent actions are already paused while that picker is
      // active, and returning control invalidates every ref, so do not let
      // the overlay cancel its own annotation session.
      if (this.#annotationPicker === undefined) {
        this.markReferencesDirty("references");
      }
    }
  };

  readonly #handleDetach = (
    _event: unknown,
    reason: unknown,
  ): void => {
    this.#attached = false;
    this.#references.clear();
    this.#snapshotCache = undefined;
    this.#referencesDirty = true;
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
        `Agent Browser ref ${ref} is stale or unknown. `
          + "Call browser_snapshot and use a ref from that result; "
          + "retrying this ref cannot succeed.",
      );
    }
    if (this.#referencesDirty) {
      throw new AgentBrowserError(
        "snapshot_required",
        "The page may have changed since the last observation. "
          + "Call browser_snapshot before another element action.",
      );
    }
    return {
      ...reference,
      generation: this.#generation,
    };
  }

  #assertActionCapability(
    ref: string,
    reference: SnapshotReference,
    action: AgentBrowserNodeAction,
  ): void {
    if (reference.actions.includes(action)) return;
    throw new AgentBrowserError(
      "capability_mismatch",
      `Agent Browser ref ${ref} (${reference.role} ${
        JSON.stringify(reference.name)
      }) does not support ${action}. Supported actions: ${
        reference.actions.length === 0
          ? "none"
          : reference.actions.join(", ")
      }`,
    );
  }

  async #assertClickable(
    ref: string,
    reference: ResolvedReference,
    signal?: AbortSignal,
  ): Promise<void> {
    if (reference.disabled) {
      throw new AgentBrowserError(
        "element_not_actionable",
        `Agent Browser ref ${ref} is disabled`,
      );
    }
    const objectGroup = `minke-agent-browser-click-${ref}`;
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
    this.#assertCurrentReference(ref, reference);
    const objectId = record(resolved.object).objectId;
    if (typeof objectId !== "string" || objectId === "") {
      throw new AgentBrowserError(
        "element_not_interactable",
        `Agent Browser ref ${ref} cannot be resolved`,
      );
    }
    try {
      const result = commandResult<{
        result?: unknown;
        exceptionDetails?: unknown;
      }>(
        await this.#command(
          "Runtime.callFunctionOn",
          {
            objectId,
            functionDeclaration: `function minkeInteractionTarget() {
              if (!(this instanceof Element) || !this.isConnected) {
                return {
                  connected: false,
                  directlyInteractive: false,
                  nestedInteractive: false,
                  disabled: false
                };
              }
              const roles = [
                "button", "checkbox", "combobox", "link", "listbox",
                "menuitem", "menuitemcheckbox", "menuitemradio",
                "option", "radio", "searchbox", "slider", "spinbutton",
                "switch", "tab", "textbox", "treeitem"
              ];
              const selector = [
                "a[href]", "button", "input", "select", "textarea",
                "summary", "[contenteditable='true']", "[tabindex]",
                ...roles.map((role) => "[role='" + role + "']")
              ].join(",");
              const role = String(
                this.getAttribute("role") ?? ""
              ).toLowerCase();
              const directlyInteractive =
                this.matches(selector) ||
                roles.includes(role) ||
                typeof this.onclick === "function";
              const nested = this.querySelector(selector);
              const nestedRole = nested === null
                ? ""
                : String(
                  nested.getAttribute("role") ??
                  (nested instanceof HTMLAnchorElement
                    ? "link"
                    : nested instanceof HTMLButtonElement
                      ? "button"
                      : nested.localName)
                ).toLowerCase();
              const nestedName = nested === null
                ? ""
                : String(
                  nested.getAttribute("aria-label") ??
                  nested.getAttribute("title") ??
                  nested.innerText ??
                  nested.textContent ??
                  ""
                ).replace(/\\s+/gu, " ").trim().slice(0, 500);
              const disabled =
                ("disabled" in this && this.disabled === true) ||
                this.getAttribute("aria-disabled") === "true";
              return {
                connected: true,
                directlyInteractive,
                nestedInteractive: nested !== null,
                nestedRole,
                nestedName,
                disabled
              };
            }`,
            returnByValue: true,
          },
          signal,
        ),
      );
      this.#assertCurrentReference(ref, reference);
      if (result.exceptionDetails !== undefined) {
        throw new AgentBrowserError(
          "element_not_interactable",
          `Agent Browser ref ${ref} cannot be inspected`,
        );
      }
      const inspection = record(
        record(result.result).value,
      ) as InteractionTargetInspection;
      if (
        inspection.connected !== true ||
        inspection.disabled === true
      ) {
        throw new AgentBrowserError(
          "element_not_actionable",
          inspection.disabled === true
            ? `Agent Browser ref ${ref} is disabled`
            : `Agent Browser ref ${ref} is no longer connected`,
        );
      }
      if (inspection.directlyInteractive === true) return;
      if (inspection.nestedInteractive === true) {
        const role =
          boundedText(inspection.nestedRole, 80) || "element";
        const name = boundedText(inspection.nestedName, 500);
        throw new AgentBrowserError(
          "element_not_actionable",
          `Agent Browser ref ${ref} is a structural ${reference.role} `
            + `containing a more specific ${role} ${JSON.stringify(name)}. `
            + "Use the actionable child ref from the current snapshot or "
            + "retry with semantic constraints for the requested action; "
            + "do not activate the structural container.",
        );
      }
      throw new AgentBrowserError(
        "element_not_actionable",
        `Agent Browser ref ${ref} (${reference.role} `
          + `${JSON.stringify(reference.name)}) is not directly interactive`,
      );
    } finally {
      await this.#command(
        "Runtime.releaseObjectGroup",
        { objectGroup },
      ).catch(() => {
        // Inspection has no mutation authority to retain.
      });
    }
  }

  async #assertPointerHit(
    ref: string,
    reference: ResolvedReference,
    documentPoint: AgentBrowserCursorPoint,
    signal?: AbortSignal,
  ): Promise<void> {
    const hit = commandResult<{
      backendNodeId?: unknown;
    }>(
      await this.#command(
        "DOM.getNodeForLocation",
        {
          x: Math.round(documentPoint.x),
          y: Math.round(documentPoint.y),
          includeUserAgentShadowDOM: true,
        },
        signal,
      ),
    );
    this.#assertCurrentReference(ref, reference);
    if (
      !Number.isSafeInteger(hit.backendNodeId) ||
      Number(hit.backendNodeId) <= 0
    ) {
      throw new AgentBrowserError(
        "element_not_interactable",
        `Agent Browser ref ${ref} has no hit-test target`,
      );
    }
    const hitBackendNodeId = Number(hit.backendNodeId);
    if (hitBackendNodeId === reference.backendNodeId) return;

    const objectGroup = `minke-agent-browser-hit-${ref}`;
    try {
      const [targetResolved, hitResolved] = await Promise.all([
        this.#command(
          "DOM.resolveNode",
          {
            backendNodeId: reference.backendNodeId,
            objectGroup,
          },
          signal,
        ),
        this.#command(
          "DOM.resolveNode",
          {
            backendNodeId: hitBackendNodeId,
            objectGroup,
          },
          signal,
        ),
      ]);
      this.#assertCurrentReference(ref, reference);
      const targetObjectId = record(
        commandResult<{ object?: unknown }>(targetResolved).object,
      ).objectId;
      const hitObjectId = record(
        commandResult<{ object?: unknown }>(hitResolved).object,
      ).objectId;
      if (
        typeof targetObjectId !== "string" ||
        targetObjectId === "" ||
        typeof hitObjectId !== "string" ||
        hitObjectId === ""
      ) {
        throw new AgentBrowserError(
          "element_not_interactable",
          `Agent Browser ref ${ref} hit-test nodes cannot be resolved`,
        );
      }
      const result = commandResult<{
        result?: unknown;
        exceptionDetails?: unknown;
      }>(
        await this.#command(
          "Runtime.callFunctionOn",
          {
            objectId: targetObjectId,
            functionDeclaration: `function minkeHitTarget(hit) {
              if (!(this instanceof Node) || !(hit instanceof Node)) {
                return { targetOrDescendant: false };
              }
              let current = hit;
              let targetOrDescendant = false;
              while (current instanceof Node) {
                if (current === this) {
                  targetOrDescendant = true;
                  break;
                }
                const root = current.getRootNode();
                current = current.parentNode ??
                  (root instanceof ShadowRoot ? root.host : null);
              }
              const element = hit instanceof Element
                ? hit
                : hit.parentElement;
              const tag = String(
                element?.localName ?? element?.nodeName ?? "element"
              ).toLowerCase().slice(0, 80);
              const name = String(
                element?.getAttribute?.("aria-label") ??
                element?.getAttribute?.("title") ??
                element?.innerText ??
                element?.textContent ??
                ""
              ).replace(/\\s+/gu, " ").trim().slice(0, 500);
              return { targetOrDescendant, tag, name };
            }`,
            arguments: [{ objectId: hitObjectId }],
            returnByValue: true,
          },
          signal,
        ),
      );
      this.#assertCurrentReference(ref, reference);
      if (result.exceptionDetails !== undefined) {
        throw new AgentBrowserError(
          "element_not_interactable",
          `Agent Browser ref ${ref} hit test failed`,
        );
      }
      const inspection = record(
        record(result.result).value,
      ) as HitTargetInspection;
      if (inspection.targetOrDescendant === true) return;
      const tag = boundedText(inspection.tag, 80) || "element";
      const name = boundedText(inspection.name, 500);
      throw new AgentBrowserError(
        "element_covered",
        `Agent Browser ref ${ref} is covered at its click point by `
          + `${tag} ${JSON.stringify(name)}. Inspect browser_snapshot `
          + "and handle the covering element before retrying.",
      );
    } finally {
      await this.#command(
        "Runtime.releaseObjectGroup",
        { objectGroup },
      ).catch(() => {
        // Hit-test object handles are never retained.
      });
    }
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
    const point = {
      x: visibleLeft + visibleWidth / 2,
      y: visibleTop + visibleHeight / 2,
    };
    const visualViewport = record(
      layoutResult.cssVisualViewport,
    );
    const cssLayoutViewport = record(
      layoutResult.cssLayoutViewport,
    );
    const layoutViewport = record(layoutResult.layoutViewport);
    const pageX =
      finiteNumber(visualViewport.pageX) ??
      finiteNumber(cssLayoutViewport.pageX) ??
      finiteNumber(layoutViewport.pageX) ??
      0;
    const pageY =
      finiteNumber(visualViewport.pageY) ??
      finiteNumber(cssLayoutViewport.pageY) ??
      finiteNumber(layoutViewport.pageY) ??
      0;
    await this.#assertPointerHit(
      ref,
      reference,
      {
        x: point.x + pageX,
        y: point.y + pageY,
      },
      signal,
    );
    return { point, viewport };
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
        `Agent Browser ref ${ref} became stale before dispatch. `
          + "Call browser_snapshot and use a ref from that result; "
          + "retrying this ref cannot succeed.",
      );
    }
    if (this.#referencesDirty) {
      throw new AgentBrowserError(
        "snapshot_required",
        "The page changed before dispatch. "
          + "Call browser_snapshot before another element action.",
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
    this.#snapshotCache = undefined;
    this.#referencesDirty = true;
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
