#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyHarnessContract } from "./contract.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const runtimeRoot = join(projectRoot, "runtime", "host");
const generatedPackageName = "@dsh-desktop/runtime-build";

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

function collectRuntimeClosure(packages, cliPackageName, frontendPackageName) {
  const selected = new Set();
  const pending = [cliPackageName];
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
  await writeFile(
    join(generatedPackageDir, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(
    join(generatedPackageDir, "index.mjs"),
    runtimeEntrySource(contract.packageName),
  );
}

async function injectWorkspacePackage(packageName, packageSource) {
  const destination = join(runtimeRoot, "node_modules", ...packageName.split("/"));
  await rm(destination, { recursive: true, force: true });
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

async function injectMissingWorkspacePackages(selectedPackages, packages) {
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
    await injectWorkspacePackage(packageName, workspacePackage.path);
  }
}

async function exposeProductBundleToProfiles(contract, productBundle) {
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
  };
  await writeFile(
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

async function pruneNodePtyPrebuilds() {
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

async function writeRuntimeAdapters(contract, commit) {
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
    await writeFile(path, source);
    await chmod(path, 0o755);
  }

  await writeFile(
    join(binRoot, "node.cmd"),
    '@echo off\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%DSH_ELECTRON_EXECUTABLE%" %*\r\n',
  );
  await writeFile(
    join(binRoot, "pnpm.cmd"),
    '@echo off\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%DSH_ELECTRON_EXECUTABLE%" "%DSH_PNPM_ENTRY%" %*\r\n',
  );
  await writeFile(
    join(binRoot, "pnpx.cmd"),
    '@echo off\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n"%DSH_ELECTRON_EXECUTABLE%" "%DSH_PNPM_ENTRY%" dlx %*\r\n',
  );
  await writeFile(
    join(runtimeRoot, "dsh-runtime.json"),
    `${JSON.stringify(
      {
        repository: contract.repository,
        commit,
        packageName: contract.packageName,
        packageVersion: contract.packageVersion,
        pnpmVersion: contract.pnpmVersion,
        productBundle: {
          packageName: contract.productBundle.packageName,
          patch: contract.productBundle.patch,
        },
        platform: process.platform,
        arch: process.arch,
      },
      null,
      2,
    )}\n`,
  );
}

async function validateRuntime(contract) {
  const required = [
    join(runtimeRoot, "index.mjs"),
    join(
      runtimeRoot,
      "node_modules",
      "@deepseek-ai",
      "dsh",
      "lib",
      "bin.js",
    ),
    join(
      runtimeRoot,
      "node_modules",
      "@deepseek-ai",
      "dsh-web-frontend",
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
    join(runtimeRoot, "bin", process.platform === "win32" ? "pnpm.cmd" : "pnpm"),
  ];
  for (const path of required) {
    if (!existsSync(path)) {
      throw new Error(`staged Harness runtime is incomplete: ${path} is missing`);
    }
  }
  const metadata = JSON.parse(
    await readFile(join(runtimeRoot, "dsh-runtime.json"), "utf8"),
  );
  if (
    metadata.commit !== contract.commit ||
    metadata.packageVersion !== contract.packageVersion ||
    metadata.productBundle?.packageName !==
      contract.productBundle.packageName ||
    metadata.productBundle?.patch !== contract.productBundle.patch
  ) {
    throw new Error("staged Harness runtime metadata does not match the contract");
  }
}

async function validateReusableRuntime(contract, commit) {
  const metadataPath = join(runtimeRoot, "dsh-runtime.json");
  if (!existsSync(metadataPath)) {
    throw new Error(
      "staged Harness runtime is missing; run harness:stage before harness:stage:fast",
    );
  }
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  if (
    metadata.repository !== contract.repository ||
    metadata.commit !== commit ||
    metadata.packageName !== contract.packageName ||
    metadata.packageVersion !== contract.packageVersion ||
    metadata.pnpmVersion !== contract.pnpmVersion ||
    metadata.platform !== process.platform ||
    metadata.arch !== process.arch
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
  ];
  for (const path of required) {
    if (!existsSync(path)) {
      throw new Error(
        `staged Harness runtime cannot be refreshed because ${path} is missing; run harness:stage`,
      );
    }
  }
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
  assertGeneratedPath(runtimeRoot, "runtime");
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

  if (flags.skipInstall && flags.skipBuild) {
    await validateReusableRuntime(contract, actualCommit);
    await injectWorkspacePackage(
      productBundle.bundle.packageName,
      productBundle.packageRoot,
    );
    await exposeProductBundleToProfiles(contract, productBundle);
    await writeRuntimeAdapters(contract, actualCommit);
    await validateRuntime(contract);
    console.log(
      `\nRefreshed ${productBundle.bundle.packageName} in ${relative(
        projectRoot,
        runtimeRoot,
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
  );
  console.log(
    `Harness runtime closure: ${String(selectedPackages.length)} workspace packages`,
  );

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

    await rm(runtimeRoot, { recursive: true, force: true });
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
        runtimeRoot,
      ],
      harnessRoot,
    );
    await injectMissingWorkspacePackages(selectedPackages, packages);
    await injectWorkspacePackage(
      productBundle.bundle.packageName,
      productBundle.packageRoot,
    );
    await exposeProductBundleToProfiles(contract, productBundle);
    await materializeSymlinks(runtimeRoot);
    await writeFile(
      join(runtimeRoot, "index.mjs"),
      runtimeEntrySource(contract.packageName),
    );
    await pruneNodePtyPrebuilds();
    await writeRuntimeAdapters(contract, actualCommit);
    await validateRuntime(contract);

    const size = capture("du", ["-sh", runtimeRoot], projectRoot).split(/\s+/u)[0];
    console.log(
      `\nStaged ${contract.packageName}@${contract.packageVersion} at ${relative(projectRoot, runtimeRoot)} (${size})`,
    );
  } finally {
    await rm(generatedPackageDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(
    `harness:stage: ${error instanceof Error ? error.stack : String(error)}`,
  );
  process.exitCode = 1;
});
