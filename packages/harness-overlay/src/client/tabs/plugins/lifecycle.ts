import type {
  InstalledPlugin,
} from "@minke/harness-overlay/plugin-install-contract.ts";
import type {
  HarnessClientContext,
} from "../../core/context.ts";
import type {
  PluginInstallerPort,
} from "../../desktop/contracts.ts";

const MAX_PLUGIN_INVENTORY_ENTRIES = 4_096;
const MAX_PLUGIN_INVENTORY_TEXT_LENGTH = 1_024;
const MAX_PLUGIN_RUNTIME_ERROR_LENGTH = 1_000;

export type PluginFiberPhase =
  | "pending"
  | "loading"
  | "active"
  | "failed"
  | "unloading"
  | null;

export interface PluginRuntimeInventoryEntry {
  readonly entryId: string;
  readonly moduleName: string;
  readonly enabled: boolean;
  readonly fiberPhase: PluginFiberPhase;
}

export interface PluginRuntimeInventorySnapshot {
  readonly entries: readonly PluginRuntimeInventoryEntry[];
}

export interface PluginRuntimeInventoryPort {
  read(): Promise<PluginRuntimeInventorySnapshot>;
}

export type PluginLifecycleState =
  | "active"
  | "disabled"
  | "failed"
  | "pending"
  | "unobserved"
  | "missing"
  | "unknown";

export interface PluginLifecyclePlugin {
  readonly name: string;
  readonly requested: string;
  readonly enabled: boolean;
  readonly version?: string;
  readonly description?: string;
  readonly repositoryUrl?: string;
  readonly state: PluginLifecycleState;
}

export interface PluginLifecycleSnapshot {
  readonly plugins: readonly PluginLifecyclePlugin[];
  readonly safeMode: boolean;
  readonly runtimeError?: string;
}

export interface PluginLifecyclePort {
  readonly available: boolean;
  install(command: string): Promise<void>;
  restart(): Promise<void>;
  setEnabled(name: string, enabled: boolean): Promise<void>;
  setSafeMode(enabled: boolean): Promise<void>;
  uninstall(name: string): Promise<void>;
  read(): Promise<PluginLifecycleSnapshot>;
}

type PluginInventoryRemote =
  HarnessClientContext["remote"]["pluginInventory"];

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function parseInventoryText(
  value: unknown,
  label: string,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PLUGIN_INVENTORY_TEXT_LENGTH ||
    value.trim() !== value ||
    /[\0\r\n]/u.test(value)
  ) {
    throw new TypeError(`invalid plugin inventory ${label}`);
  }
  return value;
}

function parseFiberPhase(value: unknown): PluginFiberPhase {
  if (
    value !== null &&
    value !== "pending" &&
    value !== "loading" &&
    value !== "active" &&
    value !== "failed" &&
    value !== "unloading"
  ) {
    throw new TypeError("invalid plugin inventory fiber phase");
  }
  return value;
}

function parseInventoryEntry(
  value: unknown,
): PluginRuntimeInventoryEntry {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 4 ||
    !Object.hasOwn(value, "entryId") ||
    !Object.hasOwn(value, "moduleName") ||
    !Object.hasOwn(value, "enabled") ||
    !Object.hasOwn(value, "fiberPhase") ||
    typeof value.enabled !== "boolean"
  ) {
    throw new TypeError("invalid plugin inventory entry");
  }
  return Object.freeze({
    entryId: parseInventoryText(value.entryId, "entry id"),
    moduleName: parseInventoryText(value.moduleName, "module name"),
    enabled: value.enabled,
    fiberPhase: parseFiberPhase(value.fiberPhase),
  });
}

export function parsePluginRuntimeInventorySnapshot(
  value: unknown,
): PluginRuntimeInventorySnapshot {
  if (
    !isRecord(value) ||
    !Object.hasOwn(value, "entries") ||
    Object.keys(value).some(
      (key) => key !== "entries" && key !== "agentPresets",
    ) ||
    !Array.isArray(value.entries) ||
    value.entries.length > MAX_PLUGIN_INVENTORY_ENTRIES
  ) {
    throw new TypeError("invalid plugin inventory snapshot");
  }
  return Object.freeze({
    entries: Object.freeze(value.entries.map(parseInventoryEntry)),
  });
}

