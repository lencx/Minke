#!/usr/bin/env node

// Builds a portable AppImage from the Debian package produced by the deb maker.
//
// The deb already contains the packaged application, the desktop entry and the
// icon set, so no packaging stack has to run twice: we unpack the deb into an
// AppDir, wire an AppRun entry point, and run appimagetool over the result.
//
// Usage:
//   node scripts/forge/appimage.mjs [path-to-deb]
//
// With no argument the script searches out/make for the minke_*_amd64.deb
// produced by `pnpm make`. The AppImage is written next to the deb, under
// out/make, so the existing artifact upload and release staging pick it up
// unchanged.

import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "../..");
const packageManifest = require(join(projectRoot, "package.json"));

// Pinned release, not "continuous", for reproducible builds. The CI matrix
// builds linux-x64 only; switching the AppImage target to another arch will
// require parameterizing both the tool asset and OUTPUT_NAME.
const APPIMAGE_TOOL_URL =
  "https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage";
const OUTPUT_NAME = "Minke-linux-x64.AppImage";

function fail(message) {
  throw new Error(message);
}

function runText(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status === null) {
    fail(
      `${command} ${args.join(" ")} was killed by signal ${String(
        result.signal,
      )}`,
    );
  }
  if (result.status !== 0) {
    fail(
      `${command} ${args.join(" ")} failed with status ${String(
        result.status,
      )}${result.stderr !== "" ? `:\n${result.stderr}` : ""}`,
    );
  }
  return result;
}

