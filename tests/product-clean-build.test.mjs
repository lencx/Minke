import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("product packages build before Harness has generated any protocol output", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "minke-product-build-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  for (const path of ["package.json", "tsconfig.json", "config", "resources", "packages"]) {
    await cp(join(projectRoot, path), join(root, path), {
      recursive: true,
      filter: (source) => !["node_modules", "lib"].includes(basename(source)),
    });
  }
  const buildScript = join("scripts", "harness", "build-product-packages.mjs");
  await mkdir(dirname(join(root, buildScript)), { recursive: true });
  await cp(join(projectRoot, buildScript), join(root, buildScript));
  for (const name of ["product-build-cache.mjs", "runtime-state.mjs"]) {
    await cp(join(projectRoot, "scripts", "harness", name), join(root, "scripts", "harness", name));
  }

  // Reuse installed third-party dependencies, but give the linked Harness
  // package only its checked-in source, as on a freshly checked-out CI runner.
  const dependencies = join(root, "node_modules");
  await mkdir(dependencies);
  for (const entry of await readdir(join(projectRoot, "node_modules"))) {
    if (entry.startsWith(".")) continue;
    const source = join(projectRoot, "node_modules", entry);
    const target = join(dependencies, entry);
    if (entry === "@deepseek-ai") {
      await mkdir(target);
      for (const name of await readdir(source)) {
        if (name === "dsh-typert-protocol") continue;
        await symlink(join(source, name), join(target, name), "junction");
      }
    } else {
      await symlink(source, target, "junction");
    }
  }
  const protocol = join(dependencies, "@deepseek-ai", "dsh-typert-protocol");
  const protocolSource = join(projectRoot, "vendor", "deepseek-harness", "packages", "typert", "protocol");
  await mkdir(protocol);
  for (const path of ["package.json", "src"]) {
    await cp(join(protocolSource, path), join(protocol, path), { recursive: true });
  }
  const errorSource = "vendor/deepseek-harness/packages/util/error/src";
  await mkdir(dirname(join(root, errorSource)), { recursive: true });
  await cp(join(projectRoot, errorSource), join(root, errorSource), { recursive: true });
  await assert.rejects(access(join(protocol, "lib")), { code: "ENOENT" });

  const result = spawnSync(process.execPath, [buildScript], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const bundlePath = join(root, "packages", "harness-overlay", "lib", "client.js");
  const modules = [];
  const bundle = await readFile(bundlePath, "utf8");
  runInNewContext(bundle, {
    window: { __ModuleLoader__: { load: (entry) => modules.push(entry) } },
  });
  assert.equal(modules.length, 1);
  assert.equal(modules[0].id, "@lencx/minke-harness-overlay");
  assert.equal(typeof modules[0].factory, "function");
  const sourceMap = JSON.parse(await readFile(`${bundlePath}.map`, "utf8"));
  assert.ok(bundle.includes('require("@deepseek-ai/dsh-client-ui-primitives")'),
    "injected controls must resolve the host's shared native UI module");
  assert.ok(!sourceMap.sources.some(path => /\/dsh-client-ui-primitives\/|\/ui-primitives\/src\//u.test(path.replaceAll("\\", "/"))),
    "the overlay must not bundle a second native UI implementation");
  assert.ok(sourceMap.sources.some((path) =>
    path.replaceAll("\\", "/").endsWith("/dsh-typert-protocol/src/remote-error.ts")),
  "the client must bundle the official RemoteError from source");
  await assert.rejects(access(join(protocol, "lib")), { code: "ENOENT" });
});
