import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  DATA_HOME_CHOOSE_DIRECTORY_CHANNEL,
  DATA_HOME_MIGRATION_PLAN_CHANNEL,
  DATA_HOME_MIGRATION_SCHEDULE_CHANNEL,
  DATA_HOME_SETTINGS_READ_CHANNEL,
} from "@minke/harness-overlay/data-home-contract.ts";
import {
  buildDshChildEnvironment,
  DataHomeManager,
  recommendedMinkeDshHome,
  resolveDshHomePath,
} from "@minke/desktop/main/data-home.ts";
import {
  bindDataHomeSettingsIpc,
} from "@minke/desktop/main/data-home-settings.ts";
import {
  mergeDataHomes,
  planDataHomeMerge,
} from "@minke/desktop/main/data-home-migration.ts";
import {
  PluginInstallationRuntime,
} from "@minke/desktop/main/plugin-installation.ts";
import {
  MinkeConfigStore,
} from "@minke/desktop/main/minke-config.ts";
import {
  desktopDataHomeSettingsPort,
  shouldExposeDesktopDataHomeSettings,
} from "@minke/harness-overlay/client/desktop/index.ts";
import {
  dataHomeEn,
  dataHomeZh,
} from "@minke/harness-overlay/client/data-home/locales.ts";
import {
  DataHomeSettingsRuntime,
} from "@minke/harness-overlay/client/data-home/runtime.ts";

const roots = [];

async function temporaryRoot(prefix = "minke-data-home-") {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true });
    }),
  );
});

test("Minke resolves one stable DSH home and child environment", () => {
  const home = join(tmpdir(), "minke-home-contract");
  const userData = join(home, ".minke");
  assert.equal(
    recommendedMinkeDshHome(userData),
    join(userData, "harness"),
  );
  assert.equal(
    resolveDshHomePath(undefined, {
      DSH_HOME: join(home, "custom-dsh"),
    }, home),
    join(home, "custom-dsh"),
  );
  assert.equal(
    resolveDshHomePath(undefined, {}, home),
    join(home, ".dsh"),
  );
  assert.equal(
    resolveDshHomePath("~/portable-dsh", {}, home),
    join(home, "portable-dsh"),
  );
  assert.deepEqual(
    buildDshChildEnvironment(join(home, "active"), {
      DSH_HOME: join(home, "stale"),
      PATH: "/usr/bin",
    }),
    {
      DSH_HOME: join(home, "active"),
      PATH: "/usr/bin",
    },
  );
});

test("initial active home inherits DSH while retaining existing Minke data", async () => {
  const home = await temporaryRoot("minke-data-home-precedence-");
  const userData = join(home, ".minke");
  const environmentHome = join(home, "custom-dsh");
  const recommended = join(userData, "harness");
  const config = new MinkeConfigStore(userData);

  const environmentManager = new DataHomeManager({
    userDataPath: userData,
    homeDirectory: home,
    environment: { DSH_HOME: environmentHome },
    configuration: config.dshHome,
  });
  assert.equal(
    await environmentManager.activePath(),
    environmentHome,
  );

  const defaultManager = new DataHomeManager({
    userDataPath: userData,
    homeDirectory: home,
    environment: {},
    configuration: config.dshHome,
  });
  assert.equal(
    await defaultManager.activePath(),
    join(home, ".dsh"),
  );
  assert.deepEqual(
    (
      await defaultManager.read()
    ).candidates.find(
      ({ path }) => path === join(home, ".dsh"),
    )?.origins,
    ["active", "default"],
  );

  await mkdir(recommended, { recursive: true });
  assert.equal(
    await defaultManager.activePath(),
    recommended,
  );

  await config.dshHome.write(join(home, "pinned-dsh"));
  assert.equal(
    await environmentManager.activePath(),
    join(home, "pinned-dsh"),
  );
});

