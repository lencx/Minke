import { statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export interface PathAliasDefinition {
  readonly prefix: string;
  readonly target: string;
}

export const PATH_ALIASES: readonly PathAliasDefinition[] = Object.freeze([
  { prefix: "@@/", target: "." },
  { prefix: "@/", target: "src" },
  { prefix: "@minke/desktop/", target: "desktop" },
  {
    prefix: "@minke/harness-overlay/",
    target: "packages/harness-overlay/src",
  },
  { prefix: "@minke/resources/", target: "resources" },
  {
    prefix: "@vendor/deepseek-harness/",
    target: "vendor/deepseek-harness",
  },
]);

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

const MODULE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
] as const;

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function existingModulePath(candidate: string): string {
  if (isFile(candidate)) return candidate;
  if (extname(candidate) === "") {
    for (const extension of MODULE_EXTENSIONS) {
      const withExtension = `${candidate}${extension}`;
      if (isFile(withExtension)) return withExtension;
    }
  }
  for (const extension of MODULE_EXTENSIONS) {
    const indexFile = join(candidate, `index${extension}`);
    if (isFile(indexFile)) return indexFile;
  }
  return candidate;
}

/** Resolve a project alias for Node's synchronous module hooks. */
export function resolvePathAlias(
  specifier: string,
  projectRoot: string,
): string | undefined {
  const definition = PATH_ALIASES.find(({ prefix }) =>
    specifier.startsWith(prefix),
  );
  if (definition === undefined) return undefined;

  const targetRoot = resolve(projectRoot, definition.target);
  const unresolvedCandidate = resolve(
    targetRoot,
    specifier.slice(definition.prefix.length),
  );
  if (!isInside(targetRoot, unresolvedCandidate)) return undefined;
  const candidate = existingModulePath(unresolvedCandidate);
  return pathToFileURL(candidate).href;
}
