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
        runtimeSizeBudgetBytes: 230686720,
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
    "packages/client/web-react/src/scoped-slots.tsx",
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
});

test("the Harness contract rejects source patch configuration", async () => {
  const { commit, projectRoot } = fixture();
  writeContract(projectRoot, commit, { patches: ["forbidden.patch"] });

  await assert.rejects(
    verifyHarnessContract(projectRoot),
    /source patches are forbidden/u,
  );
});

test("the Harness contract requires an explicit runtime size budget", async () => {
  const { commit, projectRoot } = fixture();
  writeContract(projectRoot, commit, { runtimeSizeBudgetBytes: 0 });

  await assert.rejects(
    verifyHarnessContract(projectRoot),
    /positive integer runtimeSizeBudgetBytes/u,
  );
});

test("the Harness contract rejects a missing locale change seam", async () => {
  const { projectRoot } = fixture({ localeChange: false });

  await assert.rejects(
    verifyHarnessContract(projectRoot),
    /locale change event changed/u,
  );
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
