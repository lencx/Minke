import { execFile } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { embeddedNodeEnvironment } from "../../config/embedded-node-runtime.mts";
import {
  assertRuntimeFileBudget,
  assertRuntimeSizeBudget,
  inspectRuntimeArtifacts,
} from "../harness/runtime-prune.mjs";
import {
  applicationExecutablePath,
  applicationResourcesRoot,
} from "./application-layout.mjs";

const desktopPlatforms = Object.freeze(["darwin", "linux", "win32"]);

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
  readonly verifyDarwinCodeSignature?: (
    appRoot: string,
  ) => Promise<void>;
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

function verifyDarwinCodeSignature(
  appRoot: string,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      "/usr/bin/codesign",
      ["--verify", "--deep", "--strict", appRoot],
      {
        encoding: "utf8",
        maxBuffer: 64 * 1024,
        timeout: 30_000,
      },
      (error) => {
        if (error === null) {
          resolvePromise();
          return;
        }
        reject(error);
      },
    );
  });
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

function runtimeAdapterName(platform: string, name: string): string {
  return platform === "win32" ? `${name}.cmd` : name;
}

async function assertOnlyTargetNodePtyPrebuild(
  hostRoot: string,
  platform: string,
  arch: string,
): Promise<void> {
  const prebuildsRoot = join(
    hostRoot,
    "node_modules",
    "node-pty",
    "prebuilds",
  );
  let entries;
  try {
    entries = await readdir(prebuildsRoot, { withFileTypes: true });
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
  const target = `${platform}-${arch}`;
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name === target) continue;
    throw new Error(
      `packaged application contains foreign node-pty prebuild ${join(prebuildsRoot, entry.name)}`,
    );
  }
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
  const budgets = candidate.appSizeBudgetBytes as Record<string, unknown>;
  for (const [platform, budget] of Object.entries(
    budgets,
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
  for (const platform of desktopPlatforms) {
    if (
      !Number.isSafeInteger(budgets[platform]) ||
      (budgets[platform] as number) <= 0
    ) {
      throw new Error(
        `package artifact policy must declare a positive size budget for ${platform}`,
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
  const appResources = applicationResourcesRoot(appRoot, options.platform);
  const hostRoot = join(appResources, "host");
  const productRoot = join(
    hostRoot,
    "node_modules",
    ...options.productPackageName.split("/"),
  );
  const piAiRoot = join(
    hostRoot,
    "node_modules",
    "@earendil-works",
    "pi-ai",
  );
  const legacyMistralRoot = join(
    piAiRoot,
    "node_modules",
    "@mistralai",
    "mistralai",
  );
  const required = [
    applicationExecutablePath(appRoot, options.platform),
    join(appResources, "app.asar"),
    join(hostRoot, "index.mjs"),
    join(hostRoot, "dsh-runtime.json"),
    join(hostRoot, "bin", runtimeAdapterName(options.platform, "node")),
    join(hostRoot, "bin", runtimeAdapterName(options.platform, "dsh")),
    join(hostRoot, "bin", runtimeAdapterName(options.platform, "pnpm")),
    join(hostRoot, "bin", "node-environment-bootstrap.cjs"),
    join(hostRoot, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
    join(hostRoot, "node_modules", "pnpm", "dist", "pnpm.mjs"),
    join(hostRoot, "node_modules", "esbuild", "bin", "esbuild"),
    join(productRoot, "package.json"),
    join(productRoot, "lib", "index.js"),
    join(productRoot, "lib", "client.js"),
    join(piAiRoot, "package.json"),
    join(piAiRoot, "dist", "providers", "mistral.js"),
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
  } else if (options.platform === "win32") {
    const targetRoot = join(
      hostRoot,
      "node_modules",
      "node-pty",
      "prebuilds",
      `${options.platform}-${options.arch}`,
    );
    required.push(
      join(targetRoot, "conpty.node"),
      join(targetRoot, "conpty_console_list.node"),
      join(targetRoot, "conpty", "OpenConsole.exe"),
      join(targetRoot, "conpty", "conpty.dll"),
    );
  } else if (options.platform === "linux") {
    required.push(
      join(
        hostRoot,
        "node_modules",
        "node-pty",
        "prebuilds",
        `${options.platform}-${options.arch}`,
        "pty.node",
      ),
    );
  } else {
    throw new Error(
      `unsupported packaged application platform ${options.platform}`,
    );
  }
  await Promise.all(required.map(requireRegularFile));
  await assertOnlyTargetNodePtyPrebuild(
    hostRoot,
    options.platform,
    options.arch,
  );

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
    join(legacyMistralRoot, "src"),
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

  const nodeAdapter = await readFile(
    join(hostRoot, "bin", runtimeAdapterName(options.platform, "node")),
    "utf8",
  );
  const dshAdapter = await readFile(
    join(hostRoot, "bin", runtimeAdapterName(options.platform, "dsh")),
    "utf8",
  );
  const nodeEnvironmentBootstrap = await readFile(
    join(hostRoot, "bin", "node-environment-bootstrap.cjs"),
    "utf8",
  );
  if (
    Buffer.byteLength(nodeAdapter) > 1024 ||
    !nodeAdapter.includes(embeddedNodeEnvironment.mode) ||
    !nodeAdapter.includes(embeddedNodeEnvironment.executable) ||
    !nodeAdapter.includes("node-environment-bootstrap.cjs") ||
    nodeAdapter.includes("DSH_ELECTRON_EXECUTABLE")
  ) {
    throw new Error(
      "packaged node adapter must reuse Electron instead of shipping Node",
    );
  }
  if (
    Buffer.byteLength(dshAdapter) > 1024 ||
    !dshAdapter.includes(embeddedNodeEnvironment.mode) ||
    !dshAdapter.includes(embeddedNodeEnvironment.executable) ||
    !dshAdapter.includes(
      embeddedNodeEnvironment.interactiveNodeOptions,
    ) ||
    !dshAdapter.includes(
      embeddedNodeEnvironment.interactiveNodePath,
    ) ||
    !dshAdapter.includes("index.mjs") ||
    dshAdapter.includes("DSH_ELECTRON_EXECUTABLE")
  ) {
    throw new Error(
      "packaged dsh adapter must launch the staged CLI through Electron",
    );
  }
  if (
    Buffer.byteLength(nodeEnvironmentBootstrap) > 8 * 1024 ||
    !nodeEnvironmentBootstrap.includes(
      embeddedNodeEnvironment.mode,
    ) ||
    !nodeEnvironmentBootstrap.includes(
      embeddedNodeEnvironment.bootstrap,
    ) ||
    !nodeEnvironmentBootstrap.includes("NODE_OPTIONS") ||
    !nodeEnvironmentBootstrap.includes("NODE_PATH") ||
    !nodeEnvironmentBootstrap.includes(
      "deleteEnvironmentName(process.env",
    ) ||
    !nodeEnvironmentBootstrap.includes("childProcess.execFile") ||
    !nodeEnvironmentBootstrap.includes("childProcess.fork") ||
    !nodeEnvironmentBootstrap.includes("childProcess.spawn") ||
    !nodeEnvironmentBootstrap.includes("usesShell") ||
    !nodeEnvironmentBootstrap.includes("syncBuiltinESMExports")
  ) {
    throw new Error(
      "packaged Node bootstrap must consume launch-only controls",
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

  if (options.platform === "darwin") {
    try {
      await (
        options.verifyDarwinCodeSignature ??
        verifyDarwinCodeSignature
      )(appRoot);
    } catch (error) {
      throw new Error(
        "packaged macOS application has an invalid code signature",
        { cause: error },
      );
    }
  }

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
