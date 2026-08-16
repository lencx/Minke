import type {
  ManagedTab,
} from "@minke/harness-overlay/client/tabs/types.ts";

export interface TerminalTabPayload {
  readonly cwd?: string;
  readonly sessionId?: string;
  readonly status: "starting" | "running" | "exited" | "error";
  readonly exitCode?: number;
  readonly error?: string;
}

export type TerminalTab = ManagedTab<TerminalTabPayload>;

export function isTerminalTab(tab: ManagedTab): tab is TerminalTab {
  return tab.kind === "terminal";
}
