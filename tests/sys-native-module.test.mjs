import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const packageEntryPath = new URL(
  "../packages/sys/index.js",
  import.meta.url,
);
const packageManifest = JSON.parse(
  readFileSync(
    new URL("../packages/sys/package.json", import.meta.url),
    "utf8",
  ),
);

if (process.platform !== "darwin") {
  test("sys is a Darwin-only optional module", { skip: true }, () => {});
} else {
  test("sys resolves lencx_mb.node and requires explicit activation", () => {
    const entryPath = packageEntryPath.pathname;
    const binaryPath = join(dirname(entryPath), "lencx_mb.node");
    const sys = require(entryPath);

    assert.equal(packageManifest.name, "sys");
    assert.equal(basename(binaryPath), "lencx_mb.node");
    assert.equal(typeof sys.attach, "function");
    assert.equal(typeof sys.detach, "function");
    assert.equal(typeof sys.enable, "function");
    assert.equal(typeof sys.measure, "function");
    assert.equal(sys.setPitch, undefined);
    assert.equal(sys.setSize, undefined);
    assert.equal(sys.readWindowButtonGeometry, undefined);
    assert.equal(sys.setWindowButtonCenterPitch, undefined);
    assert.equal(sys.setWindowButtonSize, undefined);
    assert.throws(
      () => sys.measure(Buffer.alloc(8)),
      /not enabled/u,
    );
    assert.equal(sys.enable("sys.lencx.me "), false);
    assert.throws(
      () => sys.measure(Buffer.alloc(8)),
      /not enabled/u,
    );
    assert.equal(sys.enable("sys.lencx.me"), true);
    assert.deepEqual(
      sys.measure(Buffer.alloc(8)),
      { reason: "window_unavailable", status: "skipped" },
    );
    assert.deepEqual(
      sys.attach(Buffer.alloc(8)),
      { reason: "window_unavailable", status: "skipped" },
    );
    assert.deepEqual(
      sys.detach(Buffer.alloc(8)),
      { reason: "window_unavailable", status: "skipped" },
    );
    assert.throws(
      () => sys.attach(Buffer.alloc(8), 10),
      /attach expects one argument/u,
    );
    assert.equal(
      readFileSync(binaryPath).includes(Buffer.from("sys.lencx.me")),
      false,
    );
  });
}
