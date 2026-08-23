import type {
  ChildProcess,
  SpawnOptions,
} from "node:child_process";
import type {
  RemoteRuntimeError,
  RemoteRuntimeSnapshot,
} from "./contract.ts";

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
