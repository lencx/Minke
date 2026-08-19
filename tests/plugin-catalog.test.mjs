import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  PluginCatalogService,
  pluginCatalogCacheFilePath,
} from "@lencx/minke-plugin-catalog";
import {
  PLUGIN_CATALOG_CANCEL_CHANNEL,
  PLUGIN_CATALOG_INSTALL_CHANNEL,
  PLUGIN_CATALOG_READ_CHANNEL,
  PLUGIN_CATALOG_REFRESH_CHANNEL,
  PLUGIN_CATALOG_TOKEN_CLEAR_CHANNEL,
  PLUGIN_CATALOG_TOKEN_SET_CHANNEL,
} from "@minke/desktop/plugin-catalog-contract.ts";
import {
  parsePluginCatalogSnapshot,
} from "@lencx/minke-plugin-catalog/contract";
import {
  bindPluginCatalogIpc,
} from "@minke/desktop/main/plugin-catalog.ts";
import {
  EncryptedGitHubTokenStore,
  pluginCatalogCredentialFilePath,
} from "@minke/desktop/main/plugin-catalog-credential.ts";
import {
  PluginCatalogInstallationRuntime,
} from "@minke/desktop/main/plugin-catalog-installation.ts";
import {
  desktopPluginCatalogPort,
} from "@minke/harness-overlay/client/desktop/workspace.ts";
import {
  PluginCatalogTabsController,
} from "@minke/harness-overlay/client/tabs/plugins/controller.ts";
import {
  pluginCatalogEn,
} from "@minke/harness-overlay/client/tabs/plugins/locales.ts";
import {
  PLUGIN_DISCOVERY_TOPIC_URL,
} from "@minke/harness-overlay/client/tabs/plugins/resources.ts";
import {
  TabsRuntime,
} from "@minke/harness-overlay/client/tabs/runtime.ts";
import {
  WebTabsController,
} from "@minke/harness-overlay/client/tabs/web/controller.ts";

const roots = [];

async function temporaryRoot() {
  const root = await mkdtemp(
    join(tmpdir(), "minke-plugin-catalog-"),
  );
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })
    ),
  );
});

function json(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-ratelimit-remaining": "4999",
      ...init.headers,
    },
    ...init,
  });
}

function pluginTranslate(key, params = {}) {
  return Object.entries(params).reduce(
    (value, [name, replacement]) =>
      value.replaceAll(`{${name}}`, String(replacement)),
    pluginCatalogEn[key],
  );
}

function pluginSnapshot(overrides = {}) {
  return {
    version: 2,
    generatedAt: "2026-08-19T00:00:00.000Z",
    lastRefreshAt: "2026-08-19T00:00:00.000Z",
    lastFullScanAt: "2026-08-19T00:00:00.000Z",
    refreshing: false,
    counts: {
      repositories: 1,
      pendingRepositories: 0,
      plugins: 1,
    },
    plugins: [
      {
        id: "minke-labs/useful-plugin",
        repository: "minke-labs/useful-plugin",
        repositoryUrl:
          "https://github.com/minke-labs/useful-plugin",
        packagePath: "",
        packageName: "useful-plugin",
        version: "1.2.3",
        description: "Useful local tools",
        topics: ["dsh-plugin", "local-tools"],
        language: "TypeScript",
        stars: 25,
        pushedAt: "2026-08-18T00:00:00Z",
        installSpec: "github:minke-labs/useful-plugin",
        installVerification: "verified",
        requiresBuildAllowance: false,
        installed: false,
      },
    ],
    candidates: [],
    credential: {
      configured: false,
      writable: true,
    },
    ...overrides,
  };
}

function secureStorage(available = true) {
  const transform = (input) =>
    Buffer.from(input).map((value) => value ^ 0xa5);
  return {
    isEncryptionAvailable() {
      return available;
    },
    encryptString(value) {
      return transform(Buffer.from(value, "utf8"));
    },
    decryptString(value) {
      return transform(value).toString("utf8");
    },
  };
}

function repository() {
  return {
    id: 42,
    full_name: "minke-labs/useful-plugin",
    html_url: "https://github.com/minke-labs/useful-plugin",
    description: "Useful local tools",
    topics: ["dsh-plugin", "local-tools"],
    language: "TypeScript",
    stargazers_count: 25,
    pushed_at: "2026-08-18T00:00:00Z",
    default_branch: "main",
    fork: false,
    archived: false,
    disabled: false,
    owner: { login: "minke-labs" },
  };
}

