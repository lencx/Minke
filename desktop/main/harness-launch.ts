import { readFile } from "node:fs/promises";
import { join } from "node:path";

interface RuntimeMetadata {
  schemaVersion?: unknown;
  productBundle?: {
    packageName?: unknown;
    patch?: unknown;
  };
}

export interface HarnessRuntimeLayout {
  entryPath: string;
  pnpmEntry: string;
  productPackageName: string;
  productPatch: string;
  runtimeBin: string;
}

export async function readHarnessRuntimeLayout(
  runtimeRoot: string,
): Promise<HarnessRuntimeLayout> {
  const metadata = JSON.parse(
    await readFile(join(runtimeRoot, "dsh-runtime.json"), "utf8"),
  ) as RuntimeMetadata;
  const packageName = metadata.productBundle?.packageName;
  const patch = metadata.productBundle?.patch;
  if (
    metadata.schemaVersion !== 3 ||
    typeof packageName !== "string" ||
    !/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/u.test(packageName) ||
    typeof patch !== "string" ||
    !/^[a-z0-9][a-z0-9._-]*$/u.test(patch)
  ) {
    throw new Error("staged Harness runtime has invalid product bundle metadata");
  }
  return {
    entryPath: join(runtimeRoot, "index.mjs"),
    pnpmEntry: join(runtimeRoot, "node_modules", "pnpm", "bin", "pnpm.cjs"),
    productPackageName: packageName,
    productPatch: join(
      runtimeRoot,
      "node_modules",
      ...packageName.split("/"),
      patch,
    ),
    runtimeBin: join(runtimeRoot, "bin"),
  };
}

export function harnessWebArguments(
  layout: Pick<HarnessRuntimeLayout, "entryPath" | "productPatch">,
): string[] {
  return [
    "--expose-internals",
    layout.entryPath,
    "web",
    "--patch",
    layout.productPatch,
    "--no-open",
    "--host",
    "127.0.0.1",
    "--port",
    "0",
  ];
}
