import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { configureAppDataPaths } from "@minke/desktop/main/app-data-paths.ts";

const desktopMainSource = await readFile(
  new URL("../desktop/main/main.ts", import.meta.url),
  "utf8",
);

test("desktop data and browser session data share ~/.minke", async () => {
  const homePath = await mkdtemp(join(tmpdir(), "minke-app-data-"));
  const calls = [];
  try {
    configureAppDataPaths({
      getPath(name) {
        assert.equal(name, "home");
        return homePath;
      },
      setPath(name, path) {
        calls.push([name, path]);
      },
    });

    const dataPath = join(homePath, ".minke");
    assert.deepEqual(calls, [
      ["userData", dataPath],
      ["sessionData", dataPath],
    ]);
    assert.equal((await stat(dataPath)).isDirectory(), true);
  } finally {
    await rm(homePath, { recursive: true, force: true });
  }
});

test("desktop configures its data paths before Electron acquires state", () => {
  const configureIndex = desktopMainSource.indexOf(
    "configureAppDataPaths(app);",
  );
  const singleInstanceIndex = desktopMainSource.indexOf(
    "app.requestSingleInstanceLock()",
  );
  const readyIndex = desktopMainSource.indexOf("await app.whenReady()");

  assert.notEqual(configureIndex, -1);
  assert.ok(configureIndex < singleInstanceIndex);
  assert.ok(configureIndex < readyIndex);
});
