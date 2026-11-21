import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";
import {
  applyHarnessRuntimePatches,
  resolveHarnessRuntimePatches,
  verifyHarnessRuntimePatchesApplied,
} from "../scripts/harness/runtime-patches.mjs";
import {
  hardenHarnessWindowsRestrictedLaunches,
  inspectHarnessRuntimeProcessPolicy,
  verifyHarnessRuntimeProcessPolicy,
} from "../scripts/harness/runtime-process-policy.mjs";

const repositoryRoot = resolve(
  fileURLToPath(new URL("..", import.meta.url)),
);

const win32PickerPatch =
  "patches/deepseek-harness/win32-directory-picker.patch";
const win32PickerRuntimeFiles = [
  {
    source:
      "vendor/deepseek-harness/packages/host/directory-picker-native/lib/index.js",
    target:
      "node_modules/@deepseek-ai/dsh-host-directory-picker-native/lib/index.js",
  },
  {
    source:
      "vendor/deepseek-harness/packages/host/directory-picker-native/lib/worker.cjs",
    target:
      "node_modules/@deepseek-ai/dsh-host-directory-picker-native/lib/worker.cjs",
  },
  {
    source:
      "vendor/deepseek-harness/packages/sandbox/sandbox-local/lib/index.js",
    target:
      "node_modules/@deepseek-ai/dsh-sandbox-local/lib/index.js",
  },
];

const fixturePatch = `diff --git a/node_modules/@deepseek-ai/example/lib/index.js b/node_modules/@deepseek-ai/example/lib/index.js
--- a/node_modules/@deepseek-ai/example/lib/index.js
+++ b/node_modules/@deepseek-ai/example/lib/index.js
@@ -1 +1 @@
-export const mode = "upstream";
+export const mode = "minke";
`;

function normalizeLineEndings(source) {
  return source.replaceAll("\r\n", "\n");
}

