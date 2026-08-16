import XTERM_STYLES from "@xterm/xterm/css/xterm.css";

/** xterm primitives plus Minke-owned Terminal tab composition. */
export const TERMINAL_TAB_STYLES = `
${XTERM_STYLES}

.minke-terminal-view {
  position: relative;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
}

.minke-terminal-host {
  position: absolute;
  inset: 0;
  padding: 4px 8px 8px 12px;
  box-sizing: border-box;
}

.minke-terminal-host .xterm,
.minke-terminal-host .xterm-viewport,
.minke-terminal-host .xterm-screen {
  height: 100%;
}

.minke-terminal-host .xterm-viewport {
  scrollbar-color:
    var(--dsw-alias-border-l3)
    transparent;
  scrollbar-width: thin;
}

.minke-terminal-state {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  text-align: center;
}

.minke-terminal-state[data-error] {
  color: var(--dsw-alias-state-error-primary);
}

.minke-terminal-state strong {
  display: block;
  margin-bottom: 6px;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-weight: 600;
}
`;

export function installTerminalTabStyles(
  root: Document = document,
): () => void {
  const style = root.createElement("style");
  style.dataset.plugin = "@lencx/minke-harness-overlay";
  style.dataset.minkeTerminalTabs = "";
  style.textContent = TERMINAL_TAB_STYLES;
  (root.head ?? root.documentElement).append(style);
  return () => {
    style.remove();
  };
}
