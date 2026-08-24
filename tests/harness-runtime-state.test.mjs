import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  fingerprintPaths,
  fingerprintRecord,
  publishDirectory,
  publishValidatedDirectory,
  writeFileAtomic,
} from "../scripts/harness/runtime-state.mjs";
import {
  minkeHarnessClientBuildEnvironment,
} from "../scripts/harness/client-build-environment.mjs";
import {
  assertReusableRuntimeFiles,
  chooseStagePlan,
  parseStageFlags,
  ReusableRuntimeUnavailableError,
} from "../scripts/harness/stage-plan.mjs";

async function withTemporaryDirectory(callback) {
  const root = await mkdtemp(join(tmpdir(), "minke-runtime-state-"));
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("the Harness client build uses Minke product branding", () => {
  const environment = minkeHarnessClientBuildEnvironment({
    DSH_BUILD_CLIENT_PROFILE: "official",
    DSH_CLIENT_BUILD_PROFILE: "official",
    DSH_CLIENT_TITLE: "DeepSeek Harness",
    PRESERVED: "yes",
  });

  assert.equal(environment.DSH_CLIENT_TITLE, "Minke");
  assert.equal(environment.DSH_BUILD_CLIENT_PROFILE, undefined);
  assert.equal(environment.DSH_CLIENT_BUILD_PROFILE, undefined);
  assert.equal(environment.PRESERVED, "yes");
});

test("runtime fingerprints are deterministic and content-sensitive", async () => {
  await withTemporaryDirectory(async (root) => {
    await mkdir(join(root, "tree"));
    await writeFile(join(root, "tree", "a.txt"), "one");
    const first = await fingerprintPaths(root, ["tree"]);
    const repeated = await fingerprintPaths(root, ["tree"]);
    assert.equal(repeated, first);

    await writeFile(join(root, "tree", "a.txt"), "two");
    const changed = await fingerprintPaths(root, ["tree"]);
    assert.notEqual(changed, first);
    assert.notEqual(
      fingerprintRecord({ version: 1, packages: ["a"] }),
      fingerprintRecord({ packages: ["b"], version: 1 }),
    );
  });
});

test("development staging rebuilds a known-unavailable reusable runtime", async () => {
  const flags = parseStageFlags([
    "--skip-install",
    "--skip-build",
    "--refresh-if-stale",
  ]);
  const fallback = await chooseStagePlan(flags, async () => {
    throw new ReusableRuntimeUnavailableError(
      "stale",
      "runtime fingerprint changed",
    );
  });
  assert.deepEqual(fallback, {
    fallbackReason: "stale",
    mode: "full",
    skipBuild: false,
    skipInstall: false,
  });
  assert.deepEqual(
    await chooseStagePlan(flags, async () => {}),
    {
      mode: "reuse",
      skipBuild: true,
      skipInstall: true,
    },
  );
  assert.deepEqual(
    await chooseStagePlan(flags, async () => {
      assertReusableRuntimeFiles(
        ["/runtime/index.mjs"],
        () => false,
      );
    }),
    {
      fallbackReason: "incomplete",
      mode: "full",
      skipBuild: false,
      skipInstall: false,
    },
  );
  assert.deepEqual(
    await chooseStagePlan(flags, async () => {
      throw new ReusableRuntimeUnavailableError(
        "invalid",
        "runtime validation rejected staged files",
      );
    }),
    {
      fallbackReason: "invalid",
      mode: "full",
      skipBuild: false,
      skipInstall: false,
    },
  );

  await assert.rejects(
    chooseStagePlan(flags, async () => {
      throw new Error("runtime validation is broken");
    }),
    /runtime validation is broken/u,
  );
  await assert.rejects(
    chooseStagePlan(
      parseStageFlags(["--skip-install", "--skip-build"]),
      async () => {
        throw new ReusableRuntimeUnavailableError(
          "stale",
          "runtime fingerprint changed",
        );
      },
    ),
    ReusableRuntimeUnavailableError,
  );
});

test("refresh-if-stale is valid only for the complete fast-stage mode", () => {
  assert.throws(
    () => parseStageFlags(["--refresh-if-stale"]),
    /requires --skip-install and --skip-build/u,
  );
});

test("runtime publication replaces a validated candidate", async () => {
  await withTemporaryDirectory(async (root) => {
    const destination = join(root, "host");
    const candidate = join(root, ".host-staging", "host");
    await mkdir(destination);
    await mkdir(candidate, { recursive: true });
    await writeFile(join(destination, "version"), "old");
    await writeFile(join(candidate, "version"), "new");

    await publishDirectory(candidate, destination);

    assert.equal(await readFile(join(destination, "version"), "utf8"), "new");
    assert.equal(
      (await readdir(root)).some((name) => name.includes(".backup.")),
      false,
    );
  });
});

test("a missing runtime candidate never disturbs the active runtime", async () => {
  await withTemporaryDirectory(async (root) => {
    const destination = join(root, "host");
    await mkdir(destination);
    await writeFile(join(destination, "version"), "old");

    await assert.rejects(
      publishDirectory(join(root, ".missing", "host"), destination),
    );
    assert.equal(await readFile(join(destination, "version"), "utf8"), "old");
  });
});

test("a rejected runtime candidate never replaces the active runtime", async () => {
  await withTemporaryDirectory(async (root) => {
    const destination = join(root, "host");
    const candidate = join(root, ".host-staging", "host");
    await mkdir(destination);
    await mkdir(candidate, { recursive: true });
    await writeFile(join(destination, "version"), "old");
    await writeFile(join(candidate, "version"), "invalid");

    await assert.rejects(
      publishValidatedDirectory(candidate, destination, async () => {
        throw new Error("candidate validation failed");
      }),
      /candidate validation failed/u,
    );
    assert.equal(await readFile(join(destination, "version"), "utf8"), "old");
    assert.equal(await readFile(join(candidate, "version"), "utf8"), "invalid");
  });
});

test("atomic file writes leave only the published file", async () => {
  await withTemporaryDirectory(async (root) => {
    const path = join(root, "runtime.json");
    await writeFileAtomic(path, '{"version":1}\n');
    assert.equal(await readFile(path, "utf8"), '{"version":1}\n');
    assert.deepEqual(await readdir(root), ["runtime.json"]);
  });
});