async function withFixture(callback, parent = tmpdir()) {
  await mkdir(parent, { recursive: true });
  const projectRoot = await mkdtemp(
    join(parent, "minke-runtime-patches-"),
  );
  const runtimeRoot = join(projectRoot, "runtime", "host");
  const target = join(
    runtimeRoot,
    "node_modules",
    "@deepseek-ai",
    "example",
    "lib",
    "index.js",
  );
  const patchPath = join(
    projectRoot,
    "patches",
    "deepseek-harness",
    "example.patch",
  );
  await mkdir(dirname(target), { recursive: true });
  await mkdir(dirname(patchPath), { recursive: true });
  await writeFile(target, 'export const mode = "upstream";\n');
  await writeFile(patchPath, fixturePatch);
  try {
    await callback({ patchPath, projectRoot, runtimeRoot, target });
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

async function withPatchedWin32PickerRuntime(callback) {
  const runtimeRoot = await mkdtemp(
    join(tmpdir(), "minke-win32-picker-runtime-"),
  );
  try {
    for (const file of win32PickerRuntimeFiles) {
      const target = resolve(runtimeRoot, file.target);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(
        target,
        await readFile(resolve(repositoryRoot, file.source)),
      );
    }
    const patches = await resolveHarnessRuntimePatches(
      repositoryRoot,
      [win32PickerPatch],
    );
    await applyHarnessRuntimePatches(runtimeRoot, patches);
    await callback(runtimeRoot);
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
}

test("declared Harness runtime patches apply to a disposable runtime", async () => {
  await withFixture(async ({ projectRoot, runtimeRoot, target }) => {
    const patches = await resolveHarnessRuntimePatches(projectRoot, [
      "patches/deepseek-harness/example.patch",
    ]);

    await applyHarnessRuntimePatches(runtimeRoot, patches);
    await verifyHarnessRuntimePatchesApplied(runtimeRoot, patches);

    assert.equal(
      normalizeLineEndings(await readFile(target, "utf8")),
      'export const mode = "minke";\n',
    );
  });
});

test("main and Worker profile resolvers work with exposed internals without the native addon", async () => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "minke-profile-resolution-"));
  const targets = ["index.js", "worker/profile-resolution-bootstrap.js"];
  const originals = [];
  const probe = (source) => {
    const module = parse(source, { ecmaVersion: "latest", sourceType: "module" });
    const accessor = module.body.find(node => node.type === "FunctionDeclaration" && node.id.name === "internalModules");
    assert.ok(accessor, "profile resolver must have an internal loader accessor");
    return spawnSync(process.execPath, ["--expose-internals", "--input-type=module", "-e", `
      import { createRequire as nodeRequire } from "node:module";
      function createRequire(url) {
        const require = nodeRequire(url);
        return id => {
          if (id === "node-addon-require-builtin") throw new Error("native addon unavailable");
          return require(id);
        };
      }
      ${source.slice(accessor.start, accessor.end)}
      try {
        const modules = internalModules();
        process.stdout.write(JSON.stringify({ esm: typeof modules.esm.resolveSync, cjs: typeof modules.cjs._resolveFilename }));
      } catch (error) {
        process.stdout.write(JSON.stringify({ error: error.message }));
        process.exitCode = 1;
      }
    `], { encoding: "utf8" });
  };
  try {
    for (const suffix of targets) {
      const source = await readFile(join(repositoryRoot, "vendor/deepseek-harness/packages/boot/app-boot/lib", suffix), "utf8");
      originals.push(source);
      const target = join(runtimeRoot, "node_modules/@deepseek-ai/dsh-app-boot/lib", suffix);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, source);
    }
    const patches = await resolveHarnessRuntimePatches(repositoryRoot, ["patches/deepseek-harness/embedded-profile-resolution.patch"]);
    await applyHarnessRuntimePatches(runtimeRoot, patches);
    for (const [index, suffix] of targets.entries()) {
      const negative = probe(originals[index]);
      assert.notEqual(negative.status, 0);
      assert.deepEqual(JSON.parse(negative.stdout), { error: "native addon unavailable" });
      const positive = probe(await readFile(join(runtimeRoot, "node_modules/@deepseek-ai/dsh-app-boot/lib", suffix), "utf8"));
      assert.equal(positive.status, 0, positive.stderr);
      assert.deepEqual(JSON.parse(positive.stdout), { esm: "function", cjs: "function" });
    }
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("runtime patches apply inside the Minke Git worktree", async () => {
  await withFixture(
    async ({ projectRoot, runtimeRoot, target }) => {
      const patches = await resolveHarnessRuntimePatches(projectRoot, [
        "patches/deepseek-harness/example.patch",
      ]);

      await applyHarnessRuntimePatches(runtimeRoot, patches);

      assert.equal(
        normalizeLineEndings(await readFile(target, "utf8")),
        'export const mode = "minke";\n',
      );
    },
    join(repositoryRoot, "runtime"),
  );
});

test("a stale Harness runtime patch fails without changing the runtime", async () => {
  await withFixture(async ({ projectRoot, runtimeRoot, target }) => {
    await writeFile(target, 'export const mode = "changed upstream";\n');
    const patches = await resolveHarnessRuntimePatches(projectRoot, [
      "patches/deepseek-harness/example.patch",
    ]);

    await assert.rejects(
      applyHarnessRuntimePatches(runtimeRoot, patches),
      /does not apply cleanly/u,
    );
    assert.equal(
      await readFile(target, "utf8"),
      'export const mode = "changed upstream";\n',
    );
  });
});

test("Harness runtime patches cannot escape owned upstream packages", async () => {
  await withFixture(async ({ patchPath, projectRoot }) => {
    await writeFile(
      patchPath,
      fixturePatch.replaceAll(
        "node_modules/@deepseek-ai/example/lib/index.js",
        "../../desktop/main/main.ts",
      ),
    );

    await assert.rejects(
      resolveHarnessRuntimePatches(projectRoot, [
        "patches/deepseek-harness/example.patch",
      ]),
      /unsafe runtime path/u,
    );
  });
});

test("Harness runtime patch declarations are unique and convention-bound", async () => {
  await withFixture(async ({ projectRoot }) => {
    await assert.rejects(
      resolveHarnessRuntimePatches(projectRoot, [
        "patches/deepseek-harness/example.patch",
        "patches/deepseek-harness/example.patch",
      ]),
      /must be unique/u,
    );
    await assert.rejects(
      resolveHarnessRuntimePatches(projectRoot, ["example.patch"]),
      /must live under patches\/deepseek-harness/u,
    );
  });
});

test("the background-process patch leaves generated ACL bundles to the runtime transform", async () => {
  const [patch] = await resolveHarnessRuntimePatches(
    repositoryRoot,
    [
      "patches/deepseek-harness/windows-background-processes.patch",
    ],
  );
  assert.equal(
    patch.targets.includes(
      "node_modules/@deepseek-ai/dsh-experimental-ptc-runtime-python/lib/index.js",
    ),
    false,
  );
  assert.equal(
    patch.targets.some((target) =>
      target.startsWith(
        "node_modules/@deepseek-ai/dsh-sandbox-windows-acl/",
      ),
    ),
    false,
  );
});

test("the Windows picker worker requests foreground, keeps IPC open, and avoids external path views", async () => {
  await withPatchedWin32PickerRuntime(async (runtimeRoot) => {
    const workerPath = resolve(
      runtimeRoot,
      "node_modules/@deepseek-ai/dsh-host-directory-picker-native/lib/worker.cjs",
    );
    const koffiRoot = resolve(runtimeRoot, "node_modules/koffi");
    await mkdir(koffiRoot, { recursive: true });
    await writeFile(
      resolve(koffiRoot, "package.json"),
      JSON.stringify({
        name: "koffi",
        version: "0.0.0",
        main: "index.cjs",
      }),
    );
    await writeFile(
      resolve(koffiRoot, "index.cjs"),
      `"use strict";
const dialog = { kind: "dialog" };
const item = { kind: "item" };
const keyboardEvents = [];
function decode(value, offsetOrType, maybeType) {
  if (offsetOrType === "str16") {
    if (!Buffer.isBuffer(value) || value.length !== 8 || value.readBigUInt64LE() !== 4242n) {
      throw new Error("unexpected UTF-16 pointer variable");
    }
    return "C:\\\\fixture\\\\安卓开发";
  }
  if (maybeType === "void *") {
    return { owner: value.owner, slot: offsetOrType / 8 };
  }
  if (offsetOrType === "void *") {
    return Buffer.isBuffer(value) ? dialog : { owner: value };
  }
  throw new Error("unexpected fake koffi decode");
}
module.exports = {
  call(fn, _prototype, _self, ...args) {
    if (fn.slot === 3 && JSON.stringify(keyboardEvents) !== "[[18,0,0,0],[18,0,2,0]]") {
      throw new Error("folder dialog must request foreground with an Alt press before Show");
    }
    if (fn.slot === 20) args[0][0] = item;
    if (fn.slot === 5) args[1][0] = 4242n;
    return 0;
  },
  decode,
  load() {
    return {
      func(_abi, symbol) {
        if (symbol === "GetCurrentThreadId") return () => 4242;
        if (symbol === "keybd_event") return (...args) => keyboardEvents.push(args);
        if (symbol === "SetThreadDpiAwarenessContext") {
          return () => ({});
        }
        return () => 0;
      },
    };
  },
  proto() {
    return {};
  },
  sizeof() {
    return 8;
  },
  view() {
    throw new Error("koffi.view is unsafe in packaged Electron");
  },
};
`,
    );

    const preloadPath = resolve(
      runtimeRoot,
      "win32-picker-ipc-preload.cjs",
    );
    await writeFile(
      preloadPath,
      `"use strict";
const nativeSend = process.send?.bind(process);
if (nativeSend === undefined) {
  throw new Error("picker IPC preload requires a child IPC channel");
}
process.send = (message, callback) => {
  const sent = nativeSend(message);
  callback?.(null);
  return sent;
};
`,
    );

    const messages = [];
    let stderr = "";
    const child = spawn(
      process.execPath,
      ["--require", preloadPath, workerPath],
      {
        env: {
          ...process.env,
          DSH_DIALOG_TITLE: "Select Workspace Directory",
        },
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("message", (message) => {
      messages.push(message);
    });
    const result = await new Promise((resolveResult, rejectResult) => {
      const timeout = setTimeout(() => {
        child.kill();
        rejectResult(
          new Error("timed out waiting for the picker worker protocol"),
        );
      }, 2_000);
      child.on("error", (error) => {
        clearTimeout(timeout);
        rejectResult(error);
      });
      child.on("close", (code, signal) => {
        clearTimeout(timeout);
        resolveResult({ code, signal });
      });
    });

    assert.equal(result.signal, null, stderr);
    assert.equal(result.code, 0, stderr);
    assert.deepEqual(
      messages,
      [
        { kind: "showing", threadId: 4242 },
        { kind: "done", path: "C:\\fixture\\安卓开发" },
      ],
      "win32 folder dialog worker exited before reporting a result",
    );
  });
});

async function withProcessPolicyFixture(
  {
    aclBundles,
    launchExtension = ".js",
    launchRelativePath,
    launchSource,
    startupFlags = 0x101,
    showWindow = 0,
  },
  callback,
) {
  const runtimeRoot = await mkdtemp(
    join(tmpdir(), "minke-runtime-process-policy-"),
  );
  const launchPath = join(
    runtimeRoot,
    launchRelativePath ?? `node_modules/@deepseek-ai/example/lib/index${launchExtension}`,
  );
  const aclRoot = join(
    runtimeRoot,
    "node_modules",
    "@deepseek-ai",
    "dsh-sandbox-windows-acl",
    "lib",
  );
  await mkdir(dirname(launchPath), { recursive: true });
  await mkdir(aclRoot, { recursive: true });
  await writeFile(launchPath, launchSource);
  const bundles = aclBundles ?? [
    {
      name: "index.js",
      showWindow,
      startupFlags,
    },
  ];
  const aclPaths = [];
  for (const [index, bundle] of bundles.entries()) {
    const aclPath = join(aclRoot, bundle.name);
    const showWindowField =
      bundle.showWindow === undefined
        ? ""
        : `    wShowWindow: ${String(bundle.showWindow)},\n`;
    await writeFile(
      aclPath,
      `function restricted${String(index)}(api, token, startupInfo, processInfo) {
  encodeStartupInfo(startupInfo, {
    dwFlags: ${String(bundle.startupFlags)},
${showWindowField}    hStdInput: null,
    hStdOutput: null,
    hStdError: null,
  });
  return api.createProcessAsUserW(
    token, null, "probe.exe", null, null, 1, 0, null, null,
    startupInfo, processInfo
  );
}
`,
    );
    aclPaths.push(aclPath);
  }
  try {
    await callback(runtimeRoot, aclPaths);
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
}

test("Harness runtime process policy rejects visible direct child processes", async () => {
  await withProcessPolicyFixture(
    {
      launchSource: `import { spawn } from "node:child_process";
spawn("probe.exe", [], { stdio: "ignore" });
`,
    },
    async (runtimeRoot) => {
      await assert.rejects(
        verifyHarnessRuntimeProcessPolicy(runtimeRoot),
        /spawn\(\) must set windowsHide: true/u,
      );
    },
  );
});

test("Harness runtime process policy accepts hidden direct and restricted launches", async () => {
  await withProcessPolicyFixture(
    {
      launchSource: `import { spawn as launch } from "node:child_process";
launch("probe.exe", [], { stdio: "ignore", windowsHide: true });
`,
    },
    async (runtimeRoot) => {
      const inspection =
        await inspectHarnessRuntimeProcessPolicy(runtimeRoot);
      assert.equal(inspection.launches.length, 1);
      assert.equal(inspection.restrictedLaunches.length, 1);
      assert.deepEqual(inspection.violations, []);
      await verifyHarnessRuntimeProcessPolicy(runtimeRoot);
    },
  );
});

test("LibreOffice redistribution sources are excluded only for the pinned engine and declared build paths", async () => {
  await withProcessPolicyFixture(
    { launchSource: 'import { spawn } from "node:child_process"; spawn("probe", [], { windowsHide: true });' },
    async (runtimeRoot) => {
      const packageName = "@deepseek-ai/libreoffice-kit-darwin-arm64";
      const packageRoot = join(runtimeRoot, "node_modules", packageName);
      const declared = "sources/scripts/build-native.mjs";
      const visible = 'import { spawnSync } from "node:child_process"; spawnSync("compiler", []);';
      await mkdir(join(packageRoot, "sources", "scripts"), { recursive: true });
      await writeFile(join(packageRoot, declared), visible);
      await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: packageName, version: "0.2.3" }));
      await writeFile(join(packageRoot, "prebuilds.json"), JSON.stringify({ source: { files: [declared] } }));
      await verifyHarnessRuntimeProcessPolicy(runtimeRoot);

      // The same visible spawn is still rejected outside the rebuild inputs,
      // even if an engine manifest erroneously lists a runtime file as source.
      for (const path of ["lib/worker.mjs", "sources/scripts/unlisted.mjs"]) {
        await mkdir(dirname(join(packageRoot, path)), { recursive: true });
        await writeFile(join(packageRoot, path), visible);
        await writeFile(join(packageRoot, "prebuilds.json"), JSON.stringify({ source: { files: [declared, "lib/worker.mjs"] } }));
        await assert.rejects(verifyHarnessRuntimeProcessPolicy(runtimeRoot), /spawnSync\(\) must set windowsHide: true/u);
        await rm(join(packageRoot, path));
      }
      await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: packageName, version: "0.2.4" }));
      await assert.rejects(verifyHarnessRuntimeProcessPolicy(runtimeRoot), /spawnSync\(\) must set windowsHide: true/u);
    },
  );
});

