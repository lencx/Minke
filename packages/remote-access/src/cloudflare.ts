/** Cloudflare Access protected named-tunnel transport. */
import {
  spawn as spawnChild,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import {
  createServer,
  request as requestHttp,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import { isAbsolute } from "node:path";
import type { Duplex } from "node:stream";
import {
  createRemoteJWKSet,
  jwtVerify,
} from "jose";
import {
  isRemoteHostnameLabel,
  parseRemoteRuntimeSnapshot,
  parseRemoteSettings,
  type RemoteRuntimeSnapshot,
  type RemoteSettings,
} from "./contract.ts";
import {
  externalRuntimeEnvironment,
  RemoteAccessError,
  type RemoteAccessLifecycle,
  type RemoteLaunchPlan,
  type RemoteProcessSpawner,
} from "./lifecycle.ts";
import {
  parseLoopbackHarnessUrl,
} from "./tailscale.ts";

const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;
const MAX_COMMAND_OUTPUT = 1024 * 1024;
const CLOUDFLARED_READY_MARKER =
  "registered tunnel connection";
const DNS_NAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const TEAM_NAME =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const AUDIENCE = /^[A-Za-z0-9_-]{16,512}$/u;
const TUNNEL_NAME =
  /^(?=.{1,256}$)[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export interface CloudflareAccessConfig {
  hostname: string;
  teamDomain: string;
  audience: string;
  tunnel: string;
  configPath: string;
  originPort: number;
}

export type CloudflareAccessTokenVerifier = (
  token: string,
) => Promise<void>;

export interface CloudflareAccessGatewayOptions {
  config: CloudflareAccessConfig;
  verifyToken: CloudflareAccessTokenVerifier;
  createServer?: typeof createServer;
  request?: typeof requestHttp;
}

export interface CloudflareAccessServiceOptions {
  command?: string;
  settings: RemoteSettings;
  spawn?: RemoteProcessSpawner;
  environment?: NodeJS.ProcessEnv;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  verifyToken?: CloudflareAccessTokenVerifier;
  createGateway?: (
    options: CloudflareAccessGatewayOptions,
  ) => CloudflareAccessGateway;
}

function defaultSpawn(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcess {
  return spawnChild(command, [...args], options);
}

function cloudflaredEnvironment(
  inherited: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return externalRuntimeEnvironment(
    inherited,
    {
      NO_AUTOUPDATE: "true",
    },
    [
      "TUNNEL_CONFIG",
      "TUNNEL_HOSTNAME",
      "TUNNEL_TOKEN",
      "TUNNEL_TOKEN_FILE",
      "TUNNEL_CRED_CONTENTS",
      "TUNNEL_CRED_FILE",
      "TUNNEL_URL",
    ],
  );
}

function canonicalDnsName(
  value: string,
  label: string,
): string {
  if (
    value !== value.toLowerCase() ||
    !DNS_NAME.test(value) ||
    value.endsWith(".ts.net") ||
    value.endsWith(".cloudflareaccess.com")
  ) {
    throw new TypeError(`invalid Cloudflare ${label}`);
  }
  return value;
}

/** Resolve and strictly validate one enabled Cloudflare Access profile. */
export function parseCloudflareAccessConfig(
  settingsValue: unknown,
): CloudflareAccessConfig {
  const settings = parseRemoteSettings(settingsValue);
  const cloudflare = settings.cloudflare;
  const hostname =
    cloudflare.hostnameMode === "generated"
      ? (() => {
          if (
            !isRemoteHostnameLabel(
              cloudflare.generatedLabel,
            )
          ) {
            throw new TypeError(
              "invalid Cloudflare hostname label",
            );
          }
          return `${cloudflare.generatedLabel}.${cloudflare.domain}`;
        })()
      : cloudflare.customHostname;
  const canonicalHostname = canonicalDnsName(
    hostname,
    "hostname",
  );
  if (
    cloudflare.hostnameMode === "generated" &&
    canonicalDnsName(cloudflare.domain, "domain") ===
      canonicalHostname
  ) {
    throw new TypeError("invalid Cloudflare hostname");
  }
  if (!TEAM_NAME.test(cloudflare.teamName)) {
    throw new TypeError("invalid Cloudflare team name");
  }
  if (!AUDIENCE.test(cloudflare.audience)) {
    throw new TypeError(
      "invalid Cloudflare Access audience",
    );
  }
  if (!TUNNEL_NAME.test(cloudflare.tunnel)) {
    throw new TypeError("invalid Cloudflare tunnel name");
  }
  if (
    !isAbsolute(cloudflare.configPath) ||
    cloudflare.configPath.trim() !== cloudflare.configPath
  ) {
    throw new TypeError(
      "Cloudflare config path must be absolute",
    );
  }
  return {
    hostname: canonicalHostname,
    teamDomain:
      `https://${cloudflare.teamName}.cloudflareaccess.com`,
    audience: cloudflare.audience,
    tunnel: cloudflare.tunnel,
    configPath: cloudflare.configPath,
    originPort: cloudflare.originPort,
  };
}

/** Build the rotating-JWKS verifier Cloudflare recommends at origins. */
export function createCloudflareAccessTokenVerifier(
  config: Pick<
    CloudflareAccessConfig,
    "teamDomain" | "audience"
  >,
): CloudflareAccessTokenVerifier {
  const jwks = createRemoteJWKSet(
    new URL(`${config.teamDomain}/cdn-cgi/access/certs`),
  );
  return async (token) => {
    await jwtVerify(token, jwks, {
      algorithms: ["RS256"],
      issuer: config.teamDomain,
      audience: config.audience,
    });
  };
}

function requestHostMatches(
  value: string | undefined,
  hostname: string,
): boolean {
  if (value === undefined) return false;
  try {
    const url = new URL(`https://${value}`);
    return (
      url.hostname === hostname &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      url.port === ""
    );
  } catch {
    return false;
  }
}

function accessToken(
  headers: IncomingHttpHeaders,
): string | undefined {
  const value = headers["cf-access-jwt-assertion"];
  return typeof value === "string" && value !== ""
    ? value
    : undefined;
}

function withoutAccessCookie(
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const cookies = value
    .split(";")
    .map((cookie) => cookie.trim())
    .filter(
      (cookie) =>
        cookie !== "" &&
        !cookie.startsWith("CF_Authorization="),
    );
  return cookies.length === 0 ? undefined : cookies.join("; ");
}

function upstreamHeaders(
  source: IncomingHttpHeaders,
): IncomingHttpHeaders {
  const headers = { ...source };
  Reflect.deleteProperty(
    headers,
    "cf-access-jwt-assertion",
  );
  const cookie = withoutAccessCookie(
    typeof source.cookie === "string"
      ? source.cookie
      : undefined,
  );
  if (cookie === undefined) {
    Reflect.deleteProperty(headers, "cookie");
  } else {
    headers.cookie = cookie;
  }
  return headers;
}

function rejectUpgrade(
  socket: Duplex,
  status: 400 | 403 | 503,
): void {
  const phrase =
    status === 400
      ? "Bad Request"
      : status === 403
        ? "Forbidden"
        : "Service Unavailable";
  socket.end(
    `HTTP/1.1 ${String(status)} ${phrase}\r\n` +
      "Connection: close\r\n" +
      "Content-Length: 0\r\n\r\n",
  );
}

/**
 * Verify Access JWTs before forwarding HTTP and WebSocket traffic to DSH.
 * The gateway listens on loopback only and removes Cloudflare credentials
 * before the application receives the request.
 */
export class CloudflareAccessGateway {
  readonly #config: CloudflareAccessConfig;
  readonly #verifyToken: CloudflareAccessTokenVerifier;
  readonly #createServer: typeof createServer;
  readonly #request: typeof requestHttp;
  readonly #sockets = new Set<Socket>();
  #server: Server | undefined;
  #target: URL | undefined;

  constructor(options: CloudflareAccessGatewayOptions) {
    this.#config = options.config;
    this.#verifyToken = options.verifyToken;
    this.#createServer = options.createServer ?? createServer;
    this.#request = options.request ?? requestHttp;
  }

  setTarget(value: string | undefined): void {
    this.#target =
      value === undefined
        ? undefined
        : new URL(parseLoopbackHarnessUrl(value));
  }

  async start(): Promise<void> {
    if (this.#server?.listening === true) return;
    const server = this.#createServer((request, response) => {
      void this.#handle(request, response);
    });
    this.#server = server;
    server.on("connection", (socket) => {
      this.#sockets.add(socket);
      socket.once("close", () => {
        this.#sockets.delete(socket);
      });
    });
    server.on("upgrade", (request, socket, head) => {
      void this.#handleUpgrade(request, socket, head);
    });
    try {
      await new Promise<void>((resolvePromise, reject) => {
        const onError = (error: Error): void => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = (): void => {
          server.off("error", onError);
          resolvePromise();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen({
          host: "127.0.0.1",
          port: this.#config.originPort,
          exclusive: true,
        });
      });
    } catch (error) {
      if (this.#server === server) this.#server = undefined;
      throw error;
    }
    const address = server.address();
    if (
      address === null ||
      typeof address === "string" ||
      address.address !== "127.0.0.1" ||
      address.port !== this.#config.originPort
    ) {
      await this.stop();
      throw new Error(
        "Cloudflare gateway bound an unexpected address",
      );
    }
  }

  async stop(): Promise<void> {
    this.#target = undefined;
    for (const socket of this.#sockets) socket.destroy();
    this.#sockets.clear();
    const server = this.#server;
    this.#server = undefined;
    if (server?.listening === true) {
      await new Promise<void>((resolvePromise) => {
        server.close(() => resolvePromise());
      });
    }
  }

  async #authorized(
    request: IncomingMessage,
  ): Promise<boolean> {
    if (
      !requestHostMatches(
        request.headers.host,
        this.#config.hostname,
      )
    ) {
      return false;
    }
    const token = accessToken(request.headers);
    if (token === undefined) return false;
    try {
      await this.#verifyToken(token);
      return true;
    } catch {
      return false;
    }
  }

  async #handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (!(await this.#authorized(request))) {
      response.writeHead(403, {
        "content-type": "text/plain; charset=utf-8",
      });
      response.end("forbidden");
      return;
    }
    const target = this.#target;
    if (target === undefined) {
      response.writeHead(503, {
        "content-type": "text/plain; charset=utf-8",
        "retry-after": "1",
      });
      response.end("Minke is starting");
      return;
    }
    if (
      request.url === undefined ||
      !request.url.startsWith("/")
    ) {
      response.writeHead(400);
      response.end();
      return;
    }
    const upstream = this.#request({
      hostname: target.hostname,
      port: Number(target.port),
      method: request.method,
      path: request.url,
      headers: upstreamHeaders(request.headers),
    });
    upstream.on("response", (incoming) => {
      response.writeHead(
        incoming.statusCode ?? 502,
        incoming.statusMessage,
        incoming.headers,
      );
      incoming.pipe(response);
    });
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    request.on("error", () => upstream.destroy());
    request.pipe(upstream);
  }

  async #handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    if (!(await this.#authorized(request))) {
      rejectUpgrade(socket, 403);
      return;
    }
    const target = this.#target;
    if (target === undefined) {
      rejectUpgrade(socket, 503);
      return;
    }
    if (
      request.url === undefined ||
      !request.url.startsWith("/")
    ) {
      rejectUpgrade(socket, 400);
      return;
    }
    const upstream = this.#request({
      hostname: target.hostname,
      port: Number(target.port),
      method: request.method,
      path: request.url,
      headers: upstreamHeaders(request.headers),
    });
    upstream.once(
      "upgrade",
      (response, upstreamSocket, upstreamHead) => {
        const status = response.statusCode ?? 101;
        const phrase =
          response.statusMessage ?? "Switching Protocols";
        socket.write(
          `HTTP/1.1 ${String(status)} ${phrase}\r\n`,
        );
        for (let index = 0;
          index < response.rawHeaders.length;
          index += 2) {
          socket.write(
            `${response.rawHeaders[index]}: ` +
              `${response.rawHeaders[index + 1]}\r\n`,
          );
        }
        socket.write("\r\n");
        if (upstreamHead.length > 0) {
          socket.write(upstreamHead);
        }
        if (head.length > 0) upstreamSocket.write(head);
        socket.pipe(upstreamSocket);
        upstreamSocket.pipe(socket);
      },
    );
    upstream.once("response", (response) => {
      response.resume();
      rejectUpgrade(socket, 503);
    });
    upstream.once("error", () => {
      rejectUpgrade(socket, 503);
    });
    upstream.end();
  }
}