test("data-home merge copies unique files, deduplicates equals, and preserves conflicts", async () => {
  const root = await temporaryRoot();
  const sourceA = join(root, "source-a");
  const sourceB = join(root, "source-b");
  const target = join(root, "target");
  await Promise.all([
    mkdir(join(sourceA, "sessions", "a"), { recursive: true }),
    mkdir(join(sourceB, "sessions", "b"), { recursive: true }),
    mkdir(target, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(sourceA, "sessions", "a", "session.jsonl"),
      "session-a\n",
    ),
    writeFile(
      join(sourceB, "sessions", "b", "session.jsonl"),
      "session-b\n",
    ),
    writeFile(join(sourceA, "same.txt"), "same\n"),
    writeFile(join(sourceB, "same.txt"), "same\n"),
    writeFile(join(target, "same.txt"), "same\n"),
    writeFile(join(sourceA, "conflict.txt"), "source-a\n"),
    writeFile(join(sourceB, "conflict.txt"), "source-b\n"),
    writeFile(join(target, "conflict.txt"), "target\n"),
  ]);

  const plan = await planDataHomeMerge(
    [sourceA, sourceB],
    target,
  );
  assert.equal(plan.copyFiles, 2);
  assert.equal(plan.identicalFiles, 2);
  assert.equal(plan.conflictFiles, 2);
  assert.deepEqual(plan.conflicts, [
    join(sourceA, "conflict.txt"),
    join(sourceB, "conflict.txt"),
  ]);

  const report = await mergeDataHomes(
    [sourceA, sourceB],
    target,
  );
  assert.equal(report.copiedFiles, 2);
  assert.equal(report.identicalFiles, 2);
  assert.equal(report.conflictFiles, 2);
  assert.equal(
    await readFile(
      join(target, "sessions", "a", "session.jsonl"),
      "utf8",
    ),
    "session-a\n",
  );
  assert.equal(
    await readFile(
      join(target, "sessions", "b", "session.jsonl"),
      "utf8",
    ),
    "session-b\n",
  );
  assert.equal(
    await readFile(join(target, "conflict.txt"), "utf8"),
    "target\n",
  );

  const repeated = await mergeDataHomes(
    [sourceA, sourceB],
    target,
  );
  assert.equal(repeated.copiedFiles, 0);
  assert.equal(repeated.identicalFiles, 4);
  assert.equal(repeated.conflictFiles, 2);
});