function candidateRepository(index) {
  const suffix = String(index).padStart(3, "0");
  return {
    ...repository(),
    id: 1_000 + index,
    full_name: `minke-labs/candidate-${suffix}`,
    html_url:
      `https://github.com/minke-labs/candidate-${suffix}`,
    description: `Candidate repository ${suffix}`,
    stargazers_count: index,
  };
}

function catalogFetcher() {
  const calls = [];
  let discoveryRound = 0;
  const manifests = new Map([
    [
      "manifest-root",
      {
        name: "useful-plugin",
        version: "1.2.3",
        description: "Root plugin",
        main: "./dist/index.js",
        dsh: {
          bundle: { patch: "./cordis.patch.yml" },
        },
      },
    ],
    [
      "manifest-nested",
      {
        name: "@minke-labs/nested-plugin",
        version: "2.0.0",
        description: "Nested plugin",
        dsh: {
          bundle: { patch: "./cordis.patch.yml" },
        },
      },
    ],
  ]);

  return {
    calls,
    async fetch(input) {
      const url = new URL(input);
      calls.push(url);
      if (url.pathname === "/search/repositories") {
        const query = url.searchParams.get("q") ?? "";
        if (query.includes("created:2008-01-01")) {
          discoveryRound += 1;
          return json({
            total_count: discoveryRound === 1 ? 1 : 0,
            incomplete_results: false,
            items: discoveryRound === 1 ? [repository()] : [],
          });
        }
        return json({
          total_count: 0,
          incomplete_results: false,
          items: [],
        });
      }
      if (
        url.pathname ===
          "/repos/minke-labs/useful-plugin/git/trees/main" ||
        url.pathname ===
          "/repos/minke-labs/useful-plugin/git/trees/tree-1"
      ) {
        return json({
          sha: "tree-1",
          truncated: false,
          tree: [
            {
              path: "package.json",
              mode: "100644",
              type: "blob",
              sha: "manifest-root",
            },
            {
              path: "cordis.patch.yml",
              mode: "100644",
              type: "blob",
              sha: "patch-root",
            },
            {
              path: "dist/index.js",
              mode: "100644",
              type: "blob",
              sha: "entry-root",
            },
            {
              path: "packages/nested/package.json",
              mode: "100644",
              type: "blob",
              sha: "manifest-nested",
            },
            {
              path: "packages/nested/cordis.patch.yml",
              mode: "100644",
              type: "blob",
              sha: "patch-nested",
            },
          ],
        });
      }
      const blob = url.pathname.match(/\/git\/blobs\/([^/]+)$/u)?.[1];
      if (blob && manifests.has(blob)) {
        return json({
          encoding: "base64",
          content: Buffer.from(
            JSON.stringify(manifests.get(blob)),
          ).toString("base64"),
        });
      }
      return json(
        { message: "not found" },
        { status: 404 },
      );
    },
  };
}

test("the catalog exposes a bounded, ranked list of pending candidates", async () => {
  const userDataPath = await temporaryRoot();
  const repositories = Array.from(
    { length: 205 },
    (_, index) => candidateRepository(index),
  );
  const catalog = new PluginCatalogService({
    userDataPath,
    token: "test-token",
    repositoryBudget: 0,
    searchPaceMs: 0,
    fetcher: async (input) => {
      const url = new URL(input);
      assert.equal(url.pathname, "/search/repositories");
      const page = Number(url.searchParams.get("page"));
      const start = (page - 1) * 100;
      return json({
        total_count: repositories.length,
        incomplete_results: false,
        items: repositories.slice(start, start + 100),
      });
    },
  });

  const snapshot = await catalog.refresh();
  assert.deepEqual(snapshot.counts, {
    repositories: 205,
    pendingRepositories: 205,
    plugins: 0,
  });
  assert.equal(snapshot.candidates.length, 200);
  assert.deepEqual(
    snapshot.candidates.slice(0, 3).map(
      ({ repository: name, stars }) => ({ name, stars }),
    ),
    [
      { name: "minke-labs/candidate-204", stars: 204 },
      { name: "minke-labs/candidate-203", stars: 203 },
      { name: "minke-labs/candidate-202", stars: 202 },
    ],
  );
  assert.equal(
    snapshot.candidates.at(-1).repository,
    "minke-labs/candidate-005",
  );
  assert.equal(
    snapshot.candidates.some(
      (candidate) => "installSpec" in candidate,
    ),
    false,
  );
  catalog.dispose();
});

