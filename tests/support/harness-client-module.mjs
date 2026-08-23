import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import {
  applyHarnessRuntimePatches,
  resolveHarnessRuntimePatches,
} from "../../scripts/harness/runtime-patches.mjs";

export async function stagePatchedHarnessClientModule({
  projectRoot,
  fixture,
  packageName,
  patches,
}) {
  const runtimeRoot = await mkdtemp(
    join(tmpdir(), "minke-harness-client-"),
  );
  const target = join(
    runtimeRoot,
    "node_modules",
    "@deepseek-ai",
    packageName,
    "lib",
    "client.js",
  );
  try {
    await mkdir(dirname(target), { recursive: true });
    const source = await readFile(
      join(projectRoot, fixture),
      "utf8",
    );
    await writeFile(
      target,
      source.replaceAll("\r\n", "\n"),
    );
    const resolved = await resolveHarnessRuntimePatches(
      projectRoot,
      patches,
    );
    await applyHarnessRuntimePatches(runtimeRoot, resolved);
    return {
      source: await readFile(target, "utf8"),
      async dispose() {
        await rm(runtimeRoot, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(runtimeRoot, { recursive: true, force: true });
    throw error;
  }
}

export function evaluateHarnessClientModule(
  source,
  dependencies = {},
  globals = {},
) {
  let definition;
  runInNewContext(source, {
    Error,
    Map,
    Math,
    Object,
    Set,
    Symbol,
    ...globals,
    window: {
      ...globals.window,
      __ModuleLoader__: {
        load(candidate) {
          definition = candidate;
        },
      },
    },
  });
  if (
    definition === undefined ||
    typeof definition.factory !== "function"
  ) {
    throw new Error("Harness client module did not register a factory");
  }
  return definition.factory(
    (specifier) => dependencies[specifier] ?? {},
  );
}