test("Harness runtime process policy audits injectable child-process spawners", async () => {
  for (const inline of [false, true]) {
    for (const hidden of [false, true]) {
      await withProcessPolicyFixture(
        {
          launchSource: `import { spawn } from "node:child_process";
function launch(internals) {
  ${inline ? "" : "const spawnProcess = internals.spawn ?? spawn;"}
  ${inline ? "(internals.spawn ?? spawn)" : "spawnProcess"}("probe.exe", [], { windowsHide: ${String(hidden)} });
}
`,
        },
        async (runtimeRoot) => {
          const inspection =
            await inspectHarnessRuntimeProcessPolicy(runtimeRoot);
          assert.equal(inspection.launches.length, 1);
          if (hidden) {
            assert.deepEqual(inspection.violations, []);
            await verifyHarnessRuntimeProcessPolicy(runtimeRoot);
          } else {
            await assert.rejects(
              verifyHarnessRuntimeProcessPolicy(runtimeRoot),
              /spawn\(\) must set windowsHide: true/u,
            );
          }
        },
      );
    }
  }
});

const catalogAppLaunchSource = `import { spawn } from "node:child_process";
import { scrubbedParentEnv } from "@deepseek-ai/dsh-subprocess";
export const launchDetachedApp = (command, args, options) => new Promise((resolve, reject) => {
  const base = Object.fromEntries(Object.entries(scrubbedParentEnv())
    .filter(([name]) => name.toUpperCase() !== "ELECTRON_RUN_AS_NODE"));
  const child = spawn(command, [...args], {
    detached: true,
    stdio: "ignore",
    windowsHide: options.windowsHide,
    env: { ...base, ...options.env },
  });
  child.unref();
  resolve();
});
`;