test("the local catalog resumes monorepo validation and reloads its cache", async () => {
  const userDataPath = await temporaryRoot();
  const remote = catalogFetcher();
  let now = new Date("2026-08-19T00:00:00.000Z");
  const catalog = new PluginCatalogService({
    userDataPath,
    token: "test-token",
    fetcher: remote.fetch,
    now: () => new Date(now),
    delay: async () => {},
    searchPaceMs: 0,
    repositoryBudget: 1,
    manifestBudget: 1,
  });

  const first = await catalog.refresh();
  assert.equal(first.refreshing, false);
  assert.deepEqual(first.counts, {
    repositories: 1,
    pendingRepositories: 1,
    plugins: 0,
  });
  assert.deepEqual(first.plugins, []);

  now = new Date("2026-08-19T01:00:00.000Z");
  const second = await catalog.refresh();
  assert.deepEqual(second.counts, {
    repositories: 1,
    pendingRepositories: 0,
    plugins: 2,
  });
  assert.deepEqual(
    second.plugins.map(({ id }) => id).sort(),
    [
      "minke-labs/useful-plugin",
      "minke-labs/useful-plugin/packages/nested",
    ],
  );
  assert.equal(
    second.plugins.find(({ packagePath }) => packagePath === "")
      .installVerification,
    "verified",
  );
  assert.equal(
    second.plugins.find(({ packagePath }) =>
      packagePath === "packages/nested"
    ).installSpec,
    "github:minke-labs/useful-plugin#path:packages/nested",
  );
  assert.equal(
    remote.calls.filter(({ pathname }) =>
      pathname.endsWith("/git/trees/tree-1")
    ).length,
    1,
  );

  const cachePath = pluginCatalogCacheFilePath(userDataPath);
  const cached = JSON.parse(await readFile(cachePath, "utf8"));
  assert.equal(cached.version, 1);
  if (process.platform !== "win32") {
    assert.equal((await stat(cachePath)).mode & 0o777, 0o600);
  }

  const offline = new PluginCatalogService({
    userDataPath,
    token: "test-token",
    fetcher: async () => {
      throw new Error("network must not be used by read");
    },
  });
  assert.deepEqual(
    (await offline.read()).plugins,
    second.plugins,
  );
  catalog.dispose();
  offline.dispose();
});

test("only validated prebuilt catalog entries can be installed", async () => {
  const userDataPath = await temporaryRoot();
  const remote = catalogFetcher();
  const installedPackageNames = new Set();
  const installs = [];
  const catalog = new PluginCatalogService({
    userDataPath,
    token: "test-token",
    fetcher: remote.fetch,
    delay: async () => {},
    searchPaceMs: 0,
    repositoryBudget: 1,
    manifestBudget: 10,
    installation: {
      async listInstalledPackageNames() {
        return [...installedPackageNames];
      },
      async install(installSpec) {
        installs.push(installSpec);
        installedPackageNames.add("useful-plugin");
      },
    },
  });

  const discovered = await catalog.refresh();
  const plugin = discovered.plugins.find(
    ({ id }) => id === "minke-labs/useful-plugin",
  );
  assert.equal(plugin.installed, false);

  const installed = await catalog.install(plugin.id);
  assert.deepEqual(installs, [
    "github:minke-labs/useful-plugin",
  ]);
  assert.equal(
    installed.plugins.find(({ id }) => id === plugin.id).installed,
    true,
  );

  await catalog.install(plugin.id);
  assert.equal(installs.length, 1);
  await assert.rejects(
    catalog.install("minke-labs/not-in-the-catalog"),
    /not found/u,
  );
  catalog.dispose();
});

test("a completed full scan retires repositories that lost discovery eligibility", async () => {
  const userDataPath = await temporaryRoot();
  const remote = catalogFetcher();
  let now = new Date("2026-08-19T00:00:00.000Z");
  const catalog = new PluginCatalogService({
    userDataPath,
    token: "test-token",
    fetcher: remote.fetch,
    now: () => new Date(now),
    delay: async () => {},
    searchPaceMs: 0,
    fullScanIntervalMs: 1_000,
    repositoryBudget: 1,
    manifestBudget: 10,
  });

  assert.equal((await catalog.refresh()).counts.plugins, 2);
  now = new Date("2026-08-19T00:00:02.000Z");
  const reconciled = await catalog.refresh();
  assert.deepEqual(reconciled.counts, {
    repositories: 0,
    pendingRepositories: 0,
    plugins: 0,
  });
  catalog.dispose();
});

