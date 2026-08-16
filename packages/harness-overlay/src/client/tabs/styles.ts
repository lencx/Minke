import {
  TABS_CHROME_HEIGHT,
} from "./constants.ts";

/** Theme-token-only chrome for the content-agnostic Tabs surface. */
export const TABS_STYLES = `
.minke-tabs-panel {
  --minke-tabs-panel-width: 360px;
  --minke-tabs-chrome-height: ${TABS_CHROME_HEIGHT}px;
  --minke-tabs-primary-top: 8px;
  --minke-tabs-primary-height: 32px;
  --minke-tabs-secondary-top: 44px;
  --minke-tabs-control-height: 24px;
  --minke-tabs-control-radius: 9px;
  --minke-tabs-secondary-control-offset-y: -4px;
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  width: var(--minke-tabs-panel-width);
  min-width: 300px;
  max-width: min(760px, calc(100% - 320px));
  flex-direction: column;
  overflow: visible;
  box-sizing: border-box;
  border-left: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  opacity: 0;
  pointer-events: none;
  transform: translateX(24px);
  visibility: hidden;
  transition:
    opacity var(--ds-transition-duration-slow) var(--ds-ease-in-out),
    transform var(--ds-transition-duration-slow) var(--ds-ease-in-out),
    visibility 0s linear var(--ds-transition-duration-slow);
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.minke-tabs-panel[data-open] {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(0);
  visibility: visible;
  transition:
    opacity var(--ds-transition-duration-slow) var(--ds-ease-in-out),
    transform var(--ds-transition-duration-slow) var(--ds-ease-in-out),
    visibility 0s;
}

.minke-tabs-panel[data-overlay] {
  box-shadow: -18px 0 40px -28px rgba(0, 0, 0, 0.52);
}

.minke-tabs-resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -5px;
  z-index: 4;
  width: 10px;
  cursor: col-resize;
  opacity: 0;
  outline: none;
  pointer-events: none;
  touch-action: none;
}

.minke-tabs-panel[data-extended] .minke-tabs-resize-handle,
.minke-tabs-panel[data-overlay] .minke-tabs-resize-handle {
  opacity: 1;
  pointer-events: auto;
}

.minke-tabs-resize-handle::after {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 3px;
  height: 32px;
  border-radius: 999px;
  background: var(--dsw-alias-border-l3);
  content: "";
  opacity: 0;
  transform: translate(-50%, -50%);
  transition: opacity var(--ds-transition-duration-slow)
    var(--ds-ease-in-out);
}

.minke-tabs-resize-handle:hover::after,
.minke-tabs-resize-handle:focus-visible::after,
.minke-tabs-panel[data-resizing] .minke-tabs-resize-handle::after {
  opacity: 1;
}

.minke-tabs-resize-handle:focus-visible::after {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 2px;
}

.minke-tabs-chrome {
  position: relative;
  height: var(--minke-tabs-chrome-height);
  min-height: 64px;
  flex: none;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
}

.minke-tabs-chrome[data-single-row] {
  height: 40px;
  min-height: 40px;
}

.minke-tabs-tabbar {
  position: absolute;
  top: max(2px, calc(var(--minke-tabs-primary-top) - 6px));
  right: 0;
  left: 0;
  display: flex;
  height: var(--minke-tabs-primary-height);
  min-width: 0;
  align-items: stretch;
}

.minke-tabs-tabbar__actions {
  display: flex;
  flex: none;
  align-items: center;
  padding: 0 6px 0 3px;
}

.minke-tabs-toolbar {
  position: absolute;
  top: var(--minke-tabs-secondary-top);
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  min-height: 0;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  box-sizing: border-box;
}

.minke-tabs-toolbar__nav,
.minke-tabs-toolbar__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
  transform: translateY(
    var(--minke-tabs-secondary-control-offset-y)
  );
}

.minke-tabs-toolbar__center {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  transform: translateY(
    var(--minke-tabs-secondary-control-offset-y)
  );
}

.minke-tabs-toolbar__identity {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  line-height: 1.2;
}

.minke-tabs-toolbar__title,
.minke-tabs-toolbar__site {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.minke-tabs-toolbar__title {
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  font-weight: 500;
}

.minke-tabs-toolbar__site {
  margin-top: 2px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
}

.minke-tabs-toolbar__button {
  display: grid;
  width: 28px;
  height: 28px;
  flex: none;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.minke-tabs-toolbar__button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.minke-tabs-toolbar__button:disabled {
  cursor: default;
  opacity: 0.34;
}

.minke-tabs-strip {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-color:
    var(--dsw-alias-border-l3)
    transparent;
  scrollbar-width: none;
}

.minke-tabs-strip::-webkit-scrollbar {
  display: none;
}

.minke-tab {
  position: relative;
  display: flex;
  min-width: 112px;
  max-width: 176px;
  height: var(--minke-tabs-control-height);
  flex: 1 0 112px;
  align-items: center;
  border: 1px solid transparent;
  border-radius: var(--minke-tabs-control-radius);
  color: var(--dsw-alias-label-secondary);
}

.minke-tab:hover,
.minke-tab[data-active] {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.minke-tab[data-active] {
  border-color: var(--dsw-alias-border-l1);
  background: var(--dsw-alias-button-floating-fill);
}

.minke-tab[data-dragging] {
  opacity: 0.46;
}

.minke-tab[data-drop-before]::before,
.minke-tab[data-drop-after]::before {
  position: absolute;
  top: 4px;
  bottom: 4px;
  z-index: 2;
  width: 2px;
  border-radius: 999px;
  background: var(--dsw-alias-state-business-primary);
  content: "";
}

.minke-tab[data-drop-before]::before {
  left: -2px;
}

.minke-tab[data-drop-after]::before {
  right: -2px;
}

.minke-tab__target {
  display: flex;
  min-width: 0;
  height: 100%;
  flex: 1;
  align-items: center;
  gap: 6px;
  padding: 0 4px 0 8px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
}

.minke-tab__mark {
  display: grid;
  width: 18px;
  height: 18px;
  flex: none;
  place-items: center;
  color: var(--dsw-alias-label-tertiary);
}

.minke-tab[data-active] .minke-tab__mark {
  color: var(--dsw-alias-brand-primary);
}

.minke-tab__title {
  overflow: hidden;
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.minke-tab__close {
  display: grid;
  width: 22px;
  height: 22px;
  flex: none;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  opacity: 0;
}

.minke-tab:hover .minke-tab__close,
.minke-tab[data-active] .minke-tab__close,
.minke-tab__close:focus-visible {
  opacity: 1;
}

.minke-tab__close:hover {
  background: var(--dsw-alias-button-floating-hover);
  color: var(--dsw-alias-label-primary);
}

.minke-tabs-progress {
  position: absolute;
  top: var(--minke-tabs-chrome-height);
  right: 0;
  left: 0;
  z-index: 3;
  height: 2px;
  overflow: hidden;
  background: transparent;
  transform: translateY(-1px);
}

.minke-tabs-progress > span {
  display: block;
  width: 38%;
  height: 100%;
  border-radius: 999px;
  background: var(--dsw-alias-brand-primary);
  opacity: 0;
  transform: translateX(-120%);
}

.minke-tabs-progress[data-loading] > span {
  animation: minke-tabs-loading 1.1s ease-in-out infinite;
  opacity: 1;
}

@keyframes minke-tabs-loading {
  0% {
    transform: translateX(-120%);
  }
  65% {
    transform: translateX(190%);
  }
  100% {
    transform: translateX(310%);
  }
}

.minke-tabs-content,
.minke-tabs-view {
  position: relative;
  min-height: 0;
  flex: 1;
}

.minke-tabs-empty {
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  padding: 28px 18px;
  overflow: auto;
  box-sizing: border-box;
}

.minke-tabs-empty__options {
  display: grid;
  width: 100%;
  max-width: 560px;
  gap: 10px;
}

.minke-tabs-empty__option {
  display: flex;
  width: 100%;
  min-height: 64px;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border: 1px solid transparent;
  border-radius: 14px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition:
    background var(--ds-transition-duration-fast) var(--ds-ease-out),
    border-color var(--ds-transition-duration-fast) var(--ds-ease-out);
}

.minke-tabs-empty__option:hover {
  background: var(--dsw-alias-button-floating-hover);
  border-color: var(--dsw-alias-border-l2);
}

.minke-tabs-empty__icon {
  display: grid;
  width: 22px;
  height: 22px;
  flex: none;
  place-items: center;
  color: var(--dsw-alias-label-secondary);
}

.minke-tabs-empty__label {
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
}

.minke-tabs-content {
  display: flex;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
}

.minke-tabs-view {
  display: flex;
  width: 100%;
}

.minke-tabs-view[hidden] {
  display: none;
}

.minke-tabs-error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  flex-direction: column;
  padding: 32px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}

.minke-tabs-error__icon {
  display: grid;
  width: 32px;
  height: 32px;
  margin-bottom: 18px;
  place-items: center;
  border-radius: 9px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-state-error-primary);
}

.minke-tabs-error h2 {
  margin: 0 0 7px;
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
}

.minke-tabs-error p {
  max-width: 38ch;
  margin: 0;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 19px;
}

.minke-tabs-error code {
  max-width: 100%;
  margin-top: 12px;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--ds-font-family-code);
  font-size: 11px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.minke-tabs-error__actions {
  display: flex;
  gap: 8px;
  margin-top: 22px;
}

.minke-tabs-error__actions button {
  display: inline-flex;
  min-height: 32px;
  align-items: center;
  gap: 6px;
  padding: 6px 11px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
}

.minke-tabs-error__actions button:first-child {
  border-color: transparent;
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-label-primary-foreground);
}

.minke-tabs-error__actions button:hover {
  filter: brightness(1.06);
}

.minke-tabs-panel button:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}

@media (prefers-reduced-motion: reduce) {
  .minke-tabs-panel {
    transition: none;
  }

  .minke-tabs-progress[data-loading] > span {
    width: 100%;
    animation: none;
    transform: none;
  }

  .minke-tabs-empty__option {
    transition: none;
  }
}
`;

/** Install the generic Tabs panel stylesheet under the product lifecycle. */
export function installTabsStyles(
  root: Document = document,
): () => void {
  const style = root.createElement("style");
  style.dataset.plugin = "@lencx/minke-harness-overlay";
  style.dataset.minkeTabs = "";
  style.textContent = TABS_STYLES;
  (root.head ?? root.documentElement).append(style);
  return () => {
    style.remove();
  };
}
