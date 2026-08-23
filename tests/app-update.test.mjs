import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  appUpdateAssetName,
  assertTrustedDownloadUrlChain,
  detectAppUpdateTarget,
  fetchAppUpdate,
  selectAppUpdate,
  verifyDownloadedUpdate,
} from "@minke/desktop/main/app-update.ts";
import {
  assertMacFileQuarantined,
} from "@minke/desktop/main/macos-quarantine.ts";
import {
  assertWindowsFileQuarantined,
} from "@minke/desktop/main/windows-quarantine.ts";

const roots = [];
const fixture = Buffer.from("verified minke installer\n");
const fixtureDigest = createHash("sha256")
  .update(fixture)
  .digest("hex");
const macTarget = {
  platform: "darwin",
  architecture: "arm64",
  installer: "dmg",
};

function releaseAsset(name) {
  return {
    name,
    state: "uploaded",
    size: fixture.byteLength,
    digest: `sha256:${fixtureDigest}`,
    browser_download_url:
      `https://github.com/lencx/Minke/releases/download/v0.3.0/${name}`,
  };
}

function releaseDocument(target = macTarget, overrides = {}) {
  return {
    tag_name: "v0.3.0",
    draft: false,
    prerelease: false,
    immutable: true,
    assets: [releaseAsset(appUpdateAssetName(target))],
    ...overrides,
  };
}

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "minke-update-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(
      async (root) =>
        await rm(root, { recursive: true, force: true }),
    ),
  );
});

test("desktop updater detects the exact installer target for each platform", async () => {
  assert.deepEqual(
    await detectAppUpdateTarget("darwin", "arm64"),
    macTarget,
  );
  assert.deepEqual(
    await detectAppUpdateTarget("darwin", "x64"),
    {
      platform: "darwin",
      architecture: "x64",
      installer: "dmg",
    },
  );
  assert.deepEqual(
    await detectAppUpdateTarget("win32", "x64"),
    {
      platform: "win32",
      architecture: "x64",
      installer: "exe",
    },
  );
  assert.deepEqual(
    await detectAppUpdateTarget("linux", "x64", {
      environment: {},
      readOsRelease: async () =>
        'ID=ubuntu\nID_LIKE="debian"\n',
    }),
    {
      platform: "linux",
      architecture: "x64",
      installer: "deb",
    },
  );
  assert.deepEqual(
    await detectAppUpdateTarget("linux", "x64", {
      environment: {},
      readOsRelease: async () =>
        'ID=rocky\nID_LIKE="rhel centos fedora"\n',
    }),
    {
      platform: "linux",
      architecture: "x64",
      installer: "rpm",
    },
  );
  assert.deepEqual(
    await detectAppUpdateTarget("linux", "x64", {
      environment: {},
      readOsRelease: async () => "ID=arch\n",
    }),
    {
      platform: "linux",
      architecture: "x64",
      installer: "appimage",
    },
  );
});

test("Linux AppImage execution and os-release fallback select AppImage safely", async () => {
  let reads = 0;
  assert.deepEqual(
    await detectAppUpdateTarget("linux", "x64", {
      environment: {
        APPIMAGE: "/opt/Minke.AppImage",
      },
      readOsRelease: async () => {
        reads += 1;
        return "ID=ubuntu\n";
      },
    }),
    {
      platform: "linux",
      architecture: "x64",
      installer: "appimage",
    },
  );
  assert.equal(reads, 0);

  const paths = [];
  assert.deepEqual(
    await detectAppUpdateTarget("linux", "x64", {
      environment: {},
      async readOsRelease(path) {
        paths.push(path);
        if (path === "/etc/os-release") {
          throw new Error("missing");
        }
        return "ID=fedora\n";
      },
    }),
    {
      platform: "linux",
      architecture: "x64",
      installer: "rpm",
    },
  );
  assert.deepEqual(paths, [
    "/etc/os-release",
    "/usr/lib/os-release",
  ]);
});

