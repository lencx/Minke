import type {
  TabsRuntime,
} from "./runtime.ts";

export interface BottomTabsDefaultCreator {
  create(
    cwd: string | undefined,
    title: string,
  ): string | undefined;
}

export interface BottomTabsToggleOptions {
  readonly currentCwd: () => string | undefined;
  readonly defaultTitle: () => string;
  readonly runtime: TabsRuntime;
  readonly terminal?: BottomTabsDefaultCreator;
}

/**
 * Keep every bottom-panel entry point on the same first-open policy.
 * Existing tabs toggle normally; an empty workspace starts a Terminal.
 */
export function createBottomTabsToggle({
  currentCwd,
  defaultTitle,
  runtime,
  terminal,
}: BottomTabsToggleOptions): () => void {
  return () => {
    const snapshot = runtime.getSnapshot();
    if (snapshot.visible) {
      runtime.hide();
      return;
    }
    if (snapshot.tabs.length === 0 && terminal !== undefined) {
      const tabId = terminal.create(
        currentCwd(),
        defaultTitle(),
      );
      if (tabId !== undefined) return;
    }
    runtime.show();
  };
}
