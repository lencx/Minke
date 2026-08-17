import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL(
  "../.github/workflows/package.yml",
  import.meta.url,
);
const readmeUrl = new URL("../README.md", import.meta.url);
const packageManifestUrl = new URL("../package.json", import.meta.url);
const harnessManifestUrl = new URL(
  "../vendor/deepseek-harness/package.json",
  import.meta.url,
);
const harnessRuntimeContractUrl = new URL(
  "../config/harness-runtime.json",
  import.meta.url,
);
const releaseAssetNames = [
  "Minke-macos-arm64.dmg",
  "Minke-macos-x64.dmg",
  "Minke-windows-x64.exe",
  "Minke-linux-x64.deb",
  "Minke-linux-x64.rpm",
];

function assertMatrixEntry(source, runner, platform, arch) {
  assert.match(
    source,
    new RegExp(
      [
        `runner:\\s*${runner}`,
        `platform:\\s*${platform}`,
        `arch:\\s*${arch}`,
      ].join("[\\s\\S]*?"),
      "u",
    ),
  );
}

function releaseJobSource(source) {
  source = source.replaceAll("\r\n", "\n");
  const releaseJobIndex = source.indexOf("\n  release:\n");
  assert.notEqual(releaseJobIndex, -1);
  return source.slice(releaseJobIndex);
}

test("GitHub Actions packages each supported desktop platform", async () => {
  const source = await readFile(workflowUrl, "utf8");

  assert.match(source, /^name:\s*Package\s*$/mu);
  assert.match(source, /^\s*workflow_dispatch:\s*$/mu);
  assert.match(source, /^\s*tags:\s*\n\s*-\s*"v\*"\s*$/mu);
  assert.match(
    source,
    /^permissions:\s*\n\s*contents:\s*read\s*$/mu,
  );
  assert.match(source, /fail-fast:\s*false/u);
  assertMatrixEntry(source, "macos-15", "darwin", "arm64");
  assertMatrixEntry(
    source,
    "macos-15-intel",
    "darwin",
    "x64",
  );
  assertMatrixEntry(source, "windows-2025", "win32", "x64");
  assertMatrixEntry(source, "ubuntu-24\\.04", "linux", "x64");

  assert.match(
    source,
    /uses:\s*actions\/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd\s+# v6\.0\.2/u,
  );
  assert.match(source, /submodules:\s*recursive/u);
  assert.match(source, /persist-credentials:\s*false/u);
  assert.match(
    source,
    /uses:\s*pnpm\/action-setup@0e279bb959325dab635dd2c09392533439d90093\s+# v6\.0\.8/u,
  );
  assert.match(
    source,
    /uses:\s*actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020\s+# v7\.0\.0/u,
  );
  assert.match(source, /node-version:\s*"24"/u);
  assert.match(source, /cache:\s*pnpm/u);
  assert.match(
    source,
    /EXPECTED_PLATFORM:\s*\$\{\{\s*matrix\.platform\s*\}\}/u,
  );
  assert.match(
    source,
    /EXPECTED_ARCH:\s*\$\{\{\s*matrix\.arch\s*\}\}/u,
  );
  assert.match(
    source,
    /process\.platform !== process\.env\.EXPECTED_PLATFORM/u,
  );
  assert.match(
    source,
    /process\.arch !== process\.env\.EXPECTED_ARCH/u,
  );
  assert.match(source, /pnpm install --frozen-lockfile/u);
  const harnessInstallIndex = source.indexOf(
    "run: pnpm --dir vendor/deepseek-harness install --recursive --frozen-lockfile --config.node-linker=isolated",
  );
  const typecheckIndex = source.indexOf("run: pnpm typecheck");
  assert.notEqual(harnessInstallIndex, -1);
  assert.ok(harnessInstallIndex < typecheckIndex);

  assert.match(source, /runner\.os == 'Linux'/u);
  assert.match(source, /sudo apt-get install --yes fakeroot rpm/u);
  assert.match(source, /run:\s*pnpm typecheck/u);
  assert.match(source, /run:\s*pnpm test:desktop/u);
  assert.match(source, /run:\s*pnpm make/u);

  assert.match(
    source,
    /uses:\s*actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a\s+# v7\.0\.1/u,
  );
  assert.match(
    source,
    /name:\s*minke-\$\{\{\s*matrix\.platform\s*\}\}-\$\{\{\s*matrix\.arch\s*\}\}/u,
  );
  assert.match(source, /path:\s*out\/make\/\*\*\/\*/u);
  assert.match(source, /if-no-files-found:\s*error/u);
  assert.match(source, /compression-level:\s*0/u);
  assert.doesNotMatch(source, /continue-on-error:/u);

  const releaseJob = releaseJobSource(source);
  assert.match(releaseJob, /needs:\s*package/u);
  assert.match(
    releaseJob,
    /if:\s*startsWith\(github\.ref,\s*'refs\/tags\/v'\)/u,
  );
  assert.match(
    releaseJob,
    /permissions:\s*\n\s*contents:\s*write/u,
  );
  assert.match(
    releaseJob,
    /uses:\s*actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c\s+# v8\.0\.1/u,
  );
  assert.match(releaseJob, /pattern:\s*minke-\*/u);
  assert.match(releaseJob, /merge-multiple:\s*false/u);
  for (const assetName of releaseAssetNames) {
    assert.ok(releaseJob.includes(`stage_asset ${assetName}`));
  }
  assert.match(releaseJob, /sha256sum Minke-\* > SHA256SUMS/u);
  assert.match(releaseJob, /GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/u);
  assert.match(
    releaseJob,
    /GH_REPO:\s*\$\{\{\s*github\.repository\s*\}\}/u,
  );
  assert.match(releaseJob, /gh release create "\$GITHUB_REF_NAME"/u);
  assert.match(releaseJob, /--verify-tag/u);
  assert.match(releaseJob, /--generate-notes/u);
  assert.match(releaseJob, /gh release upload "\$GITHUB_REF_NAME"/u);
  assert.match(releaseJob, /--clobber/u);
});

