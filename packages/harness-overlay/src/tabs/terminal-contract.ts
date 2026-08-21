/** Shared desktop/renderer contract for interactive Terminal tabs. */
export const TABS_TERMINAL_CREATE_CHANNEL =
  "minke:tabs:terminal:create";
export const TABS_TERMINAL_WRITE_CHANNEL =
  "minke:tabs:terminal:write";
export const TABS_TERMINAL_RESIZE_CHANNEL =
  "minke:tabs:terminal:resize";
export const TABS_TERMINAL_CLOSE_CHANNEL =
  "minke:tabs:terminal:close";
export const TABS_TERMINAL_EVENT_CHANNEL =
  "minke:tabs:terminal:event";

export const TERMINAL_MIN_COLS = 2;
export const TERMINAL_MAX_COLS = 500;
export const TERMINAL_MIN_ROWS = 2;
export const TERMINAL_MAX_ROWS = 300;
export const TERMINAL_MAX_INPUT_LENGTH = 65_536;
export const TERMINAL_MAX_EVENTS_PER_READ = 128;
export const TERMINAL_MAX_POLL_WAIT_MS = 25_000;

export interface TerminalCreateRequest {
  readonly cwd?: string;
  readonly cols: number;
  readonly rows: number;
}

export interface TerminalCreateResult {
  readonly sessionId: string;
}

export interface TerminalWriteRequest {
  readonly sessionId: string;
  readonly data: string;
}

export interface TerminalResizeRequest {
  readonly sessionId: string;
  readonly cols: number;
  readonly rows: number;
}

export interface TerminalReadRequest {
  readonly sessionId: string;
  readonly cursor: number;
  readonly waitMs: number;
}

export interface TerminalReadResult {
  readonly cursor: number;
  readonly done: boolean;
  readonly truncated: boolean;
  readonly events: readonly TerminalEvent[];
}

export type TerminalEvent =
  | {
      readonly type: "data";
      readonly sessionId: string;
      readonly data: string;
    }
  | {
      readonly type: "exit";
      readonly sessionId: string;
      readonly exitCode?: number;
      readonly signal?: number;
    }
  | {
      readonly type: "error";
      readonly sessionId: string;
      readonly message: string;
    };

function record(value: unknown): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new TypeError("terminal request must be an object");
  }
  return value as Record<string, unknown>;
}

function terminalSessionId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    !/^[a-z0-9][a-z0-9._:-]*$/iu.test(value)
  ) {
    throw new TypeError("invalid terminal session id");
  }
  return value;
}

function terminalDimension(
  value: unknown,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError("invalid terminal dimensions");
  }
  return value;
}

function naturalInteger(
  value: unknown,
  label: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  ) {
    throw new TypeError(`invalid ${label}`);
  }
  return value;
}

function terminalCwd(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4_096 ||
    value.trim() !== value
  ) {
    throw new TypeError("invalid terminal working directory");
  }
  return value;
}

export function parseTerminalCreateRequest(
  value: unknown,
): TerminalCreateRequest {
  const input = record(value);
  const cwd = terminalCwd(input.cwd);
  return {
    ...(cwd === undefined ? {} : { cwd }),
    cols: terminalDimension(
      input.cols,
      TERMINAL_MIN_COLS,
      TERMINAL_MAX_COLS,
    ),
    rows: terminalDimension(
      input.rows,
      TERMINAL_MIN_ROWS,
      TERMINAL_MAX_ROWS,
    ),
  };
}

export function parseTerminalCreateResult(
  value: unknown,
): TerminalCreateResult {
  const input = record(value);
  return {
    sessionId: terminalSessionId(input.sessionId),
  };
}

export function parseTerminalWriteRequest(
  value: unknown,
): TerminalWriteRequest {
  const input = record(value);
  if (
    typeof input.data !== "string" ||
    input.data.length > TERMINAL_MAX_INPUT_LENGTH
  ) {
    throw new TypeError("invalid terminal input");
  }
  return {
    sessionId: terminalSessionId(input.sessionId),
    data: input.data,
  };
}

export function parseTerminalResizeRequest(
  value: unknown,
): TerminalResizeRequest {
  const input = record(value);
  return {
    sessionId: terminalSessionId(input.sessionId),
    cols: terminalDimension(
      input.cols,
      TERMINAL_MIN_COLS,
      TERMINAL_MAX_COLS,
    ),
    rows: terminalDimension(
      input.rows,
      TERMINAL_MIN_ROWS,
      TERMINAL_MAX_ROWS,
    ),
  };
}

export function parseTerminalReadRequest(
  value: unknown,
): TerminalReadRequest {
  const input = record(value);
  return {
    sessionId: terminalSessionId(input.sessionId),
    cursor: naturalInteger(input.cursor, "terminal cursor"),
    waitMs: naturalInteger(
      input.waitMs,
      "terminal poll wait",
      TERMINAL_MAX_POLL_WAIT_MS,
    ),
  };
}

export function parseTerminalSessionId(value: unknown): string {
  return terminalSessionId(value);
}

export function parseTerminalEvent(value: unknown): TerminalEvent {
  const input = record(value);
  const sessionId = terminalSessionId(input.sessionId);
  if (input.type === "data") {
    if (
      typeof input.data !== "string" ||
      input.data.length > TERMINAL_MAX_INPUT_LENGTH
    ) {
      throw new TypeError("invalid terminal output");
    }
    return { type: "data", sessionId, data: input.data };
  }
  if (input.type === "exit") {
    const exitCode =
      typeof input.exitCode === "number" &&
      Number.isInteger(input.exitCode)
        ? input.exitCode
        : undefined;
    const signal =
      typeof input.signal === "number" &&
      Number.isInteger(input.signal)
        ? input.signal
        : undefined;
    return {
      type: "exit",
      sessionId,
      ...(exitCode === undefined ? {} : { exitCode }),
      ...(signal === undefined ? {} : { signal }),
    };
  }
  if (
    input.type === "error" &&
    typeof input.message === "string" &&
    input.message.length > 0 &&
    input.message.length <= 2_048
  ) {
    return {
      type: "error",
      sessionId,
      message: input.message,
    };
  }
  throw new TypeError("invalid terminal event");
}

export function parseTerminalReadResult(
  value: unknown,
): TerminalReadResult {
  const input = record(value);
  if (
    typeof input.done !== "boolean" ||
    typeof input.truncated !== "boolean" ||
    !Array.isArray(input.events) ||
    input.events.length > TERMINAL_MAX_EVENTS_PER_READ
  ) {
    throw new TypeError("invalid terminal read result");
  }
  return {
    cursor: naturalInteger(input.cursor, "terminal cursor"),
    done: input.done,
    truncated: input.truncated,
    events: input.events.map(parseTerminalEvent),
  };
}
