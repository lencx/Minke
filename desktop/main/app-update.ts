import { createHash, timingSafeEqual } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

export const GITHUB_LATEST_RELEASE_API =
  "https://api.github.com/repos/lencx/Minke/releases/latest";

const GITHUB_API_VERSION = "2026-03-10";
const MAX_RELEASE_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_INSTALLER_BYTES = 512 * 1024 * 1024;
const MAX_OS_RELEASE_BYTES = 64 * 1024;
const MAX_REDIRECTS = 5;
const TRUSTED_DOWNLOAD_HOSTS = new Set([
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
]);

export type UpdatePlatform = "darwin" | "win32" | "linux";
export type UpdateInstallerKind =
  | "dmg"
  | "exe"
  | "deb"
  | "rpm"
  | "appimage";

export interface AppUpdateTarget {
  platform: UpdatePlatform;
  architecture: "arm64" | "x64";
  installer: UpdateInstallerKind;
}

interface StableVersion {
  major: number;
  minor: number;
  patch: number;
  value: string;
}

export interface AppUpdateAsset {
  name: string;
  size: number;
  sha256: string;
  url: string;
}

export interface AppUpdate {
  version: string;
  tag: string;
  target: AppUpdateTarget;
  asset: AppUpdateAsset;
}

export type UpdateFetcher = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export type OsReleaseReader = (path: string) => Promise<string>;

export function shouldConfirmUpdateDownload(
  autoDownload: boolean,
): boolean {
  return !autoDownload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function stableVersion(value: unknown, label: string): StableVersion {
  if (typeof value !== "string") {
    throw new TypeError(`${label} is not a stable semantic version`);
  }
  const match =
    /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(
      value,
    );
  if (match === null) {
    throw new TypeError(`${label} is not a stable semantic version`);
  }
  const [major, minor, patch] = match
    .slice(1)
    .map((part) => Number(part));
  if (
    !Number.isSafeInteger(major) ||
    !Number.isSafeInteger(minor) ||
    !Number.isSafeInteger(patch)
  ) {
    throw new TypeError(`${label} exceeds the supported version range`);
  }
  return {
    major,
    minor,
    patch,
    value: `${String(major)}.${String(minor)}.${String(patch)}`,
  };
}

function compareVersions(
  left: StableVersion,
  right: StableVersion,
): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  return 0;
}

function normalizedTarget(
  value: AppUpdateTarget,
): AppUpdateTarget {
  if (
    value.platform === "darwin" &&
    (value.architecture === "arm64" ||
      value.architecture === "x64") &&
    value.installer === "dmg"
  ) {
    return { ...value };
  }
  if (
    value.platform === "win32" &&
    value.architecture === "x64" &&
    value.installer === "exe"
  ) {
    return { ...value };
  }
  if (
    value.platform === "linux" &&
    value.architecture === "x64" &&
    (value.installer === "deb" ||
      value.installer === "rpm" ||
      value.installer === "appimage")
  ) {
    return { ...value };
  }
  throw new TypeError(
    `unsupported application update target: ${value.platform}/${value.architecture}/${value.installer}`,
  );
}

export function appUpdateAssetName(
  value: AppUpdateTarget,
): string {
  const target = normalizedTarget(value);
  if (target.platform === "darwin") {
    return `Minke-macos-${target.architecture}.dmg`;
  }
  if (target.platform === "win32") {
    return "Minke-windows-x64.exe";
  }
  if (target.installer === "appimage") {
    return "Minke-linux-x64.AppImage";
  }
  return `Minke-linux-x64.${target.installer}`;
}

function parseOsReleaseFamily(source: string): "deb" | "rpm" | undefined {
  const identifiers = new Set<string>();
  for (const line of source.split(/\r?\n/u)) {
    const match =
      /^(ID|ID_LIKE)=(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([A-Za-z0-9._ -]*))$/u.exec(
        line.trim(),
      );
    if (match === null) continue;
    for (
      const identifier of (match[2] ?? match[3] ?? match[4] ?? "")
        .toLowerCase()
        .split(/[\s,]+/u)
    ) {
      if (identifier !== "") identifiers.add(identifier);
    }
  }
  const debianFamily = [
    "debian",
    "ubuntu",
    "linuxmint",
    "pop",
    "elementary",
    "kali",
    "raspbian",
  ].some((identifier) => identifiers.has(identifier));
  const rpmFamily = [
    "rhel",
    "fedora",
    "centos",
    "rocky",
    "almalinux",
    "suse",
    "opensuse",
  ].some((identifier) => identifiers.has(identifier));
  if (debianFamily === rpmFamily) return undefined;
  return debianFamily ? "deb" : "rpm";
}

