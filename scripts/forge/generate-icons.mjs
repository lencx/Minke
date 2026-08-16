#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptRoot, "../..");
const sourceMacIcon = join(projectRoot, "public", "minke.png");
const sourceLogo = join(projectRoot, "public", "logo.png");
const sourceTrayIcon = join(
  projectRoot,
  "public",
  "minke-tray.png",
);
const outputRoot = join(projectRoot, "resources", "icons");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    ...options,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with ${String(result.status ?? result.signal)}`,
    );
  }
}

function resizePng(source, destination, size) {
  run("sips", [
    "-z",
    String(size),
    String(size),
    "-s",
    "format",
    "png",
    source,
    "--out",
    destination,
  ]);
}

async function writeWindowsIcon(pngs, destination) {
  const images = await Promise.all(
    pngs.map(async ({ size, path }) => ({
      size,
      data: await readFile(path),
    })),
  );
  const headerSize = 6;
  const entrySize = 16;
  let imageOffset = headerSize + entrySize * images.length;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(entrySize);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(imageOffset, 12);
    imageOffset += data.length;
    return entry;
  });

  await writeFile(
    destination,
    Buffer.concat([header, ...entries, ...images.map(({ data }) => data)]),
  );
}

async function writeMacIcon(pngs, destination) {
  const sourceBySize = new Map(
    await Promise.all(
      pngs.map(async ({ size, path }) => [size, await readFile(path)]),
    ),
  );
  const variants = [
    ["icp4", 16],
    ["icp5", 32],
    ["ic11", 32],
    ["icp6", 64],
    ["ic12", 64],
    ["ic07", 128],
    ["ic08", 256],
    ["ic13", 256],
    ["ic09", 512],
    ["ic14", 512],
    ["ic10", 1024],
  ];
  const entries = variants.map(([type, size]) => {
    const data = sourceBySize.get(size);
    if (data === undefined) {
      throw new Error(`missing ${String(size)}px macOS icon source`);
    }
    const entry = Buffer.alloc(8 + data.length);
    entry.write(type, 0, 4, "ascii");
    entry.writeUInt32BE(entry.length, 4);
    data.copy(entry, 8);
    return entry;
  });
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(
    header.length + entries.reduce((length, entry) => length + entry.length, 0),
    4,
  );
  await writeFile(destination, Buffer.concat([header, ...entries]));
}

async function main() {
  if (process.platform !== "darwin") {
    throw new Error("icon generation currently requires macOS sips");
  }

  await mkdir(outputRoot, { recursive: true });
  const temporaryRoot = await mkdtemp(join(tmpdir(), "minke-icons-"));

  try {
    resizePng(sourceLogo, join(outputRoot, "icon.png"), 512);

    const macSizes = [16, 32, 64, 128, 256, 512, 1024];
    const macPngs = macSizes.map((size) => ({
      size,
      path: join(temporaryRoot, `macos-${size}.png`),
    }));
    for (const { size, path } of macPngs) {
      resizePng(sourceMacIcon, path, size);
    }
    await writeMacIcon(macPngs, join(outputRoot, "icon.icns"));

    const windowsSizes = [16, 20, 24, 32, 40, 48, 64, 256];
    const windowsPngs = windowsSizes.map((size) => ({
      size,
      path: join(temporaryRoot, `windows-${size}.png`),
    }));
    for (const { size, path } of windowsPngs) {
      resizePng(sourceLogo, path, size);
    }
    await writeWindowsIcon(windowsPngs, join(outputRoot, "icon.ico"));

    resizePng(
      sourceTrayIcon,
      join(outputRoot, "trayTemplate.png"),
      16,
    );
    resizePng(
      sourceTrayIcon,
      join(outputRoot, "trayTemplate@2x.png"),
      32,
    );
    run("sips", [
      "-s",
      "dpiWidth",
      "72",
      "-s",
      "dpiHeight",
      "72",
      join(outputRoot, "trayTemplate.png"),
    ]);
    run("sips", [
      "-s",
      "dpiWidth",
      "144",
      "-s",
      "dpiHeight",
      "144",
      join(outputRoot, "trayTemplate@2x.png"),
    ]);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

await main();
