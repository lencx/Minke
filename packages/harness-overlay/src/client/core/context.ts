import type { ComponentType } from "react";

export type HarnessThemePreference = "light" | "dark" | "system";
export type HarnessColorScheme = "light" | "dark";
export type HarnessLocale = "zh" | "en";

export interface HarnessLocaleSnapshot {
  active: HarnessLocale;
  revision: number;
}

export interface HarnessThemeSnapshot {
  preference: HarnessThemePreference;
  active: {
    colorScheme: HarnessColorScheme;
  };
}

export interface LocaleService {
  register<Key extends string>(
    namespace: string,
    dictionaries: {
      zh: Record<Key, string>;
      en: Record<Key, string>;
    },
  ): () => void;
  bind<Key extends string>(
    namespace: string,
  ): (
    key: Key,
    params?: Record<string, unknown>,
  ) => string;
  getSnapshot(): HarnessLocaleSnapshot;
  subscribe(listener: () => void): () => void;
}

export interface SlotRegistration {
  name: string;
  id: string;
  order: number;
  priority?: number;
  label?: () => string;
  locale?: string;
  inject?: () => unknown;
}

export interface SlotService {
  inject(name: string, callback: () => unknown): void;
  register(
    options: SlotRegistration,
    component: ComponentType<never>,
  ): unknown;
}

/**
 * Public Harness services consumed by the client feature installers.
 *
 * Keeping this structural boundary independent from product features prevents
 * the composition root from accumulating feature-specific overloads.
 */
export interface HarnessClientContext {
  effect(
    callback: () => void | (() => void),
    label: string,
  ): unknown;
  locale: LocaleService;
  layout: {
    openDetails(): void;
    closeDetails(): void;
    setDetails(width: number): void;
    toggleSidebar(): void;
  };
  slots: SlotService;
  theme: {
    getTheme(): HarnessThemeSnapshot;
  };
  on(
    event: "theme/change",
    listener: (snapshot: HarnessThemeSnapshot) => void,
  ): void;
  on(
    event: "locale/change",
    listener: (snapshot: HarnessLocaleSnapshot) => void,
  ): void;
  workspaces: {
    openPath(path: string): Promise<void>;
    startSession(workspaceId?: unknown): void;
  };
  sessions: {
    list: {
      getSnapshot(): { current: string | undefined };
      subscribe(listener: () => void): () => void;
    };
    open(sessionId: string): void;
  };
}