async function linuxInstallerKind(
  environment: NodeJS.ProcessEnv,
  reader: OsReleaseReader,
): Promise<"deb" | "rpm" | "appimage"> {
  const appImagePath = environment.APPIMAGE;
  if (
    typeof appImagePath === "string" &&
    appImagePath !== "" &&
    isAbsolute(appImagePath)
  ) {
    return "appimage";
  }
  for (const path of ["/etc/os-release", "/usr/lib/os-release"]) {
    try {
      const source = await reader(path);
      if (
        Buffer.byteLength(source, "utf8") >
        MAX_OS_RELEASE_BYTES
      ) {
        throw new RangeError(
          "Linux os-release document is unexpectedly large",
        );
      }
      return parseOsReleaseFamily(source) ?? "appimage";
    } catch (error) {
      if (error instanceof RangeError) throw error;
    }
  }
  return "appimage";
}

/** Resolve the one release artifact supported by the running desktop build. */
export async function detectAppUpdateTarget(
  platform: string,
  architecture: string,
  options: {
    environment?: NodeJS.ProcessEnv;
    readOsRelease?: OsReleaseReader;
  } = {},
): Promise<AppUpdateTarget> {
  if (platform === "darwin") {
    if (architecture !== "arm64" && architecture !== "x64") {
      throw new TypeError(
        `unsupported macOS architecture: ${architecture}`,
      );
    }
    return {
      platform,
      architecture,
      installer: "dmg",
    };
  }
  if (platform === "win32") {
    if (architecture !== "x64") {
      throw new TypeError(
        `unsupported Windows architecture: ${architecture}`,
      );
    }
    return {
      platform,
      architecture,
      installer: "exe",
    };
  }
  if (platform === "linux") {
    if (architecture !== "x64") {
      throw new TypeError(
        `unsupported Linux architecture: ${architecture}`,
      );
    }
    return {
      platform,
      architecture,
      installer: await linuxInstallerKind(
        options.environment ?? process.env,
        options.readOsRelease ??
          (async (path) => await readFile(path, "utf8")),
      ),
    };
  }
  throw new TypeError(
    `unsupported application update platform: ${platform}`,
  );
}

function releaseAssetUrl(tag: string, assetName: string): string {
  return `https://github.com/lencx/Minke/releases/download/${tag}/${assetName}`;
}

function trustedAsset(
  value: unknown,
  tag: string,
  target: AppUpdateTarget,
): AppUpdateAsset {
  if (!Array.isArray(value)) {
    throw new TypeError("release assets are missing");
  }
  const name = appUpdateAssetName(target);
  const candidates = value.filter(
    (candidate) =>
      isRecord(candidate) && candidate.name === name,
  );
  if (candidates.length !== 1) {
    throw new TypeError(
      `release must contain exactly one ${name} asset`,
    );
  }
  const candidate = candidates[0];
  if (candidate.state !== "uploaded") {
    throw new TypeError(`${name} is not completely uploaded`);
  }
  if (
    typeof candidate.size !== "number" ||
    !Number.isSafeInteger(candidate.size) ||
    candidate.size <= 0 ||
    candidate.size > MAX_INSTALLER_BYTES
  ) {
    throw new TypeError(`${name} has an invalid installer size`);
  }
  const digest =
    typeof candidate.digest === "string"
      ? /^sha256:([0-9a-f]{64})$/u.exec(candidate.digest)
      : null;
  if (digest === null) {
    throw new TypeError(`${name} has no valid SHA-256 digest`);
  }
  const expectedUrl = releaseAssetUrl(tag, name);
  if (candidate.browser_download_url !== expectedUrl) {
    throw new TypeError(`${name} has an untrusted download URL`);
  }
  return {
    name,
    size: candidate.size,
    sha256: digest[1],
    url: expectedUrl,
  };
}

