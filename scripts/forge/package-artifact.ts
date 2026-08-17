import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  assertRuntimeFileBudget,
  assertRuntimeSizeBudget,
  inspectRuntimeArtifacts,
} from "../harness/runtime-prune.mjs";

export interface PackageArtifactPolicy {
  readonly schemaVersion: number;
  readonly appSizeBudgetBytes: Readonly<Record<string, number>>;
}

export interface PackageArtifactVerificationOptions {
  readonly appSizeBudgetBytes?: number;
  readonly arch: string;
  readonly platform: string;
  readonly productPackageName: string;
  readonly runtimeFileBudget: number;
  readonly runtimeSizeBudgetBytes: number;
}

export interface ArtifactTreeStats {
  readonly bytes: number;
  readonly files: number;
}

export interface PackageArtifactReport {
  readonly app: ArtifactTreeStats;
  readonly host: ArtifactTreeStats;
}

async function requireRegularFile(path: string): Promise<void> {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      throw new Error(`packaged application is missing required file ${path}`);
    }
    throw error;
  }
  if (!info.isFile()) {
    throw new Error(
      `packaged application required file is not regular: ${path}`,
    );
  }
}

async function requireMissing(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
  throw new Error(`packaged application contains forbidden path ${path}`);
}

async function treeStats(root: string): Promise<ArtifactTreeStats> {
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error(`packaged application tree is not a directory: ${root}`);
  }

  let bytes = 0;
  let files = 0;
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      const info = await lstat(path);
      if (!info.isFile() && !info.isSymbolicLink()) {
        throw new Error(`packaged application contains special file ${path}`);
      }
      bytes += info.size;
      files += 1;
    }
  }
  await visit(root);
  return { bytes, files };
}

async function applicationRoot(
  outputPath: string,
  platform: string,
): Promise<string> {
  if (platform === "darwin") {
    if (basename(outputPath).endsWith(".app")) return outputPath;
    const applications = (await readdir(outputPath, { withFileTypes: true }))
      .filter(
        (entry) => entry.isDirectory() && entry.name.endsWith(".app"),
      )
      .map((entry) => entry.name);
    if (applications.length !== 1) {
      throw new Error(
        `expected one macOS .app in ${outputPath}, found ${String(applications.length)}`,
      );
    }
    return join(outputPath, applications[0]);
  }
  return outputPath;
}

function resourcesRoot(appRoot: string, platform: string): string {
  return platform === "darwin"
    ? join(appRoot, "Contents", "Resources")
    : join(appRoot, "resources");
}

function executablePath(appRoot: string, platform: string): string {
  if (platform === "darwin") {
    return join(appRoot, "Contents", "MacOS", "Minke");
  }
  return join(appRoot, platform === "win32" ? "Minke.exe" : "Minke");
}

function runtimeAdapterName(platform: string, name: string): string {
  return platform === "win32" ? `${name}.cmd` : name;
}

function hasSourceCondition(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasSourceCondition);
  if (Object.hasOwn(value, "source")) return true;
  return Object.values(value).some(hasSourceCondition);
}

export function parsePackageArtifactPolicy(
  value: unknown,
): PackageArtifactPolicy {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("package artifact policy must be an object");
  }
  const candidate = value as {
    schemaVersion?: unknown;
    appSizeBudgetBytes?: unknown;
  };
  if (candidate.schemaVersion !== 1) {
    throw new Error("package artifact policy schemaVersion must be 1");
  }
  if (
    candidate.appSizeBudgetBytes === null ||
    typeof candidate.appSizeBudgetBytes !== "object" ||
    Array.isArray(candidate.appSizeBudgetBytes)
  ) {
    throw new Error("package artifact policy must declare appSizeBudgetBytes");
  }
  for (const [platform, budget] of Object.entries(
    candidate.appSizeBudgetBytes,
  )) {
    if (
      platform.length === 0 ||
      !Number.isSafeInteger(budget) ||
      (budget as number) <= 0
    ) {
      throw new Error(
        `invalid package artifact size budget for ${JSON.stringify(platform)}`,
      );
    }
  }
  return candidate as PackageArtifactPolicy;
}

