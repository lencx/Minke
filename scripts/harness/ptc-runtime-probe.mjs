#!/usr/bin/env node

// Exercise the deployed Node PTC provider under Minke's embedded Electron Node,
// including its separate control pipe and the platform sandbox launcher.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [runtimeRoot, temporaryRoot] = process.argv.slice(2);
assert.ok(runtimeRoot && temporaryRoot, "expected runtime and temporary roots");
const requireRuntime = createRequire(join(resolve(runtimeRoot), "package.json"));
const load = name => import(pathToFileURL(requireRuntime.resolve(name)).href);
const [
  { Context }, { default: Sessions }, { default: FileSystem },
  { default: Subprocess }, { default: Sandbox }, { default: SandboxPolicy },
  { default: SessionProjections }, { default: NodeRuntime },
] = await Promise.all([
  "@deepseek-ai/cordis", "@deepseek-ai/dsh-session", "@deepseek-ai/dsh-fs-local",
  "@deepseek-ai/dsh-subprocess-local", "@deepseek-ai/dsh-sandbox-local",
  "@deepseek-ai/dsh-sandbox-policy", "@deepseek-ai/dsh-session-projection",
  "@deepseek-ai/dsh-ptc-runtime-node",
].map(load));

const cwd = join(temporaryRoot, "ptc-workspace");
await mkdir(cwd, { recursive: true });
const ctx = new Context();
try {
  await ctx.plugin(Sessions);
  await ctx.plugin(FileSystem);
  await ctx.plugin(Subprocess);
  await ctx.plugin(Sandbox, {});
  await ctx.plugin(SessionProjections);
  await ctx.plugin(SandboxPolicy, { mode: "workspace-write", workspaceRoot: cwd });
  await ctx.plugin(NodeRuntime, { timeoutMs: 10_000 });
  for (const mode of ["danger-full-access", "workspace-write"]) {
    const result = await ctx.ptcRuntime.run(ctx.ptcRuntime.resolve({
      cwd,
      sandboxPolicy: { mode, workspaceRoot: cwd },
      program: `
        const value: number = await tools.double(21);
        await (await import("node:fs/promises")).writeFile("probe.txt", String(value));
        inspect("ptc-control-ok");
        return { value, cwd: process.cwd(), env: Object.keys(process.env) };
      `,
      bindings: [{ global: "tools", functions: { double: async value => value * 2 } }],
    }));
    assert.equal(result.error, undefined, `${mode}: ${JSON.stringify(result)}`);
    // Windows may report the temporary root through its 8.3 alias. Compare
    // canonical directories on both sides while keeping the full value check.
    assert.deepEqual(
      { ...result.value, cwd: await realpath(result.value.cwd) },
      { value: 42, cwd: await realpath(cwd), env: [] },
    );
    assert.deepEqual(result.output, [{ type: "text", text: "ptc-control-ok\n" }]);
    assert.equal(result.sandbox.mode, mode);
    assert.equal(await readFile(join(cwd, "probe.txt"), "utf8"), "42");
  }
  const denied = await ctx.ptcRuntime.run(ctx.ptcRuntime.resolve({
    cwd,
    sandboxPolicy: { mode: "read-only", workspaceRoot: cwd },
    program: 'await (await import("node:fs/promises")).writeFile("probe.txt", "unexpected");',
    bindings: [],
  }));
  assert.ok(denied.error, "read-only PTC must reject workspace writes");
  assert.equal(await readFile(join(cwd, "probe.txt"), "utf8"), "42");
  console.log("ptc-runtime-ok");
} finally {
  await ctx.fiber.dispose();
}
