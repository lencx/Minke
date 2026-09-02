import type {
  AgentBrowserNavigationCommand,
  AgentBrowserProjection,
} from "@minke/harness-overlay/agent-browser-contract.ts";
import type {
  AgentBrowserHistoryClearRequest,
  AgentBrowserHistoryReadRequest,
  AgentBrowserHistorySnapshot,
} from "@minke/harness-overlay/agent-browser-history-contract.ts";
import type {
  AgentBrowserAnnotationCommitResult,
  AgentBrowserAnnotationEvent,
  AgentBrowserAnnotationRefreshRequest,
  AgentBrowserAnnotationRefreshResult,
  AgentBrowserAnnotationSession,
  AgentBrowserAnnotationStopRequest,
} from "@minke/harness-overlay/agent-browser-annotation-contract.ts";
import type {
  ManagedTab,
} from "@minke/harness-overlay/client/tabs/types.ts";

export const AGENT_BROWSER_TAB_KIND = "agent-web";

export interface AgentBrowserTabPayload
  extends AgentBrowserProjection {
  readonly controlPending: boolean;
  readonly controlError?: string;
}

export type AgentBrowserTab =
  ManagedTab<AgentBrowserTabPayload>;

export interface AgentBrowserTabsPort {
  readonly available: boolean;
  read(): Promise<readonly AgentBrowserProjection[]>;
  setControl(
    sessionId: string,
    owner: AgentBrowserProjection["owner"],
  ): Promise<AgentBrowserProjection>;
  navigate(
    sessionId: string,
    command: AgentBrowserNavigationCommand,
  ): Promise<AgentBrowserProjection>;
  readHistory(
    request: AgentBrowserHistoryReadRequest,
  ): Promise<AgentBrowserHistorySnapshot>;
  clearHistory(
    request: AgentBrowserHistoryClearRequest,
  ): Promise<AgentBrowserHistorySnapshot>;
  startAnnotation(
    sessionId: string,
  ): Promise<AgentBrowserAnnotationSession>;
  stopAnnotation(
    request: AgentBrowserAnnotationStopRequest,
  ): Promise<void>;
  refreshAnnotation(
    request: AgentBrowserAnnotationRefreshRequest,
  ): Promise<AgentBrowserAnnotationRefreshResult>;
  commitAnnotation(
    request: AgentBrowserAnnotationRefreshRequest,
  ): Promise<AgentBrowserAnnotationCommitResult>;
  close(sessionId: string): void;
  subscribe(
    listener: (
      projections: readonly AgentBrowserProjection[],
    ) => void,
  ): () => void;
  subscribeAnnotationEvents(
    listener: (event: AgentBrowserAnnotationEvent) => void,
  ): () => void;
}

export function isAgentBrowserTab(
  tab: ManagedTab,
): tab is AgentBrowserTab {
  return tab.kind === AGENT_BROWSER_TAB_KIND;
}

export function hasStableAgentControl(
  payload: Pick<
    AgentBrowserTabPayload,
    "controlPending" | "owner" | "status"
  >,
): boolean {
  return (
    payload.owner === "agent" &&
    !payload.controlPending &&
    (
      payload.status === "ready" ||
      payload.status === "loading"
    )
  );
}

export function hasStableHumanControl(
  payload: Pick<
    AgentBrowserTabPayload,
    "controlPending" | "owner" | "status"
  >,
): boolean {
  return (
    payload.owner === "human" &&
    !payload.controlPending &&
    payload.status === "paused"
  );
}
