import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import {
  delimiter,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  runtimeEntrySource,
} from "../scripts/harness/runtime-entry.mjs";
import {
  runtimeAdapterSources,
} from "../scripts/harness/runtime-adapters.mjs";
import {
  harnessRuntimeEnvironment,
} from "../desktop/main/harness-runtime.ts";
import {
  applyHarnessRuntimePatches,
  resolveHarnessRuntimePatches,
} from "../scripts/harness/runtime-patches.mjs";
import {
  embeddedNodeCapabilitiesEnvironment,
  embeddedNodeChildEnvironment,
  nativeChildEnvironment,
} from "../config/embedded-node-runtime.mts";
import {
  externalCommandEnvironment,
  interactiveShellEnvironment,
} from "../packages/harness-overlay/src/host/process-environment.ts";

const projectRoot = resolve(
  fileURLToPath(new URL("..", import.meta.url)),
);

async function loadPatchedHarnessScrubbedParentEnv(runtimeRoot) {
  await writeFile(
    join(runtimeRoot, "package.json"),
    '{"private":true,"type":"module"}\n',
  );
  const targets = new Map([
    [
      "node_modules/@deepseek-ai/dsh-subprocess/lib/index.js",
      "vendor/deepseek-harness/packages/subprocess/subprocess/lib/index.js",
    ],
    [
      "node_modules/@deepseek-ai/dsh-native-command/lib/index.js",
      "vendor/deepseek-harness/packages/util/native-command/lib/index.js",
    ],
    [
      "node_modules/@deepseek-ai/dsh-subprocess-local/lib/index.js",
      "vendor/deepseek-harness/packages/subprocess/subprocess-local/lib/index.js",
    ],
    [
      "node_modules/@deepseek-ai/dsh-web-app/lib/index.js",
      "vendor/deepseek-harness/packages/bundle/web-app/lib/index.js",
    ],
    [
      "node_modules/@deepseek-ai/dsh-sandbox-windows-acl/lib/runner.js",
      "vendor/deepseek-harness/packages/sandbox/sandbox-windows-acl/lib/runner.js",
    ],
  ]);
  for (const [target, source] of targets) {
    const targetPath = join(runtimeRoot, ...target.split("/"));
    await mkdir(resolve(targetPath, ".."), { recursive: true });
    await copyFile(resolve(projectRoot, source), targetPath);
  }
  const patches = await resolveHarnessRuntimePatches(projectRoot, [
    "patches/deepseek-harness/process-environment-boundaries.patch",
  ]);
  await applyHarnessRuntimePatches(runtimeRoot, patches);

  // The scrub itself only needs Cordis base classes. Stub that unrelated
  // dependency while executing the actual patched build artifact.
  const cordisStubUrl =
    `data:text/javascript,${encodeURIComponent(
      "export class Context {}; export class Service {};",
    )}`;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "@deepseek-ai/cordis") {
        return {
          shortCircuit: true,
          url: cordisStubUrl,
        };
      }
      return nextResolve(specifier, context);
    },
  });
  try {
    const subprocess = await import(
      pathToFileURL(
        join(
          runtimeRoot,
          "node_modules",
          "@deepseek-ai",
          "dsh-subprocess",
          "lib",
          "index.js",
        ),
      ).href
    );
    return subprocess.scrubbedParentEnv;
  } finally {
    hooks.deregister();
  }
}

async function withTemporaryDirectory(callback) {
  const root = await mkdtemp(join(tmpdir(), "minke-embedded-node-"));
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function sourceFiles(root, skippedDirectories = new Set()) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skippedDirectories.has(entry.name)) {
          await visit(join(directory, entry.name));
        }
      } else if (
        entry.isFile() &&
        /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/u.test(entry.name)
      ) {
        files.push(join(directory, entry.name));
      }
    }
  }
  await visit(root);
  return files;
}

function projectRelative(path) {
  return relative(projectRoot, path).split(sep).join("/");
}

function hasEnvironmentName(environment, name) {
  const normalized = name.toUpperCase();
  return Object.keys(environment).some(
    (key) => key.toUpperCase() === normalized,
  );
}