test("discovery fails closed when a search window cannot be split safely", async () => {
  const userDataPath = await temporaryRoot();
  const catalog = new PluginCatalogService({
    userDataPath,
    token: "test-token",
    now: () => new Date("2008-01-01T00:00:00.000Z"),
    delay: async () => {},
    searchPaceMs: 0,
    logger: {
      error() {},
      warn() {},
    },
    fetcher: async () =>
      json({
        total_count: 900,
        incomplete_results: false,
        items: [],
      }),
  });

  const snapshot = await catalog.refresh();
  assert.match(snapshot.error, /without truncation/u);
  assert.deepEqual(snapshot.counts, {
    repositories: 0,
    pendingRepositories: 0,
    plugins: 0,
  });
  catalog.dispose();
});

test("rate-limited validation leaves candidates pending and reports the failed sync", async () => {
  const userDataPath = await temporaryRoot();
  let requests = 0;
  const catalog = new PluginCatalogService({
    userDataPath,
    token: "",
    now: () => new Date("2026-08-19T00:00:00.000Z"),
    delay: async () => {},
    searchPaceMs: 0,
    logger: {
      error() {},
      warn() {},
    },
    fetcher: async (url) => {
      requests += 1;
      if (url.includes("/search/repositories?")) {
        return json({
          total_count: 1,
          incomplete_results: false,
          items: [repository()],
        });
      }
      return new Response(
        JSON.stringify({ message: "rate limit exceeded" }),
        {
          status: 403,
          headers: {
            "content-type": "application/json",
            "x-ratelimit-remaining": "0",
          },
        },
      );
    },
  });

  const snapshot = await catalog.refresh();
  assert.equal(snapshot.lastRefreshAt, null);
  assert.match(snapshot.error, /rate limit reached/u);
  assert.deepEqual(snapshot.counts, {
    repositories: 1,
    pendingRepositories: 1,
    plugins: 0,
  });
  assert.deepEqual(snapshot.candidates, [
    {
      id: "minke-labs/useful-plugin",
      repository: "minke-labs/useful-plugin",
      repositoryUrl:
        "https://github.com/minke-labs/useful-plugin",
      description: "Useful local tools",
      topics: ["dsh-plugin", "local-tools"],
      language: "TypeScript",
      stars: 25,
      pushedAt: "2026-08-18T00:00:00Z",
      status: "error",
    },
  ]);
  assert.equal(requests, 2);
  catalog.dispose();
});

test(
  "a hung catalog request times out and clears the syncing state",
  { timeout: 500 },
  async () => {
    const userDataPath = await temporaryRoot();
    const catalog = new PluginCatalogService({
      userDataPath,
      token: "test-token",
      requestTimeoutMs: 20,
      searchPaceMs: 0,
      logger: {
        error() {},
        warn() {},
      },
      fetcher: async (_url, init = {}) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(init.signal.reason),
            { once: true },
          );
        }),
    });

    const snapshot = await catalog.refresh();
    assert.equal(snapshot.refreshing, false);
    assert.match(snapshot.error, /timed out/u);
    catalog.dispose();
  },
);

test(
  "an active catalog refresh can be cancelled",
  { timeout: 500 },
  async () => {
    const userDataPath = await temporaryRoot();
    let markFetchStarted;
    let hangRequest = true;
    const fetchStarted = new Promise((resolve) => {
      markFetchStarted = resolve;
    });
    const catalog = new PluginCatalogService({
      userDataPath,
      token: "test-token",
      requestTimeoutMs: 60_000,
      searchPaceMs: 0,
      fetcher: async (_url, init = {}) => {
        if (!hangRequest) {
          return json({
            total_count: 0,
            incomplete_results: false,
            items: [],
          });
        }
        markFetchStarted();
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(init.signal.reason),
            { once: true },
          );
        });
      },
    });

    const refresh = catalog.refresh();
    await fetchStarted;
    catalog.cancelRefresh();
    const snapshot = await refresh;
    assert.equal(snapshot.refreshing, false);
    assert.equal(snapshot.error, undefined);
    hangRequest = false;
    const resumed = await catalog.refresh();
    assert.equal(resumed.refreshing, false);
    assert.equal(resumed.error, undefined);
    catalog.dispose();
  },
);

