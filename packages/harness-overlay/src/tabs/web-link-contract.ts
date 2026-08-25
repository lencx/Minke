export const TABS_WEB_EXTERNAL_LINK_CHANNEL =
  "minke:tabs:web-external-link";
export const TABS_WEB_LOCAL_PATH_CHANNEL =
  "minke:tabs:web-local-path";

const WEB_LINK_MAX_URL_LENGTH = 32_768;
const WEB_LINK_MAX_PATH_LENGTH = 32_768;
const WEB_LINK_MAX_TITLE_LENGTH = 160;

const STANDARD_EXTERNAL_PROTOCOLS = new Set([
  "http:",
  "https:",
  "mailto:",
  "sms:",
  "tel:",
]);

const IN_APP_OR_EXECUTABLE_PROTOCOLS = new Set([
  "about:",
  "blob:",
  "data:",
  "devtools:",
  "file:",
  "javascript:",
]);

export interface WebTabLocalPathRequest {
  readonly path: string;
  readonly title?: string;
}

function boundedText(
  value: unknown,
  maximumLength: number,
): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.includes("\0")
  ) {
    return undefined;
  }
  return value;
}

export function isAbsoluteLocalPath(value: string): boolean {
  return (
    value.startsWith("/") ||
    /^[A-Za-z]:[\\/]/u.test(value) ||
    value.startsWith("\\\\")
  );
}

export function normalizeAbsoluteLocalPath(
  candidate: string,
): string | undefined {
  const value = candidate.trim();
  return (
      value.length <= WEB_LINK_MAX_PATH_LENGTH &&
      isAbsoluteLocalPath(value) &&
      !value.includes("\0")
    )
    ? value
    : undefined;
}

export function fileUrlToAbsoluteLocalPath(
  candidate: string | URL,
  platform: string,
): string | undefined {
  let url: URL;
  try {
    url = candidate instanceof URL
      ? candidate
      : new URL(candidate);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "file:" ||
    /%(?:2f|5c)/iu.test(url.pathname)
  ) {
    return undefined;
  }
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return undefined;
  }
  if (platform === "win32") {
    if (url.hostname !== "") {
      return normalizeAbsoluteLocalPath(
        `\\\\${url.hostname}${path.replace(/\//gu, "\\")}`,
      );
    }
    if (!/^\/[A-Za-z]:\//u.test(path)) return undefined;
    return normalizeAbsoluteLocalPath(
      path.slice(1).replace(/\//gu, "\\"),
    );
  }
  if (url.hostname !== "" || !path.startsWith("/")) {
    return undefined;
  }
  return normalizeAbsoluteLocalPath(path);
}

function normalizedExternalUrl(
  candidate: string,
  allowCustomProtocol: boolean,
): string | undefined {
  if (
    candidate.length === 0 ||
    candidate.length > WEB_LINK_MAX_URL_LENGTH
  ) {
    return undefined;
  }
  try {
    const url = new URL(candidate);
    if (
      url.username !== "" ||
      url.password !== "" ||
      IN_APP_OR_EXECUTABLE_PROTOCOLS.has(url.protocol) ||
      (
        !allowCustomProtocol &&
        !STANDARD_EXTERNAL_PROTOCOLS.has(url.protocol)
      )
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

/**
 * Links accepted from window-open requests, which may be script initiated.
 * Keep this list explicit because the request is not known to be a user
 * gesture.
 */
export function normalizeExternalLinkUrl(
  candidate: string,
): string | undefined {
  return normalizedExternalUrl(candidate, false);
}

/**
 * Links accepted only from the isolated Web Tab preload after a trusted user
 * click. Registered application protocols are allowed, while executable or
 * guest-owned schemes remain inside the WebView policy.
 */
export function normalizeUserGestureExternalLinkUrl(
  candidate: string,
): string | undefined {
  return normalizedExternalUrl(candidate, true);
}

export function parseWebTabLocalPathRequest(
  value: unknown,
): WebTabLocalPathRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError("Web Tab local path request must be an object");
  }
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).some(
      (key) => key !== "path" && key !== "title",
    )
  ) {
    throw new TypeError(
      "Web Tab local path request has unsupported fields",
    );
  }
  const path = boundedText(
    candidate.path,
    WEB_LINK_MAX_PATH_LENGTH,
  );
  const title = candidate.title === undefined
    ? undefined
    : boundedText(candidate.title, WEB_LINK_MAX_TITLE_LENGTH);
  if (
    path === undefined ||
    !isAbsoluteLocalPath(path) ||
    (candidate.title !== undefined && title === undefined)
  ) {
    throw new TypeError("invalid Web Tab local path request");
  }
  return {
    path,
    ...(title === undefined ? {} : { title }),
  };
}