test("catalog GUI launch policy retains adapter visibility only at both pinned artifact paths", async () => {
  for (const artifact of ["index.js", "types/resolver.js"]) {
    const source = artifact === "index.js"
      ? catalogAppLaunchSource.replace("export const", "const")
      : catalogAppLaunchSource;
    await withProcessPolicyFixture(
      {
        launchRelativePath: `node_modules/@deepseek-ai/dsh-host-open-in-app/lib/${artifact}`,
        launchSource: source,
      },
      async (runtimeRoot) => {
        const inspection = await verifyHarnessRuntimeProcessPolicy(runtimeRoot);
        assert.equal(inspection.launches.length, 1);
        assert.deepEqual(inspection.violations, []);
        const observed = [];
        const launch = new Function("spawn", "scrubbedParentEnv", `${source
          .replace(/^import .*;\n/gmu, "")
          .replace("export const", "const")}
return launchDetachedApp;
`)(
          (command, args, options) => {
            observed.push({ command, args, options });
            return { unref() {} };
          },
          () => ({ PATH: "scrubbed-path", MODE: "parent", Electron_Run_As_Node: "1" }),
        );
        for (const windowsHide of [undefined, false, true]) {
          await launch("editor.exe", ["workspace"], { windowsHide, env: { MODE: "adapter" } });
        }
        assert.deepEqual(observed, [undefined, false, true].map((windowsHide) => ({
          command: "editor.exe",
          args: ["workspace"],
          options: {
            detached: true,
            stdio: "ignore",
            windowsHide,
            env: { PATH: "scrubbed-path", MODE: "adapter" },
          },
        })));
      },
    );
  }
});

