import type {
  FileManagerCodeTheme,
  FileManagerCodeThemeMode,
  FileManagerViewState,
  FileManagerViewStateUpdate,
} from "@minke/harness-overlay/tabs/files-contract.ts";

export type CodeThemeSettingsErrorKind =
  | "unavailable"
  | "read"
  | "write";

export type CodeThemeSelections = Readonly<
  Record<FileManagerCodeThemeMode, FileManagerCodeTheme>
>;

export interface CodeThemeSettingsSnapshot {
  readonly themes: CodeThemeSelections;
  readonly colorScheme: FileManagerCodeThemeMode;
  readonly theme: FileManagerCodeTheme;
  readonly editable: boolean;
  readonly error: CodeThemeSettingsErrorKind | undefined;
  readonly revision: number;
}

export interface CodeThemeSettingsStore {
  readonly available: boolean;
  readViewState?(): Promise<FileManagerViewState>;
  writeViewState?(
    update: FileManagerViewStateUpdate,
  ): Promise<void>;
}

const DEFAULT_CODE_THEMES: CodeThemeSelections = Object.freeze({
  light: "github-light-default",
  dark: "github-dark-default",
});
const CODE_THEME_MODES = ["light", "dark"] as const;

function freezeThemes(
  themes: CodeThemeSelections,
): CodeThemeSelections {
  return Object.freeze({ ...themes });
}

/**
 * Owns one independently selected code theme for each Minke appearance and
 * exposes the theme for the currently active appearance.
 */
export class CodeThemeSettingsRuntime {
  readonly store: CodeThemeSettingsStore;
  #snapshot: CodeThemeSettingsSnapshot;
  #listeners = new Set<() => void>();
  #saveTail: Promise<void> = Promise.resolve();
  #saveGeneration = 0;
  #themeRevisions: Record<FileManagerCodeThemeMode, number> = {
    light: 0,
    dark: 0,
  };
  #initializePromise: Promise<void> | undefined;
  #disposed = false;

  constructor(
    store: CodeThemeSettingsStore,
    colorScheme: FileManagerCodeThemeMode,
  ) {
    this.store = store;
    const editable =
      store.available &&
      store.readViewState !== undefined &&
      store.writeViewState !== undefined;
    const themes = freezeThemes(DEFAULT_CODE_THEMES);
    this.#snapshot = Object.freeze({
      themes,
      colorScheme,
      theme: themes[colorScheme],
      editable,
      error: editable ? undefined : "unavailable",
      revision: 0,
    });
  }

  getSnapshot = (): CodeThemeSettingsSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  initialize(): Promise<void> {
    this.#initializePromise ??= this.#initialize();
    return this.#initializePromise;
  }

  update(
    colorScheme: FileManagerCodeThemeMode,
    theme: FileManagerCodeTheme,
  ): void {
    if (!this.#snapshot.editable) {
      throw new Error("code theme settings are not editable");
    }
    if (theme === this.#snapshot.themes[colorScheme]) return;
    this.#themeRevisions[colorScheme] += 1;
    this.#publish({
      themes: {
        ...this.#snapshot.themes,
        [colorScheme]: theme,
      },
      error: undefined,
    });

    const generation = ++this.#saveGeneration;
    const operation = this.#saveTail.then(async () => {
      await this.store.writeViewState?.({
        colorScheme,
        codeTheme: theme,
      });
    });
    this.#saveTail = operation.then(
      () => {
        if (this.#disposed || generation !== this.#saveGeneration) {
          return;
        }
        if (this.#snapshot.error === "write") {
          this.#publish({ error: undefined });
        }
      },
      () => {
        if (this.#disposed || generation !== this.#saveGeneration) {
          return;
        }
        this.#publish({ error: "write" });
      },
    );
  }

  setColorScheme(colorScheme: FileManagerCodeThemeMode): void {
    if (colorScheme === this.#snapshot.colorScheme) return;
    this.#publish({ colorScheme });
  }

  async flush(): Promise<void> {
    await this.#saveTail;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#listeners.clear();
  }

  async #initialize(): Promise<void> {
    if (!this.#snapshot.editable) return;
    const revisions = { ...this.#themeRevisions };
    try {
      const state = await this.store.readViewState?.();
      if (this.#disposed) return;
      const themes = { ...this.#snapshot.themes };
      for (const colorScheme of CODE_THEME_MODES) {
        const storedTheme = state?.codeThemes?.[colorScheme];
        if (
          storedTheme !== undefined &&
          revisions[colorScheme] ===
            this.#themeRevisions[colorScheme]
        ) {
          themes[colorScheme] = storedTheme;
        }
      }
      this.#publish({
        themes,
        error: undefined,
      });
    } catch {
      if (this.#disposed) return;
      this.#publish({ error: "read" });
    }
  }

  #publish(
    patch: Partial<
      Omit<CodeThemeSettingsSnapshot, "revision" | "theme">
    >,
  ): void {
    if (this.#disposed) return;
    const themes = freezeThemes(
      patch.themes ?? this.#snapshot.themes,
    );
    const colorScheme =
      patch.colorScheme ?? this.#snapshot.colorScheme;
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      ...patch,
      themes,
      colorScheme,
      theme: themes[colorScheme],
      revision: this.#snapshot.revision + 1,
    });
    for (const listener of [...this.#listeners]) listener();
  }
}
