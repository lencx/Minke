import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";
import { verifyHarnessContract } from "@@/scripts/harness/contract.mjs";

const fixtures = [];

function write(root, path, contents) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function git(root, ...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

function writeContract(projectRoot, commit, additions = {}) {
  write(
    projectRoot,
    "config/harness-runtime.json",
    `${JSON.stringify(
      {
        submodulePath: "vendor/deepseek-harness",
        commit,
        packageName: "@deepseek-ai/dsh",
        packageVersion: "1.0.0",
        frontendPackageName: "@deepseek-ai/dsh-web-frontend",
        runtimeSizeBudgetBytes: {
          darwin: 157286400,
          linux: 268435456,
          win32: 268435456,
        },
        runtimeFileBudget: 20000,
        patches: [
          "patches/deepseek-harness/fixture.patch",
        ],
        productBundle: {
          packageName: "@lencx/minke-harness-overlay",
          packagePath: "packages/harness-overlay",
          patch: "cordis.patch.yml",
        },
        ...additions,
      },
      null,
      2,
    )}\n`,
  );
}

function fixture(options = {}) {
  const projectRoot = mkdtempSync(
    join(tmpdir(), "minke-harness-contract-"),
  );
  fixtures.push(projectRoot);
  const harnessRoot = join(projectRoot, "vendor", "deepseek-harness");
  mkdirSync(harnessRoot, { recursive: true });
  git(harnessRoot, "init", "--quiet");

  write(
    harnessRoot,
    "apps/cli/package.json",
    '{"name":"@deepseek-ai/dsh","version":"1.0.0"}\n',
  );
  write(
    harnessRoot,
    "apps/web/package.json",
    '{"name":"@deepseek-ai/dsh-web-frontend"}\n',
  );
  write(harnessRoot, "apps/cli/src/plugin.ts", "spawnSync('pnpm')\n");
  write(
    harnessRoot,
    "apps/cli/src/args.ts",
    ".option('--patch <path>')\n",
  );
  write(
    harnessRoot,
    "apps/cli/src/profile-boot.ts",
    "loadOverlayPatches(NAME, resolve(file))\n",
  );
  write(
    harnessRoot,
    "packages/bundle/web-app/src/startup.ts",
    "// pass 0 to let the OS pick a free one\n",
  );
  write(
    harnessRoot,
    "packages/client/ui-settings/src/client/contract/slots.ts",
    "'settings.section'\n",
  );
  write(
    harnessRoot,
    "packages/client/modules/src/index.ts",
    options.bootManifestGlobalName === false
      ? "{ kind: 'global', name: '__DSH_START__', value: graph }\n"
      : "{ kind: 'global', name: '__DSH_BOOT__', value: graph }\n",
  );
  write(
    harnessRoot,
    "packages/client/ui-settings-plugins/src/client/slot-contract.ts",
    `'settings.plugin.item': { kind: '${
      options.settingsPluginItemKind ?? "keyed"
    }'; scope: 'root'; owner: SettingsPluginItemOwnerProps }\n`,
  );
  write(
    harnessRoot,
    "packages/host/apiproxy/src/api-proxy.ts",
    [
      ...(options.settingsNotExposed === true
        ? ["settings-not-exposed"]
        : []),
      ...(options.exposeAllSettings === false
        ? [
          "namespaces: settings.describe({ redactSecrets: true })",
          "  .filter(descriptor => exposed.has(String(descriptor.ns)))",
          "  .map(namespaceView),",
        ]
        : [
            "namespaces: settings.describe({ redactSecrets: true }).map(namespaceView),",
          ]),
      "",
    ].join("\n"),
  );
  write(
    harnessRoot,
    "packages/host/webserver/src/injections.ts",
    options.structuredBootGlobal === false
      ? "return { placement: 'head', markup: `<script>window.__DSH_BOOT__ = ${value}</script>` }\n"
      : "return { placement: 'head', markup: `<script>globalThis[${name}] = ${value}</script>` }\n",
  );
  write(
    harnessRoot,
    "packages/host/webserver/src/index.ts",
    options.structuredIndexPipeline === false
      ? "return renderIndexInjections(this.applyIndexTaps(html), this.collectIndexInjections())\n"
      : "return this.applyIndexTaps(renderIndexInjections(html, this.collectIndexInjections()))\n",
  );
  write(
    harnessRoot,
    "packages/host/frontend-static/src/index.ts",
    options.frontendRenderIndex === false
      ? "await readFile(distIndex, 'utf8')\n"
      : "ctx.webServer.renderIndex(await readFile(distIndex, 'utf8'))\n",
  );
  write(
    harnessRoot,
    "packages/llm/llm/src/types.ts",
    options.replayEnvelope === false
      ? "replayState?: unknown\n"
      : [
          "export interface ReplayEnvelope { response: unknown }",
          "replayState?: ReplayEnvelope",
          "",
        ].join("\n"),
  );
  write(
    harnessRoot,
    "packages/attachment/attachment/src/index.ts",
    options.batchImages === false
      ? "abstract saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>\n"
      : "async saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]> {}\n",
  );
  write(
    harnessRoot,
    "packages/llm/llm-deepseek/src/index.ts",
    options.deepSeekLowEffort === false
      ? "reasoningEffort?: 'off' | 'high' | 'max'\n"
      : "reasoningEffort?: 'off' | 'low' | 'high' | 'max'\n",
  );
  write(
    harnessRoot,
    "packages/client/ui-settings-general/src/client/SettingsRoot.tsx",
    '<button aria-haspopup="dialog" aria-expanded={open} />\n',
  );
  write(
    harnessRoot,
    "packages/client/ui-sidebar/src/client/index.ts",
    "ctx.workspaces.startSession(workspaceId)\n",
  );
  write(
    harnessRoot,
    "packages/client/locale/src/client/index.ts",
    [
      "register<N extends keyof LocaleNamespaceMap",
      "ctx.slots.installLocale(locale)",
      "getSnapshot(): LocaleSnapshot",
      ...(options.localeChange === false
        ? []
        : ["'locale/change'(snapshot: LocaleSnapshot)"]),
      "",
    ].join("\n"),
  );
  write(
    harnessRoot,
    "packages/client/ui-renderer/src/client/scoped-slots.tsx",
    [
      "kit['t'] = localeSeat(face, entry.locale)",
      "useLocaleRevision(host.locale)",
      "",
    ].join("\n"),
  );
  write(
    harnessRoot,
    "packages/client/ui-theme/src/client/index.ts",
    [
      "'theme/change'(snapshot: ThemeSnapshot)",
      "ctx.provide('theme', theme)",
      "",
    ].join("\n"),
  );
  write(
    harnessRoot,
    "packages/client/ui-layout/src/client/theme-presenter.ts",
    "document.documentElement.style.colorScheme = scheme\n",
  );
  write(
    harnessRoot,
    "packages/client/ui-layout/src/client/AppFrame.tsx",
    "<div data-shell-overlay />\n",
  );
  write(
    harnessRoot,
    "packages/workspace/workspace/src/spec.ts",
    [
      "export const workspaceDomainSpec = defineDomain({",
      "  name: 'workspace',",
      `  version: ${String(options.workspaceVersion ?? 2)},`,
      "})",
      "",
    ].join("\n"),
  );
  write(
    harnessRoot,
    "packages/credentials/credentials-local/src/index.ts",
    [
      "export const CREDENTIALS_FILENAME = '.credentials.yaml'",
      `export const DOCUMENT_VERSION = ${String(
        options.credentialsDocumentVersion ?? 1
      )}`,
      "",
    ].join("\n"),
  );
  git(harnessRoot, "add", ".");
  git(
    harnessRoot,
    "-c",
    "user.name=Minke Test",
    "-c",
    "user.email=minke@example.test",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  );
  const commit = git(harnessRoot, "rev-parse", "HEAD");

  write(
    projectRoot,
    "patches/deepseek-harness/fixture.patch",
    [
      "diff --git a/node_modules/@deepseek-ai/example/lib/index.js b/node_modules/@deepseek-ai/example/lib/index.js",
      "--- a/node_modules/@deepseek-ai/example/lib/index.js",
      "+++ b/node_modules/@deepseek-ai/example/lib/index.js",
      "@@ -1 +1 @@",
      "-export const mode = \"upstream\";",
      "+export const mode = \"minke\";",
      "",
    ].join("\n"),
  );
  write(
    projectRoot,
    "packages/harness-overlay/package.json",
    `${JSON.stringify({
      name: "@lencx/minke-harness-overlay",
      version: "1.0.0",
      dsh: {
        bundle: { patch: "./cordis.patch.yml" },
        client: { platform: "web" },
      },
    })}\n`,
  );
  write(
    projectRoot,
    "packages/harness-overlay/cordis.patch.yml",
    "- insert:\n    - id: minke-overlay\n      name: '@lencx/minke-harness-overlay'\n",
  );
  writeContract(projectRoot, commit);
  return { commit, harnessRoot, projectRoot };
}

afterEach(() => {
  for (const root of fixtures.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the Harness contract accepts a clean pin plus an external bundle", async () => {
  const { projectRoot } = fixture();
  const verified = await verifyHarnessContract(projectRoot);

  assert.equal(
    verified.productBundle.bundle.packageName,
    "@lencx/minke-harness-overlay",
  );
  assert.deepEqual(
    verified.runtimePatches.map((patch) => patch.path),
    ["patches/deepseek-harness/fixture.patch"],
  );
});

test("the product bundle composes declared Minke runtime packages", async () => {
  const { commit, projectRoot } = fixture();
  write(
    projectRoot,
    "packages/harness-overlay/package.json",
    `${JSON.stringify({
      name: "@lencx/minke-harness-overlay",
      version: "1.0.0",
      dsh: {
        bundle: { patch: "./cordis.patch.yml" },
        client: { platform: "web" },
      },
      dependencies: {
        "@lencx/minke-model-runtime": "workspace:*",
      },
    })}\n`,
  );
  write(
    projectRoot,
    "packages/harness-overlay/cordis.patch.yml",
    [
      "- insert:",
      "    - id: model-runtime",
      "      name: '@lencx/minke-model-runtime/dsh'",
      "    - id: minke-overlay",
      "      name: '@lencx/minke-harness-overlay'",
      "",
    ].join("\n"),
  );
  write(
    projectRoot,
    "packages/model-runtime/package.json",
    `${JSON.stringify({
      name: "@lencx/minke-model-runtime",
      version: "1.0.0",
      exports: {
        "./dsh": {
          default: "./lib/dsh.js",
        },
      },
    })}\n`,
  );
  writeContract(projectRoot, commit, {
    productBundle: {
      packageName: "@lencx/minke-harness-overlay",
      packagePath: "packages/harness-overlay",
      patch: "cordis.patch.yml",
      workspaceRuntimePackages: [
        {
          packageName: "@lencx/minke-model-runtime",
          packagePath: "packages/model-runtime",
        },
      ],
    },
  });

  const verified = await verifyHarnessContract(projectRoot);

  assert.deepEqual(
    verified.productBundle.workspaceRuntimePackages.map(
      ({ packageName, packagePath }) => ({
        packageName,
        packagePath,
      }),
    ),
    [
      {
        packageName: "@lencx/minke-model-runtime",
        packagePath: "packages/model-runtime",
      },
    ],
  );
});

test("the Harness contract requires an explicit local runtime patch", async () => {
  const { commit, projectRoot } = fixture();
  writeContract(projectRoot, commit, { patches: [] });

  await assert.rejects(
    verifyHarnessContract(projectRoot),
    /at least one local runtime patch/u,
  );
});

test("the Harness contract requires a runtime size budget for every desktop platform", async () => {
  const { commit, projectRoot } = fixture();
  writeContract(projectRoot, commit, {
    runtimeSizeBudgetBytes: {
      darwin: 157286400,
      win32: 268435456,
    },
  });

  await assert.rejects(
    verifyHarnessContract(projectRoot),
    /positive integer runtimeSizeBudgetBytes\.linux/u,
  );
});

test("the Harness contract requires an explicit runtime file budget", async () => {
  const { commit, projectRoot } = fixture();
  writeContract(projectRoot, commit, { runtimeFileBudget: 0 });

  await assert.rejects(
    verifyHarnessContract(projectRoot),
    /positive integer runtimeFileBudget/u,
  );
});

test("the Harness contract rejects a missing locale change seam", async () => {
  const { projectRoot } = fixture({ localeChange: false });

  await assert.rejects(
    verifyHarnessContract(projectRoot),
    /locale change event changed/u,
  );
});

test("the Harness contract rejects the pre-rc.7 list settings-card API", async () => {
  const { projectRoot } = fixture({
    settingsPluginItemKind: "list",
  });

  await assert.rejects(
    verifyHarnessContract(projectRoot),
    /keyed plugin settings-card API changed/u,
  );
});

test("the Harness contract rejects the pre-rc.7 settings exposure boundary", async () => {
  const { projectRoot } = fixture({ exposeAllSettings: false });

  await assert.rejects(
    verifyHarnessContract(projectRoot),
    /settings namespace exposure changed/u,
  );
});

test("the Harness contract rejects the retired settings-not-exposed error", async () => {
  const { projectRoot } = fixture({ settingsNotExposed: true });

  await assert.rejects(
    verifyHarnessContract(projectRoot),
    /settings-not-exposed RPC contract returned/u,
  );
});

test("the Harness contract rejects a changed structured boot-global serializer", async () => {
  const { projectRoot } = fixture({ structuredBootGlobal: false });

  await assert.rejects(
    verifyHarnessContract(projectRoot),
    /structured boot-global serializer changed/u,
  );
});

test("the Harness contract rejects a renamed boot-manifest global", async () => {
  const { projectRoot } = fixture({ bootManifestGlobalName: false });

  await assert.rejects(
    verifyHarnessContract(projectRoot),
    /boot-manifest global changed/u,
  );
});

test("the Harness contract rejects reversed structured-index and raw-tap ordering", async () => {
  const { projectRoot } = fixture({ structuredIndexPipeline: false });

  await assert.rejects(
    verifyHarnessContract(projectRoot),
    /structured index pipeline changed/u,
  );
});

test("the Harness contract requires frontend-static to use the shared index renderer", async () => {
  const { projectRoot } = fixture({ frontendRenderIndex: false });

  await assert.rejects(
    verifyHarnessContract(projectRoot),
    /frontend index rendering changed/u,
  );
});

test("the Harness contract rejects the pre-rc.7 replay-state API", async () => {
  const { projectRoot } = fixture({ replayEnvelope: false });

  await assert.rejects(
    verifyHarnessContract(projectRoot),
    /LLM ReplayEnvelope API changed/u,
  );
});

test("the Harness contract requires durable batch-image attachments", async () => {
  const { projectRoot } = fixture({ batchImages: false });

  await assert.rejects(
    verifyHarnessContract(projectRoot),
    /batch image attachment API changed/u,
  );
});

test("the Harness contract requires DeepSeek low reasoning effort", async () => {
  const { projectRoot } = fixture({ deepSeekLowEffort: false });

  await assert.rejects(
    verifyHarnessContract(projectRoot),
    /DeepSeek low reasoning-effort API changed/u,
  );
});

test("the Harness contract gates authoritative Data Home formats", async () => {
  for (const [
    options,
    expected,
  ] of [
    [
      { workspaceVersion: 3 },
      /workspace storage format changed/u,
    ],
    [
      { credentialsDocumentVersion: 2 },
      /credentials document version changed/u,
    ],
  ]) {
    const { projectRoot } = fixture(options);
    await assert.rejects(
      verifyHarnessContract(projectRoot),
      expected,
    );
  }
});

test("the product extension contract enforces the @lencx scope", async () => {
  const { commit, projectRoot } = fixture();
  writeContract(projectRoot, commit, {
    productBundle: {
      packageName: "@minke/harness-overlay",
      packagePath: "packages/harness-overlay",
      patch: "cordis.patch.yml",
    },
  });

  await assert.rejects(
    verifyHarnessContract(projectRoot),
    /must use the @lencx scope/u,
  );
});

test("the product extension only stages Harness packages it composes", async () => {
  const { commit, projectRoot } = fixture();
  writeContract(projectRoot, commit, {
    productBundle: {
      packageName: "@lencx/minke-harness-overlay",
      packagePath: "packages/harness-overlay",
      patch: "cordis.patch.yml",
      runtimePackages: ["@deepseek-ai/dsh-subagent-codex"],
    },
  });

  await assert.rejects(
    verifyHarnessContract(projectRoot),
    /does not compose runtime package @deepseek-ai\/dsh-subagent-codex/u,
  );
});

test("the Harness contract rejects tracked source modifications", async () => {
  const { harnessRoot, projectRoot } = fixture();
  write(
    harnessRoot,
    "apps/cli/src/plugin.ts",
    "spawnSync('pnpm')\nexport const changed = true\n",
  );

  await assert.rejects(
    verifyHarnessContract(projectRoot),
    /apps\/cli\/src\/plugin\.ts/u,
  );
});

test("the Harness contract rejects untracked source modifications", async () => {
  const { harnessRoot, projectRoot } = fixture();
  write(harnessRoot, "unexpected.ts", "export const unexpected = true\n");

  await assert.rejects(
    verifyHarnessContract(projectRoot),
    /unexpected\.ts/u,
  );
});
