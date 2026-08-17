#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyHarnessContract } from "./contract.mjs";
import {
  assertRuntimeFileBudget,
  assertRuntimeSizeBudget,
  inspectRuntimeArtifacts,
  isPrunableRuntimePath,
  pruneRuntimeArtifacts,
  RUNTIME_PRUNE_POLICY_VERSION,
} from "./runtime-prune.mjs";
import {
  fingerprintPaths,
  fingerprintRecord,
  publishDirectory,
  publishValidatedDirectory,
  writeFileAtomic,
} from "./runtime-state.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const activeRuntimeRoot = join(projectRoot, "runtime", "host");
const generatedPackageName = "@dsh-desktop/runtime-build";
const runtimeMetadataVersion = 2;
const runtimeFingerprintPaths = [
  "config/harness-runtime.json",
  "scripts/harness/build-overlay.mjs",
  "scripts/harness/contract.mjs",
  "scripts/harness/runtime-prune.mjs",
  "scripts/harness/runtime-state.mjs",
  "scripts/harness/stage.mjs",
];

async function fingerprintRuntimeCore(contract, harnessRoot, commit) {
  const rootManifest = JSON.parse(
    await readFile(join(projectRoot, "package.json"), "utf8"),
  );
  const [desktopSources, harnessLockfile] = await Promise.all([
    fingerprintPaths(projectRoot, runtimeFingerprintPaths),
    fingerprintPaths(harnessRoot, ["pnpm-lock.yaml"]),
  ]);
  return fingerprintRecord({
    arch: process.arch,
    commit,
    desktopSources,
    electronVersion:
      rootManifest.devDependencies?.electron ??
      rootManifest.dependencies?.electron ??
      null,
    frontendPackageName: contract.frontendPackageName,
    harnessLockfile,
    packageName: contract.packageName,
    packageVersion: contract.packageVersion,
    platform: process.platform,
    pnpmVersion: contract.pnpmVersion,
    productBundle: {
      packageName: contract.productBundle.packageName,
      patch: contract.productBundle.patch,
      runtimePackages: contract.productBundle.runtimePackages ?? [],
    },
    schemaVersion: runtimeMetadataVersion,
  });
}

async function fingerprintProductBundle(productBundle) {
  return fingerprintPaths(
    productBundle.packageRoot,
    [
      "package.json",
      "lib",
      "config",
      productBundle.bundle.patch,
      "LICENSE",
    ],
    {
      shouldIgnore: isPrunableRuntimePath,
    },
  );
}

async function inspectPrunedRuntime(runtimeRoot, contract) {
  const inspection = await inspectRuntimeArtifacts(runtimeRoot);
  if (inspection.prunable.files > 0) {
    throw new Error(
      `staged Harness runtime contains ${String(inspection.prunable.files)} prunable build artifacts`,
    );
  }
  assertRuntimeSizeBudget(
    inspection.bytes,
    contract.runtimeSizeBudgetBytes,
  );
  assertRuntimeFileBudget(
    inspection.files,
    contract.runtimeFileBudget,
  );
  return inspection;
}

function runtimeSizeContract(contract) {
  return {
    budgetBytes: contract.runtimeSizeBudgetBytes,
    fileBudget: contract.runtimeFileBudget,
    policyVersion: RUNTIME_PRUNE_POLICY_VERSION,
  };
}

function parseFlags(argv) {
  const known = new Set(["--skip-install", "--skip-build"]);
  for (const flag of argv) {
    if (!known.has(flag)) {
      throw new Error(`unknown option ${JSON.stringify(flag)}`);
    }
  }
  return {
    skipInstall: argv.includes("--skip-install"),
    skipBuild: argv.includes("--skip-build"),
  };
}

function formatCommand(command, args) {
  return [command, ...args]
    .map((part) => (/[\s"'\\]/u.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

async function run(command, args, cwd) {
  console.log(`\n$ ${formatCommand(command, args)}`);
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, CI: "true" },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          `${formatCommand(command, args)} failed ${
            signal === null ? `with exit code ${String(code)}` : `on ${signal}`
          }`,
        ),
      );
    });
  });
}

