import type {
  ChildProcess,
  SpawnOptions,
} from "node:child_process";
import type {
  RemoteRuntimeError,
  RemoteRuntimeSnapshot,
} from "./contract.ts";

const EXTERNAL_RUNTIME_NODE_CONTROLS = [
  "ELECTRON_RUN_AS_NODE",
  "MINKE_INTERACTIVE_NODE_OPTIONS",
  "MINKE_INTERACTIVE_NODE_PATH",
  "MINKE_NODE_BOOTSTRAP",
  "NODE_OPTIONS",
  "NODE_PATH",
] as const;

function deleteEnvironmentName(
  environment: NodeJS.ProcessEnv,
  name: string,
): void {
  const normalized = name.toUpperCase();
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase() === normalized) {
      delete environment[key];
    }
  }
}

/** Build an external-service environment without Minke's Node bootstrap. */
export function externalRuntimeEnvironment(
  inherited: NodeJS.ProcessEnv,
  additions: NodeJS.ProcessEnv = {},
  omissions: readonly string[] = [],
): NodeJS.ProcessEnv {
  const environment = {
    ...inherited,
    ...additions,
  };
  for (const name of [
    ...EXTERNAL_RUNTIME_NODE_CONTROLS,
    ...omissions,
  ]) {
    deleteEnvironmentName(environment, name);
  }
  return environment;
}

export interface RemoteCommandExecutionOptions {
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface RemoteCommandExecutionResult {
  stdout: string;
  stderr: string;
}

export type RemoteCommandExecutor = (
  command: string,
  args: readonly string[],
  options: RemoteCommandExecutionOptions,
) => Promise<RemoteCommandExecutionResult>;

export type RemoteProcessSpawner = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface RemoteLaunchPlan {
  trustedHosts: string[];
}

export interface RemoteAccessLifecycle {
  read(): RemoteRuntimeSnapshot;
  prepare(signal?: AbortSignal): Promise<RemoteLaunchPlan>;
  start(target: string, signal?: AbortSignal): Promise<void>;
  stop(): Promise<void>;
}

export class RemoteAccessError extends Error {
  readonly kind: RemoteRuntimeError;

  constructor(
    kind: RemoteRuntimeError,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RemoteAccessError";
    this.kind = kind;
  }
}
