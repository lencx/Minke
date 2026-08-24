export {
  AgentBrowserTabsController,
} from "./controller.ts";
export {
  createAgentBrowserTabRenderer,
} from "./renderer.tsx";
export {
  createAgentBrowserComposerBridge,
  createAgentBrowserChatPort,
} from "./chat.ts";
export type {
  AgentBrowserComposerBridge,
  AgentBrowserComposerCapability,
} from "./chat.ts";
export {
  agentBrowserTabsEn,
  agentBrowserTabsZh,
} from "./locales.ts";
export type {
  AgentBrowserTabsLocaleKey,
  AgentBrowserTabsTranslate,
} from "./locales.ts";
export {
  installAgentBrowserTabStyles,
} from "./styles.ts";
export {
  AGENT_BROWSER_TAB_KIND,
  isAgentBrowserTab,
} from "./types.ts";
export type {
  AgentBrowserTab,
  AgentBrowserTabPayload,
  AgentBrowserTabsPort,
} from "./types.ts";
