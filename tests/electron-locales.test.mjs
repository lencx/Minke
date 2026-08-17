import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  MAC_ELECTRON_LOCALES,
  pruneMacElectronLocales,
} from "../scripts/forge/electron-locales.ts";

async function assertMissing(path) {
  await assert.rejects(access(path), { code: "ENOENT" });
}

test("macOS packaging keeps only Minke's English and Chinese locales", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "minke-locales-"));
  const appRoot = join(temporaryRoot, "Minke.app");
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
  const removedLocales = ["de.lproj", "fr.lproj", "ja.lproj"];

  try {
    await mkdir(appResources, { recursive: true });
    await mkdir(frameworkResources, { recursive: true });
    for (const locale of [...MAC_ELECTRON_LOCALES, ...removedLocales]) {
      const frameworkLocale = join(frameworkResources, locale);
      await mkdir(frameworkLocale);
      await writeFile(join(frameworkLocale, "locale.pak"), locale);
      await symlink(
        join(
          "..",
          "Frameworks",
          "Electron Framework.framework",
          "Versions",
          "A",
          "Resources",
          locale,
        ),
        join(appResources, locale),
      );
    }
    await writeFile(join(frameworkResources, "resources.pak"), "chromium");

    const result = await pruneMacElectronLocales(appRoot);

    assert.deepEqual(result.removed, removedLocales);
    for (const locale of MAC_ELECTRON_LOCALES) {
      assert.equal(
        await readFile(join(frameworkResources, locale, "locale.pak"), "utf8"),
        locale,
      );
      await access(join(appResources, locale));
    }
    for (const locale of removedLocales) {
      await assertMissing(join(frameworkResources, locale));
      await assertMissing(join(appResources, locale));
    }
    assert.equal(
      await readFile(join(frameworkResources, "resources.pak"), "utf8"),
      "chromium",
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