test("data-home merge reconciles profile and storage metadata", async () => {
  const root = await temporaryRoot("minke-data-home-structured-");
  const source = join(root, "source");
  const target = join(root, "target");
  const sharedWorkspacePath = join(root, "workspace-shared");
  const sourceWorkspacePath = join(root, "workspace-source");
  const targetWorkspacePath = join(root, "workspace-target");
  await Promise.all([
    mkdir(join(source, "profiles", "web"), { recursive: true }),
    mkdir(join(source, "storages"), { recursive: true }),
    mkdir(join(target, "profiles", "web"), { recursive: true }),
    mkdir(
      join(
        target,
        "profiles",
        "web",
        "node_modules",
        "dsh-example-plugin",
      ),
      { recursive: true },
    ),
    mkdir(join(target, "storages"), { recursive: true }),
    mkdir(sharedWorkspacePath),
    mkdir(sourceWorkspacePath),
    mkdir(targetWorkspacePath),
  ]);

  const profile = (dependencies, bundles) => ({
    name: "dsh-profile-web",
    private: true,
    dependencies,
    dsh: { profile: { bundles } },
  });
  const projectionCache = (sessions) => ({
    unit: { name: "session_projcache", version: 3 },
    global: null,
    tables: { sessions },
  });
  const workspaceStorage = ({
    workspaceIds,
    archivedSessionIds,
    workspaces,
  }) => ({
    unit: { name: "workspace", version: 2 },
    global: {
      initialized: true,
      workspaceIds,
      archivedSessionIds,
    },
    tables: { workspaces },
  });
  const workspace = (path, title, sessionIds, updatedAt) => ({
    path,
    title,
    sessionIds,
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt,
  });

  await Promise.all([
    writeFile(
      join(source, "profiles", "web", "package.json"),
      `${JSON.stringify(
        profile(
          { "dsh-example-plugin": "^1.0.0" },
          ["@deepseek-ai/dsh-base", "dsh-example-plugin"],
        ),
        null,
        2,
      )}\n`,
    ),
    writeFile(
      join(target, "profiles", "web", "package.json"),
      `${JSON.stringify(
        profile({}, ["@deepseek-ai/dsh-base"]),
        null,
        2,
      )}\n`,
    ),
    writeFile(
      join(
        target,
        "profiles",
        "web",
        "node_modules",
        "dsh-example-plugin",
        "package.json",
      ),
      `${JSON.stringify({
        name: "dsh-example-plugin",
        version: "1.0.0",
      })}\n`,
    ),
    writeFile(
      join(source, "storages", "session_projcache.json"),
      `${JSON.stringify(
        projectionCache({
          "session-source": {
            identity: { createdAt: 1, cwd: sourceWorkspacePath },
            rows: {},
          },
        }),
        null,
        2,
      )}\n`,
    ),
    writeFile(
      join(target, "storages", "session_projcache.json"),
      `${JSON.stringify(
        projectionCache({
          "session-target": {
            identity: { createdAt: 2, cwd: targetWorkspacePath },
            rows: {},
          },
        }),
        null,
        2,
      )}\n`,
    ),
    writeFile(
      join(source, "storages", "workspace.json"),
      `${JSON.stringify(
        workspaceStorage({
          workspaceIds: ["source-shared", "source-only"],
          archivedSessionIds: ["archived-source"],
          workspaces: {
            "source-shared": workspace(
              sharedWorkspacePath,
              "Source shared",
              ["session-source"],
              "2026-08-20T01:00:00.000Z",
            ),
            "source-only": workspace(
              sourceWorkspacePath,
              "Source only",
              [],
              "2026-08-20T02:00:00.000Z",
            ),
          },
        }),
        null,
        2,
      )}\n`,
    ),
    writeFile(
      join(target, "storages", "workspace.json"),
      `${JSON.stringify(
        workspaceStorage({
          workspaceIds: ["target-shared", "target-only"],
          archivedSessionIds: ["archived-target"],
          workspaces: {
            "target-shared": workspace(
              sharedWorkspacePath,
              "Target shared",
              ["session-target"],
              "2026-08-20T03:00:00.000Z",
            ),
            "target-only": workspace(
              targetWorkspacePath,
              "Target only",
              [],
              "2026-08-20T04:00:00.000Z",
            ),
          },
        }),
        null,
        2,
      )}\n`,
    ),
  ]);

  const plan = await planDataHomeMerge([source], target);
  assert.equal(plan.copyFiles, 3);
  assert.equal(plan.conflictFiles, 0);

  const report = await mergeDataHomes([source], target);
  assert.equal(report.copiedFiles, 3);
  assert.equal(report.conflictFiles, 0);

  const mergedProfile = JSON.parse(
    await readFile(
      join(target, "profiles", "web", "package.json"),
      "utf8",
    ),
  );
  assert.deepEqual(mergedProfile.dependencies, {
    "dsh-example-plugin": "^1.0.0",
  });
  assert.deepEqual(mergedProfile.dsh.profile.bundles, [
    "@deepseek-ai/dsh-base",
    "dsh-example-plugin",
  ]);
  const installed = await new PluginInstallationRuntime({
    runtimeRoot: join(root, "unused-runtime"),
    dshHome: target,
    electronExecutable: process.execPath,
  }).listInstalled();
  assert.deepEqual(
    installed.plugins.map(({ name, state }) => ({ name, state })),
    [{ name: "dsh-example-plugin", state: "ready" }],
  );

  const mergedCache = JSON.parse(
    await readFile(
      join(target, "storages", "session_projcache.json"),
      "utf8",
    ),
  );
  assert.deepEqual(
    Object.keys(mergedCache.tables.sessions).sort(),
    ["session-source", "session-target"],
  );

  const mergedWorkspace = JSON.parse(
    await readFile(
      join(target, "storages", "workspace.json"),
      "utf8",
    ),
  );
  assert.deepEqual(mergedWorkspace.global.workspaceIds, [
    "target-shared",
    "target-only",
    "source-only",
  ]);
  assert.deepEqual(mergedWorkspace.global.archivedSessionIds, [
    "archived-target",
    "archived-source",
  ]);
  assert.deepEqual(
    mergedWorkspace.tables.workspaces["target-shared"].sessionIds,
    ["session-target", "session-source"],
  );
  assert.equal(
    mergedWorkspace.tables.workspaces["target-shared"].title,
    "Target shared",
  );
  assert.equal(
    mergedWorkspace.tables.workspaces["source-only"].path,
    sourceWorkspacePath,
  );
  assert.equal(
    mergedWorkspace.tables.workspaces["source-shared"],
    undefined,
  );

  const repeated = await mergeDataHomes([source], target);
  assert.equal(repeated.copiedFiles, 0);
  assert.equal(repeated.conflictFiles, 0);
});