test("desktop updater rejects unsupported platforms, architectures, and target combinations", async () => {
  await assert.rejects(
    detectAppUpdateTarget("freebsd", "x64"),
    /unsupported application update platform/u,
  );
  await assert.rejects(
    detectAppUpdateTarget("win32", "arm64"),
    /unsupported Windows architecture/u,
  );
  await assert.rejects(
    detectAppUpdateTarget("linux", "arm64"),
    /unsupported Linux architecture/u,
  );
  await assert.rejects(
    detectAppUpdateTarget("linux", "x64", {
      environment: {},
      readOsRelease: async () => "x".repeat(65 * 1024),
    }),
    /unexpectedly large/u,
  );
  assert.throws(
    () =>
      appUpdateAssetName({
        platform: "darwin",
        architecture: "x64",
        installer: "exe",
      }),
    /unsupported application update target/u,
  );
});

test("desktop updater selects only a newer immutable release and exact platform asset", () => {
  const targets = [
    macTarget,
    {
      platform: "darwin",
      architecture: "x64",
      installer: "dmg",
    },
    {
      platform: "win32",
      architecture: "x64",
      installer: "exe",
    },
    {
      platform: "linux",
      architecture: "x64",
      installer: "deb",
    },
    {
      platform: "linux",
      architecture: "x64",
      installer: "rpm",
    },
    {
      platform: "linux",
      architecture: "x64",
      installer: "appimage",
    },
  ];
  for (const target of targets) {
    const name = appUpdateAssetName(target);
    const update = selectAppUpdate(
      releaseDocument(target),
      "0.2.0",
      target,
    );
    assert.deepEqual(update, {
      version: "0.3.0",
      tag: "v0.3.0",
      target,
      asset: {
        name,
        size: fixture.byteLength,
        sha256: fixtureDigest,
        url:
          `https://github.com/lencx/Minke/releases/download/v0.3.0/${name}`,
      },
    });
  }
  assert.equal(
    selectAppUpdate(releaseDocument(), "0.3.0", macTarget),
    undefined,
  );
  assert.equal(
    selectAppUpdate(releaseDocument(), "1.0.0", macTarget),
    undefined,
  );
});

test("desktop updater rejects release metadata that cannot be trusted", () => {
  assert.throws(
    () =>
      selectAppUpdate(
        releaseDocument(macTarget, { immutable: false }),
        "0.2.0",
        macTarget,
      ),
    /not immutable/u,
  );
  assert.throws(
    () =>
      selectAppUpdate(
        releaseDocument(macTarget, {
          assets: [
            {
              ...releaseAsset(appUpdateAssetName(macTarget)),
              digest: null,
            },
          ],
        }),
        "0.2.0",
        macTarget,
      ),
    /SHA-256 digest/u,
  );
  assert.throws(
    () =>
      selectAppUpdate(
        releaseDocument(macTarget, {
          assets: [
            {
              ...releaseAsset(appUpdateAssetName(macTarget)),
              browser_download_url:
                "https://attacker.invalid/Minke-macos-arm64.dmg",
            },
          ],
        }),
        "0.2.0",
        macTarget,
      ),
    /download URL/u,
  );
  assert.throws(
    () =>
      selectAppUpdate(
        releaseDocument(macTarget, { prerelease: true }),
        "0.2.0",
        macTarget,
      ),
    /stable release/u,
  );
  assert.throws(
    () =>
      selectAppUpdate(
        releaseDocument(macTarget, {
          assets: [
            releaseAsset("Minke-windows-x64.exe"),
          ],
        }),
        "0.2.0",
        macTarget,
      ),
    /exactly one Minke-macos-arm64.dmg/u,
  );
});