test("release workflow contract supports Windows line endings", async () => {
  const source = await readFile(workflowUrl, "utf8");
  const releaseJob = releaseJobSource(source.replaceAll("\n", "\r\n"));
  assert.match(releaseJob, /needs:\s*package/u);
});

test("README links directly to every latest installer", async () => {
  const readme = await readFile(readmeUrl, "utf8");

  for (const assetName of releaseAssetNames) {
    assert.ok(
      readme.includes(
        `https://github.com/lencx/Minke/releases/latest/download/${assetName}`,
      ),
    );
  }
});

test("native makers receive required distribution metadata", async () => {
  const manifest = JSON.parse(
    await readFile(packageManifestUrl, "utf8"),
  );

  assert.equal(manifest.author, "lencx <lencx.me@gmail.com>");
  assert.equal(manifest.license, "Apache-2.0");
  assert.equal(
    manifest.repository?.url,
    "git+https://github.com/lencx/Minke.git",
  );
  assert.equal(
    manifest.homepage,
    "https://github.com/lencx/Minke#readme",
  );
  assert.equal(typeof manifest.description, "string");
  assert.notEqual(manifest.description, "");
});

test("packaging uses the package manager pinned by Harness", async () => {
  const [manifest, harnessManifest, runtimeContract] =
    await Promise.all(
      [
        packageManifestUrl,
        harnessManifestUrl,
        harnessRuntimeContractUrl,
      ].map(async (url) => JSON.parse(await readFile(url, "utf8"))),
    );

  assert.equal(
    manifest.packageManager,
    harnessManifest.packageManager,
  );
  assert.equal(
    runtimeContract.pnpmVersion,
    harnessManifest.packageManager.replace(/^pnpm@/u, ""),
  );
});
