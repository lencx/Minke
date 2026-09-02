/** Shared desktop/renderer contract for web content hosted by Tabs. */
export const TABS_OPEN_EXTERNAL_CHANNEL =
  "minke:tabs:open-external";

export const TABS_LAYOUT_STATE_READ_CHANNEL =
  "minke:tabs:layout-state:read";
export const TABS_LAYOUT_STATE_WRITE_CHANNEL =
  "minke:tabs:layout-state:write";

export const TABS_WEB_PARTITION = "persist:minke-tabs-web";

export type TabsLayoutPlacement = "right" | "bottom";

export interface TabsLayoutState {
  readonly rightWidth?: number;
  readonly bottomHeight?: number;
}

export interface TabsLayoutStateUpdate {
  readonly placement: TabsLayoutPlacement;
  readonly size: number;
}

function tabsLayoutRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function tabsLayoutSize(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 1 ||
    value > 10_000
  ) {
    throw new TypeError(`${label} must be a finite positive size`);
  }
  return value;
}

export function parseTabsLayoutState(
  value: unknown,
): TabsLayoutState {
  const candidate = tabsLayoutRecord(value, "Tabs layout state");
  if (
    Object.keys(candidate).some(
      (key) => key !== "rightWidth" && key !== "bottomHeight",
    )
  ) {
    throw new TypeError("Tabs layout state has unsupported fields");
  }
  return {
    ...(candidate.rightWidth === undefined
      ? {}
      : {
          rightWidth: tabsLayoutSize(
            candidate.rightWidth,
            "Tabs right panel width",
          ),
        }),
    ...(candidate.bottomHeight === undefined
      ? {}
      : {
          bottomHeight: tabsLayoutSize(
            candidate.bottomHeight,
            "Tabs bottom panel height",
          ),
        }),
  };
}

export function parseTabsLayoutStateUpdate(
  value: unknown,
): TabsLayoutStateUpdate {
  const candidate = tabsLayoutRecord(
    value,
    "Tabs layout state update",
  );
  if (
    Object.keys(candidate).some(
      (key) => key !== "placement" && key !== "size",
    ) ||
    (candidate.placement !== "right" &&
      candidate.placement !== "bottom")
  ) {
    throw new TypeError("invalid Tabs layout placement");
  }
  return {
    placement: candidate.placement,
    size: tabsLayoutSize(candidate.size, "Tabs panel size"),
  };
}

/**
 * Accept only browser resources that can safely live in Minke's isolated
 * guest partition. Embedded credentials are rejected so the panel never
 * turns a visually hidden user-info segment into an accidental secret sink.
 */
export function normalizeWebTabUrl(
  value: string,
): string | undefined {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

const MAX_WEB_FAVICON_URL_LENGTH = 8_192;

/**
 * Accept only bounded browser-resource URLs for a page favicon.
 *
 * Favicons may legitimately be served from a CDN rather than the page's
 * origin, so both URLs are validated independently instead of requiring an
 * origin match.
 */
export function normalizeWebFaviconUrl(
  candidate: string,
  pageUrl: string,
): string | undefined {
  if (candidate.length > MAX_WEB_FAVICON_URL_LENGTH) {
    return undefined;
  }
  const faviconUrl = normalizeWebTabUrl(candidate);
  const normalizedPageUrl = normalizeWebTabUrl(pageUrl);
  if (
    faviconUrl === undefined ||
    normalizedPageUrl === undefined ||
    faviconUrl.length > MAX_WEB_FAVICON_URL_LENGTH
  ) {
    return undefined;
  }
  return faviconUrl;
}
