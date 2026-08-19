import {
  parseDataHomePath,
  type DataHomeMigrationMode,
  type DataHomeMigrationPlan,
  type DataHomeSettingsSnapshot as DataHomeDataSnapshot,
} from "@minke/harness-overlay/data-home-contract.ts";
import type {
  DataHomeSettingsPort,
} from "@minke/harness-overlay/client/bridge.ts";

export type DataHomeSettingsErrorKind =
  | "unavailable"
  | "read"
  | "choose"
  | "plan"
  | "fresh"
  | "schedule";

export interface DataHomeSettingsSnapshot {
  data: Readonly<DataHomeDataSnapshot> | undefined;
  plan: Readonly<DataHomeMigrationPlan> | undefined;
  busy: boolean;
  scheduled: boolean;
  error: DataHomeSettingsErrorKind | undefined;
  revision: number;
}

/** Owns the async Settings workflow without allowing a live home switch. */
export class DataHomeSettingsRuntime {
  readonly port: DataHomeSettingsPort;
  #snapshot: DataHomeSettingsSnapshot = Object.freeze({
    data: undefined,
    plan: undefined,
    busy: false,
    scheduled: false,
    error: undefined,
    revision: 0,
  });
  #listeners = new Set<() => void>();
  #initializePromise: Promise<void> | undefined;
  #disposed = false;

  constructor(port: DataHomeSettingsPort) {
    this.port = port;
  }

  getSnapshot = (): DataHomeSettingsSnapshot => this.#snapshot;

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

  async chooseDirectory(): Promise<string | undefined> {
    if (!this.port.available) {
      this.#publish({ error: "unavailable" });
      return undefined;
    }
    this.#publish({ busy: true, error: undefined });
    try {
      return await this.port.chooseDirectory();
    } catch {
      this.#publish({ error: "choose" });
      return undefined;
    } finally {
      this.#publish({ busy: false });
    }
  }

  async preview(
    targetPath: string,
    mode: DataHomeMigrationMode,
  ): Promise<void> {
    if (!this.port.available) {
      this.#publish({ error: "unavailable" });
      return;
    }
    this.#publish({
      busy: true,
      error: undefined,
      plan: undefined,
      scheduled: false,
    });
    try {
      const target = parseDataHomePath(targetPath);
      const plan = await this.port.plan({
        mode,
        targetPath: target,
      });
      this.#publish({ plan });
    } catch {
      this.#publish({
        error: mode === "fresh" ? "fresh" : "plan",
      });
    } finally {
      this.#publish({ busy: false });
    }
  }

  async schedule(
    targetPath: string,
    mode: DataHomeMigrationMode,
  ): Promise<void> {
    if (!this.port.available) {
      this.#publish({ error: "unavailable" });
      return;
    }
    this.#publish({ busy: true, error: undefined });
    try {
      const target = parseDataHomePath(targetPath);
      if (
        this.#snapshot.plan?.targetPath !== target ||
        this.#snapshot.plan.mode !== mode
      ) {
        throw new Error(
          "data-home migration must be previewed first",
        );
      }
      await this.port.schedule({
        mode,
        targetPath: target,
        riskAccepted: true,
      });
      this.#publish({ scheduled: true });
    } catch {
      this.#publish({ error: "schedule" });
    } finally {
      this.#publish({ busy: false });
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#listeners.clear();
  }

  async #initialize(): Promise<void> {
    if (!this.port.available) {
      this.#publish({ error: "unavailable" });
      return;
    }
    try {
      const data = await this.port.read();
      this.#publish({ data });
    } catch {
      this.#publish({ error: "read" });
    }
  }

  #publish(
    patch: Partial<Omit<DataHomeSettingsSnapshot, "revision">>,
  ): void {
    if (this.#disposed) return;
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      ...patch,
      revision: this.#snapshot.revision + 1,
    });
    for (const listener of [...this.#listeners]) listener();
  }
}
