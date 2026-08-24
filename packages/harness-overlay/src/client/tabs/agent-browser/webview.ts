export const AGENT_BROWSER_WEB_PREFERENCES = Object.freeze([
  "contextIsolation=yes",
  "nodeIntegration=no",
  "sandbox=yes",
  "webSecurity=yes",
]);

interface AgentBrowserWebviewTarget {
  className: string;
  setAttribute(name: string, value: string): void;
}

const ELECTRON_USER_AGENT_TOKEN = /(?:^|\s+)Electron\/[^\s]+/gu;

/**
 * Keep the embedder's real Chromium/platform identity while omitting Electron's
 * product token from guest requests.
 */
export function agentBrowserUserAgent(userAgent: string): string {
  return userAgent
    .replace(ELECTRON_USER_AGENT_TOKEN, "")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

/**
 * Configure only the renderer-owned presentation shell. Main admits the
 * partition and performs the first navigation after it claims the guest.
 */
export function configureAgentBrowserWebview(
  view: AgentBrowserWebviewTarget,
  options: {
    readonly partition: string;
    readonly label: string;
    readonly userAgent: string;
  },
): void {
  view.className = "minke-agent-browser__guest";
  view.setAttribute(
    "useragent",
    agentBrowserUserAgent(options.userAgent),
  );
  view.setAttribute("src", "about:blank");
  view.setAttribute("partition", options.partition);
  view.setAttribute(
    "webpreferences",
    AGENT_BROWSER_WEB_PREFERENCES.join(","),
  );
  view.setAttribute("aria-label", options.label);
}
