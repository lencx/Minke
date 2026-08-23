import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, test } from "node:test";
import {
  discoverReleaseAssets,
  GITHUB_RELEASE_API_VERSION,
  publishGithubRelease,
  RELEASE_ASSET_NAMES,
} from "../scripts/forge/github-release.mjs";

const roots = [];

async function releaseAssetFixture() {
  const root = await mkdtemp(join(tmpdir(), "minke-release-"));
  roots.push(root);
  await Promise.all(
    RELEASE_ASSET_NAMES.map(
      async (name) =>
        await writeFile(join(root, name), `${name}\n`),
    ),
  );
  return root;
}

function result(status, stdout = "", stderr = "") {
  return { status, stdout, stderr };
}

function runner(results) {
  const calls = [];
  return {
    calls,
    run: async (args) => {
      calls.push(args);
      const next = results.shift();
      assert.notEqual(next, undefined);
      return next;
    },
  };
}

function publishOptions(assets, runGh) {
  return {
    assets,
    packageVersion: "0.3.0",
    releaseTag: "v0.3.0",
    repository: "lencx/Minke",
    runGh,
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(
      async (root) =>
        await rm(root, { recursive: true, force: true }),
    ),
  );
});

test("release asset discovery accepts only the exact non-empty installer set", async () => {
  const root = await releaseAssetFixture();
  const assets = await discoverReleaseAssets(root);
  assert.deepEqual(
    assets.map((path) => basename(path)),
    RELEASE_ASSET_NAMES,
  );

  await writeFile(join(root, "unexpected.txt"), "unexpected\n");
  await assert.rejects(
    discoverReleaseAssets(root),
    /exact required set/u,
  );
});

test("release asset discovery rejects symbolic links", async () => {
  const root = await releaseAssetFixture();
  await rm(join(root, "SHA256SUMS"));
  await symlink(
    join(root, "Minke-linux-x64.deb"),
    join(root, "SHA256SUMS"),
  );
  await assert.rejects(
    discoverReleaseAssets(root),
    /non-empty regular file/u,
  );
});

test("release publication creates a draft and accepts only an immutable published release", async () => {
  const root = await releaseAssetFixture();
  const assets = await discoverReleaseAssets(root);
  const fake = runner([
    result(1, "", "release not found"),
    result(0),
    result(0),
    result(0, JSON.stringify({ immutable: true })),
  ]);

  await publishGithubRelease(
    publishOptions(assets, fake.run),
  );

  assert.deepEqual(fake.calls[0], [
    "release",
    "view",
    "v0.3.0",
  ]);
  assert.deepEqual(
    fake.calls[1].slice(0, 3),
    ["release", "create", "v0.3.0"],
  );
  assert.ok(fake.calls[1].includes("--draft"));
  assert.ok(fake.calls[1].includes("--verify-tag"));
  assert.deepEqual(fake.calls[2], [
    "release",
    "edit",
    "v0.3.0",
    "--draft=false",
  ]);
  assert.deepEqual(fake.calls[3], [
    "api",
    "-H",
    `X-GitHub-Api-Version: ${GITHUB_RELEASE_API_VERSION}`,
    "repos/lencx/Minke/releases/tags/v0.3.0",
  ]);
});

test("release publication refuses mismatched tags and existing releases", async () => {
  const root = await releaseAssetFixture();
  const assets = await discoverReleaseAssets(root);
  const unused = runner([]);
  await assert.rejects(
    publishGithubRelease({
      ...publishOptions(assets, unused.run),
      releaseTag: "v0.4.0",
    }),
    /does not match package version/u,
  );
  assert.equal(unused.calls.length, 0);

  const existing = runner([result(0)]);
  await assert.rejects(
    publishGithubRelease(
      publishOptions(assets, existing.run),
    ),
    /already exists/u,
  );
  assert.equal(existing.calls.length, 1);
});

test("mutable or unverifiable releases are returned to draft", async () => {
  const root = await releaseAssetFixture();
  const assets = await discoverReleaseAssets(root);
  const mutable = runner([
    result(1),
    result(0),
    result(0),
    result(0, JSON.stringify({ immutable: false })),
    result(0),
  ]);
  await assert.rejects(
    publishGithubRelease(
      publishOptions(assets, mutable.run),
    ),
    /immutability must be enabled/u,
  );
  assert.deepEqual(mutable.calls.at(-1), [
    "release",
    "edit",
    "v0.3.0",
    "--draft=true",
  ]);

  const unreadable = runner([
    result(1),
    result(0),
    result(0),
    result(1, "", "API unavailable"),
    result(0),
  ]);
  await assert.rejects(
    publishGithubRelease(
      publishOptions(assets, unreadable.run),
    ),
    /unable to verify release immutability/u,
  );
  assert.deepEqual(unreadable.calls.at(-1), [
    "release",
    "edit",
    "v0.3.0",
    "--draft=true",
  ]);
});
