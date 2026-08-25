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

/**
 * Configure only the renderer-owned presentation shell. Main admits the
 * partition, owns its UA, and navigates after it claims the guest.
 */
export function configureAgentBrowserWebview(
  view: AgentBrowserWebviewTarget,
  options: {
    readonly partition: string;
    readonly label: string;
  },
): void {
  view.className = "minke-agent-browser__guest";
  view.setAttribute("src", "about:blank");
  view.setAttribute("partition", options.partition);
  view.setAttribute(
    "webpreferences",
    AGENT_BROWSER_WEB_PREFERENCES.join(","),
  );
  view.setAttribute("aria-label", options.label);
}
