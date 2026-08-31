import type { ComponentType } from "react";

export type HarnessThemePreference = "light" | "dark" | "system";
export type HarnessColorScheme = "light" | "dark";

/** Open locale identifier accepted from alpha.2 language-pack plugins. */
export type HarnessLocale = string;

/** Match alpha.2's BCP 47-style LocaleId wire contract. */
export const HARNESS_LOCALE_ID_PATTERN =
  /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;

/** Validate locale snapshots before they cross the desktop bridge. */
export function isHarnessLocale(
  value: unknown,
): value is HarnessLocale {
  return (
    typeof value === "string" &&
    HARNESS_LOCALE_ID_PATTERN.test(value)
  );
}

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
  key?: string;
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

export interface HarnessRemoteError extends Error {
  readonly code: string;
  readonly details: unknown;
}

export type HarnessRemoteResult =
  | {
    readonly ok: true;
    readonly value: unknown;
  }
  | {
    readonly ok: false;
    readonly error: HarnessRemoteError;
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
  remote: {
    pluginInventory: {
      list(): Promise<HarnessRemoteResult>;
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
  uiWorkspace: {
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
        ): Promise<HarnessRemoteResult>;
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
