import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePathAlias } from "../config/path-aliases.mts";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) {
      return {
        format: "module",
        shortCircuit: true,
        source: `export default ${JSON.stringify(
          readFileSync(fileURLToPath(url), "utf8"),
        )};`,
      };
    }
    return nextLoad(url, context);
  },
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      resolvePathAlias(specifier, projectRoot) ?? specifier,
      context,
    );
  },
});
