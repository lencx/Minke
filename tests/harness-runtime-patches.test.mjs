import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

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

test("the background-process patch does not pin generated ACL bundle hashes", async () => {
  const source = await readFile(
    join(
      repositoryRoot,
      "patches",
      "deepseek-harness",
      "windows-background-processes.patch",
    ),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /dsh-sandbox-windows-acl\/lib\/types-/u,
  );
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
      async (runtimeRoot, aclPaths) => {
        const first =
          await hardenHarnessWindowsRestrictedLaunches(runtimeRoot);
        assert.deepEqual(first, {
          changedLaunches: bundleNames.length,
          files: bundleNames.length,
          launches: bundleNames.length,
        });
        for (const aclPath of aclPaths) {
          const source = normalizeLineEndings(
            await readFile(aclPath, "utf8"),
          );
          assert.match(source, /dwFlags: 257,/u);
          assert.match(source, /wShowWindow: 0,/u);
        }
        await verifyHarnessRuntimeProcessPolicy(runtimeRoot);

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
