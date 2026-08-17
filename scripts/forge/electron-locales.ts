import { readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";

export const MAC_ELECTRON_LOCALES = Object.freeze([
  "en.lproj",
  "en_GB.lproj",
  "zh_CN.lproj",
  "zh_TW.lproj",
]);

const PRESERVED_LOCALES = new Set([
  ...MAC_ELECTRON_LOCALES,
  "Base.lproj",
]);

function isLocaleDirectory(name: string): boolean {
  return name.endsWith(".lproj");
}

async function localeDirectories(root: string): Promise<string[]> {
  return (await readdir(root, { withFileTypes: true }))
    .filter((entry) => isLocaleDirectory(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Electron ships every Chromium locale. Minke's locale contract intentionally
 * exposes only English and Chinese, so remove the other packs before signing.
 */
export async function pruneMacElectronLocales(
  appRoot: string,
): Promise<Readonly<{ removed: string[] }>> {
  if (!basename(appRoot).endsWith(".app")) {
    throw new Error(`expected a macOS application bundle, received ${appRoot}`);
  }
  const contentsRoot = join(appRoot, "Contents");
  const appResources = join(contentsRoot, "Resources");
  const frameworkResources = join(
    contentsRoot,
    "Frameworks",
    "Electron Framework.framework",
    "Versions",
    "A",
    "Resources",
  );
  const [frameworkLocales, appLocales] = await Promise.all([
    localeDirectories(frameworkResources),
    localeDirectories(appResources),
  ]);
  for (const required of MAC_ELECTRON_LOCALES) {
    if (
      !frameworkLocales.includes(required) ||
      !appLocales.includes(required)
    ) {
      throw new Error(`Electron locale ${required} is missing from ${appRoot}`);
    }
  }

  const removed = [
    ...new Set([...frameworkLocales, ...appLocales]),
  ].filter((name) => !PRESERVED_LOCALES.has(name));
  await Promise.all(
    removed.flatMap((name) => [
      rm(join(frameworkResources, name), { recursive: true, force: true }),
      rm(join(appResources, name), { recursive: true, force: true }),
    ]),
  );
  return { removed };
}
