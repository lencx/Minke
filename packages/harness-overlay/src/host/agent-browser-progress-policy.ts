import type {
  AgentBrowserOperation,
} from "../agent-browser-contract.ts";

const TRACE_LIMIT = 24;
const NO_PROGRESS_LIMIT = 4;
const ABSENCE_LIMIT = 3;
const MAX_LOCATION_CYCLE_PERIOD = 4;

// A generated locator is both more expensive and more permissive than a
// semantic find. One shared budget prevents alternating between the two tools
// from replenishing separate counters while preserving five finds or three
// generated locators on one unchanged page.
const RESOLUTION_BUDGET = 15;
const RESOLUTION_COST: Partial<
  Record<AgentBrowserOperation, number>
> = {
  find: 3,
  locate: 5,
};

export interface AgentBrowserPolicyCall {
  readonly ownerId: string;
  readonly sessionId?: string;
  readonly pageId?: string;
  readonly operation: AgentBrowserOperation;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface AgentBrowserPolicyStop {
  readonly code:
    | "find_exhausted"
    | "find_repeated"
    | "locate_exhausted"
    | "locate_repeated"
    | "no_progress_loop"
    | "ping_pong_loop"
    | "repeated_open"
    | "repeated_operation";
  readonly message: string;
}

export type AgentBrowserPolicyOutcome = (
  | {
      readonly kind: "success";
      /** Stable semantic result identity; omit volatile request ids. */
      readonly key: string;
      /** Whether this result advanced browser or resolution state. */
      readonly progress: boolean;
    }
  | {
      readonly kind: "absence";
      /** Stable identity for a structured negative observation. */
      readonly key: string;
    }
  | {
      readonly kind: "rejection";
      /** Stable host-policy rejection code. */
      readonly key: string;
    }
  | {
      readonly kind: "failure";
      /** Stable remote error identity. */
      readonly key: string;
      /** Unknown/transient failures receive one retry. */
      readonly retryable: boolean;
    }
) & {
  /** Latest normalized location when the operation exposed one. */
  readonly currentUrl?: string;
};

interface TraceEntry {
  readonly operation: AgentBrowserOperation;
  readonly signature: string;
  readonly epoch: string;
  readonly sessionId?: string;
  readonly outcome: AgentBrowserPolicyOutcome;
}

interface OwnerTurn {
  turnKey: unknown;
  readonly history: TraceEntry[];
  stopped?: AgentBrowserPolicyStop;
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? JSON.stringify(value)
      : "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${
      Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) =>
          `${JSON.stringify(key)}:${canonicalJson(record[key])}`
        )
        .join(",")
    }}`;
  }
  return JSON.stringify(String(value));
}

function callSignature(call: AgentBrowserPolicyCall): string {
  return canonicalJson([
    call.operation,
    call.payload,
  ]);
}

function callEpoch(call: AgentBrowserPolicyCall): string {
  return canonicalJson([
    call.sessionId ?? null,
    call.pageId ?? null,
  ]);
}

function makesProgress(outcome: AgentBrowserPolicyOutcome): boolean {
  return outcome.kind === "success" && outcome.progress;
}

function noProgressTail(history: readonly TraceEntry[]): TraceEntry[] {
  const tail: TraceEntry[] = [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry === undefined || makesProgress(entry.outcome)) break;
    tail.unshift(entry);
  }
  return tail;
}

function activeSessionUrls(
  history: readonly TraceEntry[],
): ReadonlyMap<string, string> {
  const urls = new Map<string, string>();
  for (const entry of history) {
    if (
      entry.sessionId !== undefined &&
      entry.outcome.currentUrl !== undefined
    ) {
      urls.set(entry.sessionId, entry.outcome.currentUrl);
    }
  }
  return urls;
}

function outcomeIdentity(
  outcome: AgentBrowserPolicyOutcome,
): string {
  switch (outcome.kind) {
    case "success":
      return canonicalJson([
        outcome.kind,
        outcome.key,
        outcome.progress,
        outcome.currentUrl ?? null,
      ]);
    case "failure":
      return canonicalJson([
        outcome.kind,
        outcome.key,
        outcome.retryable,
        outcome.currentUrl ?? null,
      ]);
    case "absence":
    case "rejection":
      return canonicalJson([
        outcome.kind,
        outcome.key,
        outcome.currentUrl ?? null,
      ]);
  }
}

function repeatedStablePingPong(
  history: readonly TraceEntry[],
): boolean {
  if (history.length < 4) return false;
  const recent = history.slice(-4);
  const [first, second, third, fourth] = recent;
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined
  ) {
    return false;
  }
  return (
    first.epoch === second.epoch &&
    first.epoch === third.epoch &&
    first.epoch === fourth.epoch &&
    first.signature !== second.signature &&
    first.signature === third.signature &&
    second.signature === fourth.signature &&
    outcomeIdentity(first.outcome) ===
      outcomeIdentity(third.outcome) &&
    outcomeIdentity(second.outcome) ===
      outcomeIdentity(fourth.outcome)
  );
}

function repeatedStableExact(
  history: readonly TraceEntry[],
): boolean {
  const previous = history.at(-2);
  const current = history.at(-1);
  return (
    previous !== undefined &&
    current !== undefined &&
    previous.epoch === current.epoch &&
    previous.signature === current.signature &&
    outcomeIdentity(previous.outcome) ===
      outcomeIdentity(current.outcome)
  );
}

function repeatedLocationCycle(
  history: readonly TraceEntry[],
): boolean {
  const locationsBySession = new Map<string, string[]>();
  for (const entry of history) {
    const sessionId = entry.sessionId;
    const currentUrl = entry.outcome.currentUrl;
    if (sessionId === undefined || currentUrl === undefined) {
      continue;
    }
    const locations = locationsBySession.get(sessionId) ?? [];
    if (locations.at(-1) !== currentUrl) {
      locations.push(currentUrl);
    }
    locationsBySession.set(sessionId, locations);
  }
  for (const locations of locationsBySession.values()) {
    const maximumPeriod = Math.min(
      MAX_LOCATION_CYCLE_PERIOD,
      Math.floor(locations.length / 2),
    );
    for (
      let period = 2;
      period <= maximumPeriod;
      period += 1
    ) {
      const cycle = locations.slice(-period);
      const previous = locations.slice(
        -(period * 2),
        -period,
      );
      if (
        cycle.every((location, index) =>
          location === previous[index]
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function repeatedOperationStop(
  operation: AgentBrowserOperation,
): AgentBrowserPolicyStop {
  return {
    code: "repeated_operation",
    message:
      `The unchanged ${operation} call already produced the same non-progressing result. Stop retrying it; only new page or control state can make this exact call useful.`,
  };
}

/**
 * Turn-scoped liveness policy for model-facing browser calls.
 *
 * The trace is the only loop ledger. It covers exact repeats, semantic
 * refinement churn, repeated call or location cycles, and cross-operation
 * failure streaks without resetting when an error merely requests another
 * snapshot.
 */
export class AgentBrowserProgressPolicy {
  readonly #owners = new Map<string, OwnerTurn>();

  enterTurn(ownerId: string, turnKey: unknown): void {
    const state = this.#owners.get(ownerId);
    if (
      state !== undefined &&
      Object.is(state.turnKey, turnKey)
    ) {
      return;
    }
    this.#owners.set(ownerId, {
      turnKey,
      history: [],
    });
  }

  endTurn(ownerId: string): void {
    this.#owners.delete(ownerId);
  }

  forgetSession(ownerId: string, sessionId: string): void {
    const state = this.#owners.get(ownerId);
    if (state === undefined) return;
    const retained = state.history.filter(
      (entry) => entry.sessionId !== sessionId,
    );
    state.history.splice(0, state.history.length, ...retained);
  }

  disposeOwner(ownerId: string): void {
    this.#owners.delete(ownerId);
  }

  dispose(): void {
    this.#owners.clear();
  }

  preflight(
    call: AgentBrowserPolicyCall,
  ): AgentBrowserPolicyStop | undefined {
    const state = this.#state(call.ownerId);
    if (state.stopped !== undefined) return state.stopped;
    const history = state.history;
    const signature = callSignature(call);
    const epoch = callEpoch(call);
    const sameCall = history.filter(
      (entry) =>
        entry.signature === signature &&
        entry.epoch === epoch,
    );
    const sameCallSinceProgress = noProgressTail(history).filter(
      (entry) =>
        entry.signature === signature &&
        entry.epoch === epoch,
    );
    const mostRecent = history.at(-1);

    if (
      call.operation === "open" &&
      typeof call.payload.url === "string" &&
      [...activeSessionUrls(history).values()].includes(
        call.payload.url,
      )
    ) {
      return this.#halt(state, {
        code: "repeated_open",
        message:
          "This URL was already opened in the current browser turn. Reopening it would duplicate a tab without advancing the task.",
      });
    }

    if (
      call.operation === "find" &&
      sameCall.some((entry) =>
        entry.outcome.kind === "success" ||
        entry.outcome.kind === "absence"
      )
    ) {
      return this.#halt(state, {
        code: "find_repeated",
        message:
          "This browser_find query already succeeded or returned a conclusive absence on the unchanged page. Repeating it cannot reveal new evidence.",
      });
    }

    if (
      call.operation === "locate" &&
      sameCall.some((entry) =>
        entry.outcome.kind === "success"
      )
    ) {
      return this.#halt(state, {
        code: "locate_repeated",
        message:
          "This browser_locate expression already succeeded on the unchanged snapshot. Repeating it cannot refine the target.",
      });
    }

    if (
      (
        call.operation === "screenshot" ||
        call.operation === "wait"
      ) &&
      mostRecent?.signature === signature &&
      mostRecent.epoch === epoch &&
      mostRecent.outcome.kind === "success"
    ) {
      return this.#halt(
        state,
        repeatedOperationStop(call.operation),
      );
    }

    const lastSame = sameCallSinceProgress.at(-1);
    if (
      lastSame?.outcome.kind === "success" &&
      !lastSame.outcome.progress
    ) {
      return this.#halt(
        state,
        repeatedOperationStop(call.operation),
      );
    }
    if (
      lastSame?.outcome.kind === "rejection" ||
      (
        lastSame?.outcome.kind === "failure" &&
        !lastSame.outcome.retryable
      )
    ) {
      return this.#halt(
        state,
        repeatedOperationStop(call.operation),
      );
    }
    if (
      lastSame?.outcome.kind === "failure" &&
      lastSame.outcome.retryable &&
      sameCallSinceProgress.filter((entry) =>
        entry.outcome.kind === "failure" &&
        entry.outcome.key === lastSame.outcome.key
      ).length >= 2
    ) {
      return this.#halt(
        state,
        repeatedOperationStop(call.operation),
      );
    }

    const cost = RESOLUTION_COST[call.operation];
    if (cost !== undefined && sameCall.length === 0) {
      const seen = new Map<string, number>();
      for (const entry of history) {
        if (entry.epoch !== epoch) continue;
        const entryCost = RESOLUTION_COST[entry.operation];
        if (entryCost === undefined) continue;
        seen.set(entry.signature, entryCost);
      }
      const spent = [...seen.values()].reduce(
        (sum, entryCost) => sum + entryCost,
        0,
      );
      if (spent + cost > RESOLUTION_BUDGET) {
        return this.#halt(
          state,
          call.operation === "find"
          ? {
              code: "find_exhausted",
              message:
                "The shared target-resolution budget is exhausted on this unchanged snapshot. More semantic queries would be argument churn, not progress.",
            }
          : {
              code: "locate_exhausted",
              message:
                "The shared target-resolution budget is exhausted on this unchanged snapshot. More generated locators would be argument churn, not progress.",
            },
        );
      }
    }

    return undefined;
  }

  recordOutcome(
    call: AgentBrowserPolicyCall,
    outcome: AgentBrowserPolicyOutcome,
  ): AgentBrowserPolicyStop | undefined {
    const state = this.#state(call.ownerId);
    // A call admitted before another concurrent call stopped the turn must
    // still surface its real result, especially if it mutated the page.
    if (state.stopped !== undefined) return undefined;
    const history = state.history;
    history.push({
      operation: call.operation,
      signature: callSignature(call),
      epoch: callEpoch(call),
      ...(call.sessionId === undefined
        ? {}
        : { sessionId: call.sessionId }),
      outcome,
    });
    if (history.length > TRACE_LIMIT) {
      history.splice(0, history.length - TRACE_LIMIT);
    }

    if (repeatedStableExact(history)) {
      return this.#halt(
        state,
        repeatedOperationStop(call.operation),
      );
    }
    if (
      repeatedStablePingPong(history) ||
      repeatedLocationCycle(history)
    ) {
      return this.#halt(state, {
        code: "ping_pong_loop",
        message:
          "Agent Browser detected a repeated observable browser-state cycle. The current path is revisiting the same states rather than advancing the task.",
      });
    }

    if (makesProgress(outcome)) return undefined;

    if (outcome.kind === "absence") {
      const epoch = callEpoch(call);
      const absenceCount = history.filter(
        (entry) =>
          entry.epoch === epoch &&
          entry.outcome.kind === "absence",
      ).length;
      if (absenceCount >= ABSENCE_LIMIT) {
        return this.#halt(state, {
          code: "find_exhausted",
          message:
            "Three distinct searches found no matching control on the unchanged snapshot. The requested target is not currently exposed; do not substitute another action.",
        });
      }
    }

    if (noProgressTail(history).length >= NO_PROGRESS_LIMIT) {
      return this.#halt(state, {
        code: "no_progress_loop",
        message:
          "Agent Browser reached the cross-operation no-progress limit for the current browser path. Further browser calls in this turn would repeat failed reasoning.",
      });
    }
    return undefined;
  }

  #state(ownerId: string): OwnerTurn {
    const existing = this.#owners.get(ownerId);
    if (existing !== undefined) return existing;
    const state: OwnerTurn = {
      turnKey: undefined,
      history: [],
    };
    this.#owners.set(ownerId, state);
    return state;
  }

  #halt(
    state: OwnerTurn,
    stop: AgentBrowserPolicyStop,
  ): AgentBrowserPolicyStop {
    state.stopped = stop;
    return stop;
  }
}
