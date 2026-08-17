export interface RuntimeTarget {
  readonly arch?: string;
  readonly platform?: string;
}

export interface RuntimeArtifactSummary {
  readonly bytes: number;
  readonly files: number;
}

export interface RuntimeArtifactInspection extends RuntimeArtifactSummary {
  readonly prunable: RuntimeArtifactSummary & {
    readonly categories: Readonly<Record<string, RuntimeArtifactSummary>>;
  };
}

export const RUNTIME_PRUNE_POLICY_VERSION: number;

export function runtimeArtifactCategory(
  path: string,
  target?: RuntimeTarget,
): string | undefined;

export function isPrunableRuntimePath(
  path: string,
  target?: RuntimeTarget,
): boolean;

export function inspectRuntimeArtifacts(
  runtimeRoot: string,
  target?: RuntimeTarget,
): Promise<RuntimeArtifactInspection>;

export function pruneRuntimeArtifacts(
  runtimeRoot: string,
  target?: RuntimeTarget,
): Promise<unknown>;

export function assertRuntimeSizeBudget(
  bytes: number,
  budgetBytes: number,
): void;

export function assertRuntimeFileBudget(
  files: number,
  budgetFiles: number,
): void;