function environmentValue(environment, name) {
  const normalized = name.toUpperCase();
  return Object.entries(environment).find(
    ([key]) => key.toUpperCase() === normalized,
  )?.[1];
}

test("the staged entry consumes Node bootstrap controls before loading the CLI", async () => {
  await withTemporaryDirectory(async (root) => {
    const cliRoot = join(root, "node_modules", "@fixture", "cli");
    await mkdir(join(root, "bin"), { recursive: true });
    await mkdir(join(cliRoot, "lib"), { recursive: true });
    await writeFile(
      join(root, "bin", "node-environment-bootstrap.cjs"),
      runtimeAdapterSources()["node-environment-bootstrap.cjs"],
    );
    await writeFile(
      join(cliRoot, "package.json"),
      `${JSON.stringify({
        name: "@fixture/cli",
        type: "module",
      })}\n`,
    );
    await writeFile(
      join(cliRoot, "lib", "bin.js"),
      [
        "const controls = new Set([",
        '  "ELECTRON_RUN_AS_NODE",',
        '  "NODE_OPTIONS",',
        '  "NODE_PATH",',
        "]);",
        "process.stdout.write(JSON.stringify({",
        "  controls: Object.fromEntries(",
        "    Object.entries(process.env).filter(",
        "      ([key]) => controls.has(key.toUpperCase()),",
        "    ),",
        "  ),",
        "  node: process.env.MINKE_NODE_EXECUTABLE,",
        "  pnpm: process.env.MINKE_PNPM_ENTRY,",
        "}));",
        "",
      ].join("\n"),
    );
    const entryPath = join(root, "index.mjs");
    await writeFile(entryPath, runtimeEntrySource("@fixture/cli"));

    const result = spawnSync(process.execPath, [entryPath], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        electron_run_as_node: "stale-lowercase",
        NODE_OPTIONS: "--no-warnings",
        node_options: "--trace-warnings",
        NODE_PATH: join(root, "ambient-modules"),
        Node_Path: join(root, "mixed-case-modules"),
        MINKE_NODE_EXECUTABLE: process.execPath,
        MINKE_PNPM_ENTRY: join(root, "pnpm.cjs"),
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      controls: {},
      node: process.execPath,
      pnpm: join(root, "pnpm.cjs"),
    });
  });
});