test("release lookup uses the pinned GitHub API endpoint and refuses redirects", async () => {
  const requests = [];
  const update = await fetchAppUpdate(
    async (input, init) => {
      requests.push({ input, init });
      return new Response(JSON.stringify(releaseDocument()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    "0.2.0",
    macTarget,
  );

  assert.equal(update?.version, "0.3.0");
  assert.equal(
    requests[0].input,
    "https://api.github.com/repos/lencx/Minke/releases/latest",
  );
  assert.equal(requests[0].init.redirect, "error");
  assert.equal(requests[0].init.cache, "no-store");
  assert.equal(
    requests[0].init.headers["X-GitHub-Api-Version"],
    "2026-03-10",
  );

  await assert.rejects(
    fetchAppUpdate(
      async () =>
        new Response("temporarily unavailable", {
          status: 503,
        }),
      "0.2.0",
      macTarget,
    ),
    /HTTP 503/u,
  );
});

test("download redirect policy accepts only GitHub's HTTPS release asset chain", () => {
  const assetUrl =
    "https://github.com/lencx/Minke/releases/download/v0.3.0/Minke-macos-arm64.dmg";
  assert.doesNotThrow(() =>
    assertTrustedDownloadUrlChain(assetUrl, [
      assetUrl,
      "https://release-assets.githubusercontent.com/github-production-release-asset/123/file?token=redacted",
    ]),
  );
  assert.throws(
    () =>
      assertTrustedDownloadUrlChain(assetUrl, [
        assetUrl,
        "http://release-assets.githubusercontent.com/file",
      ]),
    /HTTPS/u,
  );
  assert.throws(
    () =>
      assertTrustedDownloadUrlChain(assetUrl, [
        assetUrl,
        "https://github-release.attacker.invalid/file",
      ]),
    /download host/u,
  );
  assert.throws(
    () =>
      assertTrustedDownloadUrlChain(assetUrl, [
        "https://github.com/lencx/Minke/releases/download/v0.3.0/other.dmg",
      ]),
    /initial download URL/u,
  );
});

test("download verification checks regular-file type, exact size, and SHA-256", async () => {
  const root = await temporaryRoot();
  const installer = join(root, "Minke.dmg");
  await writeFile(installer, fixture);
  const asset = {
    name: "Minke-macos-arm64.dmg",
    size: fixture.byteLength,
    sha256: fixtureDigest,
    url:
      "https://github.com/lencx/Minke/releases/download/v0.3.0/Minke-macos-arm64.dmg",
  };

  await assert.doesNotReject(
    verifyDownloadedUpdate(installer, asset),
  );

  await writeFile(installer, Buffer.from("tampered installer\n"));
  await assert.rejects(
    verifyDownloadedUpdate(installer, {
      ...asset,
      size: Buffer.byteLength("tampered installer\n"),
    }),
    /SHA-256 mismatch/u,
  );

  const target = join(root, "target.dmg");
  const linked = join(root, "linked.dmg");
  await writeFile(target, fixture);
  await symlink(target, linked);
  await assert.rejects(
    verifyDownloadedUpdate(linked, asset),
    /regular file/u,
  );
  assert.equal((await lstat(linked)).isSymbolicLink(), true);
});

test("mac updater requires a quarantine attribute and never removes it", async () => {
  const calls = [];
  await assert.doesNotReject(
    assertMacFileQuarantined("/private/tmp/Minke.dmg", async (args) => {
      calls.push(args);
      return "0081;65f00abc;Minke;";
    }),
  );
  assert.deepEqual(calls, [
    ["-p", "com.apple.quarantine", "/private/tmp/Minke.dmg"],
  ]);

  await assert.rejects(
    assertMacFileQuarantined(
      "/private/tmp/Minke.dmg",
      async () => "",
    ),
    /not quarantined/u,
  );
});

test("Windows updater requires and preserves an Internet-zone Mark-of-the-Web", async () => {
  const calls = [];
  await assert.doesNotReject(
    assertWindowsFileQuarantined(
      "C:\\Users\\Minke\\Minke.exe",
      async (path) => {
        calls.push(path);
        return "[ZoneTransfer]\r\nZoneId=3\r\n";
      },
    ),
  );
  assert.deepEqual(calls, [
    "C:\\Users\\Minke\\Minke.exe:Zone.Identifier",
  ]);
  await assert.doesNotReject(
    assertWindowsFileQuarantined(
      "C:\\Minke.exe",
      async () => "[ZoneTransfer]\nZoneId=4\n",
    ),
  );
  await assert.rejects(
    assertWindowsFileQuarantined(
      "C:\\Minke.exe",
      async () => "[ZoneTransfer]\nZoneId=2\n",
    ),
    /trusted Internet-zone/u,
  );
  await assert.rejects(
    assertWindowsFileQuarantined(
      "C:\\Minke.exe",
      async () => {
        throw new Error("missing stream");
      },
    ),
    /no Mark-of-the-Web/u,
  );
});