// The deb data member can exceed 100 MiB; stream it to disk instead of
// buffering the whole archive in memory.
async function extractDataMember(debPath, dataMember, destPath) {
  const child = spawn("ar", ["p", debPath, dataMember], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  // Attach the close listener BEFORE awaiting the pipeline: if the child
  // exits before the stream finishes, the exit promise must still resolve.
  const exitPromise = new Promise((resolvePromise) =>
    child.on("close", resolvePromise),
  );
  await pipeline(child.stdout, createWriteStream(destPath));
  const exitCode = await exitPromise;
  if (exitCode !== 0) {
    fail(
      `ar p ${debPath} ${dataMember} failed with status ${String(exitCode)}`,
    );
  }
  const dataStat = await stat(destPath);
  if (dataStat.size === 0) {
    fail(`ar p ${debPath} ${dataMember} produced an empty archive`);
  }
}

async function findDeb(projectRoot) {
  const outMake = join(projectRoot, "out", "make");
  let entries;
  try {
    entries = await readdir(outMake, { recursive: true });
  } catch (error) {
    if (error instanceof Error && error.code === "ENOENT") {
      fail(`${outMake} does not exist; run "pnpm make" first`);
    }
    throw error;
  }
  const matches = entries
    .filter((entry) => /^minke_.*_amd64\.deb$/u.test(basename(entry)))
    .map((entry) => join(outMake, entry));
  if (matches.length === 0) {
    fail(
      `no minke_*_amd64.deb found under ${outMake}; run "pnpm make" first`,
    );
  }
  if (matches.length > 1) {
    fail(
      `expected exactly one minke_*_amd64.deb under ${outMake}, found ${String(
        matches.length,
      )}`,
    );
  }
  return matches[0];
}

async function extractDeb(debPath, appDir) {
  const members = runText("ar", ["t", debPath]).stdout
    .split(/\r?\n/u)
    .filter((member) => member !== "");
  const dataMember = members.find((member) =>
    member.startsWith("data.tar."),
  );
  if (dataMember === undefined) {
    fail(`no data.tar.* member in ${debPath}`);
  }
  const compressionFlag = {
    ".gz": "--gzip",
    ".bz2": "--bzip2",
    ".lzma": "--lzma",
    ".xz": "--xz",
    ".zst": "--zstd",
  }[dataMember.slice("data.tar".length)];
  if (compressionFlag === undefined) {
    fail(`unsupported deb data compression: ${dataMember}`);
  }
  const dataArchive = join(appDir, dataMember);
  await extractDataMember(debPath, dataMember, dataArchive);
  runText(
    "tar",
    [compressionFlag, "-xf", dataArchive, "-C", appDir],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  await rm(dataArchive, { force: true });
}

function ensureExecutable(filePath) {
  runText("chmod", ["+x", filePath]);
}

async function stageDesktopEntry(appDir) {
  const sourceDesktop = join(
    appDir,
    "usr",
    "share",
    "applications",
    "minke.desktop",
  );
  const source = await readFile(sourceDesktop, "utf8");
  const normalized = source.replace(/\r\n?/gu, "\n");
  if (
    !/^Exec=/mu.test(normalized) ||
    !/^Icon=/mu.test(normalized)
  ) {
    fail(`${sourceDesktop} is missing Exec= or Icon= lines`);
  }
  // AppImage desktop entries launch through AppRun; use a relative Exec and a
  // root-level icon so desktop integration resolves both inside the AppDir.
  const appImageDesktop = normalized
    .replace(/^Exec=.*$/mu, "Exec=Minke")
    .replace(/^Icon=.*$/mu, "Icon=minke");
  await writeFile(join(appDir, "Minke.desktop"), appImageDesktop);
}

async function stageIcon(appDir) {
  const debIcon = join(appDir, "usr", "share", "pixmaps", "minke.png");
  try {
    await copyFile(debIcon, join(appDir, "minke.png"));
    return;
  } catch (error) {
    if (!(error instanceof Error && error.code === "ENOENT")) {
      throw error;
    }
    // fall back to the repository icon used by the other makers
  }
  await copyFile(
    join(projectRoot, "resources", "icons", "icon.png"),
    join(appDir, "minke.png"),
  );
}

async function stageLaunchers(appDir) {
  const binaryPath = join(appDir, "usr", "lib", "minke", "Minke");
  await stat(binaryPath);
  await symlink("usr/lib/minke/Minke", join(appDir, "AppRun"));
  await symlink("usr/lib/minke/Minke", join(appDir, "Minke"));
  ensureExecutable(binaryPath);
}

async function appimageToolPath() {
  if (process.env.APPIMAGETOOL_PATH !== undefined) {
    return process.env.APPIMAGETOOL_PATH;
  }
  const toolPath = join(tmpdir(), "minke-appimagetool-x86_64.AppImage");
  try {
    await stat(toolPath);
  } catch {
    // Download to a .part file and rename only on success, so an interrupted
    // download can never be mistaken for a valid cached tool.
    const partPath = `${toolPath}.part`;
    try {
      runText(
        "curl",
        [
          "-fsSL",
          "--retry",
          "3",
          "--connect-timeout",
          "10",
          "--max-time",
          "300",
          "-o",
          partPath,
          APPIMAGE_TOOL_URL,
        ],
        { stdio: "inherit" },
      );
      await rename(partPath, toolPath);
    } catch (error) {
      await rm(partPath, { force: true });
      throw error;
    }
  }
  ensureExecutable(toolPath);
  return toolPath;
}

async function main() {
  const debArg = process.argv[2];
  const debPath =
    debArg !== undefined ? resolve(debArg) : await findDeb(projectRoot);
  const outputPath = join(dirname(debPath), OUTPUT_NAME);

  const appDir = join(tmpdir(), `minke-appimage-${process.pid}`);
  await mkdir(appDir, { recursive: true });
  try {
    console.log(`[appimage] unpacking ${debPath}`);
    await extractDeb(debPath, appDir);

    console.log("[appimage] staging desktop entry and icons");
    await stageDesktopEntry(appDir);
    await stageIcon(appDir);
    await stageLaunchers(appDir);

    console.log("[appimage] resolving appimagetool");
    const toolPath = await appimageToolPath();

    console.log(`[appimage] writing ${outputPath}`);
    runText(
      toolPath,
      [
        "--appimage-extract-and-run",
        "--no-appstream",
        appDir,
        outputPath,
      ],
      { stdio: "inherit", maxBuffer: 64 * 1024 * 1024 },
    );

    const outputStat = await stat(outputPath);
    const sizeMiB = (outputStat.size / 1024 / 1024).toFixed(1);
    console.log(
      `[appimage] ${packageManifest.name ?? "Minke"} AppImage ready: ${outputPath} (${sizeMiB} MiB)`,
    );
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
