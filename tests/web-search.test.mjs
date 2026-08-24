import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  parseRssSearchResult,
} from "@minke/harness-overlay/web-search/provider.ts";
import {
  MINKE_WEB_SEARCH_FALLBACK_ENABLED_ENV,
} from "@minke/harness-overlay/web-search-settings-contract.ts";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const harnessRoot = join(projectRoot, "vendor", "deepseek-harness");
const harnessUrl = pathToFileURL(`${harnessRoot}/`).href;
const harnessModulesAnchor = pathToFileURL(
  join(
    harnessRoot,
    "node_modules",
    ".pnpm",
    "node_modules",
    "_minke_test.mjs",
  ),
).href;

async function listen(server) {
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${String(address.port)}/search`;
}

async function close(server) {
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error === undefined) resolveClose();
      else rejectClose(error);
    });
  });
}

// Harness uses an isolated pnpm linker. Re-anchor only its bare imports to
// the workspace facade so every plugin shares the pinned Cordis singleton.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier ===
      "@lencx/minke-harness-overlay/web-search"
    ) {
      return {
        shortCircuit: true,
        url: pathToFileURL(
          join(
            projectRoot,
            "packages",
            "harness-overlay",
            "lib",
            "web-search.js",
          ),
        ).href,
      };
    }
    const fromHarness = context.parentURL?.startsWith(harnessUrl) ?? false;
    const isBare =
      !specifier.startsWith(".") &&
      !specifier.startsWith("/") &&
      !specifier.startsWith("node:");
    if (specifier.startsWith("@deepseek-ai/") || (fromHarness && isBare)) {
      return nextResolve(specifier, {
        ...context,
        parentURL: harnessModulesAnchor,
      });
    }
    return nextResolve(specifier, context);
  },
});

test("Minke RSS search parsing is bounded and rejects unsafe XML", () => {
  const longSnippet = "x".repeat(3_000);
  const result = parseRssSearchResult(`<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>${"T".repeat(600)} &amp; Browser</title>
    <link>https://example.test/result#fragment</link>
    <description><![CDATA[<strong>${longSnippet}</strong>\u202e]]></description>
    <pubDate>Sun, 24 Aug 2026 00:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Duplicate</title>
    <link>https://example.test/result#other</link>
  </item>
  <item>
    <title>Credentials are not portable</title>
    <link>https://user:secret@example.test/private</link>
  </item>
  <item>
    <title>Non-HTTP result</title>
    <link>javascript:alert(1)</link>
  </item>
</channel></rss>`);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].url, "https://example.test/result");
  assert.equal(result.sources[0].title.length, 512);
  assert.equal(result.sources[0].snippet.length, 2_048);
  assert.doesNotMatch(result.sources[0].snippet, /\u202e/u);
  assert.equal(
    result.sources[0].publishedAt,
    "2026-08-24T00:00:00.000Z",
  );
  assert.equal(result.truncated, false);

  assert.deepEqual(
    parseRssSearchResult(
      '<?xml version="1.0"?><rss><channel></channel></rss>',
    ),
    { sources: [], truncated: false },
  );
  for (const xml of [
    "<root><item><link>https://example.test</link></item></root>",
    '<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss><channel></channel></rss>',
  ]) {
    assert.throws(
      () => parseRssSearchResult(xml),
      (error) =>
        error instanceof Error &&
        error.code === "WEB_SEARCH_INVALID_RESPONSE",
    );
  }
});

function testOverlay(settingsPath, storageRoot) {
  // Keep the real host and Agent Preset capability rows; remove only bound
  // ports, file watchers, and unrelated Minke services from this smoke.
  return [
    {
      id: "settings",
      config: { path: settingsPath, watch: false },
    },
    {
      id: "storage-json",
      config: { root: storageRoot },
    },
    { id: "webserver", disabled: true },
    { id: "web-runtime", disabled: true },
    { id: "session-telemetry-otel", disabled: true },
    { id: "modules", disabled: true },
    { id: "connection", disabled: true },
    { id: "client-hmr", disabled: true },
    { id: "directory-picker", disabled: true },
    { id: "model-runtime", disabled: true },
    { id: "minke-overlay", disabled: true },
    {
      id: "agent-presets",
      config: {
        default: "standard",
        roots: [
          {
            path: join(
              harnessRoot,
              "apps",
              "cli",
              "config",
              "agent-presets",
            ),
            trust: "system",
          },
        ],
        includeUserRoot: false,
      },
    },
    {
      insert: [
        {
          id: "directory-picker-browse",
          name: "@deepseek-ai/dsh-host-directory-picker-browse",
        },
        {
          id: "ui-directory-picker-browse",
          name: "@deepseek-ai/dsh-client-ui-directory-picker-browse",
        },
      ],
    },
  ];
}

test(
  "the Minke Web profile composes bounded web_search in every full Agent Preset",
  { timeout: 120_000 },
  async () => {
    const home = await mkdtemp(join(tmpdir(), "minke-web-search-"));
    const previousHome = process.env.DSH_HOME;
    const previousDeepSeekApiKey = process.env.DEEPSEEK_API_KEY;
    const previousSearchBaseURL =
      process.env.MINKE_WEB_SEARCH_BASE_URL;
    const previousFallbackEnabled =
      process.env[MINKE_WEB_SEARCH_FALLBACK_ENABLED_ENV];
    const previousExplicitProvider =
      process.env.DSH_WEB_SEARCH_PROVIDER;
    const searchRequests = [];
    const searchServer = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      searchRequests.push({
        query: url.searchParams.get("q"),
        userAgent: request.headers["user-agent"],
      });
      response.writeHead(200, {
        "content-type": "application/rss+xml; charset=utf-8",
      });
      response.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title>Minke Browser</title>
    <link>https://example.test/minke-browser</link>
    <description>Product-owned search result.</description>
    <pubDate>Sun, 24 Aug 2026 00:00:00 GMT</pubDate>
  </item>
</channel></rss>`);
    });
    const searchBaseURL = await listen(searchServer);
    process.env.DSH_HOME = home;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env[MINKE_WEB_SEARCH_FALLBACK_ENABLED_ENV];
    delete process.env.DSH_WEB_SEARCH_PROVIDER;
    process.env.MINKE_WEB_SEARCH_BASE_URL = searchBaseURL;

    let ctx;
    try {
      const settingsPath = join(home, "settings.yaml");
      const profileDir = join(home, "profiles", "web-search-test");
      const rootConfig = join(profileDir, "cordis.yml");
      await mkdir(profileDir, { recursive: true });
      await writeFile(settingsPath, "{}\n");
      await writeFile(rootConfig, "[]\n");

      const [
        {
          boot,
          healProfilesModuleFallback,
          loadOverlayPatches,
        },
        { provideCmdline },
      ] =
        await Promise.all([
          import("@deepseek-ai/dsh-app-boot"),
          import("@deepseek-ai/dsh-cmdline"),
        ]);
      healProfilesModuleFallback(
        join(harnessRoot, "apps", "cli", "package.json"),
        home,
      );
      const createPatches = () => [
        ...loadOverlayPatches(
          "minke-web-search-test",
          join(
            harnessRoot,
            "packages",
            "bundle",
            "base",
            "cordis.patch.yml",
          ),
        ),
        ...loadOverlayPatches(
          "minke-web-search-test",
          join(
            harnessRoot,
            "packages",
            "bundle",
            "web-app",
            "cordis.patch.yml",
          ),
        ),
        ...loadOverlayPatches(
          "minke-web-search-test",
          join(
            projectRoot,
            "packages",
            "harness-overlay",
            "cordis.patch.yml",
          ),
        ),
        ...testOverlay(settingsPath, join(home, "storages")),
      ];
      const bootContext = () =>
        boot(
          "minke-web-search-test",
          rootConfig,
          createPatches(),
          (hostCtx) => {
            provideCmdline(hostCtx, {
              args: [],
              exit: () => {},
            });
          },
        );
      ctx = await bootContext();

      assert.deepEqual(
        ctx.tools.schemas().map(({ name }) => name),
        [],
        "web_search must not leak from an Agent Preset into the host layer",
      );
      assert.deepEqual(
        await ctx.web.search({
          query: "Minke product route",
          maxResults: 1,
        }),
        {
          sources: [
            {
              title: "Minke Browser",
              url: "https://example.test/minke-browser",
              snippet: "Product-owned search result.",
              publishedAt: "2026-08-24T00:00:00.000Z",
            },
          ],
          truncated: false,
        },
        "web_search must use Minke's credential-free provider instead of DeepSeek",
      );
      assert.deepEqual(searchRequests.map(({ query }) => query), [
        "Minke product route",
      ]);
      assert.equal(
        searchRequests.some(({ userAgent }) =>
          /\bElectron\//u.test(userAgent ?? "")
        ),
        false,
      );

      for (const preset of ["standard", "code", "cordis"]) {
        const handle = await ctx.agents.create({
          sessionId: `minke-web-search-${preset}`,
          setup: (agentCtx) =>
            ctx.agentPresets.mount(agentCtx, preset).then(() => undefined),
        });
        try {
          const definition = ctx.tools.get("web_search", handle.agent);
          assert.ok(
            definition,
            `${preset} must register web_search in its scoped tool layer`,
          );
          assert.equal(definition.timeoutMs, 60_000);
          assert.match(definition.description, /1–4 queries/u);
          assert.equal(
            ctx.tools.get("web_fetch", handle.agent),
            undefined,
            `${preset} must keep web_fetch disabled`,
          );

          const assembly = await ctx.systemPrompt.assemble({
            scope: handle.agent,
          });
          if (preset === "code") {
            assert.deepEqual(
              assembly.tools.map(({ name }) => name),
              ["run_code"],
            );
            assert.match(
              assembly.sections.find(({ name }) => name === "tools:sdk")
                ?.text ?? "",
              /web_search/u,
            );
          } else {
            assert.ok(
              assembly.tools.some(({ name }) => name === "web_search"),
              `${preset} must present web_search to the model`,
            );
            assert.ok(
              !assembly.tools.some(({ name }) => name === "web_fetch"),
              `${preset} must not present web_fetch to the model`,
            );
          }
        } finally {
          await handle.dispose();
        }
      }

      const minimal = await ctx.agents.create({
        sessionId: "minke-web-search-minimal",
        setup: (agentCtx) =>
          ctx.agentPresets.mount(agentCtx, "minimal").then(() => undefined),
      });
      try {
        assert.equal(ctx.tools.get("web_search", minimal.agent), undefined);
        assert.equal(ctx.tools.get("web_fetch", minimal.agent), undefined);
      } finally {
        await minimal.dispose();
      }

      await ctx.fiber.dispose();
      ctx = undefined;
      process.env[MINKE_WEB_SEARCH_FALLBACK_ENABLED_ENV] = "0";
      ctx = await bootContext();
      await assert.rejects(
        ctx.web.search({
          query: "disabled Minke fallback",
          maxResults: 1,
        }),
        (error) =>
          error instanceof Error &&
          error.code === "WEB_PROVIDER_UNAVAILABLE",
      );
      assert.equal(
        searchRequests.length,
        1,
        "disabling the fallback must not call the Minke RSS endpoint",
      );

      await ctx.fiber.dispose();
      ctx = undefined;
      delete process.env[MINKE_WEB_SEARCH_FALLBACK_ENABLED_ENV];
      process.env.DSH_WEB_SEARCH_PROVIDER =
        "explicit-test-provider";
      ctx = await bootContext();
      let explicitSearches = 0;
      const unregisterExplicit =
        ctx.web.registerSearchProvider({
          id: "explicit-test-provider",
          available: () => true,
          async search() {
            explicitSearches += 1;
            return {
              sources: [{
                title: "Explicit provider",
                url: "https://explicit.test/result",
              }],
              truncated: false,
            };
          },
        });
      try {
        assert.deepEqual(
          await ctx.web.search({
            query: "respect explicit provider",
            maxResults: 1,
          }),
          {
            sources: [{
              title: "Explicit provider",
              url: "https://explicit.test/result",
            }],
            truncated: false,
          },
        );
      } finally {
        unregisterExplicit();
      }
      assert.equal(explicitSearches, 1);
      assert.equal(
        searchRequests.length,
        1,
        "an explicit DSH provider must not fall through to Minke",
      );
    } finally {
      await ctx?.fiber.dispose();
      if (previousHome === undefined) {
        delete process.env.DSH_HOME;
      } else {
        process.env.DSH_HOME = previousHome;
      }
      if (previousDeepSeekApiKey === undefined) {
        delete process.env.DEEPSEEK_API_KEY;
      } else {
        process.env.DEEPSEEK_API_KEY = previousDeepSeekApiKey;
      }
      if (previousSearchBaseURL === undefined) {
        delete process.env.MINKE_WEB_SEARCH_BASE_URL;
      } else {
        process.env.MINKE_WEB_SEARCH_BASE_URL =
          previousSearchBaseURL;
      }
      if (previousFallbackEnabled === undefined) {
        delete process.env[MINKE_WEB_SEARCH_FALLBACK_ENABLED_ENV];
      } else {
        process.env[MINKE_WEB_SEARCH_FALLBACK_ENABLED_ENV] =
          previousFallbackEnabled;
      }
      if (previousExplicitProvider === undefined) {
        delete process.env.DSH_WEB_SEARCH_PROVIDER;
      } else {
        process.env.DSH_WEB_SEARCH_PROVIDER =
          previousExplicitProvider;
      }
      await close(searchServer);
      await rm(home, { recursive: true, force: true });
    }
  },
);