test(
  "data-home migration supports symlinked DSH roots",
  { skip: process.platform === "win32" },
  async () => {
    const root = await temporaryRoot("minke-data-home-links-");
    const source = join(root, "source");
    const sourceAlias = join(root, "source-alias");
    const target = join(root, "target");
    const targetAlias = join(root, "target-alias");
    await Promise.all([
      mkdir(source, { recursive: true }),
      mkdir(target, { recursive: true }),
    ]);
    await writeFile(join(source, "plugin.json"), "plugin\n");
    await symlink(source, sourceAlias);
    await symlink(target, targetAlias);

    const report = await mergeDataHomes(
      [sourceAlias],
      targetAlias,
    );
    assert.equal(report.copiedFiles, 1);
    assert.equal(
      await readFile(join(target, "plugin.json"), "utf8"),
      "plugin\n",
    );

    const containedTarget = join(source, "nested-target");
    const containedAlias = join(root, "contained-alias");
    await mkdir(containedTarget);
    await symlink(containedTarget, containedAlias);
    await assert.rejects(
      planDataHomeMerge([source], containedAlias),
      /must not contain one another/u,
    );
  },
);

test("scheduled migration switches config only after the restart-time merge succeeds", async () => {
  const home = await temporaryRoot("minke-data-home-manager-");
  const userData = join(home, ".minke");
  const recommended = join(userData, "harness");
  const defaultHome = join(home, ".dsh");
  const environmentHome = join(home, "environment-dsh");
  await Promise.all([
    mkdir(recommended, { recursive: true }),
    mkdir(defaultHome, { recursive: true }),
    mkdir(environmentHome, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(recommended, "minke.txt"), "minke\n"),
    writeFile(join(defaultHome, "default.txt"), "default\n"),
    writeFile(
      join(environmentHome, "environment.txt"),
      "environment\n",
    ),
  ]);
  const config = new MinkeConfigStore(userData);
  let restarts = 0;
  const manager = new DataHomeManager({
    userDataPath: userData,
    homeDirectory: home,
    environment: {
      DSH_HOME: environmentHome,
    },
    configuration: config.dshHome,
    restart: () => {
      restarts += 1;
    },
  });

  const snapshot = await manager.read();
  assert.equal(snapshot.activePath, environmentHome);
  assert.equal(snapshot.recommendedPath, recommended);
  assert.deepEqual(
    snapshot.candidates.map(({ path }) => path).sort(),
    [recommended, defaultHome, environmentHome].sort(),
  );

  const plan = await manager.plan({
    mode: "merge",
    targetPath: recommended,
  });
  assert.equal(plan.mode, "merge");
  assert.deepEqual(
    plan.sourcePaths.sort(),
    [defaultHome, environmentHome].sort(),
  );
  const scheduled = await manager.schedule({
    mode: "merge",
    targetPath: recommended,
    riskAccepted: true,
  });
  assert.equal(scheduled.scheduled, true);
  assert.equal(restarts, 1);
  assert.equal(await config.dshHome.read(), undefined);

  const completed = await manager.completePendingMigration();
  assert.equal(completed?.status, "completed");
  assert.equal(await config.dshHome.read(), recommended);
  assert.equal(
    await readFile(join(recommended, "default.txt"), "utf8"),
    "default\n",
  );
  assert.equal(
    await readFile(join(recommended, "environment.txt"), "utf8"),
    "environment\n",
  );
  assert.equal(
    (await manager.read()).lastMigration?.status,
    "completed",
  );
});

