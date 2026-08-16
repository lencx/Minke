/** Shared desktop/renderer contract for web content hosted by Tabs. */
export const TABS_OPEN_EXTERNAL_CHANNEL =
  "minke:tabs:open-external";

export const TABS_WEB_PARTITION = "persist:minke-tabs-web";

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
