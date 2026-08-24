import { request } from "node:http";
import {
  connect as connectTcp,
  createServer as createTcpServer,
} from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const FORGE_DEVELOPMENT_LEASE_PORT = 41_782;
export const FORGE_DEVELOPMENT_RENDERER_PORT = 41_783;

const LEASE_HOST = "127.0.0.1";
const LEASE_PROTOCOL = "minke-forge-development-v1";
const MAX_CONTROL_DOCUMENT_BYTES = 4_096;
const MAX_RENDERER_DOCUMENT_BYTES = 32_768;

function parseLeaseOwner(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return undefined;
  }
  const keys = Object.keys(value);
  if (
    keys.length !== 3 ||
    !keys.includes("protocol") ||
    !keys.includes("pid") ||
    !keys.includes("workspace") ||
    value.protocol !== LEASE_PROTOCOL ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0 ||
    typeof value.workspace !== "string" ||
    value.workspace.length === 0 ||
    value.workspace.length > MAX_CONTROL_DOCUMENT_BYTES
  ) {
    return undefined;
  }
  return Object.freeze({
    pid: value.pid,
    workspace: value.workspace,
  });
}

function listen(server, port, host) {
  return new Promise((resolvePromise, reject) => {
    const cleanup = () => {
      server.off("error", onError);
      server.off("listening", onListening);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      resolvePromise();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({
      exclusive: true,
      host,
      port,
    });
  });
}

function close(server) {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolvePromise();
      } else {
        reject(error);
      }
    });
  });
}

async function bindLease({ host, owner, port }) {
  const document = `${JSON.stringify({
    protocol: LEASE_PROTOCOL,
    ...owner,
  })}\n`;
  const sockets = new Set();
  const server = createTcpServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
    });
    socket.on("error", () => {});
    socket.end(document);
  });
  await listen(server, port, host);
  const address = server.address();
  if (address === null || typeof address !== "object") {
    await close(server);
    throw new Error("development lease has no TCP address");
  }
  let released = false;
  return Object.freeze({
    acquired: true,
    owner,
    port: address.port,
    async release() {
      if (released) return;
      released = true;
      const closed = close(server);
      for (const socket of sockets) socket.destroy();
      await closed;
    },
  });
}

function readLeaseOwner({ host, port, timeoutMs }) {
  return new Promise((resolvePromise) => {
    const socket = connectTcp({ host, port });
    let settled = false;
    let source = "";
    const finish = (owner) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolvePromise(owner);
    };
    const parse = () => {
      try {
        finish(parseLeaseOwner(JSON.parse(source.trim())));
      } catch {
        finish(undefined);
      }
    };
    socket.setEncoding("utf8");
    socket.setTimeout(timeoutMs);
    socket.on("data", (chunk) => {
      source += chunk;
      if (
        Buffer.byteLength(source, "utf8") >
        MAX_CONTROL_DOCUMENT_BYTES
      ) {
        finish(undefined);
      } else if (source.includes("\n")) {
        parse();
      }
    });
    socket.on("end", parse);
    socket.on("timeout", () => finish(undefined));
    socket.on("error", () => finish(undefined));
  });
}

/** Own one development workspace before staging or entering Forge. */
export async function acquireForgeDevelopmentLease({
  host = LEASE_HOST,
  port = FORGE_DEVELOPMENT_LEASE_PORT,
  timeoutMs = 750,
  workspace = process.cwd(),
} = {}) {
  const owner = Object.freeze({
    pid: process.pid,
    workspace: resolve(workspace),
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await bindLease({
        host,
        owner,
        port,
      });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.code !== "EADDRINUSE"
      ) {
        throw error;
      }
      const existing = await readLeaseOwner({
        host,
        port,
        timeoutMs,
      });
      if (existing !== undefined) {
        return Object.freeze({
          acquired: false,
          owner: existing,
        });
      }
      if (attempt === 0) {
        await delay(25);
        continue;
      }
      return Object.freeze({
        acquired: false,
        owner: undefined,
      });
    }
  }
  throw new Error("development lease acquisition did not settle");
}

function requestRendererDocument({
  host,
  port,
  timeoutMs,
}) {
  return new Promise((resolvePromise) => {
    let settled = false;
    let connected = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    };
    const requestValue = request(
      {
        headers: {
          accept: "text/html",
        },
        host,
        method: "GET",
        path: "/",
        port,
        timeout: timeoutMs,
      },
      (response) => {
        let source = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          source += chunk;
          if (
            Buffer.byteLength(source, "utf8") >
            MAX_RENDERER_DOCUMENT_BYTES
          ) {
            requestValue.destroy();
            finish({ reachable: true, source: "" });
          }
        });
        response.on("end", () => {
          finish({ reachable: true, source });
        });
        response.on("error", () => {
          finish({ reachable: true, source: "" });
        });
      },
    );
    requestValue.on("socket", (socket) => {
      if (!socket.connecting) connected = true;
      socket.once("connect", () => {
        connected = true;
      });
    });
    requestValue.on("timeout", () => {
      requestValue.destroy();
      finish({ reachable: connected, source: "" });
    });
    requestValue.on("error", () => {
      finish({ reachable: connected, source: "" });
    });
  });
}

/** Distinguish a legacy Minke renderer from an unrelated port owner. */
export async function inspectForgeDevelopmentRenderer({
  port = FORGE_DEVELOPMENT_RENDERER_PORT,
  timeoutMs = 750,
} = {}) {
  for (const host of ["::1", "127.0.0.1"]) {
    const result = await requestRendererDocument({
      host,
      port,
      timeoutMs,
    });
    if (!result.reachable) continue;
    return (
      result.source.includes("<title>Minke</title>") &&
        result.source.includes('src="/main.tsx"')
    )
      ? "minke"
      : "foreign";
  }
  return "absent";
}

/** Keep the lease across staging, Forge startup, and every child restart. */
export async function runOwnedForgeDevelopment({
  acquireLease,
  inspectRenderer,
  prepare,
  launch,
}) {
  const lease = await acquireLease();
  if (!lease.acquired) {
    return Object.freeze({
      kind: "lease-held",
      owner: lease.owner,
    });
  }
  try {
    const renderer = await inspectRenderer();
    if (renderer === "minke") {
      return Object.freeze({
        kind: "renderer-running",
      });
    }
    if (renderer === "foreign") {
      return Object.freeze({
        kind: "renderer-port-held",
      });
    }
    if (renderer !== "absent") {
      throw new TypeError(
        `unsupported development renderer state ${JSON.stringify(renderer)}`,
      );
    }
    await prepare();
    return Object.freeze({
      kind: "completed",
      result: await launch(),
    });
  } finally {
    await lease.release();
  }
}

/** Exit explicitly because Forge intentionally keeps Vite handles alive. */
export function finishOwnedForgeDevelopment(
  result,
  {
    exit = (code) => process.exit(code),
    signal = (value) => process.kill(process.pid, value),
  } = {},
) {
  if (result.signal !== null) {
    signal(result.signal);
    return;
  }
  exit(result.code ?? 1);
}
