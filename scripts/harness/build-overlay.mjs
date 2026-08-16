#!/usr/bin/env node

import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packageRoot = join(projectRoot, "packages", "harness-overlay");
const outputRoot = join(packageRoot, "lib");
const packageManifest = JSON.parse(
  await readFile(join(packageRoot, "package.json"), "utf8"),
);
const packageId = packageManifest.name;
if (
  typeof packageId !== "string" ||
  !packageId.startsWith("@lencx/")
) {
  throw new Error("Minke overlay packages must use the @lencx scope");
}

await mkdir(outputRoot, { recursive: true });

await build({
  entryPoints: [join(packageRoot, "src", "index.ts")],
  outfile: join(outputRoot, "index.js"),
  bundle: false,
  format: "esm",
  platform: "node",
  target: "es2022",
  sourcemap: true,
});

await build({
  entryPoints: [
    join(packageRoot, "src", "model-runtime", "index.ts"),
  ],
  outfile: join(outputRoot, "model-runtime.js"),
  bundle: true,
  packages: "external",
  format: "esm",
  platform: "node",
  target: "es2022",
  sourcemap: true,
});

await build({
  entryPoints: [join(packageRoot, "src", "client", "index.tsx")],
  outfile: join(outputRoot, "client.js"),
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "chrome120",
  external: ["react", "react/jsx-runtime"],
  loader: {
    ".css": "text",
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify(
      process.env.NODE_ENV ?? "production",
    ),
  },
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(
      packageId,
    )}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
  },
  footer: {
    js: "return module.exports; } });",
  },
  sourcemap: true,
});

const clientBundle = await readFile(join(outputRoot, "client.js"), "utf8");
if (!clientBundle.startsWith("window.__ModuleLoader__.load(")) {
  throw new Error("Minke overlay client bundle is missing its Harness loader wrapper");
}
if (/require\(["']@deepseek-ai\//u.test(clientBundle)) {
  throw new Error(
    "Minke overlay client bundle leaked a non-platform Harness value import",
  );
}

console.log(`Built ${packageId} in ${outputRoot}`);
