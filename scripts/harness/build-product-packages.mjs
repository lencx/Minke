#!/usr/bin/env node

import { build } from "esbuild";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const overlayPackageRoot = join(
  projectRoot,
  "packages",
  "harness-overlay",
);
const modelRuntimePackageRoot = join(
  projectRoot,
  "packages",
  "model-runtime",
);
const overlayOutputRoot = join(overlayPackageRoot, "lib");
const modelRuntimeOutputRoot = join(modelRuntimePackageRoot, "lib");
const tsconfigPath = join(projectRoot, "tsconfig.json");

async function readManifest(packageRoot) {
  return JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  );
}

const [overlayManifest, modelRuntimeManifest] = await Promise.all([
  readManifest(overlayPackageRoot),
  readManifest(modelRuntimePackageRoot),
]);
const overlayPackageId = overlayManifest.name;
const modelRuntimePackageId = modelRuntimeManifest.name;
if (overlayPackageId !== "@lencx/minke-harness-overlay") {
  throw new Error(
    "Minke Harness overlay package name must be @lencx/minke-harness-overlay",
  );
}
if (modelRuntimePackageId !== "@lencx/minke-model-runtime") {
  throw new Error(
    "Minke model runtime package name must be @lencx/minke-model-runtime",
  );
}

await Promise.all([
  mkdir(overlayOutputRoot, { recursive: true }),
  mkdir(modelRuntimeOutputRoot, { recursive: true }),
  rm(join(overlayOutputRoot, "model-runtime.js"), { force: true }),
  rm(join(overlayOutputRoot, "model-runtime.js.map"), { force: true }),
]);

await Promise.all([
  build({
    entryPoints: [
      join(modelRuntimePackageRoot, "src", "core.ts"),
    ],
    outfile: join(modelRuntimeOutputRoot, "index.js"),
    bundle: false,
    format: "esm",
    platform: "node",
    target: "es2022",
    tsconfig: tsconfigPath,
    sourcemap: true,
  }),
  build({
    entryPoints: [
      join(modelRuntimePackageRoot, "src", "contract.ts"),
    ],
    outfile: join(modelRuntimeOutputRoot, "contract.js"),
    bundle: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    tsconfig: tsconfigPath,
    sourcemap: true,
  }),
  build({
    entryPoints: [
      join(modelRuntimePackageRoot, "src", "dsh.ts"),
    ],
    outfile: join(modelRuntimeOutputRoot, "dsh.js"),
    bundle: true,
    packages: "external",
    format: "esm",
    platform: "node",
    target: "es2022",
    tsconfig: tsconfigPath,
    sourcemap: true,
  }),
]);

await Promise.all([
  build({
    entryPoints: [join(overlayPackageRoot, "src", "index.ts")],
    outfile: join(overlayOutputRoot, "index.js"),
    bundle: true,
    packages: "external",
    format: "esm",
    platform: "node",
    target: "es2022",
    tsconfig: tsconfigPath,
    sourcemap: true,
  }),
  build({
    entryPoints: [
      join(overlayPackageRoot, "src", "client", "index.tsx"),
    ],
    outfile: join(overlayOutputRoot, "client.js"),
    bundle: true,
    format: "cjs",
    platform: "browser",
    target: "chrome120",
    tsconfig: tsconfigPath,
    external: ["react", "react/jsx-runtime"],
    loader: {
      ".css": "text",
      ".png": "dataurl",
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify(
        process.env.NODE_ENV ?? "production",
      ),
    },
    banner: {
      js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(
        overlayPackageId,
      )}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
    },
    footer: {
      js: "return module.exports; } });",
    },
    sourcemap: true,
  }),
]);

const clientBundle = await readFile(
  join(overlayOutputRoot, "client.js"),
  "utf8",
);
if (!clientBundle.startsWith("window.__ModuleLoader__.load(")) {
  throw new Error(
    "Minke overlay client bundle is missing its Harness loader wrapper",
  );
}
if (/require\(["']@deepseek-ai\//u.test(clientBundle)) {
  throw new Error(
    "Minke overlay client bundle leaked a non-platform Harness value import",
  );
}

console.log(
  `Built ${modelRuntimePackageId} in ${modelRuntimeOutputRoot}`,
);
console.log(`Built ${overlayPackageId} in ${overlayOutputRoot}`);