test("GitHub tokens are value-free on reads and encrypted at rest", async () => {
  const userDataPath = await temporaryRoot();
  const token = "github_pat_minke_test_token_123";
  const store = new EncryptedGitHubTokenStore({
    userDataPath,
    environment: {},
    secureStorage: secureStorage(),
  });

  assert.deepEqual(await store.describe(), {
    configured: false,
    writable: true,
  });
  await store.set(token);
  assert.deepEqual(await store.describe(), {
    configured: true,
    writable: true,
    source: "secure-storage",
  });
  assert.equal(await store.resolve(), token);

  const credentialPath =
    pluginCatalogCredentialFilePath(userDataPath);
  const persisted = await readFile(credentialPath, "utf8");
  assert.doesNotMatch(persisted, new RegExp(token, "u"));
  assert.deepEqual(Object.keys(JSON.parse(persisted)).sort(), [
    "encryptedToken",
    "version",
  ]);
  assert.doesNotMatch(
    JSON.stringify(await store.describe()),
    new RegExp(token, "u"),
  );
  if (process.platform !== "win32") {
    assert.equal(
      (await stat(credentialPath)).mode & 0o777,
      0o600,
    );
  }

  const lockedStore = new EncryptedGitHubTokenStore({
    userDataPath,
    environment: {},
    secureStorage: secureStorage(false),
  });
  assert.deepEqual(await lockedStore.describe(), {
    configured: true,
    writable: false,
    source: "secure-storage",
  });
  await assert.rejects(
    lockedStore.resolve(),
    /secure storage is unavailable/u,
  );
  await lockedStore.unset();
  assert.deepEqual(await lockedStore.describe(), {
    configured: false,
    writable: false,
  });

  const inherited = new EncryptedGitHubTokenStore({
    userDataPath,
    environment: { GITHUB_TOKEN: token },
    secureStorage: secureStorage(),
  });
  assert.deepEqual(await inherited.describe(), {
    configured: true,
    writable: false,
    source: "environment",
  });
  assert.equal(await inherited.resolve(), token);
  await assert.rejects(
    inherited.set("github_pat_replacement"),
    /comes from the environment/u,
  );
});

test("a saved GitHub token is applied to the next scan without a restart", async () => {
  const userDataPath = await temporaryRoot();
  const token = "github_pat_hot_update_123";
  const store = new EncryptedGitHubTokenStore({
    userDataPath,
    environment: {},
    secureStorage: secureStorage(),
  });
  let expectedAuthorization = `Bearer ${token}`;
  const authorizations = [];
  const catalog = new PluginCatalogService({
    userDataPath,
    credentialProvider: store,
    searchPaceMs: 0,
    fetcher: async (_input, init = {}) => {
      const authorization =
        new Headers(init.headers).get("authorization");
      authorizations.push(authorization);
      assert.equal(authorization, expectedAuthorization);
      return json({
        total_count: 0,
        incomplete_results: false,
        items: [],
      });
    },
  });

  const saved = await catalog.saveGitHubToken(token);
  assert.deepEqual(saved.credential, {
    configured: true,
    writable: true,
    source: "secure-storage",
  });
  assert.doesNotMatch(
    JSON.stringify(saved),
    new RegExp(token, "u"),
  );
  await catalog.refresh();
  assert.ok(authorizations.length > 0);

  expectedAuthorization = null;
  const cleared = await catalog.clearGitHubToken();
  assert.deepEqual(cleared.credential, {
    configured: false,
    writable: true,
  });
  const authenticatedRequestCount = authorizations.length;
  await catalog.refresh();
  assert.ok(authorizations.length > authenticatedRequestCount);
  catalog.dispose();
});

