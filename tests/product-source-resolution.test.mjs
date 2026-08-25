import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import mainConfig from "../vite.main.config.mts";
import preloadConfig from "../vite.preload.config.mts";
import rendererConfig from "../vite.renderer.config.mts";
import tabsWebPreloadConfig from "../vite.tabs-web-preload.config.mts";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

const productSourceEntries = Object.freeze({
  "@lencx/minke-im-discord":
    "packages/im-discord/src/index.ts",
  "@lencx/minke-im-gateway":
    "packages/im-gateway/src/index.ts",
  "@lencx/minke-im-gateway/sqlite":
    "packages/im-gateway/src/sqlite.ts",
  "@lencx/minke-im-gateway/weixin":
    "packages/im-gateway/src/weixin.ts",
  "@lencx/minke-im-telegram":
    "packages/im-telegram/src/index.ts",
  "@lencx/minke-im-weixin":
    "packages/im-weixin/src/index.ts",
  "@lencx/minke-model-runtime":
    "packages/model-runtime/src/core.ts",
  "@lencx/minke-model-runtime/contract":
    "packages/model-runtime/src/contract.ts",
  "@lencx/minke-model-runtime/dsh":
    "packages/model-runtime/src/dsh.ts",
  "@lencx/minke-model-runtime/live":
    "packages/model-runtime/src/live.ts",
  "@lencx/minke-model-runtime/process-environment":
    "packages/model-runtime/src/process-environment.ts",
});

const viteConfigs = Object.freeze([
  ["main", mainConfig],
  ["preload", preloadConfig],
  ["renderer", rendererConfig],
  ["tabs web preload", tabsWebPreloadConfig],
]);

function aliasReplacement(config, specifier) {
  const aliases = config.resolve?.alias;
  if (!Array.isArray(aliases)) return undefined;
  for (const alias of aliases) {
    if (
      typeof alias === "object" &&
      alias !== null &&
      "find" in alias &&
      "replacement" in alias
    ) {
      const matches = typeof alias.find === "string"
        ? alias.find === specifier
        : alias.find.test(specifier);
      if (matches) return alias.replacement;
    }
  }
  return undefined;
}

test("Vite resolves generated product packages from source", () => {
  for (const [name, config] of viteConfigs) {
    for (const [specifier, relativeTarget] of Object.entries(
      productSourceEntries,
    )) {
      const expected = resolve(projectRoot, relativeTarget);
      assert.equal(
        aliasReplacement(config, specifier),
        expected,
        `${name} must resolve ${specifier} from source`,
      );
      assert.equal(existsSync(expected), true);
    }
  }
});

test("product source aliases do not capture sibling specifiers", () => {
  for (const [, config] of viteConfigs) {
    assert.equal(
      aliasReplacement(
        config,
        "@lencx/minke-im-discord-experimental",
      ),
      undefined,
    );
    assert.equal(
      aliasReplacement(
        config,
        "@lencx/minke-model-runtime/unknown",
      ),
      undefined,
    );
  }
});
