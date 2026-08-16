import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePathAlias } from "../config/path-aliases.mts";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      resolvePathAlias(specifier, projectRoot) ?? specifier,
      context,
    );
  },
});
