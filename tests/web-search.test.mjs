import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import {
  MINKE_WEB_SEARCH_TOOL_NAME,
  apply,
  formatMinkeWebSearchOutput,
  parseMinkeWebSearchArgs,
} from "@minke/harness-overlay/web-search/index.ts";
import {
  parseRssSearchResult,
} from "@minke/harness-overlay/web-search/provider.ts";
import {
  assertObjectJsonSchema,
  assertSupportedJsonSchema,
} from "../vendor/deepseek-harness/packages/core/tools/src/json-schema.ts";

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

test("minke_web_search validates bounded query batches", () => {
  assert.deepEqual(
    parseMinkeWebSearchArgs({
      queries: [" alpha ", "beta", "alpha"],
    }),
    ["alpha", "beta"],
  );
  for (const queries of [
    [],
    [""],
    ["a", "b", "c", "d", "e"],
  ]) {
    assert.throws(
      () => parseMinkeWebSearchArgs({ queries }),
      /quer(?:y|ies)/u,
    );
  }
});

test("minke_web_search renders guarded citation-ready output", () => {
  const rendered = formatMinkeWebSearchOutput({
    sources: [{
      url: "https://example.test/result",
      title: "Result",
      snippet: "External snippet.",
      publishedAt: "2026-08-24T00:00:00.000Z",
    }],
    truncated: true,
  });
  assert.match(rendered, /untrusted external content/u);
  assert.match(
    rendered,
    /\[Result\]\(https:\/\/example\.test\/result\)/u,
  );
  assert.match(rendered, /Cite the relevant URLs/u);
  assert.match(rendered, /Refine the query/u);
});