test("catalog GUI launch policy rejects other paths, owners, and changed process options", async () => {
  const cases = [
    { path: "node_modules/@deepseek-ai/example/lib/index.js" },
    { path: "node_modules/@deepseek-ai/dsh-host-open-in-app/lib/other.js" },
    { source: catalogAppLaunchSource.replace("launchDetachedApp =", "backgroundLaunch =") },
    { source: catalogAppLaunchSource.replace("(command, args, options)", "(command, args, settings)") },
    { source: catalogAppLaunchSource.replace("(resolve, reject)", "(command, reject)") },
    { source: catalogAppLaunchSource.replace('stdio: "ignore",', 'stdio: "ignore", shell: false,') },
    { source: catalogAppLaunchSource.replace("Object.entries(scrubbedParentEnv())", "Object.entries(process.env)") },
    { source: catalogAppLaunchSource.replace("...base, ...options.env", "...options.env, ...base") },
    { source: catalogAppLaunchSource.replace("windowsHide: options.windowsHide", "windowsHide: false") },
    { source: catalogAppLaunchSource.replace("spawn(command, [...args]", "spawn(command, args") },
  ];
  for (const entry of cases) {
    await withProcessPolicyFixture(
      {
        launchRelativePath: entry.path ?? "node_modules/@deepseek-ai/dsh-host-open-in-app/lib/index.js",
        launchSource: entry.source ?? catalogAppLaunchSource,
      },
      async (runtimeRoot) => {
        await assert.rejects(
          verifyHarnessRuntimeProcessPolicy(runtimeRoot),
          /spawn\(\) must set windowsHide: true/u,
        );
      },
    );
  }
});

test("catalog GUI launch exception still audits extra spawns in the same owner and file", async () => {
  for (const source of [
    `${catalogAppLaunchSource}\nspawn("helper.exe", [], {});\n`,
    catalogAppLaunchSource.replace("  child.unref();", '  spawn("helper.exe", [], {});\n  child.unref();'),
  ]) {
    await withProcessPolicyFixture(
      {
        launchRelativePath: "node_modules/@deepseek-ai/dsh-host-open-in-app/lib/index.js",
        launchSource: source,
      },
      async (runtimeRoot) => {
        const inspection = await inspectHarnessRuntimeProcessPolicy(runtimeRoot);
        assert.equal(inspection.launches.length, 2);
        assert.equal(inspection.violations.length, 1);
        await assert.rejects(
          verifyHarnessRuntimeProcessPolicy(runtimeRoot),
          /spawn\(\) must set windowsHide: true/u,
        );
      },
    );
  }
});

const nativeCommandLaunchSource = `import { execFile } from "node:child_process";
export const runNativeCommand = (command, args, signal, window) => new Promise((resolve, reject) => {
  execFile(command, [...args], {
    encoding: "utf8", env: externalCommandEnvironment(), signal, windowsHide: window === "hidden",
  }, (error, stdout, stderr) => {
    if (error !== null) { reject(error); return; }
    resolve({ stdout, stderr });
  });
});
`;