test("fresh data-home activation leaves existing data behind", async () => {
  const home = await temporaryRoot("minke-data-home-fresh-");
  const userData = join(home, ".minke");
  const defaultHome = join(home, ".dsh");
  const freshTarget = join(home, "fresh-dsh");
  const occupiedTarget = join(home, "occupied-dsh");
  await Promise.all([
    mkdir(defaultHome, { recursive: true }),
    mkdir(occupiedTarget, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(defaultHome, "session.jsonl"), "session\n"),
    writeFile(join(defaultHome, "plugins.json"), "plugins\n"),
    writeFile(join(occupiedTarget, "existing.txt"), "occupied\n"),
  ]);
  const config = new MinkeConfigStore(userData);
  let restarts = 0;
  const manager = new DataHomeManager({
    userDataPath: userData,
    homeDirectory: home,
    environment: {},
    configuration: config.dshHome,
    restart: () => {
      restarts += 1;
    },
  });

  await assert.rejects(
    manager.plan({
      mode: "fresh",
      targetPath: occupiedTarget,
    }),
    /must be empty/u,
  );

  const plan = await manager.plan({
    mode: "fresh",
    targetPath: freshTarget,
  });
  assert.equal(plan.mode, "fresh");
  assert.deepEqual(plan.sourcePaths, []);
  assert.equal(plan.copyFiles, 0);

  await manager.schedule({
    mode: "fresh",
    targetPath: freshTarget,
    riskAccepted: true,
  });
  assert.equal(restarts, 1);
  assert.equal(await config.dshHome.read(), undefined);

  const completed = await manager.completePendingMigration();
  assert.equal(completed?.status, "completed");
  assert.equal(completed?.mode, "fresh");
  assert.equal(await config.dshHome.read(), freshTarget);
  await assert.rejects(
    readFile(join(freshTarget, "session.jsonl"), "utf8"),
    /ENOENT/u,
  );
  assert.equal(
    await readFile(join(defaultHome, "session.jsonl"), "utf8"),
    "session\n",
  );
});

test("legacy pending data-home journals resume as merge migrations", async () => {
  const home = await temporaryRoot("minke-data-home-legacy-");
  const userData = join(home, ".minke");
  const defaultHome = join(home, ".dsh");
  const target = join(home, "legacy-target");
  const journalPath = join(
    userData,
    "desktop",
    "data-home-migration.json",
  );
  await Promise.all([
    mkdir(defaultHome, { recursive: true }),
    mkdir(join(userData, "desktop"), { recursive: true }),
  ]);
  await writeFile(join(defaultHome, "session.jsonl"), "legacy\n");
  await writeFile(
    journalPath,
    `${JSON.stringify({
      version: 1,
      request: {
        targetPath: target,
        sourcePaths: [defaultHome],
      },
      state: {
        status: "pending",
        targetPath: target,
        copiedFiles: 0,
        copiedBytes: 0,
        identicalFiles: 0,
        conflictFiles: 0,
        conflicts: [],
        updatedAt: "2026-08-19T00:00:00.000Z",
      },
    })}\n`,
  );
  const config = new MinkeConfigStore(userData);
  const manager = new DataHomeManager({
    userDataPath: userData,
    homeDirectory: home,
    environment: {},
    configuration: config.dshHome,
  });

  const completed = await manager.completePendingMigration();
  assert.equal(completed?.status, "completed");
  assert.equal(completed?.mode, "merge");
  assert.equal(await config.dshHome.read(), target);
  assert.equal(
    await readFile(join(target, "session.jsonl"), "utf8"),
    "legacy\n",
  );
});