function classifyCloudflaredFailure(
  output: string,
): "cloudflare-config" | "cloudflare-access" | "cloudflare-tunnel" {
  const normalized = output.toLowerCase();
  if (
    normalized.includes("access") &&
    (
      normalized.includes("jwt") ||
      normalized.includes("audience") ||
      normalized.includes("audtag")
    )
  ) {
    return "cloudflare-access";
  }
  if (
    normalized.includes("config") ||
    normalized.includes("credentials") ||
    normalized.includes("ingress") ||
    normalized.includes("origin")
  ) {
    return "cloudflare-config";
  }
  return "cloudflare-tunnel";
}

/** Own one foreground, locally configured named Cloudflare Tunnel. */
export class CloudflareAccessService
implements RemoteAccessLifecycle {
  readonly #command: string | undefined;
  readonly #settings: RemoteSettings;
  readonly #enabled: boolean;
  readonly #spawn: RemoteProcessSpawner;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #startupTimeoutMs: number;
  readonly #shutdownTimeoutMs: number;
  readonly #verifyToken:
    CloudflareAccessTokenVerifier | undefined;
  readonly #createGateway: (
    options: CloudflareAccessGatewayOptions,
  ) => CloudflareAccessGateway;
  #config: CloudflareAccessConfig | undefined;
  #gateway: CloudflareAccessGateway | undefined;
  #process: ChildProcess | undefined;
  #output = "";
  #stopping = false;
  #snapshot: RemoteRuntimeSnapshot;

  constructor(options: CloudflareAccessServiceOptions) {
    this.#settings = parseRemoteSettings(options.settings);
    this.#enabled =
      this.#settings.enabled &&
      this.#settings.method === "cloudflare";
    this.#command =
      options.command?.trim() === ""
        ? undefined
        : options.command;
    this.#spawn = options.spawn ?? defaultSpawn;
    this.#environment = cloudflaredEnvironment(
      options.environment ?? process.env,
    );
    this.#startupTimeoutMs =
      options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.#shutdownTimeoutMs =
      options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    this.#verifyToken = options.verifyToken;
    this.#createGateway =
      options.createGateway ??
      ((gatewayOptions) =>
        new CloudflareAccessGateway(gatewayOptions));
    this.#snapshot = {
      method: "cloudflare",
      transport: "access",
      state: this.#enabled && this.#command === undefined
        ? "unavailable"
        : "disabled",
    };
  }

  read(): RemoteRuntimeSnapshot {
    return parseRemoteRuntimeSnapshot(this.#snapshot);
  }

  async prepare(): Promise<RemoteLaunchPlan> {
    if (!this.#enabled) {
      this.#publish("disabled");
      return { trustedHosts: [] };
    }
    if (this.#command === undefined) {
      this.#publish("unavailable");
      return { trustedHosts: [] };
    }
    let config: CloudflareAccessConfig;
    try {
      config = parseCloudflareAccessConfig(this.#settings);
    } catch {
      this.#publishError("cloudflare-config");
      throw new RemoteAccessError(
        "cloudflare-config",
        "Cloudflare Access settings are incomplete or invalid",
      );
    }
    const verifyToken =
      this.#verifyToken ??
      createCloudflareAccessTokenVerifier(config);
    const gateway = this.#createGateway({
      config,
      verifyToken,
    });
    try {
      await gateway.start();
    } catch {
      this.#publishError("cloudflare-config");
      throw new RemoteAccessError(
        "cloudflare-config",
        "Cloudflare's loopback origin port is unavailable",
      );
    }
    this.#config = config;
    this.#gateway = gateway;
    this.#publish(
      "ready",
      `https://${config.hostname}`,
    );
    return { trustedHosts: [config.hostname] };
  }

  async start(targetValue: string): Promise<void> {
    if (!this.#enabled || this.#command === undefined) return;
    if (this.#process !== undefined) {
      throw new Error("remote access is already running");
    }
    const config = this.#config;
    const gateway = this.#gateway;
    if (config === undefined || gateway === undefined) {
      throw new RemoteAccessError(
        "cloudflare-config",
        "Cloudflare Access must be prepared before it starts",
      );
    }
    const target = parseLoopbackHarnessUrl(targetValue);
    await gateway.start();
    gateway.setTarget(target);
    this.#output = "";
    this.#stopping = false;

    let child: ChildProcess;
    try {
      child = this.#spawn(
        this.#command,
        [
          "tunnel",
          "--no-autoupdate",
          "--config",
          config.configPath,
          "--url",
          `http://127.0.0.1:${String(config.originPort)}`,
          "--loglevel",
          "info",
          "run",
          config.tunnel,
        ],
        {
          detached: false,
          env: this.#environment,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
    } catch {
      await gateway.stop();
      this.#publishError("cloudflare-tunnel");
      throw new RemoteAccessError(
        "cloudflare-tunnel",
        "cloudflared could not start",
      );
    }
    this.#process = child;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    const capture = (chunk: string | Buffer): void => {
      this.#output = `${this.#output}${String(chunk)}`.slice(
        -MAX_COMMAND_OUTPUT,
      );
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    child.on("error", () => {
      if (this.#process === child && !this.#stopping) {
        this.#publishError(
          classifyCloudflaredFailure(this.#output),
        );
      }
    });
    child.once("exit", () => {
      if (this.#process !== child) return;
      this.#process = undefined;
      if (!this.#stopping) {
        this.#publishError(
          classifyCloudflaredFailure(this.#output),
        );
        void gateway.stop();
      }
    });

    try {
      await this.#waitUntilReady(child);
      this.#publish(
        "active",
        `https://${config.hostname}`,
      );
    } catch {
      const kind = classifyCloudflaredFailure(this.#output);
      await this.#terminate(child);
      await gateway.stop();
      this.#publishError(kind);
      throw new RemoteAccessError(
        kind,
        "Cloudflare Tunnel failed to become ready",
      );
    }
  }

  async stop(): Promise<void> {
    const child = this.#process;
    if (child !== undefined) {
      await this.#terminate(child);
    }
    await this.#gateway?.stop();
    if (this.#config !== undefined) {
      this.#publish(
        "ready",
        `https://${this.#config.hostname}`,
      );
    } else if (!this.#enabled) {
      this.#publish("disabled");
    } else if (this.#command === undefined) {
      this.#publish("unavailable");
    }
  }

  #publish(
    state: "disabled" | "unavailable" | "ready" | "active",
    url?: string,
  ): void {
    this.#snapshot = parseRemoteRuntimeSnapshot({
      method: "cloudflare",
      transport: "access",
      state,
      ...(url === undefined ? {} : { url }),
    });
  }

  #publishError(
    error:
      | "cloudflare-config"
      | "cloudflare-access"
      | "cloudflare-tunnel",
  ): void {
    this.#snapshot = parseRemoteRuntimeSnapshot({
      method: "cloudflare",
      transport: "access",
      state: "error",
      error,
    });
  }

  async #waitUntilReady(
    child: ChildProcess,
  ): Promise<void> {
    await new Promise<void>((resolvePromise, reject) => {
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        child.stdout?.off("data", inspect);
        child.stderr?.off("data", inspect);
        child.off("error", onError);
        child.off("exit", onExit);
        if (error === undefined) resolvePromise();
        else reject(error);
      };
      const inspect = (): void => {
        if (
          this.#output
            .toLowerCase()
            .includes(CLOUDFLARED_READY_MARKER)
        ) {
          finish();
        }
      };
      const onError = (): void => {
        finish(new Error("cloudflared process failed"));
      };
      const onExit = (): void => {
        finish(
          new Error(
            "cloudflared exited before readiness",
          ),
        );
      };
      const timeout = setTimeout(() => {
        finish(
          new Error("cloudflared readiness timed out"),
        );
      }, this.#startupTimeoutMs);
      child.stdout?.on("data", inspect);
      child.stderr?.on("data", inspect);
      child.once("error", onError);
      child.once("exit", onExit);
      inspect();
    });
  }

  async #terminate(child: ChildProcess): Promise<void> {
    this.#stopping = true;
    if (
      child.exitCode === null &&
      child.signalCode === null
    ) {
      child.kill(
        process.platform === "win32" ? "SIGTERM" : "SIGINT",
      );
    }
    const exited = await this.#waitForExit(
      child,
      this.#shutdownTimeoutMs,
    );
    if (!exited) {
      child.kill("SIGKILL");
      await this.#waitForExit(child, 1_000);
    }
    if (this.#process === child) this.#process = undefined;
    this.#stopping = false;
  }

  async #waitForExit(
    child: ChildProcess,
    timeoutMs: number,
  ): Promise<boolean> {
    if (
      child.exitCode !== null ||
      child.signalCode !== null
    ) {
      return true;
    }
    return await new Promise<boolean>((resolvePromise) => {
      const timeout = setTimeout(() => {
        child.off("exit", onExit);
        resolvePromise(false);
      }, timeoutMs);
      const onExit = (): void => {
        clearTimeout(timeout);
        resolvePromise(true);
      };
      child.once("exit", onExit);
    });
  }
}
