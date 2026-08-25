import type {
  ChangeEvent,
  Dispatch,
  SetStateAction,
} from "react";

export type BrowserUserAgentField =
  | "webUserAgent"
  | "agentUserAgent";

export type BrowserUserAgentDrafts = Record<
  BrowserUserAgentField,
  string
>;

export interface BrowserUserAgentDraft {
  readonly displayValue: string;
  readonly configuredValue: string;
}

/** Snapshot the textarea value before React releases currentTarget. */
export function stageBrowserUserAgentChange(
  setDrafts: Dispatch<
    SetStateAction<BrowserUserAgentDrafts>
  >,
  field: BrowserUserAgentField,
  event: Pick<
    ChangeEvent<HTMLTextAreaElement>,
    "currentTarget"
  >,
): void {
  const value = event.currentTarget.value;
  setDrafts((current) => ({
    ...current,
    [field]: value,
  }));
}

/** Show the effective recommendation while preserving an empty auto sentinel. */
export function browserUserAgentDisplayValue(
  configuredValue: string,
  automaticUserAgent: string,
): string {
  return configuredValue === ""
    ? automaticUserAgent
    : configuredValue;
}

/** Fold multiline editing into one safe request-header value. */
export function stageBrowserUserAgentDraft(
  value: string,
  automaticUserAgent: string,
): BrowserUserAgentDraft {
  const normalized = value.replace(/[\t\r\n]+/gu, " ").trim();
  const displayValue = normalized === ""
    ? automaticUserAgent
    : normalized;
  return Object.freeze({
    displayValue,
    configuredValue:
      displayValue === automaticUserAgent ? "" : displayValue,
  });
}