test("native command policy preserves explicit Explorer visibility and hidden background commands", async () => {
  for (const artifact of ["index.js", "types/runner.js"]) {
    const source = artifact === "index.js"
      ? nativeCommandLaunchSource.replace("export const", "const")
      : nativeCommandLaunchSource.replace("env: externalCommandEnvironment(), ", "");
    await withProcessPolicyFixture({
      launchRelativePath: `node_modules/@deepseek-ai/dsh-native-command/lib/${artifact}`,
      launchSource: source,
    }, async (runtimeRoot) => {
      const inspection = await verifyHarnessRuntimeProcessPolicy(runtimeRoot);
      assert.equal(inspection.launches.length, 1);
      const observed = [];
      const run = new Function("execFile", "externalCommandEnvironment", `${source
        .replace(/^import .*;\n/gmu, "")
        .replace("export const", "const")}
return runNativeCommand;
`)(
        (command, args, options, callback) => {
          observed.push({ command, args, options });
          callback(null, "done", "");
        },
        () => ({ PATH: "scrubbed-path" }),
      );
      const signal = new AbortController().signal;
      for (const window of ["visible", "hidden"]) {
        assert.deepEqual(await run("explorer.exe", ["C:\\workspace"], signal, window), {
          stdout: "done", stderr: "",
        });
      }
      assert.deepEqual(observed.map(({ options }) => options.windowsHide), [false, true]);
      assert.equal(observed[0].options.signal, signal);
      assert.equal(observed[0].options.shell, undefined);
      assert.deepEqual(observed[0].args, ["C:\\workspace"]);
    });
  }
});

test("native command visibility policy rejects changed runners and extra process launches", async () => {
  const cases = [
    { path: "node_modules/@deepseek-ai/example/lib/index.js" },
    { path: "node_modules/@deepseek-ai/dsh-native-command/lib/other.js" },
    { source: nativeCommandLaunchSource.replace("runNativeCommand =", "backgroundCommand =") },
    { source: nativeCommandLaunchSource.replace("signal, window)", "signal, visibility)") },
    { source: nativeCommandLaunchSource.replace('window === "hidden"', 'window !== "visible"') },
    { source: nativeCommandLaunchSource.replace('window === "hidden"', "false") },
    { source: nativeCommandLaunchSource.replace("env: externalCommandEnvironment()", "env: process.env") },
    { source: nativeCommandLaunchSource.replace('encoding: "utf8",', 'encoding: "utf8", shell: true,') },
    { source: nativeCommandLaunchSource.replace("command, [...args]", "command, args") },
    { source: `${nativeCommandLaunchSource}\nexecFile("helper.exe", [], {});\n` },
    { source: nativeCommandLaunchSource.replace("  execFile(command", '  execFile("helper.exe", [], {});\n  execFile(command') },
  ];
  for (const entry of cases) {
    await withProcessPolicyFixture({
      launchRelativePath: entry.path ?? "node_modules/@deepseek-ai/dsh-native-command/lib/index.js",
      launchSource: entry.source ?? nativeCommandLaunchSource,
    }, async (runtimeRoot) => {
      await assert.rejects(
        verifyHarnessRuntimeProcessPolicy(runtimeRoot),
        /execFile\(\) must set windowsHide: true/u,
      );
    });
  }
});

test("Harness runtime process policy rejects visible restricted-token children", async () => {
  await withProcessPolicyFixture(
    {
      launchSource: `const { spawnSync } = require("child_process");
spawnSync("probe.exe", [], { windowsHide: true });
`,
      launchExtension: ".cjs",
      startupFlags: 0x100,
    },
    async (runtimeRoot) => {
      await assert.rejects(
        verifyHarnessRuntimeProcessPolicy(runtimeRoot),
        /STARTF_USESHOWWINDOW.*SW_HIDE/u,
      );
    },
  );
});

test("restricted launch hardening discovers one or multiple hashed ACL bundles", async () => {
  for (const bundleNames of [
    ["types-WindowsHash.js"],
    ["types-DarwinHashA.js", "types-DarwinHashB.js"],
  ]) {
    await withProcessPolicyFixture(
      {
        aclBundles: bundleNames.map((name) => ({
          name,
          showWindow: undefined,
          startupFlags: 0x100,
        })),
        launchSource: `import { spawn } from "node:child_process";
spawn("probe.exe", [], { stdio: "ignore", windowsHide: true });
`,
      },
      async (runtimeRoot) => {
        const first =
          await hardenHarnessWindowsRestrictedLaunches(runtimeRoot);
        assert.deepEqual(first, {
          changedLaunches: bundleNames.length,
          files: bundleNames.length,
          launches: bundleNames.length,
        });
        const inspection =
          await verifyHarnessRuntimeProcessPolicy(runtimeRoot);
        assert.equal(
          inspection.restrictedLaunches.length,
          bundleNames.length,
        );
        assert.deepEqual(inspection.violations, []);

        const second =
          await hardenHarnessWindowsRestrictedLaunches(runtimeRoot);
        assert.equal(second.changedLaunches, 0);
      },
    );
  }
});