test("the installation runtime uses the bundled command without a shell", async () => {
  const root = await temporaryRoot();
  const dshHome = join(root, "dsh-home");
  const profileDirectory = join(
    dshHome,
    "profiles",
    "web",
  );
  await mkdir(profileDirectory, { recursive: true });
  await writeFile(
    join(profileDirectory, "package.json"),
    JSON.stringify({
      dependencies: {
        "useful-plugin": "github:minke-labs/useful-plugin",
        "@minke/nested": "github:minke-labs/nested#path:plugin",
      },
    }),
  );
  const layout = {
    entryPath: join(root, "runtime", "index.mjs"),
    pnpmEntry: join(root, "runtime", "pnpm.cjs"),
    productPackageName: "@minke/runtime",
    productPatch: join(root, "runtime", "product.yml"),
    runtimeBin: join(root, "runtime", "bin"),
  };
  const commands = [];
  const installation = new PluginCatalogInstallationRuntime({
    runtimeRoot: join(root, "runtime"),
    dshHome,
    electronExecutable: join(root, "Minke"),
    environment: {
      PATH: "/usr/bin",
      DSH_ELECTRON_EXECUTABLE: "ambient-electron",
      DSH_PNPM_ENTRY: "ambient-pnpm",
    },
    readRuntimeLayout: async () => layout,
    runCommand: async (command, args, options) => {
      commands.push({ command, args, options });
    },
  });

  assert.deepEqual(
    (await installation.listInstalledPackageNames()).sort(),
    ["@minke/nested", "useful-plugin"],
  );
  await installation.install(
    "github:minke-labs/useful-plugin#path:packages/plugin",
  );
  assert.equal(commands.length, 1);
  assert.equal(commands[0].command, join(root, "Minke"));
  assert.deepEqual(commands[0].args, [
    "--expose-internals",
    layout.entryPath,
    "plugin",
    "--profile",
    "web",
    "add",
    "github:minke-labs/useful-plugin#path:packages/plugin",
  ]);
  assert.equal(commands[0].options.cwd, dshHome);
  assert.equal(commands[0].options.env.DSH_HOME, dshHome);
  assert.equal(
    commands[0].options.env.ELECTRON_RUN_AS_NODE,
    "1",
  );
  assert.equal(
    commands[0].options.env.MINKE_NODE_EXECUTABLE,
    join(root, "Minke"),
  );
  assert.equal(
    commands[0].options.env.MINKE_PNPM_ENTRY,
    layout.pnpmEntry,
  );
  assert.equal(
    commands[0].options.env.DSH_ELECTRON_EXECUTABLE,
    undefined,
  );
  assert.equal(
    commands[0].options.env.DSH_PNPM_ENTRY,
    undefined,
  );
  assert.match(
    commands[0].options.env.PATH,
    new RegExp(layout.runtimeBin.replaceAll("/", "\\/"), "u"),
  );
  await assert.rejects(
    installation.install("https://example.com/plugin"),
    /invalid plugin catalog install specification/u,
  );
});

test("the desktop catalog port validates snapshots from the preload bridge", async () => {
  const snapshot = pluginSnapshot();
  let refreshes = 0;
  let cancellations = 0;
  const installs = [];
  const tokens = [];
  let tokenClears = 0;
  const port = desktopPluginCatalogPort({
    minkeDesktop: {
      pluginCatalog: {
        async read() {
          return snapshot;
        },
        async refresh() {
          refreshes += 1;
          return snapshot;
        },
        async cancel() {
          cancellations += 1;
          return snapshot;
        },
        async install(pluginId) {
          installs.push(pluginId);
          return snapshot;
        },
        async setToken(token) {
          tokens.push(token);
          return snapshot;
        },
        async clearToken() {
          tokenClears += 1;
          return snapshot;
        },
      },
    },
  });

  assert.equal(port.available, true);
  assert.deepEqual(await port.read(), snapshot);
  assert.deepEqual(await port.refresh(), snapshot);
  assert.deepEqual(await port.cancel(), snapshot);
  assert.deepEqual(
    await port.install("minke-labs/useful-plugin"),
    snapshot,
  );
  assert.deepEqual(
    await port.setToken("github_pat_renderer_test"),
    snapshot,
  );
  assert.deepEqual(await port.clearToken(), snapshot);
  assert.equal(refreshes, 1);
  assert.equal(cancellations, 1);
  assert.deepEqual(installs, ["minke-labs/useful-plugin"]);
  assert.deepEqual(tokens, ["github_pat_renderer_test"]);
  assert.equal(tokenClears, 1);

  const unavailable = desktopPluginCatalogPort({});
  assert.equal(unavailable.available, false);
  await assert.rejects(
    unavailable.read(),
    /bridge is unavailable/u,
  );
});

