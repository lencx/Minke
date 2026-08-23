import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import test from "node:test";

const forgeSource = readFileSync(
  new URL("../forge.config.ts", import.meta.url),
  "utf8",
);
const iconGeneratorSource = readFileSync(
  new URL("../scripts/forge/generate-icons.mjs", import.meta.url),
  "utf8",
);
const trayTemplateUrl = new URL(
  "../resources/icons/trayTemplate.png",
  import.meta.url,
);
const trayTemplate2xUrl = new URL(
  "../resources/icons/trayTemplate@2x.png",
  import.meta.url,
);

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function readRgbaPng(url) {
  const source = readFileSync(url);
  assert.equal(
    source.subarray(0, 8).toString("hex"),
    "89504e470d0a1a0a",
    `${url.pathname} must be a PNG`,
  );
  const width = source.readUInt32BE(16);
  const height = source.readUInt32BE(20);
  assert.equal(source[24], 8, "tray PNGs must use 8-bit channels");
  assert.equal(source[25], 6, "tray PNGs must retain an alpha channel");
  assert.equal(source[28], 0, "tray PNGs must not be interlaced");

  const idat = [];
  for (let offset = 8; offset < source.length;) {
    const length = source.readUInt32BE(offset);
    const type = source.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") {
      idat.push(source.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
  }

  const encoded = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row += 1) {
    const encodedStart = row * (stride + 1);
    const outputStart = row * stride;
    const filter = encoded[encodedStart];
    for (let column = 0; column < stride; column += 1) {
      const raw = encoded[encodedStart + column + 1];
      const left = column >= 4 ? pixels[outputStart + column - 4] : 0;
      const above =
        row > 0 ? pixels[outputStart + column - stride] : 0;
      const upperLeft =
        row > 0 && column >= 4
          ? pixels[outputStart + column - stride - 4]
          : 0;
      const predictor = [
        0,
        left,
        above,
        Math.floor((left + above) / 2),
        paeth(left, above, upperLeft),
      ][filter];
      assert.notEqual(
        predictor,
        undefined,
        `unsupported PNG row filter ${String(filter)}`,
      );
      pixels[outputStart + column] = (raw + predictor) & 0xff;
    }
  }
  return { height, pixels, width };
}

function assertTemplateMask(url, expectedSize) {
  const { height, pixels, width } = readRgbaPng(url);
  assert.deepEqual([width, height], [expectedSize, expectedSize]);
  let hasTransparentPixel = false;
  let hasVisiblePixel = false;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3];
    hasTransparentPixel ||= alpha === 0;
    hasVisiblePixel ||= alpha > 0;
    if (alpha > 0) {
      assert.ok(
        pixels[offset] <= 8 &&
          pixels[offset + 1] <= 8 &&
          pixels[offset + 2] <= 8,
        "visible template pixels must be black",
      );
    }
  }
  assert.equal(hasTransparentPixel, true, "template mask needs transparency");
  assert.equal(hasVisiblePixel, true, "template mask cannot be empty");
}

test("macOS Tray assets use a black-alpha template image pair", () => {
  assert.match(forgeSource, /trayTemplate\.png/);
  assert.match(forgeSource, /trayTemplate@2x\.png/);
  assert.match(iconGeneratorSource, /"minke-tray\.png"/);
  assert.doesNotMatch(
    iconGeneratorSource,
    /colorkey|colorchannelmixer/,
    "the supplied black-alpha source must not be recolored",
  );
  assert.match(iconGeneratorSource, /trayTemplate\.png/);
  assert.match(iconGeneratorSource, /trayTemplate@2x\.png/);
  assert.equal(existsSync(trayTemplateUrl), true);
  assert.equal(existsSync(trayTemplate2xUrl), true);
  assertTemplateMask(trayTemplateUrl, 16);
  assertTemplateMask(trayTemplate2xUrl, 32);
});
