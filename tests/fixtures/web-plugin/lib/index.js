import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const inject = ["agents", "connection", "typertGateway", "sessionTelemetry", "terminalController", "officeKit", "pluginInventory", "pluginManager", "webServer", "settings", "llm", "web"];

async function probeTerminal(ctx) {
  const cwd = await mkdtemp(join(tmpdir(), "minke-terminal-smoke-"));
  const abort = new AbortController();
  const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]);
  const id = "smoke-terminal";
  const marker = randomUUID();
  let handle;
  let stream;
  let peer;
  try {
    handle = await ctx.agents.create({
      sessionId: `terminal-smoke-${randomUUID()}`,
      meta: { cwd },
      signal,
    });
    const { agent } = handle;
    peer = ctx.connection.createPeer({ principal: { kind: "owner" }, interactions: "none" });
    const controller = ctx.terminalController;
    const created = await controller.create(agent, { id, cols: 80, rows: 24 }, signal);
    if (created.cwd !== cwd || created.state !== "running") throw new Error("DSH terminal did not start in its workspace");
    let input;
    const uplink = new ReadableStream({ start(controller) { input = controller; } });
    const frames = await ctx.typertGateway.stream({
      namespace: "terminal", method: "attach", args: { agentId: agent.id, id },
      peer, signal, uplink,
    });
    stream = frames[Symbol.asyncIterator]();
    const first = await stream.next();
    if (first.done || first.value.type !== "snapshot" || !first.value.writable) throw new Error("DSH terminal did not provide its writable initial screen");
    input.enqueue({ type: "resize", sequence: 1, cols: 100, rows: 30 });
    input.enqueue({ type: "write", sequence: 2, data: `echo ${marker} > terminal-smoke.txt\rexit\r` });
    let info;
    const acknowledged = new Set();
    while (true) {
      const frame = await stream.next();
      if (frame.done) break;
      if (frame.value.type === "state" && frame.value.info.state === "exited") {
        info = frame.value.info;
      }
      if (frame.value.type === "ack") {
        if (frame.value.refusal !== undefined) throw new Error(`DSH terminal refused input: ${frame.value.refusal}`);
        acknowledged.add(frame.value.sequence);
      }
      if (info !== undefined && acknowledged.has(1) && acknowledged.has(2)) break;
    }
    const bytes = await readFile(join(cwd, "terminal-smoke.txt"));
    // Windows PowerShell 5 writes UTF-16LE; cmd and other shells write UTF-8 here.
    const output = bytes[0] === 0xff && bytes[1] === 0xfe
      ? bytes.subarray(2).toString("utf16le") : bytes.toString("utf8");
    if (output.trim() !== marker || info?.exitCode !== 0 || info.cols !== 100 || info.rows !== 30
      || !acknowledged.has(1) || !acknowledged.has(2)) {
      throw new Error(`DSH terminal command, resize or exit failed: ${JSON.stringify({ output, info })}`);
    }
    await controller.close(agent, id);
    if (controller.list(agent.id).length !== 0) throw new Error("DSH terminal remained after close");
    return { command: true, resize: true, exit: true, close: true };
  } finally {
    abort.abort();
    try {
      await stream?.return?.();
    } finally {
      try { await peer?.dispose(); await handle?.dispose(); }
      finally { await rm(cwd, { recursive: true, force: true }); }
    }
  }
}

export function apply(ctx) {
  ctx.webServer.register({
    kind: "exact",
    path: "/smoke/feedback-policy",
    handler(_request, response) {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ sharing: ctx.sessionTelemetry.sharing }));
    },
  });
  ctx.webServer.register({
    kind: "exact",
    path: "/smoke/terminal",
    async handler(request, response) {
      if (request.method !== "POST") {
        response.writeHead(405, { allow: "POST" });
        response.end();
        return;
      }
      const result = await probeTerminal(ctx);
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(result));
    },
  });
  ctx.webServer.register({
    kind: "exact",
    path: "/smoke/model-settings",
    async handler(request, response) {
      if (request.method === "POST") {
        await ctx.settings.update("llm-pi-ai", {
          providers: {
            "minke-smoke-live": {
              api: "openai-completions", baseURL: "http://127.0.0.1:1/v1",
              models: [{ id: "fixture", contextWindow: 8192, maxTokens: 1024 }],
            },
          },
        });
      } else if (request.method !== "GET") {
        response.writeHead(405, { allow: "GET, POST" });
        response.end();
        return;
      }
      const descriptor = ctx.settings.describe({ redactSecrets: true }).find(row => row.ns === "llm-pi-ai");
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ descriptor, providers: ctx.llm.listProviders().map(row => row.id) }));
    },
  });
  ctx.webServer.register({
    kind: "exact",
    path: "/smoke/disable-failed-plugin",
    async handler(request, response) {
      if (request.method !== "POST") {
        response.writeHead(405, { allow: "POST" });
        response.end();
        return;
      }
      const change = await ctx.pluginManager.setBundleEnabled("@dsh-desktop/smoke-failing-web-plugin", false);
      const bundles = await ctx.pluginManager.listBundles();
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ change, bundles }));
    },
  });
  ctx.webServer.register({
    kind: "exact",
    path: "/smoke/automation-tasks",
    async handler(request, response) {
      if (request.method !== "GET") {
        response.writeHead(405, { allow: "GET" });
        response.end();
        return;
      }
      const inventory = await ctx.pluginInventory.list();
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ inventory }));
    },
  });
  ctx.webServer.register({
    kind: "exact",
    path: "/smoke/office-preview",
    async handler(request, response) {
      if (request.method !== "GET") {
        response.writeHead(405, { allow: "GET" });
        response.end();
        return;
      }
      const fixture = new URL("../document-conversion.docx", import.meta.url);
      const info = await stat(fixture);
      const result = await ctx.officeKit.convert({
        extension: "docx",
        priority: "foreground",
        source: {
          key: "minke-smoke-office",
          version: "fixture",
          bytes: info.size,
          async read(signal, maxBytes) {
            signal.throwIfAborted();
            const bytes = await readFile(fixture, { signal });
            if (bytes.length > maxBytes) throw new Error("Office fixture exceeds the converter input limit");
            return { bytes, version: "fixture" };
          },
        },
      });
      response.writeHead(200, {
        "content-type": "application/pdf",
        "cache-control": "no-store",
      });
      response.end(Buffer.from(result.pdf));
    },
  });
  return ctx.webServer.register({
    kind: "exact",
    path: "/smoke/plugin-inventory",
    async handler(request, response) {
      if (request.method !== "GET") {
        response.writeHead(405, { allow: "GET" });
        response.end();
        return;
      }
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      const inventory = await ctx.pluginInventory.list();
      const webSettings = ctx.settings.describe({ redactSecrets: true }).find(row => row.ns === "web")?.value;
      response.end(JSON.stringify({ ...inventory, webProviders: ctx.web.listProviders(), webSettings }));
    },
  });
}
