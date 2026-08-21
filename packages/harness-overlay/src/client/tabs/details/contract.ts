export const DSH_DETAILS_STATE_EVENT =
  "minke:dsh-details-state";
export const MINKE_DETAILS_PORTAL_EVENT =
  "minke:details-portal-change";
export const MINKE_DETAILS_PORTAL_SELECTOR =
  "[data-minke-details-portal]";
export const DSH_DETAILS_STATE_KEY =
  "__minkeDshDetailsState";

export interface DshDetailsState {
  readonly open: boolean;
  readonly sessionId: string;
  readonly callId?: string;
  readonly label: string;
  readonly title: string;
}

type DetailsStateHost = Readonly<
  Record<string, unknown>
>;

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized === "" ? undefined : normalized;
}

/**
 * Keep the runtime-patch boundary narrow and fail closed when an older or
 * third-party Details producer publishes an incomplete payload.
 */
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

export function readDshDetailsState(
  host: DetailsStateHost = globalThis as DetailsStateHost,
): DshDetailsState | undefined {
  return parseDshDetailsState(host[DSH_DETAILS_STATE_KEY]);
}
