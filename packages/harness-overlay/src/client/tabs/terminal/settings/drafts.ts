import type {
  ChangeEvent,
  Dispatch,
  SetStateAction,
} from "react";
import type {
  TerminalSettings,
} from "../../../../terminal-settings-contract.ts";

export type SettingField = keyof TerminalSettings;
export type TerminalSettingDrafts = Record<SettingField, string>;

/**
 * Snapshot the DOM value while React still owns currentTarget. State
 * updaters may run after event dispatch, when currentTarget is null again.
 */
export function stageDraftChange(
  setDrafts: Dispatch<SetStateAction<TerminalSettingDrafts>>,
  field: SettingField,
  event: Pick<ChangeEvent<HTMLInputElement>, "currentTarget">,
): void {
  const value = event.currentTarget.value;
  setDrafts((current) => ({
    ...current,
    [field]: value,
  }));
}
