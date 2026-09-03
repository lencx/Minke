import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  validateDiscordBotToken,
} from "../packages/im-discord/src/index.ts";
import {
  sanitizeBotAgent,
} from "../packages/im-weixin/src/network.ts";
import {
  MINKE_WEB_SEARCH_DEFAULT_USER_AGENT,
} from "../packages/harness-overlay/src/web-search/provider.ts";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

const productManifests = Object.freeze([
  "package.json",
  "packages/harness-overlay/package.json",
  "packages/im-discord/package.json",
  "packages/im-gateway/package.json",
  "packages/im-telegram/package.json",
  "packages/im-weixin/package.json",
  "packages/model-runtime/package.json",
  "packages/remote-access/package.json",
]);

function readManifest(relativePath) {
  return JSON.parse(
    readFileSync(resolve(projectRoot, relativePath), "utf8"),
  );
}

test("all product manifests declare the 0.4.0 release", () => {
  for (const relativePath of productManifests) {
    assert.equal(
      readManifest(relativePath).version,
      "0.4.0",
      `${relativePath} must match the product release`,
    );
  }
});

test("default network identities expose the product version", async () => {
  const version = readManifest("package.json").version;
  assert.equal(sanitizeBotAgent(undefined), `Minke/${version}`);
  assert.equal(
    MINKE_WEB_SEARCH_DEFAULT_USER_AGENT,
    `Minke/${version} (+https://github.com/lencx/Minke)`,
  );

  let discordUserAgent;
  await validateDiscordBotToken({
    fetch: async (_input, init) => {
      discordUserAgent = new Headers(init?.headers).get(
        "user-agent",
      );
      return new Response(JSON.stringify({
        avatar: null,
        bot: true,
        discriminator: "0",
        global_name: "Minke Bot",
        id: "100000000000000001",
        username: "minke",
      }), {
        headers: { "content-type": "application/json" },
      });
    },
    token: "release-version-test-token",
  });
  assert.equal(
    discordUserAgent,
    `DiscordBot (https://github.com/lencx/Minke, ${version})`,
  );
});