test(
  "Minke registers an independent minke_web_search without replacing native web tools",
  async () => {
    const requests = [];
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const query = url.searchParams.get("q") ?? "";
      requests.push({
        query,
        userAgent: request.headers["user-agent"],
      });
      response.writeHead(200, {
        "content-type": "application/rss+xml; charset=utf-8",
      });
      response.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title>${query} result</title>
    <link>https://example.test/${encodeURIComponent(query)}</link>
    <description>Result for ${query}.</description>
  </item>
  <item>
    <title>Shared result</title>
    <link>https://example.test/shared</link>
    <description>Shared result.</description>
  </item>
</channel></rss>`);
    });
    const baseURL = await listen(server);
    const definitions = new Map([
      ["web_search", { name: "web_search", native: true }],
      ["web_fetch", { name: "web_fetch", native: true }],
    ]);
    const sections = [];
    const effects = [];
    const listeners = new Map();
    const restricted = [];
    const lifted = [];
    const ctx = {
      effect(callback) {
        effects.push(callback());
      },
      tools: {
        register(definition) {
          assert.equal(definitions.has(definition.name), false);
          definitions.set(definition.name, definition);
        },
      },
      systemPrompt: {
        getSectionOrder() {
          return 100;
        },
        section(section) {
          sections.push(section);
        },
      },
      agentPresets: {
        composedPreset(agentContext) {
          return agentContext.preset;
        },
      },
      on(event, listener) {
        listeners.set(event, listener);
      },
    };

    try {
      apply(ctx, {
        baseURL,
        maxResults: 2,
        maxQueries: 4,
      });

      assert.deepEqual([...definitions.keys()], [
        "web_search",
        "web_fetch",
        MINKE_WEB_SEARCH_TOOL_NAME,
      ]);
      assert.equal(definitions.get("web_search").native, true);
      assert.equal(definitions.get("web_fetch").native, true);
      assert.equal(
        Object.hasOwn(ctx, "web"),
        false,
        "the Minke plugin must not depend on or mutate ctx.web",
      );
      const routingGuidance =
        typeof sections[0]?.text === "function"
          ? sections[0].text({
              scope: { ctx: { preset: "standard" } },
            })
          : sections[0]?.text ?? "";
      assert.match(
        routingGuidance,
        /automatically retries failed native web_search[\s\S]*minke_web_search/u,
      );
      assert.match(
        routingGuidance,
        /failed web_fetch remains an error[\s\S]*alternatives/u,
      );
      assert.equal(
        sections[0].text({
          scope: { ctx: { preset: "minimal" } },
        }),
        "",
      );

      const definition = definitions.get(
        MINKE_WEB_SEARCH_TOOL_NAME,
      );
      assert.doesNotThrow(
        () => assertObjectJsonSchema(definition.parameters),
        "model function parameters must use an object-rooted JSON Schema",
      );
      assert.doesNotThrow(
        () => assertSupportedJsonSchema(definition.output.schema),
        "the alpha.2 tool registry must accept the output schema",
      );
      const result = await definition.execute(
        { queries: ["alpha", "beta"] },
        { signal: new AbortController().signal },
      );
      assert.deepEqual(
        result.sources.map(({ url }) => url),
        [
          "https://example.test/alpha",
          "https://example.test/beta",
        ],
      );
      assert.equal(result.truncated, true);
      assert.deepEqual(
        requests.map(({ query }) => query).sort(),
        ["alpha", "beta"],
      );
      assert.equal(
        requests.some(({ userAgent }) =>
          /\bElectron\//u.test(userAgent ?? "")
        ),
        false,
      );
      assert.match(
        definition.output.render(
          { queries: ["alpha", "beta"] },
          result,
        )[0].text,
        /https:\/\/example\.test\/alpha/u,
      );

      const nativeSearchFailure = {
        isError: true,
        error: {
          message:
            'DeepSeek API error (HTTP 503)\n\nThe web search request used endpoint "https://search.example/v1/messages".',
          info: {
            name: "WebError",
            code: "WEB_PROVIDER_ERROR",
          },
          // Unknown/internal fields must never be serialized into fallback
          // output. Only the ToolFailure contract is safe to project.
          details: { apiKey: "must-not-leak" },
        },
        content: [
          {
            type: "text",
            text:
              'Error: DeepSeek API error (HTTP 503)\n\nThe web search request used endpoint "https://search.example/v1/messages".',
          },
          {
            type: "text",
            text:
              "Search endpoint configuration is separate from chat.",
          },
          {
            type: "text",
            text: [
              "Diagnostic mirror: https://alice:must-not-leak@search.example/v1/messages?api_key=must-not-leak&mode=web",
              "Authorization: Bearer must-not-leak",
              "token=must-not-leak",
            ].join("\n"),
          },
        ],
        debug: { authorization: "Bearer must-not-leak" },
      };
      const routedSearch = await listeners.get("tools/execute")(
        {
          name: "web_search",
          arguments: { queries: ["native failure"] },
          signal: new AbortController().signal,
        },
        async () => nativeSearchFailure,
      );
      assert.equal(routedSearch.isError, false);
      assert.match(
        routedSearch.value.content,
        /automatic minke_web_search fallback/u,
      );
      assert.match(
        routedSearch.value.content,
        /WebError[\s\S]*WEB_PROVIDER_ERROR/u,
      );
      assert.match(
        routedSearch.value.content,
        /The web search request used endpoint "https:\/\/search\.example\/v1\/messages"/u,
      );
      assert.match(
        routedSearch.value.content,
        /Search endpoint configuration is separate from chat/u,
      );
      assert.match(
        routedSearch.value.content,
        /https:\/\/search\.example\/v1\/messages\?api_key=REDACTED&mode=web/u,
      );
      assert.match(
        routedSearch.value.content,
        /Authorization: REDACTED/u,
      );
      assert.match(
        routedSearch.value.content,
        /token=REDACTED/u,
      );
      assert.doesNotMatch(
        routedSearch.value.content,
        /must-not-leak|alice:|apiKey/iu,
      );
      assert.deepEqual(
        routedSearch.value.sources.map(({ url }) => url),
        [
          "https://example.test/native%20failure",
          "https://example.test/shared",
        ],
      );

      const nativeFetchFailure = {
        isError: true,
        error: {
          message: "upstream returned HTTP 503",
          info: {
            name: "WebError",
            code: "WEB_PROVIDER_ERROR",
          },
        },
        content: [
          {
            type: "text",
            text: "Error: upstream returned HTTP 503",
          },
          {
            type: "text",
            text: "Effective fetch endpoint: https://failed.example/page",
          },
        ],
      };
      const routedFetch = await listeners.get("tools/execute")(
        {
          name: "web_fetch",
          arguments: { url: "https://failed.example/page" },
          signal: new AbortController().signal,
        },
        async () => nativeFetchFailure,
      );
      assert.equal(
        routedFetch.isError,
        true,
        "search alternatives must not masquerade as fetched content",
      );
      assert.equal(routedFetch.error, nativeFetchFailure.error);
      assert.deepEqual(
        routedFetch.content.slice(0, -1),
        nativeFetchFailure.content,
      );
      assert.equal(
        routedFetch.content[0],
        nativeFetchFailure.content[0],
      );
      assert.match(
        routedFetch.content.at(-1).text,
        /original URL was not fetched/u,
      );
      assert.match(
        routedFetch.content.at(-1).text,
        /minke_web_search fallback found search alternatives/u,
      );
      assert.match(
        routedFetch.content.at(-1).text,
        /https:\/\/example\.test\/https%3A%2F%2Ffailed\.example%2Fpage/u,
      );

      const cancelledFailure = {
        ...nativeSearchFailure,
        error: {
          message: "aborted",
          info: { code: "ABORTED" },
        },
      };
      assert.equal(
        await listeners.get("tools/execute")(
          {
            name: "web_search",
            arguments: { queries: ["must not run"] },
            signal: new AbortController().signal,
          },
          async () => cancelledFailure,
        ),
        cancelledFailure,
      );

      const providerCancelledFailure = {
        ...nativeSearchFailure,
        error: {
          message: "DeepSeek search aborted",
          info: {
            name: "WebError",
            code: "WEB_ABORTED",
          },
        },
        content: [{
          type: "text",
          text: "Error: DeepSeek search aborted",
        }],
      };
      const requestCountBeforeProviderCancellation = requests.length;
      assert.equal(
        await listeners.get("tools/execute")(
          {
            name: "web_search",
            arguments: { queries: ["must also not run"] },
            signal: new AbortController().signal,
          },
          async () => providerCancelledFailure,
        ),
        providerCancelledFailure,
      );
      assert.equal(
        requests.length,
        requestCountBeforeProviderCancellation,
      );

      const minimalAgent = {
        session: { id: "minimal-session" },
        ctx: {
          preset: "minimal",
          tools: {
            restrict({ deny }) {
              restricted.push(deny);
              return () => lifted.push(deny);
            },
          },
        },
      };
      listeners.get("agent/created")({
        agent: minimalAgent,
      });
      assert.deepEqual(restricted, [[MINKE_WEB_SEARCH_TOOL_NAME]]);
      listeners.get("agent-preset/selected")(
        minimalAgent.session.id,
        "standard",
      );
      assert.equal(lifted.length, 1);
      listeners.get("agent/disposed")({
        agent: minimalAgent,
      });
    } finally {
      for (const dispose of effects.reverse()) {
        await dispose?.();
      }
      await close(server);
    }
  },
);
