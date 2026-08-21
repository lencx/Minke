export function parseBootManifest(html) {
  const match =
    /<script>globalThis\["__DSH_BOOT__"\] = (?<manifest>.*?)<\/script>/su.exec(
      html,
    );
  if (match?.groups?.manifest === undefined) {
    throw new Error("served page has no globalThis __DSH_BOOT__ manifest");
  }
  const manifest = JSON.parse(match.groups.manifest);
  if (!Array.isArray(manifest.entries)) {
    throw new Error(
      "served globalThis __DSH_BOOT__ manifest has no entries array",
    );
  }
  return manifest;
}
