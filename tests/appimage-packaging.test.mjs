import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL(
  "../.github/workflows/package.yml",
  import.meta.url,
);
const readmeUrl = new URL("../README.md", import.meta.url);
const scriptUrl = new URL("../scripts/forge/appimage.mjs", import.meta.url);

const appImageAssetName = "Minke-linux-x64.AppImage";

test("AppImage script exists and is an executable ESM entry", async () => {
  const script = await readFile(scriptUrl, "utf8");

  assert.match(script, /^#!\/usr\/bin\/env node\s*$/mu);
  assert.match(script, /from "node:child_process"/u);
  assert.match(script, /appimagetool/u);
  assert.match(script, /--appimage-extract-and-run/u);
  assert.match(script, /AppRun/u);
});

test("Linux job builds the AppImage after the distributables", async () => {
  const source = await readFile(workflowUrl, "utf8");

  const appImageStep =
    /name:\s*Build AppImage from deb\s*\n\s*if:\s*runner\.os == 'Linux'\s*\n\s*run:\s*node scripts\/forge\/appimage\.mjs/u;
  assert.match(source, appImageStep);

  const makeIndex = source.indexOf("run: pnpm make");
  const appImageIndex = source.indexOf("Build AppImage from deb");
  const uploadIndex = source.indexOf("Upload distributables");
  assert.notEqual(makeIndex, -1);
  assert.ok(appImageIndex > makeIndex, "AppImage step must run after pnpm make");
  assert.ok(uploadIndex > appImageIndex, "AppImage step must run before upload");
});

test("release job stages and checksums the AppImage", async () => {
  let source = await readFile(workflowUrl, "utf8");
  // The project contract must survive CRLF conversions (see the
  // "release workflow contract supports Windows line endings" test).
  source = source.replaceAll("\r\n", "\n");
  const releaseJobIndex = source.indexOf("\n  release:\n");
  assert.notEqual(releaseJobIndex, -1);
  const releaseJob = source.slice(releaseJobIndex);

  assert.ok(
    releaseJob.includes(`stage_asset ${appImageAssetName}`),
    "release job must stage the AppImage asset",
  );
  assert.match(releaseJob, /'Minke-\*\.AppImage'/u);
  assert.match(releaseJob, /sha256sum Minke-\* > SHA256SUMS/u);
});

test("README links directly to the AppImage installer", async () => {
  const readme = await readFile(readmeUrl, "utf8");

  assert.ok(
    readme.includes(
      `https://github.com/lencx/Minke/releases/latest/download/${appImageAssetName}`,
    ),
  );
});