/**
 * Converts GitHub's latest-release document into a fail-closed desktop update.
 * The GitHub immutable-release boundary is the current release trust root.
 */
export function selectAppUpdate(
  value: unknown,
  currentVersion: string,
  targetValue: AppUpdateTarget,
): AppUpdate | undefined {
  const target = normalizedTarget(targetValue);
  const current = stableVersion(currentVersion, "current version");
  if (!isRecord(value)) {
    throw new TypeError("latest release response is not an object");
  }
  const tag =
    typeof value.tag_name === "string" ? value.tag_name : "";
  const candidate = stableVersion(tag, "release tag");
  if (compareVersions(candidate, current) <= 0) return undefined;
  if (value.draft !== false || value.prerelease !== false) {
    throw new TypeError("latest update is not a stable release");
  }
  if (value.immutable !== true) {
    throw new TypeError("latest update release is not immutable");
  }
  return {
    version: candidate.value,
    tag,
    target,
    asset: trustedAsset(value.assets, tag, target),
  };
}

export async function fetchAppUpdate(
  fetcher: UpdateFetcher,
  currentVersion: string,
  target: AppUpdateTarget,
): Promise<AppUpdate | undefined> {
  const response = await fetcher(GITHUB_LATEST_RELEASE_API, {
    method: "GET",
    redirect: "error",
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": `Minke/${currentVersion}`,
    },
  });
  if (!response.ok) {
    throw new Error(
      `GitHub latest-release request failed with HTTP ${String(response.status)}`,
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("json")) {
    throw new TypeError(
      "GitHub latest-release response is not JSON",
    );
  }
  const source = await response.text();
  if (source.length > MAX_RELEASE_DOCUMENT_BYTES) {
    throw new RangeError(
      "GitHub latest-release response is unexpectedly large",
    );
  }
  let document: unknown;
  try {
    document = JSON.parse(source) as unknown;
  } catch {
    throw new TypeError(
      "GitHub latest-release response is invalid JSON",
    );
  }
  return selectAppUpdate(document, currentVersion, target);
}

export function assertTrustedDownloadUrlChain(
  expectedUrl: string,
  chain: readonly string[],
): void {
  if (chain.length === 0 || chain[0] !== expectedUrl) {
    throw new TypeError("update has an unexpected initial download URL");
  }
  if (chain.length > MAX_REDIRECTS + 1) {
    throw new TypeError("update download has too many redirects");
  }
  for (const value of chain.slice(1)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new TypeError("update download contains an invalid URL");
    }
    if (url.protocol !== "https:") {
      throw new TypeError("update download redirects must use HTTPS");
    }
    if (!TRUSTED_DOWNLOAD_HOSTS.has(url.hostname)) {
      throw new TypeError(
        `update download host is not trusted: ${url.hostname}`,
      );
    }
    if (url.username !== "" || url.password !== "") {
      throw new TypeError(
        "update download URL must not contain credentials",
      );
    }
  }
}

export async function verifyDownloadedUpdate(
  path: string,
  asset: AppUpdateAsset,
): Promise<void> {
  const pathDetails = await lstat(path);
  if (!pathDetails.isFile() || pathDetails.isSymbolicLink()) {
    throw new TypeError("downloaded update is not a regular file");
  }
  const file = await open(
    path,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
  );
  try {
    const before = await file.stat();
    if (!before.isFile()) {
      throw new TypeError("downloaded update is not a regular file");
    }
    if (before.size !== asset.size) {
      throw new Error(
        `downloaded update size mismatch: expected ${String(asset.size)}, received ${String(before.size)}`,
      );
    }
    const hash = createHash("sha256");
    for await (const chunk of file.createReadStream({
      autoClose: false,
      start: 0,
    })) {
      hash.update(chunk);
    }
    const after = await file.stat();
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    ) {
      throw new Error(
        "downloaded update changed during verification",
      );
    }
    const actual = hash.digest();
    const expected = Buffer.from(asset.sha256, "hex");
    if (
      expected.byteLength !== actual.byteLength ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new Error("downloaded update SHA-256 mismatch");
    }
  } finally {
    await file.close();
  }
}
