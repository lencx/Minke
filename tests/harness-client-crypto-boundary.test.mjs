import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  inspectHarnessClientArtifact,
  inspectHarnessClientCryptoBoundary,
} from "../scripts/harness/client-crypto-boundary.mjs";

test("the v0.3 secure-context-only UUID call is rejected", () => {
  assert.throws(
    () =>
      inspectHarnessClientArtifact(
        "function mintRpcId() { return RpcId(crypto.randomUUID()); }\n",
        "node_modules/@deepseek-ai/dsh-host-apiproxy/lib/client.js",
      ),
    /secure-context-only crypto\.randomUUID/u,
  );
});

test("the browser-compatible UUID implementation is accepted", () => {
  assert.doesNotThrow(() =>
    inspectHarnessClientArtifact(
      [
        "export function randomUUID() {",
        "  return globalThis.crypto.getRandomValues(new Uint8Array(16));",
        "}",
        "",
      ].join("\n"),
      "node_modules/@deepseek-ai/dsh-util-crypto/lib/client.js",
    ),
  );
});

test("Host-only crypto imports are rejected from browser artifacts", () => {
  assert.throws(
    () =>
      inspectHarnessClientArtifact(
        'import { randomUUID } from "node:crypto";\nrandomUUID();\n',
        "node_modules/@deepseek-ai/example/lib/client.js",
      ),
    /Host-only node:crypto/u,
  );
});

test("the staged-runtime inspection covers dynamic and static browser code", async () => {
  const runtimeRoot = await mkdtemp(
    join(tmpdir(), "minke-client-crypto-boundary-"),
  );
  const clientBundle = join(
    runtimeRoot,
    "node_modules",
    "@deepseek-ai",
    "example",
    "lib",
    "client.js",
  );
  const frontendBundle = join(
    runtimeRoot,
    "node_modules",
    "@deepseek-ai",
    "dsh-web-frontend",
    "dist",
    "assets",
    "index.js",
  );
  try {
    await mkdir(join(clientBundle, ".."), { recursive: true });
    await mkdir(join(frontendBundle, ".."), { recursive: true });
    await writeFile(
      clientBundle,
      "globalThis.crypto.getRandomValues(new Uint8Array(16));\n",
    );
    await writeFile(frontendBundle, "globalThis.__DSH_BOOT__;\n");

    assert.deepEqual(
      await inspectHarnessClientCryptoBoundary(
        runtimeRoot,
        "@deepseek-ai/dsh-web-frontend",
      ),
      { artifacts: 2 },
    );

    await writeFile(
      clientBundle,
      "globalThis.crypto.randomUUID();\n",
    );
    await assert.rejects(
      inspectHarnessClientCryptoBoundary(
        runtimeRoot,
        "@deepseek-ai/dsh-web-frontend",
      ),
      /secure-context-only crypto\.randomUUID/u,
    );
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});
