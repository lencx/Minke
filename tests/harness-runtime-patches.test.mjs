import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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

function inspectSubagentModelRoutePatch(source) {
  const additionsByTarget = new Map();
  let target;
  for (
    const line of normalizeLineEndings(source).split("\n")
  ) {
    if (line.startsWith("+++ b/")) {
      target = line.slice("+++ b/".length);
      additionsByTarget.set(target, []);
      continue;
    }
    if (
      target === undefined ||
      !line.startsWith("+") ||
      line.startsWith("+++")
    ) {
      continue;
    }
    additionsByTarget.get(target)?.push(line.slice(1).trim());
  }
  const additions = [...additionsByTarget.values()].flat();
  const count = (statement) =>
    additions.filter((line) => line === statement).length;
  const targets = [...additionsByTarget.keys()];
  return {
    childModelReads: count(
      "const agentModel = childAgentOptions.model;",
    ),
    childOptionsDeclarations: count(
      "const childAgentOptions = resolveChildAgentOptions(" +
        "parent, request.agentOptions, childDepth);",
    ),
    childOptionsUses: count(
      "agentOptions: childAgentOptions,",
    ),
    childProviderReads: count(
      "const agentProvider = childAgentOptions.provider;",
    ),
    outOfProcessTargets: targets.filter((candidate) =>
      /dsh-subagent-(?:codex|claude-code|dsh-sdk)/u.test(
        candidate,
      )
    ),
    parentModelFallbacks: count(
      "const parentModel = parentRequest?.model ?? " +
        "parent.options.model;",
    ),
    parentProviderFallbacks: count(
      "const parentProvider = parentRequest?.provider ?? " +
        "parent.options.provider;",
    ),
    parentRequestConfigReads: count(
      "const parentRequest = " +
        "parent.session.requestHeader()?.config;",
    ),
    targets,
  };
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
    patch.targets.some((target) =>
      target.startsWith(
        "node_modules/@deepseek-ai/dsh-sandbox-windows-acl/",
      ),
    ),
    false,
  );
});

test("the subagent model-route patch stays within in-process routing bundles", async () => {
  const [patch] = await resolveHarnessRuntimePatches(
    repositoryRoot,
    [
      "patches/deepseek-harness/subagent-effective-model-route.patch",
    ],
  );
  assert.deepEqual(patch.targets, [
    "node_modules/@deepseek-ai/dsh-subagent/lib/index.js",
    "node_modules/@deepseek-ai/dsh-subagent-in-process-driver/lib/index.js",
  ]);

  const source = await readFile(patch.absolutePath, "utf8");
  assert.deepEqual(
    inspectSubagentModelRoutePatch(source),
    {
      childModelReads: 1,
      childOptionsDeclarations: 2,
      childOptionsUses: 2,
      childProviderReads: 1,
      outOfProcessTargets: [],
      parentModelFallbacks: 1,
      parentProviderFallbacks: 1,
      parentRequestConfigReads: 1,
      targets: [
        "node_modules/@deepseek-ai/dsh-subagent/lib/index.js",
        "node_modules/@deepseek-ai/dsh-subagent-in-process-driver/lib/index.js",
      ],
    },
  );
});

test("the Windows picker worker keeps IPC open until its terminal result", async () => {
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
function decode(value, offsetOrType, maybeType) {
  if (maybeType === "void *") {
    return { owner: value.owner, slot: offsetOrType / 8 };
  }
  if (offsetOrType === "void *") {
    return Buffer.isBuffer(value) ? dialog : { owner: value };
  }
  throw new Error("unexpected fake koffi decode");
}
decode.string16 = () => "C:\\\\picked";
module.exports = {
  call(fn, _prototype, _self, ...args) {
    if (fn.slot === 20) args[0][0] = item;
    if (fn.slot === 5) args[1][0] = { kind: "name" };
    return 0;
  },
  decode,
  load() {
    return {
      func(_abi, symbol) {
        if (symbol === "GetCurrentThreadId") return () => 4242;
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
        { kind: "done", path: "C:\\picked" },
      ],
      "win32 folder dialog worker exited before reporting a result",
    );
  });
});

async function withProcessPolicyFixture(
  {
    aclBundles,
    launchExtension = ".js",
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
    "node_modules",
    "@deepseek-ai",
    "example",
    "lib",
    `index${launchExtension}`,
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
