import type {
  AgentBrowserAnnotationPage,
  AgentBrowserAnnotationTarget,
} from "@minke/harness-overlay/agent-browser-annotation-contract.ts";
import type {
  AgentBrowserChatTarget,
  AgentBrowserNumberedComment,
} from "../agent-browser/chat.ts";

export type BrowserAnnotationPhase =
  | "idle"
  | "starting"
  | "active"
  | "sending"
  | "error";

export interface BrowserAnnotationSnapshot {
  readonly phase: BrowserAnnotationPhase;
  readonly count: number;
  readonly comments: readonly AgentBrowserNumberedComment[];
  readonly draft?: AgentBrowserAnnotationTarget;
  readonly draftComment?: string;
  readonly editingIndex?: number;
  readonly page?: AgentBrowserAnnotationPage;
  readonly annotationSessionId?: string;
  readonly generation?: number;
  readonly chatTarget?: AgentBrowserChatTarget;
  readonly staleTargetIds?: readonly string[];
  readonly error?: string;
}

export interface BrowserAnnotationController {
  commitAnnotation(tabId: string, comment: string): void;
  dismissAnnotationDraft(tabId: string): void;
  editAnnotation(tabId: string, index: number): void;
  removeAnnotation(tabId: string, index: number): void;
}

export interface BrowserAnnotationLabels {
  readonly commentLabel: string;
  readonly commentAdd: string;
  readonly commentEdit: string;
  readonly commentPlaceholder: string;
  readonly actionDelete: string;
  readonly actionDismiss: string;
  readonly actionAdd: string;
  readonly actionSave: string;
  readonly errorStale: string;
  actionEditNumber(number: number): string;
}