test("restricted launch hardening follows a delegated restricted process owner", async () => {
  await withProcessPolicyFixture(
    {
      aclBundles: [],
      launchSource: `import { spawn } from "node:child_process";
spawn("probe.exe", [], { stdio: "ignore", windowsHide: true });
`,
    },
    async (runtimeRoot) => {
      const processRoot = join(
        runtimeRoot,
        "node_modules",
        "@deepseek-ai",
        "dsh-win32-process",
        "lib",
      );
      const processPath = join(processRoot, "index.js");
      await mkdir(processRoot, { recursive: true });
      await writeFile(
        processPath,
        `function createRestrictedProcess(api, options, commandLine, creationFlags, startupInfo, processInfo) {
  return api.createProcessAsUserW(
    options.token, null, commandLine, null, null, 1, creationFlags, null,
    options.cwd, startupInfo, processInfo
  );
}
function spawnPipedProcess(api, options) {
  const startupInfo = {};
  encodeStartupInfo(startupInfo, {
    dwFlags: 0x100,
    hStdInput: null,
    hStdOutput: null,
    hStdError: null,
  });
  return createRestrictedProcess(
    api, options, "piped.exe", 0, startupInfo, {}
  );
}
function spawnInheritedJobProcess(api, options) {
  const startupInfo = {};
  encodeStartupInfo(startupInfo, {
    dwFlags: 0x100,
    hStdInput: null,
    hStdOutput: null,
    hStdError: null,
  });
  return createRestrictedProcess(
    api, options, "job.exe", 4, startupInfo, {}
  );
}
`,
      );

      const first =
        await hardenHarnessWindowsRestrictedLaunches(runtimeRoot);
      assert.deepEqual(first, {
        changedLaunches: 2,
        files: 1,
        launches: 2,
      });
      const hardened = await readFile(processPath, "utf8");
      assert.equal(
        hardened.match(/dwFlags:\s*257/gu)?.length,
        2,
      );
      assert.equal(
        hardened.match(/wShowWindow:\s*0/gu)?.length,
        2,
      );

      const inspection =
        await verifyHarnessRuntimeProcessPolicy(runtimeRoot);
      assert.equal(inspection.restrictedLaunches.length, 2);
      assert.deepEqual(inspection.violations, []);

      const second =
        await hardenHarnessWindowsRestrictedLaunches(runtimeRoot);
      assert.equal(second.changedLaunches, 0);
    },
  );
});

const sharedJobOwnerSource = `function createRestrictedProcess(api, options, commandLine, creationFlags, startupInfo, processInfo) {
  return api.createProcessAsUserW(
    options.token, null, commandLine, null, null, 1, creationFlags, null,
    options.cwd, startupInfo, processInfo
  );
}
function spawnPipedProcess(api, options) {
  const startupInfo = {};
  encodeStartupInfo(startupInfo, { dwFlags: 0x100, hStdInput: null });
  return createRestrictedProcess(api, options, "piped.exe", 0, startupInfo, {});
}
function spawnJobProcess(api, options, resolveStdio, createName, create) {
  const startupInfo = {};
  encodeStartupInfo(startupInfo, { dwFlags: 0x100, hStdInput: null });
  return create(startupInfo, {});
}
function spawnInheritedJobProcess(api, options) {
  return spawnJobProcess(api, options, () => ({}), "CreateProcessAsUserW", (startupInfo, processInfo) =>
    createRestrictedProcess(api, options, "job.exe", 4, startupInfo, processInfo));
}
function spawnCurrentTokenJobProcess(api, options) {
  return spawnJobProcess(api, options, () => ({}), "CreateProcessW", (startupInfo, processInfo) =>
    api.createProcessW(null, "ordinary.exe", null, null, 1, 1028, null, options.cwd, startupInfo, processInfo));
}
`;

async function writeSharedJobOwner(runtimeRoot, source) {
  const path = join(
    runtimeRoot,
    "node_modules",
    "@deepseek-ai",
    "dsh-win32-process",
    "lib",
    "index.js",
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source);
  return path;
}

test("alpha.2 shared Job hardening hides both token types at the native call", async () => {
  await withProcessPolicyFixture(
    {
      aclBundles: [],
      launchSource: `import { spawn } from "node:child_process";
(internals.spawn ?? spawn)("runner.exe", [], { windowsHide: true });
`,
    },
    async (runtimeRoot) => {
      const path = await writeSharedJobOwner(runtimeRoot, sharedJobOwnerSource);
      await assert.rejects(
        verifyHarnessRuntimeProcessPolicy(runtimeRoot),
        /STARTF_USESHOWWINDOW.*SW_HIDE/u,
      );
      assert.deepEqual(await hardenHarnessWindowsRestrictedLaunches(runtimeRoot), {
        changedLaunches: 2,
        files: 1,
        launches: 3,
      });
      const source = await readFile(path, "utf8");
      const launches = new Function("encodeStartupInfo", `${source}
return [spawnPipedProcess, spawnInheritedJobProcess, spawnCurrentTokenJobProcess];
`)(Object.assign);
      const observed = [];
      const api = {
        createProcessAsUserW: (...args) => observed.push({ api: "restricted", ...args[9] }),
        createProcessW: (...args) => observed.push({ api: "ordinary", ...args[8] }),
      };
      for (const launch of launches) launch(api, {});
      assert.deepEqual(observed, ["restricted", "restricted", "ordinary"].map((api) => ({
        api,
        dwFlags: 0x101,
        wShowWindow: 0,
        hStdInput: null,
      })));
      const inspection = await verifyHarnessRuntimeProcessPolicy(runtimeRoot);
      assert.equal(inspection.launches.length, 1);
      assert.equal(inspection.restrictedLaunches.length, 2);
      assert.equal((await hardenHarnessWindowsRestrictedLaunches(runtimeRoot)).changedLaunches, 0);
    },
  );
});