/** Adapt dsh's authoritative Loader inventory Remote. */
export function createHarnessPluginInventoryPort(
  remote: PluginInventoryRemote,
): PluginRuntimeInventoryPort {
  return Object.freeze({
    async read(): Promise<PluginRuntimeInventorySnapshot> {
      const result = await remote.list();
      if (!result.ok) throw result.error;
      return parsePluginRuntimeInventorySnapshot(
        result.value,
      );
    },
  });
}

function runtimeErrorMessage(error: unknown): string {
  const candidate =
    error instanceof Error ? error.message : String(error);
  const normalized = candidate.replace(/\s+/gu, " ").trim();
  return (
    normalized === ""
      ? "plugin runtime inventory is unavailable"
      : normalized
  ).slice(0, MAX_PLUGIN_RUNTIME_ERROR_LENGTH);
}

function lifecycleState(
  plugin: InstalledPlugin,
  entries: readonly PluginRuntimeInventoryEntry[] | undefined,
  safeMode: boolean,
): PluginLifecycleState {
  if (safeMode || !plugin.enabled) return "disabled";
  if (plugin.state === "missing") return "missing";
  if (entries === undefined) return "unknown";
  if (entries.length === 0) return "unobserved";
  const enabled = entries.filter((entry) => entry.enabled);
  if (enabled.length === 0) return "disabled";
  if (enabled.some((entry) => entry.fiberPhase === "failed")) {
    return "failed";
  }
  if (enabled.some((entry) => entry.fiberPhase === "active")) {
    return "active";
  }
  return "pending";
}

function lifecyclePlugin(
  plugin: InstalledPlugin,
  entries: readonly PluginRuntimeInventoryEntry[] | undefined,
  safeMode: boolean,
): PluginLifecyclePlugin {
  return Object.freeze({
    name: plugin.name,
    requested: plugin.requested,
    enabled: plugin.enabled,
    ...(plugin.version === undefined
      ? {}
      : { version: plugin.version }),
    ...(plugin.description === undefined
      ? {}
      : { description: plugin.description }),
    ...(plugin.repositoryUrl === undefined
      ? {}
      : { repositoryUrl: plugin.repositoryUrl }),
    state: lifecycleState(plugin, entries, safeMode),
  });
}

interface InventoryReadSuccess {
  readonly snapshot: PluginRuntimeInventorySnapshot;
}

interface InventoryReadFailure {
  readonly error: string;
}

type InventoryRead = InventoryReadSuccess | InventoryReadFailure;

async function readInventory(
  inventory: PluginRuntimeInventoryPort,
): Promise<InventoryRead> {
  try {
    return { snapshot: await inventory.read() };
  } catch (error) {
    return { error: runtimeErrorMessage(error) };
  }
}

/**
 * Compose installation metadata and current Loader state behind one plugin
 * lifecycle interface. Inventory failures degrade state without hiding the
 * installed package list.
 */
export function createPluginLifecyclePort(
  installer: PluginInstallerPort,
  inventory: PluginRuntimeInventoryPort,
): PluginLifecyclePort {
  return Object.freeze({
    available: installer.available,
    async install(command: string): Promise<void> {
      await installer.install(command);
    },
    async restart(): Promise<void> {
      await installer.restart();
    },
    async setEnabled(
      name: string,
      enabled: boolean,
    ): Promise<void> {
      await installer.setEnabled(name, enabled);
    },
    async setSafeMode(enabled: boolean): Promise<void> {
      await installer.setSafeMode(enabled);
    },
    async uninstall(name: string): Promise<void> {
      await installer.uninstall(name);
    },
    async read(): Promise<PluginLifecycleSnapshot> {
      const [installed, runtime] = await Promise.all([
        installer.readInstalled(),
        readInventory(inventory),
      ]);
      const byModule = new Map<
        string,
        PluginRuntimeInventoryEntry[]
      >();
      if ("snapshot" in runtime) {
        for (const entry of runtime.snapshot.entries) {
          const entries = byModule.get(entry.moduleName);
          if (entries === undefined) {
            byModule.set(entry.moduleName, [entry]);
          } else {
            entries.push(entry);
          }
        }
      }
      return Object.freeze({
        plugins: Object.freeze(
          installed.plugins.map((plugin) =>
            lifecyclePlugin(
              plugin,
              "snapshot" in runtime
                ? (byModule.get(plugin.name) ?? [])
                : undefined,
              installed.safeMode,
            )
          ),
        ),
        safeMode: installed.safeMode,
        ...("error" in runtime
          ? { runtimeError: runtime.error }
          : {}),
      });
    },
  });
}
