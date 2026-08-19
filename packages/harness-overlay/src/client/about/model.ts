import type { DesktopAboutInfo } from "../desktop/index.ts";
import type { AboutTranslate } from "./locales.ts";

export const MINKE_PROJECT_URL =
  "https://github.com/lencx/Minke";
export const DEEPSEEK_HARNESS_URL =
  "https://github.com/deepseek-ai/deepseek-harness";

export function platformLabel(platform: string): string {
  if (platform === "darwin") return "macOS";
  if (platform === "win32") return "Windows";
  if (platform === "linux") return "Linux";
  return platform;
}

export function aboutMetadata(
  info: DesktopAboutInfo,
  t: AboutTranslate,
): string {
  return t("metadata", {
    version: info.version,
    platform: platformLabel(info.platform),
    arch: info.arch,
  });
}

export function aboutTagline(
  t: AboutTranslate,
): readonly [before: string, after: string] {
  const marker = "{harness}";
  const [before, ...after] = t("tagline").split(marker);
  return [before ?? "", after.join(marker)];
}