test("failed restart-time migration preserves the previous active configuration", async () => {
  const home = await temporaryRoot("minke-data-home-failure-");
  const userData = join(home, ".minke");
  const defaultHome = join(home, ".dsh");
  const blockedTarget = join(home, "blocked-target");
  await mkdir(defaultHome, { recursive: true });
  await writeFile(join(defaultHome, "session.jsonl"), "data\n");
  const config = new MinkeConfigStore(userData);
  const manager = new DataHomeManager({
    userDataPath: userData,
    homeDirectory: home,
    environment: {},
    configuration: config.dshHome,
  });

  await manager.schedule({
    mode: "merge",
    targetPath: blockedTarget,
    riskAccepted: true,
  });
  await writeFile(blockedTarget, "not a directory\n");

  const failed = await manager.completePendingMigration();
  assert.equal(failed?.status, "failed");
  assert.equal(await config.dshHome.read(), undefined);
  assert.equal(await manager.activePath(), defaultHome);
  assert.match(failed?.error ?? "", /target must be a directory/u);
});

test("a corrupt migration receipt does not prevent Settings or startup recovery", async () => {
  const home = await temporaryRoot("minke-data-home-corrupt-");
  const userData = join(home, ".minke");
  const config = new MinkeConfigStore(userData);
  await mkdir(join(userData, "desktop"), { recursive: true });
  await writeFile(
    join(userData, "desktop", "data-home-migration.json"),
    "{not-json",
  );
  const manager = new DataHomeManager({
    userDataPath: userData,
    homeDirectory: home,
    environment: {},
    configuration: config.dshHome,
  });

  assert.equal(
    (await manager.completePendingMigration())?.status,
    "failed",
  );
  const snapshot = await manager.read();
  assert.equal(snapshot.activePath, join(home, ".dsh"));
  assert.equal(snapshot.lastMigration?.status, "failed");
});

test("data-home Settings IPC authorizes all read, picker, plan, and schedule operations", async () => {
  const handlers = new Map();
  const calls = [];
  const snapshot = {
    activePath: "/active",
    recommendedPath: "/recommended",
    candidates: [],
  };
  const binding = bindDataHomeSettingsIpc(
    {
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
      removeHandler(channel) {
        handlers.delete(channel);
      },
    },
    {
      async read() {
        calls.push(["read"]);
        return snapshot;
      },
      async chooseDirectory() {
        calls.push(["choose"]);
        return "/chosen";
      },
      async plan(request) {
        calls.push(["plan", request]);
        return {
          mode: request.mode,
          targetPath: request.targetPath,
          sourcePaths: ["/source"],
          copyFiles: 1,
          copyBytes: 7,
          identicalFiles: 0,
          conflictFiles: 0,
          conflicts: [],
        };
      },
      async schedule(request) {
        calls.push(["schedule", request]);
        return {
          scheduled: true,
          targetPath: request.targetPath,
        };
      },
    },
    (event) => event === "allowed",
  );

  assert.deepEqual(
    await handlers.get(DATA_HOME_SETTINGS_READ_CHANNEL)("allowed"),
    snapshot,
  );
  assert.equal(
    await handlers.get(DATA_HOME_CHOOSE_DIRECTORY_CHANNEL)("allowed"),
    "/chosen",
  );
  assert.equal(
    (
      await handlers.get(DATA_HOME_MIGRATION_PLAN_CHANNEL)(
        "allowed",
        { mode: "merge", targetPath: "/target" },
      )
    ).copyFiles,
    1,
  );
  assert.deepEqual(
    await handlers.get(DATA_HOME_MIGRATION_SCHEDULE_CHANNEL)(
      "allowed",
      {
        mode: "merge",
        targetPath: "/target",
        riskAccepted: true,
      },
    ),
    {
      scheduled: true,
      targetPath: "/target",
    },
  );
  await assert.rejects(
    handlers.get(DATA_HOME_SETTINGS_READ_CHANNEL)("denied"),
    /unauthorized/u,
  );
  assert.deepEqual(calls, [
    ["read"],
    ["choose"],
    ["plan", { mode: "merge", targetPath: "/target" }],
    [
      "schedule",
      {
        mode: "merge",
        targetPath: "/target",
        riskAccepted: true,
      },
    ],
  ]);

  binding.dispose();
  binding.dispose();
  assert.equal(handlers.size, 0);
});