test("alpha.2 shared Job audit rejects missing or bypassed STARTUPINFOW before mutation", async () => {
  const cases = [
    {
      source: sharedJobOwnerSource.replace("return create(startupInfo, {});", "return create({}, {});"),
      error: /spawnJobProcess must pass its encoded STARTUPINFOW/u,
    },
    {
      source: sharedJobOwnerSource.replace('"job.exe", 4, startupInfo, processInfo', '"job.exe", 4, {}, processInfo'),
      error: /spawnJobProcess callback must pass its STARTUPINFOW/u,
    },
    {
      source: sharedJobOwnerSource.replace("options.cwd, startupInfo, processInfo));", "options.cwd, {}, processInfo));"),
      error: /spawnJobProcess callback must pass its STARTUPINFOW/u,
    },
    {
      source: `${sharedJobOwnerSource}\napi.createProcessW(null, "escape.exe", null, null, 1, 0, null, null, {}, {});\n`,
      error: /CreateProcessW must receive STARTUPINFOW through spawnJobProcess/u,
    },
  ];
  for (const { source, error } of cases) {
    await withProcessPolicyFixture(
      {
        aclBundles: [],
        launchSource: `import { spawn } from "node:child_process";
spawn("runner.exe", [], { windowsHide: true });
`,
      },
      async (runtimeRoot) => {
        const path = await writeSharedJobOwner(runtimeRoot, source);
        await assert.rejects(verifyHarnessRuntimeProcessPolicy(runtimeRoot), error);
        await assert.rejects(hardenHarnessWindowsRestrictedLaunches(runtimeRoot), error);
        assert.equal(await readFile(path, "utf8"), source);
      },
    );
  }
});

test("delegated restricted launch hardening rejects an unconfigured launch", async () => {
  await withProcessPolicyFixture(
    {
      aclBundles: [],
      launchSource: `import { spawn } from "node:child_process";
spawn("probe.exe", [], { stdio: "ignore", windowsHide: true });
`,
    },
    async (runtimeRoot) => {
      const processRoot = join(
        runtimeRoot,
        "node_modules",
        "@deepseek-ai",
        "dsh-win32-process",
        "lib",
      );
      await mkdir(processRoot, { recursive: true });
      await writeFile(
        join(processRoot, "index.js"),
        `function createRestrictedProcess(api, options, commandLine, creationFlags, startupInfo, processInfo) {
  return api.createProcessAsUserW(
    options.token, null, commandLine, null, null, 1, creationFlags, null,
    options.cwd, startupInfo, processInfo
  );
}
function spawnConfigured(api, options) {
  const startupInfo = {};
  encodeStartupInfo(startupInfo, {
    dwFlags: 0x100,
    hStdInput: null,
    hStdOutput: null,
    hStdError: null,
  });
  return createRestrictedProcess(
    api, options, "configured.exe", 0, startupInfo, {}
  );
}
function spawnUnconfigured(api, options) {
  return createRestrictedProcess(
    api, options, "unconfigured.exe", 0, {}, {}
  );
}
`,
      );

      await assert.rejects(
        hardenHarnessWindowsRestrictedLaunches(runtimeRoot),
        /2 createRestrictedProcess call\(s\) but 1 STARTUPINFOW configuration/u,
      );
    },
  );
});

test("restricted launch hardening rejects drift before changing any bundle", async () => {
  await withProcessPolicyFixture(
    {
      aclBundles: [
        {
          name: "types-A-valid.js",
          showWindow: undefined,
          startupFlags: 0x100,
        },
        {
          name: "types-Z-drifted.js",
          showWindow: undefined,
          startupFlags: "flags",
        },
      ],
      launchSource: `const { spawnSync } = require("child_process");
spawnSync("probe.exe", [], { windowsHide: true });
`,
    },
    async (runtimeRoot, [validPath]) => {
      const before = await readFile(validPath, "utf8");
      await assert.rejects(
        hardenHarnessWindowsRestrictedLaunches(runtimeRoot),
        /dwFlags must statically include STARTF_USESTDHANDLES/u,
      );
      assert.equal(await readFile(validPath, "utf8"), before);
    },
  );
});

test("restricted launch hardening rejects a runtime with no ACL launch sites", async () => {
  await withProcessPolicyFixture(
    {
      aclBundles: [],
      launchSource: `import { spawn } from "node:child_process";
spawn("probe.exe", [], { windowsHide: true });
`,
    },
    async (runtimeRoot) => {
      await assert.rejects(
        hardenHarnessWindowsRestrictedLaunches(runtimeRoot),
        /has no CreateProcessAsUserW launch sites/u,
      );
    },
  );
});