test("the applied Harness patch scrubs ambient Node launch controls", async () => {
  await withTemporaryDirectory(async (runtimeRoot) => {
    const scrubbedParentEnv =
      await loadPatchedHarnessScrubbedParentEnv(runtimeRoot);
    const runtimeEnvironment = harnessRuntimeEnvironment(
      {
        pnpmEntry: "C:\\Minke\\runtime\\pnpm.cjs",
        runtimeBin: "C:\\Minke\\runtime\\bin",
      },
      {
        dshHome: "C:\\Users\\tester\\.dsh",
        electronExecutable: "C:\\Program Files\\Minke\\Minke.exe",
        modelRuntimes: {
          lmStudio: { enabled: false },
          ollama: { enabled: false },
        },
      },
      {
        NODE_OPTIONS: "--require C:\\ambient.cjs",
        NODE_PATH: "C:\\ambient-modules",
      },
    );
    const names = [
      ...new Set([
        ...Object.keys(runtimeEnvironment),
        "MINKE_NODE_EXECUTABLE",
        "MINKE_PNPM_ENTRY",
        "MINKE_NODE_BOOTSTRAP",
        "MINKE_INTERACTIVE_NODE_OPTIONS",
        "MINKE_INTERACTIVE_NODE_PATH",
        "ELECTRON_RUN_AS_NODE",
        "NODE_OPTIONS",
        "NODE_PATH",
        "DSH_ELECTRON_EXECUTABLE",
        "DSH_PNPM_ENTRY",
      ]),
    ];
    const previous = Object.fromEntries(
      names.map((name) => [name, process.env[name]]),
    );
    try {
      Object.assign(process.env, runtimeEnvironment);
      const descendantEnvironment = scrubbedParentEnv();
      assert.equal(
        descendantEnvironment.MINKE_NODE_EXECUTABLE,
        "C:\\Program Files\\Minke\\Minke.exe",
      );
      assert.equal(
        descendantEnvironment.MINKE_PNPM_ENTRY,
        "C:\\Minke\\runtime\\pnpm.cjs",
      );
      for (const name of [
        "ELECTRON_RUN_AS_NODE",
        "MINKE_INTERACTIVE_NODE_OPTIONS",
        "MINKE_INTERACTIVE_NODE_PATH",
        "MINKE_NODE_BOOTSTRAP",
        "NODE_OPTIONS",
        "NODE_PATH",
      ]) {
        assert.equal(
          hasEnvironmentName(descendantEnvironment, name),
          false,
          name,
        );
      }
    } finally {
      for (const name of names) {
        const value = previous[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

test("embedded child environments distinguish shells from owned Node processes", () => {
  const options = {
    electronExecutable: "/Applications/Minke.app/Minke",
    pnpmEntry: "/runtime/pnpm.cjs",
    runtimeBin: "/runtime/bin",
  };
  const inherited = {
    Path: "/usr/bin",
    electron_run_as_node: "ambient",
    node_options: "--require /tmp/ambient.cjs",
    NoDe_PaTh: "/tmp/ambient-modules",
    minke_node_executable: "/stale/electron",
    Minke_Pnpm_Entry: "/stale/pnpm.cjs",
    dsh_electron_executable: "/legacy/electron",
    Dsh_Pnpm_Entry: "/legacy/pnpm.cjs",
    PRESERVED: "yes",
  };

  const shell = embeddedNodeCapabilitiesEnvironment(
    options,
    inherited,
  );
  assert.equal(
    hasEnvironmentName(shell, "ELECTRON_RUN_AS_NODE"),
    false,
  );
  assert.equal(shell.node_options, inherited.node_options);
  assert.equal(shell.NoDe_PaTh, inherited.NoDe_PaTh);
  assert.equal(
    shell.PATH,
    [options.runtimeBin, "/usr/bin"].join(delimiter),
  );
  assert.equal(shell.Path, undefined);
  assert.equal(
    shell.MINKE_NODE_EXECUTABLE,
    options.electronExecutable,
  );
  assert.equal(shell.MINKE_PNPM_ENTRY, options.pnpmEntry);
  assert.equal(
    shell.MINKE_NODE_BOOTSTRAP,
    join(options.runtimeBin, "node-environment-bootstrap.cjs"),
  );
  assert.equal(
    shell.MINKE_INTERACTIVE_NODE_OPTIONS,
    inherited.node_options,
  );
  assert.equal(
    shell.MINKE_INTERACTIVE_NODE_PATH,
    inherited.NoDe_PaTh,
  );
  assert.equal(
    hasEnvironmentName(shell, "DSH_ELECTRON_EXECUTABLE"),
    false,
  );
  assert.equal(
    hasEnvironmentName(shell, "DSH_PNPM_ENTRY"),
    false,
  );
  assert.equal(shell.PRESERVED, "yes");

  const nodeChild = embeddedNodeChildEnvironment(
    options,
    inherited,
  );
  assert.equal(nodeChild.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(
    hasEnvironmentName(nodeChild, "NODE_OPTIONS"),
    false,
  );
  assert.equal(
    hasEnvironmentName(nodeChild, "NODE_PATH"),
    false,
  );
  assert.equal(nodeChild.PRESERVED, "yes");

  assert.deepEqual(
    nativeChildEnvironment({
      PRESERVED: "yes",
      electron_run_as_node: "1",
      minke_interactive_node_options: "--original",
      MINKE_INTERACTIVE_NODE_PATH: "/original-modules",
      minke_node_bootstrap: "/runtime/bootstrap.cjs",
      Node_Options: "--require /tmp/ambient.cjs",
      node_path: "/tmp/ambient-modules",
    }),
    {
      PRESERVED: "yes",
    },
  );

  const wrappedAgain = embeddedNodeChildEnvironment(
    options,
    nodeChild,
  );
  assert.equal(
    wrappedAgain.MINKE_INTERACTIVE_NODE_OPTIONS,
    inherited.node_options,
    "a second owned-Node boundary must retain the original user snapshot",
  );
  assert.equal(
    wrappedAgain.MINKE_INTERACTIVE_NODE_PATH,
    inherited.NoDe_PaTh,
    "a second owned-Node boundary must retain the original user snapshot",
  );
  assert.equal(
    wrappedAgain.PATH,
    nodeChild.PATH,
    "reapplying the same capability boundary must not duplicate runtime PATH",
  );
  const changedActiveEnvironment = {
    ...nodeChild,
    node_options: "--require /tmp/intermediate.cjs",
    node_path: "/tmp/intermediate-modules",
  };
  const wrappedAfterIntermediateChange =
    embeddedNodeCapabilitiesEnvironment(
      options,
      changedActiveEnvironment,
    );
  assert.equal(
    wrappedAfterIntermediateChange.MINKE_INTERACTIVE_NODE_OPTIONS,
    inherited.node_options,
    "an existing pre-bootstrap snapshot must outrank intermediate Node options",
  );
  assert.equal(
    wrappedAfterIntermediateChange.MINKE_INTERACTIVE_NODE_PATH,
    inherited.NoDe_PaTh,
    "an existing pre-bootstrap snapshot must outrank an intermediate Node path",
  );
  const restored = interactiveShellEnvironment(wrappedAgain);
  assert.equal(
    environmentValue(restored, "NODE_OPTIONS"),
    inherited.node_options,
  );
  assert.equal(
    environmentValue(restored, "NODE_PATH"),
    inherited.NoDe_PaTh,
  );
});

test("Harness startup snapshots and Host terminals restore the user's Node environment", () => {
  const runtime = harnessRuntimeEnvironment(
    {
      pnpmEntry: "/runtime/pnpm.cjs",
      runtimeBin: "/runtime/bin",
    },
    {
      dshHome: "/profile",
      electronExecutable: "/Applications/Minke.app/Minke",
      modelRuntimes: {
        lmStudio: { enabled: false },
        ollama: { enabled: false },
      },
    },
    {
      electron_run_as_node: "ambient",
      node_options: "--require /tmp/user-preload.cjs",
      NoDe_PaTh: "/tmp/user-modules",
      PRESERVED: "yes",
    },
  );

  assert.equal(hasEnvironmentName(runtime, "NODE_OPTIONS"), false);
  assert.equal(hasEnvironmentName(runtime, "NODE_PATH"), false);
  assert.equal(runtime.ELECTRON_RUN_AS_NODE, "1");

  const shell = interactiveShellEnvironment(runtime);
  assert.equal(
    environmentValue(shell, "NODE_OPTIONS"),
    "--require /tmp/user-preload.cjs",
  );
  assert.equal(
    environmentValue(shell, "NODE_PATH"),
    "/tmp/user-modules",
  );
  assert.equal(hasEnvironmentName(shell, "ELECTRON_RUN_AS_NODE"), false);
  assert.equal(
    hasEnvironmentName(shell, "MINKE_INTERACTIVE_NODE_OPTIONS"),
    false,
  );
  assert.equal(
    hasEnvironmentName(shell, "MINKE_INTERACTIVE_NODE_PATH"),
    false,
  );
  assert.equal(shell.PRESERVED, "yes");

  const external = externalCommandEnvironment(runtime);
  for (const name of [
    "ELECTRON_RUN_AS_NODE",
    "MINKE_INTERACTIVE_NODE_OPTIONS",
    "MINKE_INTERACTIVE_NODE_PATH",
    "MINKE_NODE_BOOTSTRAP",
    "NODE_OPTIONS",
    "NODE_PATH",
  ]) {
    assert.equal(hasEnvironmentName(external, name), false);
  }
  assert.equal(
    external.MINKE_NODE_EXECUTABLE,
    runtime.MINKE_NODE_EXECUTABLE,
  );
});

test("every staged adapter scopes Node mode to its direct Electron child", () => {
  const sources = runtimeAdapterSources();
  assert.deepEqual(Object.keys(sources).sort(), [
    "dsh",
    "dsh.cmd",
    "node",
    "node-environment-bootstrap.cjs",
    "node.cmd",
    "pnpm",
    "pnpm.cmd",
    "pnpx",
    "pnpx.cmd",
  ]);
  const bootstrap = sources["node-environment-bootstrap.cjs"];
  assert.match(bootstrap, /ELECTRON_RUN_AS_NODE/u);
  assert.match(bootstrap, /NODE_OPTIONS/u);
  assert.match(bootstrap, /NODE_PATH/u);
  assert.match(bootstrap, /delete environment\[key\]/u);
  for (
    const [name, source] of Object.entries(sources)
      .filter(([name]) => name !== "node-environment-bootstrap.cjs")
  ) {
    assert.match(source, /ELECTRON_RUN_AS_NODE/u, name);
    assert.match(source, /MINKE_NODE_EXECUTABLE/u, name);
    assert.doesNotMatch(source, /DSH_(?:ELECTRON_EXECUTABLE|PNPM_ENTRY)/u);
    if (name.startsWith("pnpm") || name.startsWith("pnpx")) {
      assert.match(source, /MINKE_PNPM_ENTRY/u, name);
    }
    if (!name.startsWith("dsh")) {
      assert.match(source, /node-environment-bootstrap\.cjs/u, name);
    }
  }
  assert.match(sources.dsh, /--expose-internals/u);
  assert.match(sources["dsh.cmd"], /--expose-internals/u);
  for (const name of ["dsh", "dsh.cmd"]) {
    assert.match(
      sources[name],
      /MINKE_INTERACTIVE_NODE_OPTIONS/u,
      name,
    );
    assert.match(
      sources[name],
      /MINKE_INTERACTIVE_NODE_PATH/u,
      name,
    );
  }
});

test("the POSIX dsh adapter passes Node mode only to the staged entry", {
  skip: process.platform === "win32",
}, async () => {
  await withTemporaryDirectory(async (root) => {
    const binRoot = join(root, "bin");
    await mkdir(binRoot, { recursive: true });
    const adapter = join(binRoot, "dsh");
    await writeFile(adapter, runtimeAdapterSources().dsh);
    await chmod(adapter, 0o755);
    await writeFile(
      join(root, "index.mjs"),
      [
        "process.stdout.write(JSON.stringify({",
        "  mode: process.env.ELECTRON_RUN_AS_NODE ?? null,",
        "  nodeOptions: process.env.NODE_OPTIONS ?? null,",
        "  nodePath: process.env.NODE_PATH ?? null,",
        "  interactiveNodeOptions:",
        "    process.env.MINKE_INTERACTIVE_NODE_OPTIONS ?? null,",
        "  interactiveNodePath:",
        "    process.env.MINKE_INTERACTIVE_NODE_PATH ?? null,",
        "  execArgv: process.execArgv,",
        "  args: process.argv.slice(2),",
        "}));",
        "",
      ].join("\n"),
    );

    const result = spawnSync(
      adapter,
      ["plugin", "--profile", "web", "why", "fixture"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "0",
          NODE_OPTIONS: "--require /tmp/user-preload.cjs",
          NODE_PATH: "/tmp/user-modules",
          MINKE_NODE_EXECUTABLE: process.execPath,
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      mode: "1",
      nodeOptions: null,
      nodePath: null,
      interactiveNodeOptions: "--require /tmp/user-preload.cjs",
      interactiveNodePath: "/tmp/user-modules",
      execArgv: ["--expose-internals"],
      args: ["plugin", "--profile", "web", "why", "fixture"],
    });

    const preservedResult = spawnSync(
      adapter,
      ["why", "snapshot"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_OPTIONS: "--require /tmp/intermediate.cjs",
          NODE_PATH: "/tmp/intermediate-modules",
          MINKE_INTERACTIVE_NODE_OPTIONS:
            "--require /tmp/original.cjs",
          MINKE_INTERACTIVE_NODE_PATH:
            "/tmp/original-modules",
          MINKE_NODE_EXECUTABLE: process.execPath,
        },
      },
    );
    assert.equal(
      preservedResult.status,
      0,
      preservedResult.stderr,
    );
    assert.deepEqual(JSON.parse(preservedResult.stdout), {
      mode: "1",
      nodeOptions: null,
      nodePath: null,
      interactiveNodeOptions:
        "--require /tmp/original.cjs",
      interactiveNodePath: "/tmp/original-modules",
      execArgv: ["--expose-internals"],
      args: ["why", "snapshot"],
    });
  });
});

test("the POSIX node adapter hides bootstrap controls from the user program", {
  skip: process.platform === "win32",
}, async () => {
  await withTemporaryDirectory(async (root) => {
    const adapter = join(root, "node");
    await writeFile(adapter, runtimeAdapterSources().node);
    await writeFile(
      join(root, "node-environment-bootstrap.cjs"),
      runtimeAdapterSources()["node-environment-bootstrap.cjs"],
    );
    await chmod(adapter, 0o755);

    const result = spawnSync(
      adapter,
      [
        "--input-type=module",
        "-e",
        [
          'const names = new Set(["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "NODE_PATH"]);',
          "process.stdout.write(JSON.stringify(Object.fromEntries(",
          "  Object.entries(process.env).filter(([key]) => names.has(key.toUpperCase())),",
          ")));",
        ].join("\n"),
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "0",
          NODE_OPTIONS: "--no-warnings",
          NODE_PATH: join(root, "ambient-modules"),
          MINKE_NODE_EXECUTABLE: process.execPath,
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {});
  });
});

test("the POSIX node adapter preserves Node semantics recursively and scrubs native children", {
  skip: process.platform === "win32",
}, async () => {
  await withTemporaryDirectory(async (root) => {
    const adapter = join(root, "node");
    const bootstrap = join(root, "node-environment-bootstrap.cjs");
    const child = join(root, "child.cjs");
    const parent = join(root, "parent.cjs");
    await writeFile(adapter, runtimeAdapterSources().node);
    await writeFile(
      bootstrap,
      runtimeAdapterSources()["node-environment-bootstrap.cjs"],
    );
    await writeFile(
      child,
      [
        'const controls = ["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "NODE_PATH",',
        '  "MINKE_INTERACTIVE_NODE_OPTIONS", "MINKE_INTERACTIVE_NODE_PATH"];',
        "process.stdout.write(JSON.stringify({",
        "  bootstrap: process.env.MINKE_NODE_BOOTSTRAP,",
        "  controls: Object.fromEntries(Object.entries(process.env).filter(",
        "    ([key]) => controls.includes(key.toUpperCase()),",
        "  )),",
        "  execArgv: process.execArgv,",
        "}));",
        "",
      ].join("\n"),
    );
    await writeFile(
      parent,
      [
        'const { execFileSync, fork, spawnSync } = require("node:child_process");',
        `const childPath = ${JSON.stringify(child)};`,
        'process.env.ELECTRON_RUN_AS_NODE = "poisoned";',
        'process.env.NODE_OPTIONS = "--no-warnings";',
        `process.env.NODE_PATH = ${JSON.stringify(join(root, "poisoned-modules"))};`,
        "const read = (value) => JSON.parse(String(value));",
        "const spawned = spawnSync(process.execPath, [childPath], { encoding: \"utf8\" });",
        "if (spawned.status !== 0) throw new Error(spawned.stderr);",
        "const shelled = spawnSync(process.execPath, [childPath], {",
        "  encoding: \"utf8\",",
        "  shell: true,",
        "});",
        "if (shelled.status !== 0) throw new Error(shelled.stderr);",
        "const executed = read(execFileSync(process.execPath, [childPath]));",
        "const native = String(execFileSync(\"env\", []));",
        "const forked = fork(childPath, [], { silent: true });",
        "let forkedOutput = \"\";",
        "forked.stdout.on(\"data\", (chunk) => { forkedOutput += chunk; });",
        "forked.once(\"error\", (error) => { throw error; });",
        "forked.once(\"exit\", (code) => {",
        "  if (code !== 0) throw new Error(`fork failed: ${code}`);",
        "  process.stdout.write(JSON.stringify({",
        "    executed,",
        "    forked: read(forkedOutput),",
        "    native,",
        "    shelled: read(shelled.stdout),",
        "    spawned: read(spawned.stdout),",
        "  }));",
        "});",
        "",
      ].join("\n"),
    );
    await chmod(adapter, 0o755);

    const result = spawnSync(adapter, [parent], {
      encoding: "utf8",
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "0",
        MINKE_NODE_EXECUTABLE: process.execPath,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    for (const launch of [
      report.spawned,
      report.executed,
      report.forked,
    ]) {
      assert.deepEqual(launch.controls, {});
      assert.equal(
        await realpath(launch.bootstrap),
        await realpath(bootstrap),
      );
      assert.equal(launch.execArgv[0], "--require");
      assert.equal(
        await realpath(launch.execArgv[1]),
        await realpath(bootstrap),
      );
    }
    assert.deepEqual(report.shelled.controls, {});
    assert.equal(
      report.shelled.bootstrap,
      undefined,
      "shell:true is a native shell boundary, not a direct embedded-Node launch",
    );
    assert.deepEqual(report.shelled.execArgv, []);
    for (const name of [
      "ELECTRON_RUN_AS_NODE",
      "MINKE_INTERACTIVE_NODE_OPTIONS",
      "MINKE_INTERACTIVE_NODE_PATH",
      "MINKE_NODE_BOOTSTRAP",
      "NODE_OPTIONS",
      "NODE_PATH",
    ]) {
      assert.doesNotMatch(
        report.native,
        new RegExp(`^${name}=`, "mi"),
        name,
      );
    }
  });
});

test("every process.execPath production seam remains classified", async () => {
  const skipped = new Set(["dist", "lib", "node_modules", "tests"]);
  const topLevelFiles = (
    await Promise.all(
      ["config", "desktop", "packages", "scripts"].map((path) =>
        sourceFiles(resolve(projectRoot, path), skipped),
      ),
    )
  ).flat();
  const topLevelOwners = [];
  for (const path of topLevelFiles) {
    if ((await readFile(path, "utf8")).includes("process.execPath")) {
      topLevelOwners.push(projectRelative(path));
    }
  }
  assert.deepEqual(topLevelOwners.sort(), [
    "desktop/main/application.ts",
    "desktop/main/main-window.ts",
    "scripts/forge/run.mjs",
    "scripts/harness/node-pty-probe.cjs",
    "scripts/harness/pnpm-invocation.mjs",
    "scripts/harness/runtime-adapters.mjs",
    "scripts/harness/smoke.mjs",
    "scripts/harness/stage.mjs",
  ]);

  const upstreamFiles = (
    await Promise.all(
      ["apps", "packages"].map((path) =>
        sourceFiles(
          resolve(projectRoot, "vendor", "deepseek-harness", path),
          new Set(["lib", "node_modules", "test-support", "tests"]),
        ),
      ),
    )
  ).flat();
  const upstreamOwners = [];
  for (const path of upstreamFiles) {
    if ((await readFile(path, "utf8")).includes("process.execPath")) {
      upstreamOwners.push(projectRelative(path));
    }
  }
  assert.deepEqual(upstreamOwners.sort(), [
    "vendor/deepseek-harness/packages/bundle/web-app/src/index.ts",
    "vendor/deepseek-harness/packages/fs/tool-fs-search/src/search-core.ts",
    "vendor/deepseek-harness/packages/host/directory-picker-native/src/win32-dialog-host.ts",
    "vendor/deepseek-harness/packages/sandbox/sandbox-local/src/index.ts",
    "vendor/deepseek-harness/packages/subagent/subagent-codex/src/run.ts",
  ]);

  const sharedScrubOwners = [];
  for (const path of upstreamFiles) {
    if ((await readFile(path, "utf8")).includes("scrubbedParentEnv")) {
      sharedScrubOwners.push(projectRelative(path));
    }
  }
  assert.deepEqual(sharedScrubOwners.sort(), [
    "vendor/deepseek-harness/packages/bundle/web-app/src/index.ts",
    "vendor/deepseek-harness/packages/mcp/mcp-client/src/transport.ts",
    "vendor/deepseek-harness/packages/sdk/client/src/types.ts",
    "vendor/deepseek-harness/packages/subagent/subagent-claude-code/src/process.ts",
    "vendor/deepseek-harness/packages/subagent/subagent-claude-code/src/run.ts",
    "vendor/deepseek-harness/packages/subagent/subagent-dsh-sdk/src/run.ts",
    "vendor/deepseek-harness/packages/subprocess/subprocess-local/src/spawn.ts",
    "vendor/deepseek-harness/packages/subprocess/subprocess/src/index.ts",
    "vendor/deepseek-harness/packages/subprocess/subprocess/src/types.ts",
  ]);

  const webAppSource = await readFile(
    resolve(
      projectRoot,
      "vendor/deepseek-harness/packages/bundle/web-app/src/index.ts",
    ),
    "utf8",
  );
  assert.match(webAppSource, /spawn\(process\.execPath,/u);
  assert.match(webAppSource, /env:\s*scrubbedParentEnv\(\)/u);

  const searchSource = await readFile(
    resolve(
      projectRoot,
      "vendor/deepseek-harness/packages/fs/tool-fs-search/src/search-core.ts",
    ),
    "utf8",
  );
  assert.match(
    searchSource,
    /const executableSidecar = `\$\{process\.execPath\}-rg`/u,
  );
  assert.match(
    searchSource,
    /argv:\s*\[await resolveRgPath\(\), '--no-config'/u,
  );

  const codexSource = await readFile(
    resolve(
      projectRoot,
      "vendor/deepseek-harness/packages/subagent/subagent-codex/src/run.ts",
    ),
    "utf8",
  );
  assert.match(
    codexSource,
    /return \[process\.execPath, CODEX_PACKAGE_BIN, 'app-server', '--stdio'\]/u,
  );
  assert.match(
    codexSource,
    /spec\.spawn\(\{\s*argv: codexAppServerArgv\(\)/u,
  );

  const patch = await readFile(
    resolve(
      projectRoot,
      "patches/deepseek-harness/win32-directory-picker.patch",
    ),
    "utf8",
  );
  assert.match(patch, /ELECTRON_RUN_AS_NODE/u);
  assert.match(
    patch,
    /dsh-host-directory-picker-native\/lib\/index\.js/u,
  );
  assert.match(patch, /dsh-sandbox-local\/lib\/index\.js/u);
  assert.match(
    patch,
    /^\+\s*const nodeExecutable = process\.env\.MINKE_NODE_EXECUTABLE;/mu,
  );

  const environmentPatchPath =
    "patches/deepseek-harness/process-environment-boundaries.patch";
  const contract = JSON.parse(
    await readFile(
      resolve(projectRoot, "config/harness-runtime.json"),
      "utf8",
    ),
  );
  assert.equal(
    contract.patches.includes(environmentPatchPath),
    true,
  );
  const [environmentPatch] = await resolveHarnessRuntimePatches(
    resolve(projectRoot),
    [environmentPatchPath],
  );
  assert.deepEqual(environmentPatch.targets, [
    "node_modules/@deepseek-ai/dsh-subprocess/lib/index.js",
    "node_modules/@deepseek-ai/dsh-native-command/lib/index.js",
    "node_modules/@deepseek-ai/dsh-subprocess-local/lib/index.js",
    "node_modules/@deepseek-ai/dsh-web-app/lib/index.js",
    "node_modules/@deepseek-ai/dsh-sandbox-windows-acl/lib/runner.js",
  ]);
});