test("data-home Settings bridge and runtime expose the migration workflow", async () => {
  assert.deepEqual(
    Object.keys(dataHomeEn).sort(),
    Object.keys(dataHomeZh).sort(),
  );
  const calls = [];
  const snapshot = {
    activePath: "/active",
    recommendedPath: "/recommended",
    candidates: [
      {
        path: "/active",
        origins: ["active", "minke"],
        fileCount: 2,
        byteCount: 12,
      },
    ],
  };
  const port = desktopDataHomeSettingsPort({
    minkeDesktop: {
      dataHome: {
        async read() {
          return snapshot;
        },
        async chooseDirectory() {
          return "/chosen";
        },
        async plan(request) {
          calls.push(["plan", request]);
          return {
            mode: request.mode,
            targetPath: request.targetPath,
            sourcePaths: ["/active"],
            copyFiles: 2,
            copyBytes: 12,
            identicalFiles: 0,
            conflictFiles: 0,
            conflicts: [],
          };
        },
        async schedule(request) {
          calls.push(["schedule", request]);
          return {
            scheduled: true,
            targetPath: request.targetPath,
          };
        },
      },
    },
  });
  const runtime = new DataHomeSettingsRuntime(port);
  await runtime.initialize();
  assert.equal(runtime.getSnapshot().data?.activePath, "/active");
  assert.equal(await runtime.chooseDirectory(), "/chosen");
  await runtime.preview("/recommended", "merge");
  assert.equal(runtime.getSnapshot().plan?.copyFiles, 2);
  await runtime.schedule("/different", "merge");
  assert.equal(runtime.getSnapshot().error, "schedule");

  await runtime.schedule("/recommended", "merge");
  assert.equal(runtime.getSnapshot().scheduled, true);
  await runtime.preview("/fresh", "fresh");
  assert.equal(runtime.getSnapshot().plan?.mode, "fresh");
  await runtime.schedule("/fresh", "fresh");
  assert.equal(runtime.getSnapshot().scheduled, true);
  assert.deepEqual(calls, [
    ["plan", { mode: "merge", targetPath: "/recommended" }],
    [
      "schedule",
      {
        mode: "merge",
        targetPath: "/recommended",
        riskAccepted: true,
      },
    ],
    ["plan", { mode: "fresh", targetPath: "/fresh" }],
    [
      "schedule",
      {
        mode: "fresh",
        targetPath: "/fresh",
        riskAccepted: true,
      },
    ],
  ]);
  runtime.dispose();
});

test("data-home Settings stays discoverable with an older desktop preload", async () => {
  const olderDesktopWindow = {
    minkeDesktop: {
      surface: { kind: "macos" },
    },
  };
  const port = desktopDataHomeSettingsPort(olderDesktopWindow);

  assert.equal(port.available, false);
  assert.equal(
    shouldExposeDesktopDataHomeSettings(olderDesktopWindow),
    true,
  );

  const runtime = new DataHomeSettingsRuntime(port);
  await runtime.initialize();
  assert.equal(runtime.getSnapshot().error, "unavailable");
  runtime.dispose();
});
