import type {
  ReactNode,
} from "react";

export interface DshDetailsState {
  readonly open: boolean;
  readonly sessionId: string;
  readonly callId?: string;
  readonly label: string;
  readonly title: string;
}

export interface DshDetailsPresentation {
  readonly state: DshDetailsState;
  readonly panel: ReactNode;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized === "" ? undefined : normalized;
}

/** Validate the narrow state Interface published by Harness Details. */
export function parseDshDetailsState(
  value: unknown,
): DshDetailsState | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.open !== "boolean") return undefined;
  const sessionId = nonEmptyString(candidate.sessionId);
  const label = nonEmptyString(candidate.label);
  const title = nonEmptyString(candidate.title);
  if (
    sessionId === undefined ||
    label === undefined ||
    title === undefined
  ) {
    return undefined;
  }
  const callId = nonEmptyString(candidate.callId);
  if (candidate.open && callId === undefined) return undefined;
  return Object.freeze({
    open: candidate.open,
    sessionId,
    ...(callId === undefined ? {} : { callId }),
    label,
    title,
  });
}
