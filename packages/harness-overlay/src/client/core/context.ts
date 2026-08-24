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
  id?: string;
  order?: number;
  priority?: number;
  label?: () => string;
  locale?: string;
  inject?: () => unknown;
}

export interface SlotService {
  inject(name: string, callback: () => unknown): () => void;
  register<Props>(
    options: SlotRegistration,
    component: ComponentType<Props>,
  ): () => void;
}

export type HarnessRpcResult =
  | {
    readonly ok: true;
    readonly value: unknown;
  }
  | {
    readonly ok: false;
    readonly error: {
      readonly code: string;
      readonly message: string;
      readonly details: unknown;
    };
  };

export type HarnessPromptContentPart =
  | {
      readonly type: "text";
      readonly text: string;
    }
  | {
      readonly type: "image";
      readonly mediaType: "image/png";
      readonly data: string;
      readonly name?: string;
    };

export interface HarnessClientScopedContext {
  effect(
    callback: () => void | (() => void),
    label: string,
  ): unknown;
  get(service: string): unknown;
}

/**
 * Public Harness services consumed by the client feature installers.
 *
 * Keeping this structural boundary independent from product features prevents
 * the composition root from accumulating feature-specific overloads.
 */
export interface HarnessClientContext {
  /**
   * Resolve optional services through Cordis' tracked dependency scope.
   * Feature code must not read an optional service directly from the root
   * context because doing so bypasses service lifetime tracking.
   */
  inject?(
    dependencies: readonly string[],
    callback: (scope: HarnessClientScopedContext) => void,
  ): unknown;
  connection: {
    rpc: {
      call(
        channel: string,
        endpoint: string,
        payload: unknown,
        signal?: AbortSignal,
      ): Promise<HarnessRpcResult>;
    };
  };
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
    details: {
      open(): void;
      close(): void;
      getSnapshot(): boolean;
      subscribe(listener: () => void): () => void;
      registerHost(): () => void;
    };
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
      getSnapshot(): {
        current: string | undefined;
        byId: Readonly<
          Record<
            string,
            {
              readonly cwd?: string;
              readonly title?: string;
            } | undefined
          >
        >;
      };
      subscribe(listener: () => void): () => void;
    };
    binding(sessionId: string): {
      readonly session: {
        prompt(
          content: HarnessPromptContentPart[],
          mode: "queue" | "steer",
          signal?: AbortSignal,
        ): Promise<HarnessRpcResult>;
      };
    } | undefined;
    /**
     * Resolve a use-and-discard session scope. Optional for compatibility
     * with older Harness builds that can still accept direct prompts.
     */
    scope?(sessionId: string): unknown;
    open(sessionId: string): void;
  };
}
