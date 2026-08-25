import { resolve } from "node:path";

export interface ProductSourceEntry {
  readonly specifier: string;
  readonly target: string;
}

/**
 * Product packages whose runtime exports point at generated `lib` files.
 *
 * Forge's Vite builds consume their TypeScript entry points directly so a
 * clean checkout does not depend on ignored build output being present.
 */
export const PRODUCT_SOURCE_ENTRIES:
  readonly ProductSourceEntry[] = Object.freeze([
    {
      specifier: "@lencx/minke-im-discord",
      target: "packages/im-discord/src/index.ts",
    },
    {
      specifier: "@lencx/minke-im-gateway",
      target: "packages/im-gateway/src/index.ts",
    },
    {
      specifier: "@lencx/minke-im-gateway/sqlite",
      target: "packages/im-gateway/src/sqlite.ts",
    },
    {
      specifier: "@lencx/minke-im-gateway/weixin",
      target: "packages/im-gateway/src/weixin.ts",
    },
    {
      specifier: "@lencx/minke-im-telegram",
      target: "packages/im-telegram/src/index.ts",
    },
    {
      specifier: "@lencx/minke-im-weixin",
      target: "packages/im-weixin/src/index.ts",
    },
    {
      specifier: "@lencx/minke-model-runtime",
      target: "packages/model-runtime/src/core.ts",
    },
    {
      specifier: "@lencx/minke-model-runtime/contract",
      target: "packages/model-runtime/src/contract.ts",
    },
    {
      specifier: "@lencx/minke-model-runtime/dsh",
      target: "packages/model-runtime/src/dsh.ts",
    },
    {
      specifier: "@lencx/minke-model-runtime/live",
      target: "packages/model-runtime/src/live.ts",
    },
    {
      specifier:
        "@lencx/minke-model-runtime/process-environment",
      target:
        "packages/model-runtime/src/process-environment.ts",
    },
  ]);

function exactSpecifierPattern(specifier: string): RegExp {
  const escaped = specifier.replace(
    /[.*+?^${}()|[\]\\]/gu,
    "\\$&",
  );
  return new RegExp(`^${escaped}$`, "u");
}

export function productSourceAliases(projectRoot: string): Array<{
  readonly find: RegExp;
  readonly replacement: string;
}> {
  return PRODUCT_SOURCE_ENTRIES.map(({ specifier, target }) => ({
    find: exactSpecifierPattern(specifier),
    replacement: resolve(projectRoot, target),
  }));
}