function capture(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
  });
  if (result.status !== 0) {
    throw new Error(
      `${formatCommand(command, args)} failed:\n${result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
}

function assertGeneratedPath(path, label) {
  const absolute = resolve(path);
  if (
    absolute === projectRoot ||
    projectRoot.startsWith(`${absolute}${sep}`) ||
    !absolute.startsWith(`${projectRoot}${sep}`)
  ) {
    throw new Error(`refusing to clear unsafe ${label} path ${absolute}`);
  }
}

async function readWorkspacePackages(harnessRoot) {
  const rows = JSON.parse(
    capture("pnpm", ["list", "-r", "--depth", "-1", "--json"], harnessRoot),
  );
  const packages = new Map();
  for (const row of rows) {
    if (
      typeof row.name !== "string" ||
      typeof row.path !== "string" ||
      row.name === "@deepseek-ai/dsh-root"
    ) {
      continue;
    }
    const manifest = JSON.parse(
      await readFile(join(row.path, "package.json"), "utf8"),
    );
    packages.set(row.name, { manifest, path: row.path });
  }
  return packages;
}

function dependencyNames(manifest, includeDevDependencies) {
  return [
    manifest.dependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
    includeDevDependencies ? manifest.devDependencies : undefined,
  ].flatMap((field) => (field === undefined ? [] : Object.keys(field)));
}

function collectRuntimeClosure(
  packages,
  cliPackageName,
  frontendPackageName,
  runtimePackages = [],
) {
  const selected = new Set();
  const pending = [cliPackageName, ...runtimePackages];
  while (pending.length > 0) {
    const name = pending.pop();
    if (name === undefined || selected.has(name)) continue;
    const workspacePackage = packages.get(name);
    if (workspacePackage === undefined) {
      throw new Error(`workspace package ${name} is missing`);
    }
    selected.add(name);
    for (const dependency of dependencyNames(
      workspacePackage.manifest,
      name === cliPackageName,
    )) {
      if (packages.has(dependency) && !selected.has(dependency)) {
        pending.push(dependency);
      }
    }
  }
  if (!selected.has(frontendPackageName)) {
    throw new Error(
      `${frontendPackageName} is absent from the ${cliPackageName} runtime closure`,
    );
  }
  return [...selected].sort();
}

async function ensureReact18TypeIsolation(harnessRoot) {
  const links = [
    {
      name: "react",
      source: join(
        harnessRoot,
        "packages",
        "client",
        "ui-conversation",
        "node_modules",
        "@types",
        "react",
      ),
    },
    {
      name: "react-dom",
      source: join(
        harnessRoot,
        "packages",
        "client",
        "ui-primitives",
        "node_modules",
        "@types",
        "react-dom",
      ),
    },
  ];
  const targetRoot = join(harnessRoot, "node_modules", "@types");
  await mkdir(targetRoot, { recursive: true });
  for (const link of links) {
    if (!existsSync(link.source)) {
      throw new Error(
        `Harness build dependency is missing at ${link.source}; run without --skip-install`,
      );
    }
    const source = await realpath(link.source);
    const target = join(targetRoot, link.name);
    if (existsSync(target)) {
      const info = await lstat(target);
      if (!info.isSymbolicLink()) {
        throw new Error(`cannot isolate Harness React types: ${target} is not a symlink`);
      }
      if ((await realpath(target)) === source) continue;
      await rm(target);
    }
    await symlink(source, target, "dir");
  }
}

function runtimeEntrySource(cliPackageName) {
  return `delete process.env.ELECTRON_RUN_AS_NODE;

function report(error, seen = new Set(), indent = "") {
  if (error !== null && typeof error === "object") {
    if (seen.has(error)) return;
    seen.add(error);
  }
  const rendered = error instanceof Error ? error.stack || error.message : String(error);
  console.error(\`\${indent}\${rendered}\`);
  if (error instanceof AggregateError) {
    for (const nested of error.errors) report(nested, seen, \`\${indent}  \`);
  }
  if (error instanceof Error && error.cause !== undefined) {
    report(error.cause, seen, \`\${indent}  caused by: \`);
  }
}

try {
  await import("${cliPackageName}/lib/bin.js");
} catch (error) {
  report(error);
  process.exitCode = 1;
}
`;
}

async function writeDeployRoot(
  generatedPackageDir,
  selectedPackages,
  contract,
) {
  const dependencies = Object.fromEntries(
    selectedPackages.map((name) => [name, "workspace:*"]),
  );
  dependencies.pnpm = contract.pnpmVersion;
  const manifest = {
    name: generatedPackageName,
    version: "0.0.0",
    private: true,
    type: "module",
    dependencies,
  };
  await mkdir(generatedPackageDir, { recursive: true });
  await writeFileAtomic(
    join(generatedPackageDir, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFileAtomic(
    join(generatedPackageDir, "index.mjs"),
    runtimeEntrySource(contract.packageName),
  );
}

async function copyWorkspacePackage(packageName, packageSource, destination) {
  await mkdir(destination, { recursive: true });
  let copiedRuntimeEntry = false;
  for (const entry of [
    "package.json",
    "lib",
    "config",
    "cordis.patch.yml",
    "LICENSE",
  ]) {
    const source = join(packageSource, entry);
    if (!existsSync(source)) continue;
    await cp(source, join(destination, entry), {
      dereference: true,
      preserveTimestamps: true,
      recursive: (await stat(source)).isDirectory(),
    });
    if (entry === "lib") copiedRuntimeEntry = true;
  }
  if (!copiedRuntimeEntry) {
    throw new Error(`built workspace package ${packageName} has no lib directory`);
  }
}

async function injectWorkspacePackage(
  runtimeRoot,
  packageName,
  packageSource,
  { prune = false, transactional = false } = {},
) {
  const destination = join(runtimeRoot, "node_modules", ...packageName.split("/"));
  if (!transactional) {
    await rm(destination, { recursive: true, force: true });
    await copyWorkspacePackage(packageName, packageSource, destination);
    if (prune) await pruneRuntimeArtifacts(destination);
    return;
  }

  const parent = dirname(destination);
  await mkdir(parent, { recursive: true });
  const leaf = packageName.split("/").at(-1);
  const candidate = await mkdtemp(join(parent, `.${leaf}-staging-`));
  try {
    await copyWorkspacePackage(packageName, packageSource, candidate);
    if (prune) await pruneRuntimeArtifacts(candidate);
    await publishDirectory(candidate, destination);
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
}

async function injectMissingWorkspacePackages(
  runtimeRoot,
  selectedPackages,
  packages,
) {
  for (const packageName of selectedPackages) {
    const destination = join(
      runtimeRoot,
      "node_modules",
      ...packageName.split("/"),
    );
    if (existsSync(destination)) continue;
    const workspacePackage = packages.get(packageName);
    if (workspacePackage === undefined) {
      throw new Error(`cannot inject unknown workspace package ${packageName}`);
    }
    console.log(`Injecting workspace package omitted by deploy: ${packageName}`);
    await injectWorkspacePackage(runtimeRoot, packageName, workspacePackage.path);
  }
}

async function exposeProductBundleToProfiles(
  runtimeRoot,
  contract,
  productBundle,
) {
  const cliManifestPath = join(
    runtimeRoot,
    "node_modules",
    ...contract.packageName.split("/"),
    "package.json",
  );
  const manifest = JSON.parse(await readFile(cliManifestPath, "utf8"));
  manifest.dependencies = {
    ...(manifest.dependencies ?? {}),
    [productBundle.bundle.packageName]: productBundle.manifest.version,
    ...Object.fromEntries(
      (productBundle.bundle.runtimePackages ?? []).map((packageName) => [
        packageName,
        contract.packageVersion,
      ]),
    ),
  };
  await writeFileAtomic(
    cliManifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

async function materializeSymlinks(root) {
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const relativePath = relative(root, path);
      if (
        entry.isDirectory() &&
        (entry.name === ".bin" || relativePath.includes(`${sep}.bin${sep}`))
      ) {
        await rm(path, { recursive: true, force: true });
      } else if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isSymbolicLink()) {
        const linkTarget = await readlink(path);
        const source = await realpath(resolve(dirname(path), linkTarget));
        await rm(path);
        await cp(source, path, {
          dereference: true,
          force: true,
          preserveTimestamps: true,
          recursive: (await stat(source)).isDirectory(),
        });
      }
    }
  }
  await visit(root);
}

async function pruneNodePtyPrebuilds(runtimeRoot) {
  const prebuildsRoot = join(runtimeRoot, "node_modules", "node-pty", "prebuilds");
  if (!existsSync(prebuildsRoot)) return;
  const target = `${process.platform}-${process.arch}`;
  for (const entry of await readdir(prebuildsRoot, { withFileTypes: true })) {
    if (entry.name !== target) {
      await rm(join(prebuildsRoot, entry.name), {
        recursive: true,
        force: true,
      });
    }
  }
  const spawnHelper = join(prebuildsRoot, target, "spawn-helper");
  if (existsSync(spawnHelper)) await chmod(spawnHelper, 0o755);
}

async function writeRuntimeAdapters(
  runtimeRoot,
  contract,
  commit,
  { coreFingerprint, productBundleFingerprint, runtimeSize },
) {
  const binRoot = join(runtimeRoot, "bin");
  await mkdir(binRoot, { recursive: true });
  const posixScripts = {
    node: `#!/bin/sh
set -eu
: "\${DSH_ELECTRON_EXECUTABLE:?DSH_ELECTRON_EXECUTABLE is required}"
exec env ELECTRON_RUN_AS_NODE=1 "$DSH_ELECTRON_EXECUTABLE" "$@"
`,
    pnpm: `#!/bin/sh
set -eu
: "\${DSH_ELECTRON_EXECUTABLE:?DSH_ELECTRON_EXECUTABLE is required}"
: "\${DSH_PNPM_ENTRY:?DSH_PNPM_ENTRY is required}"
exec env ELECTRON_RUN_AS_NODE=1 "$DSH_ELECTRON_EXECUTABLE" "$DSH_PNPM_ENTRY" "$@"
`,
    pnpx: `#!/bin/sh
set -eu
: "\${DSH_ELECTRON_EXECUTABLE:?DSH_ELECTRON_EXECUTABLE is required}"
: "\${DSH_PNPM_ENTRY:?DSH_PNPM_ENTRY is required}"
exec env ELECTRON_RUN_AS_NODE=1 "$DSH_ELECTRON_EXECUTABLE" "$DSH_PNPM_ENTRY" dlx "$@"
`,
  };
  for (const [name, source] of Object.entries(posixScripts)) {
    const path = join(binRoot, name);
    await writeFileAtomic(path, source, { mode: 0o755 });
  }

  await writeFileAtomic(
    join(binRoot, "node.cmd"),
    '@echo off\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%DSH_ELECTRON_EXECUTABLE%" %*\r\n',
  );
  await writeFileAtomic(
    join(binRoot, "pnpm.cmd"),
    '@echo off\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%DSH_ELECTRON_EXECUTABLE%" "%DSH_PNPM_ENTRY%" %*\r\n',
  );
  await writeFileAtomic(
    join(binRoot, "pnpx.cmd"),
    '@echo off\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%DSH_ELECTRON_EXECUTABLE%" "%DSH_PNPM_ENTRY%" dlx %*\r\n',
  );
  await writeFileAtomic(
    join(runtimeRoot, "dsh-runtime.json"),
    `${JSON.stringify(
      {
        schemaVersion: runtimeMetadataVersion,
        repository: contract.repository,
        commit,
        packageName: contract.packageName,
        packageVersion: contract.packageVersion,
        pnpmVersion: contract.pnpmVersion,
        coreFingerprint,
        productBundle: {
          packageName: contract.productBundle.packageName,
          patch: contract.productBundle.patch,
          runtimePackages: contract.productBundle.runtimePackages ?? [],
          fingerprint: productBundleFingerprint,
        },
        platform: process.platform,
        arch: process.arch,
        runtimeSize,
      },
      null,
      2,
    )}\n`,
  );
}

async function validateRuntime(
  runtimeRoot,
  contract,
  { commit, coreFingerprint, productBundleFingerprint, runtimeSize },
) {
  const productPackageRoot = join(
    runtimeRoot,
    "node_modules",
    ...contract.productBundle.packageName.split("/"),
  );
  const required = [
    join(runtimeRoot, "index.mjs"),
    join(
      runtimeRoot,
      "node_modules",
      ...contract.packageName.split("/"),
      "lib",
      "bin.js",
    ),
    join(
      runtimeRoot,
      "node_modules",
      ...contract.frontendPackageName.split("/"),
      "dist",
      "index.html",
    ),
    join(runtimeRoot, "node_modules", "pnpm", "bin", "pnpm.cjs"),
    join(
      runtimeRoot,
      "node_modules",
      ...contract.productBundle.packageName.split("/"),
      "lib",
      "client.js",
    ),
    join(
      runtimeRoot,
      "node_modules",
      ...contract.productBundle.packageName.split("/"),
      contract.productBundle.patch,
    ),
    ...(contract.productBundle.runtimePackages ?? []).flatMap((packageName) => [
      join(runtimeRoot, "node_modules", ...packageName.split("/"), "package.json"),
      join(runtimeRoot, "node_modules", ...packageName.split("/"), "lib", "index.js"),
    ]),
    join(runtimeRoot, "bin", process.platform === "win32" ? "pnpm.cmd" : "pnpm"),
  ];
  for (const path of required) {
    if (!existsSync(path)) {
      throw new Error(`staged Harness runtime is incomplete: ${path} is missing`);
    }
  }
  const installedProductBundleFingerprint = await fingerprintProductBundle({
    bundle: contract.productBundle,
    packageRoot: productPackageRoot,
  });
  if (installedProductBundleFingerprint !== productBundleFingerprint) {
    throw new Error(
      "staged Harness product bundle does not match its built source",
    );
  }
  await inspectPrunedRuntime(runtimeRoot, contract);
  const metadata = JSON.parse(
    await readFile(join(runtimeRoot, "dsh-runtime.json"), "utf8"),
  );
  if (
    metadata.schemaVersion !== runtimeMetadataVersion ||
    metadata.repository !== contract.repository ||
    metadata.commit !== commit ||
    metadata.packageName !== contract.packageName ||
    metadata.packageVersion !== contract.packageVersion ||
    metadata.pnpmVersion !== contract.pnpmVersion ||
    metadata.coreFingerprint !== coreFingerprint ||
    metadata.productBundle?.packageName !==
      contract.productBundle.packageName ||
    metadata.productBundle?.patch !== contract.productBundle.patch ||
    metadata.productBundle?.fingerprint !== productBundleFingerprint ||
    JSON.stringify(metadata.productBundle?.runtimePackages ?? []) !==
      JSON.stringify(contract.productBundle.runtimePackages ?? []) ||
    metadata.platform !== process.platform ||
    metadata.arch !== process.arch ||
    JSON.stringify(metadata.runtimeSize) !== JSON.stringify(runtimeSize)
  ) {
    throw new Error("staged Harness runtime metadata does not match the contract");
  }
}

async function validateReusableRuntime(
  runtimeRoot,
  contract,
  commit,
  coreFingerprint,
) {
  const metadataPath = join(runtimeRoot, "dsh-runtime.json");
  if (!existsSync(metadataPath)) {
    throw new Error(
      "staged Harness runtime is missing; run harness:stage before harness:stage:fast",
    );
  }
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  if (
    metadata.schemaVersion !== runtimeMetadataVersion ||
    metadata.repository !== contract.repository ||
    metadata.commit !== commit ||
    metadata.packageName !== contract.packageName ||
    metadata.packageVersion !== contract.packageVersion ||
    metadata.pnpmVersion !== contract.pnpmVersion ||
    metadata.coreFingerprint !== coreFingerprint ||
    metadata.productBundle?.packageName !==
      contract.productBundle.packageName ||
    metadata.productBundle?.patch !== contract.productBundle.patch ||
    JSON.stringify(metadata.productBundle?.runtimePackages ?? []) !==
      JSON.stringify(contract.productBundle.runtimePackages ?? []) ||
    metadata.platform !== process.platform ||
    metadata.arch !== process.arch ||
    metadata.runtimeSize?.policyVersion !== RUNTIME_PRUNE_POLICY_VERSION ||
    metadata.runtimeSize?.budgetBytes !== contract.runtimeSizeBudgetBytes ||
    metadata.runtimeSize?.fileBudget !== contract.runtimeFileBudget
  ) {
    throw new Error(
      "staged Harness runtime is stale; run harness:stage before harness:stage:fast",
    );
  }
  const required = [
    join(runtimeRoot, "index.mjs"),
    join(
      runtimeRoot,
      "node_modules",
      ...contract.packageName.split("/"),
      "lib",
      "bin.js",
    ),
    join(
      runtimeRoot,
      "node_modules",
      ...contract.frontendPackageName.split("/"),
      "dist",
      "index.html",
    ),
    join(runtimeRoot, "node_modules", "pnpm", "bin", "pnpm.cjs"),
    ...(contract.productBundle.runtimePackages ?? []).flatMap((packageName) => [
      join(runtimeRoot, "node_modules", ...packageName.split("/"), "package.json"),
      join(runtimeRoot, "node_modules", ...packageName.split("/"), "lib", "index.js"),
    ]),
  ];
  for (const path of required) {
    if (!existsSync(path)) {
      throw new Error(
        `staged Harness runtime cannot be refreshed because ${path} is missing; run harness:stage`,
      );
    }
  }
  await inspectPrunedRuntime(runtimeRoot, contract);
  return metadata;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const configuredContract = JSON.parse(
    await readFile(join(projectRoot, "config", "harness-runtime.json"), "utf8"),
  );
  const configuredHarnessRoot = resolve(
    projectRoot,
    configuredContract.submodulePath,
  );
  const generatedPackageDir = join(
    configuredHarnessRoot,
    "apps",
    "dsh-desktop-runtime-build",
  );
  assertGeneratedPath(activeRuntimeRoot, "runtime");
  assertGeneratedPath(generatedPackageDir, "generated deploy package");
  // An interrupted previous stage must never contaminate contract verification
  // or make the pinned upstream workspace appear to have an untracked change.
  await rm(generatedPackageDir, { recursive: true, force: true });

  const verified = await verifyHarnessContract(projectRoot);
  const {
    contract,
    harnessRoot,
    actualCommit,
    productBundle,
  } = verified;

  await run(
    process.execPath,
    [join(projectRoot, "scripts", "harness", "build-overlay.mjs")],
    projectRoot,
  );
  const [coreFingerprint, productBundleFingerprint] = await Promise.all([
    fingerprintRuntimeCore(contract, harnessRoot, actualCommit),
    fingerprintProductBundle(productBundle),
  ]);
  const expectedRuntimeBase = {
    commit: actualCommit,
    coreFingerprint,
    productBundleFingerprint,
  };

  if (flags.skipInstall && flags.skipBuild) {
    await validateReusableRuntime(
      activeRuntimeRoot,
      contract,
      actualCommit,
      coreFingerprint,
    );
    await injectWorkspacePackage(
      activeRuntimeRoot,
      productBundle.bundle.packageName,
      productBundle.packageRoot,
      { prune: true, transactional: true },
    );
    await exposeProductBundleToProfiles(
      activeRuntimeRoot,
      contract,
      productBundle,
    );
    await inspectPrunedRuntime(activeRuntimeRoot, contract);
    const expectedRuntime = {
      ...expectedRuntimeBase,
      runtimeSize: runtimeSizeContract(contract),
    };
    await writeRuntimeAdapters(
      activeRuntimeRoot,
      contract,
      actualCommit,
      expectedRuntime,
    );
    await validateRuntime(activeRuntimeRoot, contract, expectedRuntime);
    console.log(
      `\nRefreshed ${productBundle.bundle.packageName} in ${relative(
        projectRoot,
        activeRuntimeRoot,
      )} without touching the Harness workspace`,
    );
    return;
  }

  if (!flags.skipInstall) {
    await run(
      "pnpm",
      ["install", "--frozen-lockfile", "--config.node-linker=isolated"],
      harnessRoot,
    );
  }

  const packages = await readWorkspacePackages(harnessRoot);
  const selectedPackages = collectRuntimeClosure(
    packages,
    contract.packageName,
    contract.frontendPackageName,
    productBundle.bundle.runtimePackages ?? [],
  );
  console.log(
    `Harness runtime closure: ${String(selectedPackages.length)} workspace packages`,
  );

  let stagingContainer;
  try {
    await writeDeployRoot(generatedPackageDir, selectedPackages, contract);
    await run(
      "pnpm",
      [
        "install",
        "--filter",
        `${generatedPackageName}...`,
        "--lockfile=false",
        "--ignore-scripts",
        "--config.node-linker=isolated",
      ],
      harnessRoot,
    );
    await ensureReact18TypeIsolation(harnessRoot);

    if (flags.skipBuild) {
      console.log("Skipping Harness source build (--skip-build)");
    } else {
      await run("pnpm", ["run", "build"], harnessRoot);
    }

    const runtimeParent = dirname(activeRuntimeRoot);
    await mkdir(runtimeParent, { recursive: true });
    stagingContainer = await mkdtemp(join(runtimeParent, ".host-staging-"));
    const candidateRuntimeRoot = join(stagingContainer, "host");
    assertGeneratedPath(candidateRuntimeRoot, "runtime candidate");
    await run(
      "pnpm",
      [
        "--filter",
        generatedPackageName,
        "deploy",
        "--legacy",
        "--prod",
        "--config.node-linker=hoisted",
        "--config.auto-install-peers=false",
        "--config.link-workspace-packages=true",
        candidateRuntimeRoot,
      ],
      harnessRoot,
    );
    await injectMissingWorkspacePackages(
      candidateRuntimeRoot,
      selectedPackages,
      packages,
    );
    await injectWorkspacePackage(
      candidateRuntimeRoot,
      productBundle.bundle.packageName,
      productBundle.packageRoot,
    );
    await exposeProductBundleToProfiles(
      candidateRuntimeRoot,
      contract,
      productBundle,
    );
    await materializeSymlinks(candidateRuntimeRoot);
    await writeFileAtomic(
      join(candidateRuntimeRoot, "index.mjs"),
      runtimeEntrySource(contract.packageName),
    );
    await pruneNodePtyPrebuilds(candidateRuntimeRoot);
    const pruneReport = await pruneRuntimeArtifacts(candidateRuntimeRoot);
    const runtimeInspection = await inspectPrunedRuntime(
      candidateRuntimeRoot,
      contract,
    );
    const expectedRuntime = {
      ...expectedRuntimeBase,
      runtimeSize: runtimeSizeContract(contract),
    };
    console.log(
      `Pruned ${String(pruneReport.removed.files)} build-only files (${(pruneReport.removed.bytes / 1024 / 1024).toFixed(1)} MiB) and deduplicated ${(pruneReport.optimized.bytes / 1024 / 1024).toFixed(1)} MiB of tooling; runtime payload is ${(runtimeInspection.bytes / 1024 / 1024).toFixed(1)} MiB`,
    );
    await writeRuntimeAdapters(
      candidateRuntimeRoot,
      contract,
      actualCommit,
      expectedRuntime,
    );
    await publishValidatedDirectory(
      candidateRuntimeRoot,
      activeRuntimeRoot,
      (runtimeRoot) =>
        validateRuntime(runtimeRoot, contract, expectedRuntime),
    );

    const size = capture("du", ["-sh", activeRuntimeRoot], projectRoot).split(
      /\s+/u,
    )[0];
    console.log(
      `\nStaged ${contract.packageName}@${contract.packageVersion} at ${relative(projectRoot, activeRuntimeRoot)} (${size})`,
    );
  } finally {
    if (stagingContainer !== undefined) {
      await rm(stagingContainer, { recursive: true, force: true });
    }
    await rm(generatedPackageDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(
    `harness:stage: ${error instanceof Error ? error.stack : String(error)}`,
  );
  process.exitCode = 1;
});
