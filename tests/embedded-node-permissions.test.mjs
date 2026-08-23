import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  runtimeEntrySource,
} from "../scripts/harness/runtime-entry.mjs";
import {
  runtimeAdapterSources,
} from "../scripts/harness/runtime-adapters.mjs";
import {
  harnessRuntimeEnvironment,
} from "../desktop/main/harness-runtime.ts";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

async function loadHarnessScrubbedParentEnv() {
  // The scrub is pure; its Cordis base classes are unrelated and are not
  // compiled yet when this suite runs in a clean packaging checkout.
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
      "../vendor/deepseek-harness/packages/subprocess/subprocess/src/index.ts"
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

test("the staged entry preserves embedded Node mode for descendants", async () => {
  await withTemporaryDirectory(async (root) => {
    const cliRoot = join(root, "node_modules", "@fixture", "cli");
    await mkdir(join(cliRoot, "lib"), { recursive: true });
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
        'import { spawnSync } from "node:child_process";',
        "const child = spawnSync(",
        "  process.execPath,",
        '  ["--input-type=module", "-e",',
        '   "process.stdout.write(process.env.ELECTRON_RUN_AS_NODE ?? \\"missing\\")"],',
        '  { encoding: "utf8", env: process.env },',
        ");",
        "if (child.status !== 0) throw new Error(child.stderr);",
        "process.stdout.write(child.stdout);",
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
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "1");
  });
});

test("Minke's embedded Node adapter survives the Harness child scrub", async () => {
  const scrubbedParentEnv = await loadHarnessScrubbedParentEnv();
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
    {},
  );
  const names = [
    ...new Set([
      ...Object.keys(runtimeEnvironment),
      "MINKE_NODE_EXECUTABLE",
      "MINKE_PNPM_ENTRY",
      "ELECTRON_RUN_AS_NODE",
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
    assert.equal(descendantEnvironment.ELECTRON_RUN_AS_NODE, "1");
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("every staged adapter delegates to Minke and reasserts Node mode", () => {
  const sources = runtimeAdapterSources();
  assert.deepEqual(Object.keys(sources).sort(), [
    "dsh",
    "dsh.cmd",
    "node",
    "node.cmd",
    "pnpm",
    "pnpm.cmd",
    "pnpx",
    "pnpx.cmd",
  ]);
  for (const [name, source] of Object.entries(sources)) {
    assert.match(source, /ELECTRON_RUN_AS_NODE/u, name);
    assert.match(source, /MINKE_NODE_EXECUTABLE/u, name);
    assert.doesNotMatch(source, /DSH_(?:ELECTRON_EXECUTABLE|PNPM_ENTRY)/u);
    if (name.startsWith("pnpm") || name.startsWith("pnpx")) {
      assert.match(source, /MINKE_PNPM_ENTRY/u, name);
    }
  }
  assert.match(sources.dsh, /--expose-internals/u);
  assert.match(sources["dsh.cmd"], /--expose-internals/u);
});

test("the POSIX dsh adapter launches the staged CLI through embedded Node", {
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
        "  mode: process.env.ELECTRON_RUN_AS_NODE,",
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
          MINKE_NODE_EXECUTABLE: process.execPath,
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      mode: "1",
      execArgv: ["--expose-internals"],
      args: ["plugin", "--profile", "web", "why", "fixture"],
    });
  });
});

test("the POSIX node adapter launches the configured executable in Node mode", {
  skip: process.platform === "win32",
}, async () => {
  await withTemporaryDirectory(async (root) => {
    const adapter = join(root, "node");
    await writeFile(adapter, runtimeAdapterSources().node);
    await chmod(adapter, 0o755);

    const result = spawnSync(
      adapter,
      [
        "--input-type=module",
        "-e",
        'process.stdout.write(process.env.ELECTRON_RUN_AS_NODE ?? "missing")',
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "0",
          MINKE_NODE_EXECUTABLE: process.execPath,
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "1");
  });
});

test("production sources never clear Minke's inherited Node mode", async () => {
  const roots = ["config", "desktop", "packages", "scripts"].map((path) =>
    resolve(projectRoot, path),
  );
  const files = (
    await Promise.all(
      roots.map((root) =>
        sourceFiles(
          root,
          new Set(["dist", "lib", "node_modules", "tests"]),
        ),
      ),
    )
  ).flat();
  const clearMode =
    /(?:delete\s+process\.env(?:\.ELECTRON_RUN_AS_NODE|\[["']ELECTRON_RUN_AS_NODE["']\])|process\.env(?:\.ELECTRON_RUN_AS_NODE|\[["']ELECTRON_RUN_AS_NODE["']\])\s*=\s*(?:undefined|null|["']["']))/u;
  for (const path of files) {
    assert.doesNotMatch(
      await readFile(path, "utf8"),
      clearMode,
      `${projectRelative(path)} clears the embedded Node capability`,
    );
  }
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
});
