import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(
  new URL("../desktop/renderer/App.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(
  new URL("../desktop/renderer/styles.css", import.meta.url),
  "utf8",
);

function hexChannels(value) {
  const hex = value.slice(1);
  return [0, 2, 4].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
}

function luminance(value) {
  const channels = hexChannels(value).map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return (
    0.2126 * channels[0] +
    0.7152 * channels[1] +
    0.0722 * channels[2]
  );
}

function contrast(foreground, background) {
  const lighter = Math.max(
    luminance(foreground),
    luminance(background),
  );
  const darker = Math.min(
    luminance(foreground),
    luminance(background),
  );
  return (lighter + 0.05) / (darker + 0.05);
}

function themeValues(name) {
  return [
    ...stylesSource.matchAll(
      new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "giu"),
    ),
  ].map((match) => match[1]);
}

test("bootstrap loading text stays readable in light and dark appearances", () => {
  assert.match(
    appSource,
    /className="[^"]*\bminke-bootstrap__status\b[^"]*"/u,
  );
  assert.doesNotMatch(
    appSource,
    /text-slate-(?:100|200|300)/u,
  );
  assert.match(
    stylesSource,
    /@media \(prefers-color-scheme:\s*dark\)/u,
  );

  const statusColors = themeValues(
    "--minke-bootstrap-status-color",
  );
  assert.equal(statusColors.length, 2);
  assert.ok(
    contrast(statusColors[0], "#ffffff") >= 4.5,
    "light appearance needs readable loading text",
  );
  assert.ok(
    contrast(statusColors[1], "#1f2937") >= 4.5,
    "dark appearance needs readable loading text",
  );
});
