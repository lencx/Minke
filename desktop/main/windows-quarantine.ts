import { readFile } from "node:fs/promises";

const MAX_ZONE_IDENTIFIER_BYTES = 4 * 1024;

export type WindowsZoneIdentifierReader = (
  path: string,
) => Promise<string>;

function internetZone(source: string): boolean {
  let inZoneTransfer = false;
  let zoneId: number | undefined;
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const section = /^\[([^\]]+)\]$/u.exec(line);
    if (section !== null) {
      inZoneTransfer = section[1] === "ZoneTransfer";
      continue;
    }
    if (!inZoneTransfer) continue;
    const match = /^ZoneId=(\d+)$/u.exec(line);
    if (match === null) continue;
    if (zoneId !== undefined) return false;
    zoneId = Number(match[1]);
  }
  return zoneId === 3 || zoneId === 4;
}

/**
 * Require Windows' Mark-of-the-Web before launching a downloaded installer.
 * The alternate data stream is deliberately preserved for SmartScreen.
 */
export async function assertWindowsFileQuarantined(
  path: string,
  reader: WindowsZoneIdentifierReader = async (streamPath) =>
    await readFile(streamPath, "utf8"),
): Promise<void> {
  let source: string;
  try {
    source = await reader(`${path}:Zone.Identifier`);
  } catch {
    throw new Error(
      "downloaded Windows update has no Mark-of-the-Web",
    );
  }
  if (
    Buffer.byteLength(source, "utf8") >
      MAX_ZONE_IDENTIFIER_BYTES ||
    !internetZone(source)
  ) {
    throw new Error(
      "downloaded Windows update has no trusted Internet-zone Mark-of-the-Web",
    );
  }
}