test("the Plugins menu opens a local catalog with sync and in-app GitHub tabs", async () => {
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const snapshot = pluginSnapshot();
  const external = [];
  let reads = 0;
  let refreshes = 0;
  let cancellations = 0;
  let installs = 0;
  let tokenSaves = 0;
  let tokenClears = 0;
  const webTabs = new WebTabsController(tabs, {
    openExternal(url) {
      external.push(url);
    },
  });
  const controller = new PluginCatalogTabsController(
    tabs,
    {
      available: true,
      async read() {
        reads += 1;
        return snapshot;
      },
      async refresh() {
        refreshes += 1;
        return snapshot;
      },
      async cancel() {
        cancellations += 1;
        return snapshot;
      },
      async install() {
        installs += 1;
        return snapshot;
      },
      async setToken() {
        tokenSaves += 1;
        return snapshot;
      },
      async clearToken() {
        tokenClears += 1;
        return snapshot;
      },
    },
    webTabs,
  );
  const tabId = controller.create("Plugins");
  await new Promise((resolve) => setImmediate(resolve));

  const tab = tabs.getSnapshot().tabs[0];
  assert.equal(tab.id, tabId);
  assert.equal(tab.kind, "plugin-catalog");
  assert.equal(tab.payload.snapshot.plugins.length, 1);
  assert.equal(reads, 1);
  assert.equal(
    controller.create("Plugins"),
    tab.id,
  );
  assert.equal(tabs.getSnapshot().tabs.length, 1);

  await controller.refresh(tab.id);
  assert.equal(refreshes, 1);
  await controller.cancel(tab.id);
  assert.equal(cancellations, 1);
  await controller.install(
    tab.id,
    "minke-labs/useful-plugin",
  );
  assert.equal(installs, 1);
  await controller.clearToken(tab.id);
  assert.equal(tokenClears, 1);
  await controller.saveToken(
    tab.id,
    "github_pat_controller_test",
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(tokenSaves, 1);
  assert.equal(refreshes, 2);
  controller.openDiscoveryResource();
  controller.openRepository(
    "https://github.com/minke-labs/useful-plugin",
    "minke-labs/useful-plugin",
  );
  controller.openRepository("https://example.com/not-allowed");
  assert.deepEqual(external, []);
  assert.deepEqual(
    tabs
      .getSnapshot()
      .tabs
      .filter(({ kind }) => kind === "web")
      .map(({ payload, title }) => ({
        title,
        url: payload.url,
      })),
    [
    {
      title: "GitHub plugin topic",
      url: PLUGIN_DISCOVERY_TOPIC_URL,
    },
    {
      title: "minke-labs/useful-plugin",
      url: "https://github.com/minke-labs/useful-plugin",
    },
    ],
  );

  const [rendererSource, viewSource, styles] = await Promise.all([
    readFile(
      new URL(
        "../packages/harness-overlay/src/client/tabs/plugins/renderer.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../packages/harness-overlay/src/client/tabs/plugins/PluginCatalogView.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../packages/harness-overlay/src/client/tabs/plugins/styles.css",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.match(rendererSource, /kind:\s*"plugin-catalog"/u);
  assert.match(rendererSource, /id:\s*"plugins"/u);
  assert.match(rendererSource, /controller\.create/u);
  assert.match(viewSource, /plugins\.action\.sync/u);
  assert.match(viewSource, /controller\.cancel/u);
  assert.match(viewSource, /plugins\.action\.github/u);
  assert.match(viewSource, /minke-plugins-card/u);
  assert.match(viewSource, /data-candidate/u);
  assert.match(
    viewSource,
    /const FILTERS:[\s\S]*?"installed"/u,
  );
  assert.match(viewSource, /controller\.install/u);
  assert.match(viewSource, /controller\.saveToken/u);
  assert.match(styles, /@container minke-plugin-catalog/u);
  assert.equal(
    pluginTranslate("plugins.page.title"),
    "Plugin catalog",
  );
  assert.equal(
    pluginTranslate("plugins.action.sync"),
    "Sync latest",
  );
  assert.equal(
    pluginTranslate("plugins.action.stop"),
    "Stop syncing",
  );

  controller.dispose();
  webTabs.dispose();
  tabs.dispose();
});

test("the plugin catalog tab can stop a background sync", async () => {
  const tabs = new TabsRuntime({
    showPanel() {},
    hidePanel() {},
  });
  const syncing = pluginSnapshot({ refreshing: true });
  const idle = pluginSnapshot({ refreshing: false });
  let cancellations = 0;
  const controller = new PluginCatalogTabsController(
    tabs,
    {
      available: true,
      async read() {
        return syncing;
      },
      async refresh() {
        return syncing;
      },
      async cancel() {
        cancellations += 1;
        return idle;
      },
      async install() {
        return idle;
      },
      async setToken() {
        return idle;
      },
      async clearToken() {
        return idle;
      },
    },
    {
      open() {
        return undefined;
      },
    },
  );

  const tabId = controller.create("Plugins");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(tabs.tab(tabId).payload.refreshing, true);

  await controller.cancel(tabId);
  assert.equal(cancellations, 1);
  assert.equal(tabs.tab(tabId).payload.refreshing, false);
  assert.equal(tabs.tab(tabId).payload.cancelling, false);

  controller.dispose();
  tabs.dispose();
});

test("the catalog contract and IPC adapter reject malformed or unauthorized data", async () => {
  assert.throws(
    () =>
      parsePluginCatalogSnapshot({
        version: 2,
        generatedAt: null,
        lastRefreshAt: null,
        lastFullScanAt: null,
        refreshing: false,
        counts: {
          repositories: 0,
          pendingRepositories: 0,
          plugins: 1,
        },
        plugins: [],
        candidates: [],
        credential: {
          configured: false,
          writable: true,
        },
      }),
    /count does not match/u,
  );

  const handlers = new Map();
  const snapshot = {
    version: 2,
    generatedAt: null,
    lastRefreshAt: null,
    lastFullScanAt: null,
    refreshing: false,
    counts: {
      repositories: 0,
      pendingRepositories: 0,
      plugins: 0,
    },
    plugins: [],
    candidates: [],
    credential: {
      configured: false,
      writable: true,
    },
  };
  let refreshes = 0;
  let cancellations = 0;
  const installs = [];
  const tokens = [];
  let tokenClears = 0;
  const binding = bindPluginCatalogIpc(
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
        return snapshot;
      },
      async refresh() {
        refreshes += 1;
        return snapshot;
      },
      async cancelRefresh() {
        cancellations += 1;
        return snapshot;
      },
      async install(pluginId) {
        installs.push(pluginId);
        return snapshot;
      },
      async saveGitHubToken(token) {
        tokens.push(token);
        return snapshot;
      },
      async clearGitHubToken() {
        tokenClears += 1;
        return snapshot;
      },
    },
    (event) => event === "allowed",
  );

  assert.deepEqual(
    await handlers.get(PLUGIN_CATALOG_READ_CHANNEL)("allowed"),
    snapshot,
  );
  await handlers.get(PLUGIN_CATALOG_REFRESH_CHANNEL)("allowed");
  assert.equal(refreshes, 1);
  await handlers.get(PLUGIN_CATALOG_CANCEL_CHANNEL)("allowed");
  assert.equal(cancellations, 1);
  await handlers.get(PLUGIN_CATALOG_INSTALL_CHANNEL)(
    "allowed",
    { pluginId: "minke-labs/useful-plugin" },
  );
  assert.deepEqual(installs, ["minke-labs/useful-plugin"]);
  await handlers.get(PLUGIN_CATALOG_TOKEN_SET_CHANNEL)(
    "allowed",
    { token: "github_pat_ipc_test" },
  );
  assert.deepEqual(tokens, ["github_pat_ipc_test"]);
  await handlers.get(PLUGIN_CATALOG_TOKEN_CLEAR_CHANNEL)(
    "allowed",
  );
  assert.equal(tokenClears, 1);
  await assert.rejects(
    handlers.get(PLUGIN_CATALOG_INSTALL_CHANNEL)(
      "allowed",
      { pluginId: "", extra: true },
    ),
    /invalid plugin catalog install request/u,
  );
  await assert.rejects(
    handlers.get(PLUGIN_CATALOG_TOKEN_SET_CHANNEL)(
      "allowed",
      { token: "GITHUB_TOKEN=secret" },
    ),
    /invalid GitHub token/u,
  );
  await assert.rejects(
    handlers.get(PLUGIN_CATALOG_READ_CHANNEL)("denied"),
    /unauthorized/u,
  );
  await assert.rejects(
    handlers.get(PLUGIN_CATALOG_TOKEN_SET_CHANNEL)(
      "denied",
      { token: "" },
    ),
    /unauthorized/u,
  );
  binding.dispose();
  binding.dispose();
  assert.equal(handlers.size, 0);
});