export async function verifyPackagedApplication(
  outputPath: string,
  options: PackageArtifactVerificationOptions,
): Promise<PackageArtifactReport> {
  const appRoot = await applicationRoot(outputPath, options.platform);
  const appResources = resourcesRoot(appRoot, options.platform);
  const hostRoot = join(appResources, "host");
  const productRoot = join(
    hostRoot,
    "node_modules",
    ...options.productPackageName.split("/"),
  );
  const mistralRoot = join(
    hostRoot,
    "node_modules",
    "@earendil-works",
    "pi-ai",
    "node_modules",
    "@mistralai",
    "mistralai",
  );
  const required = [
    executablePath(appRoot, options.platform),
    join(appResources, "app.asar"),
    join(hostRoot, "index.mjs"),
    join(hostRoot, "dsh-runtime.json"),
    join(hostRoot, "bin", runtimeAdapterName(options.platform, "node")),
    join(hostRoot, "bin", runtimeAdapterName(options.platform, "pnpm")),
    join(hostRoot, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
    join(hostRoot, "node_modules", "pnpm", "dist", "pnpm.mjs"),
    join(hostRoot, "node_modules", "esbuild", "bin", "esbuild"),
    join(productRoot, "package.json"),
    join(productRoot, "lib", "index.js"),
    join(productRoot, "lib", "client.js"),
    join(mistralRoot, "package.json"),
    join(mistralRoot, "esm", "index.js"),
  ];
  if (options.platform === "darwin") {
    required.push(
      join(
        hostRoot,
        "node_modules",
        "node-pty",
        "prebuilds",
        `${options.platform}-${options.arch}`,
        "pty.node",
      ),
      join(
        hostRoot,
        "node_modules",
        "node-pty",
        "prebuilds",
        `${options.platform}-${options.arch}`,
        "spawn-helper",
      ),
      join(
        appResources,
        "app.asar.unpacked",
        "node_modules",
        "sys",
        "lencx_mb.node",
      ),
    );
  }
  await Promise.all(required.map(requireRegularFile));

  const forbidden = [
    join(appResources, "node"),
    join(appResources, "node.exe"),
    join(hostRoot, "node"),
    join(hostRoot, "node.exe"),
    join(hostRoot, "node_modules", "pnpm", "artifacts"),
    join(hostRoot, "node_modules", "@mixmark-io", "domino", ".yarn"),
    join(hostRoot, "node_modules", "@mixmark-io", "domino", "test"),
    join(
      hostRoot,
      "node_modules",
      "@earendil-works",
      "pi-ai",
      "node_modules",
      "@mistralai",
      "mistralai",
      "examples",
    ),
    join(
      hostRoot,
      "node_modules",
      "@earendil-works",
      "pi-ai",
      "node_modules",
      "@mistralai",
      "mistralai",
      "packages",
    ),
    join(mistralRoot, "src"),
    join(
      hostRoot,
      "node_modules",
      "@earendil-works",
      "pi-ai",
      "node_modules",
      "@mistralai",
      "mistralai",
      "tests",
    ),
  ];
  if (options.platform !== "win32") {
    forbidden.push(
      join(hostRoot, "node_modules", "node-pty", "deps", "winpty"),
      join(hostRoot, "node_modules", "node-pty", "third_party", "conpty"),
      join(
        hostRoot,
        "node_modules",
        "pnpm",
        "dist",
        "vendor",
        "fastlist-0.3.0-x64.exe",
      ),
      join(
        hostRoot,
        "node_modules",
        "pnpm",
        "dist",
        "vendor",
        "fastlist-0.3.0-x86.exe",
      ),
    );
  }
  await Promise.all(forbidden.map(requireMissing));

  const mistralManifest = JSON.parse(
    await readFile(join(mistralRoot, "package.json"), "utf8"),
  );
  if (
    mistralManifest.name !== "@mistralai/mistralai" ||
    mistralManifest.main !== "./esm/index.js" ||
    hasSourceCondition(mistralManifest.exports)
  ) {
    throw new Error(
      "packaged Mistral SDK must resolve only through compiled esm exports",
    );
  }

  const nodeAdapter = await readFile(
    join(hostRoot, "bin", runtimeAdapterName(options.platform, "node")),
    "utf8",
  );
  if (
    Buffer.byteLength(nodeAdapter) > 1024 ||
    !nodeAdapter.includes("ELECTRON_RUN_AS_NODE")
  ) {
    throw new Error(
      "packaged node adapter must reuse Electron instead of shipping Node",
    );
  }

  const inspection = await inspectRuntimeArtifacts(hostRoot, {
    arch: options.arch,
    platform: options.platform,
  });
  if (inspection.prunable.files > 0) {
    throw new Error(
      `packaged Host contains ${String(inspection.prunable.files)} forbidden build or platform artifacts`,
    );
  }
  assertRuntimeSizeBudget(inspection.bytes, options.runtimeSizeBudgetBytes);
  assertRuntimeFileBudget(inspection.files, options.runtimeFileBudget);

  const app = await treeStats(appRoot);
  if (
    options.appSizeBudgetBytes !== undefined &&
    app.bytes > options.appSizeBudgetBytes
  ) {
    const actualMiB = (app.bytes / 1024 / 1024).toFixed(1);
    const budgetMiB = (options.appSizeBudgetBytes / 1024 / 1024).toFixed(1);
    throw new Error(
      `packaged application is ${actualMiB} MiB, above the ${budgetMiB} MiB budget`,
    );
  }
  return {
    app,
    host: {
      bytes: inspection.bytes,
      files: inspection.files,
    },
  };
}
