import { app, type BrowserWindow } from "electron";
import { createRequire } from "node:module";
import { join } from "node:path";
import type {
  WindowButtonDetachResult,
  WindowButtonGeometryResult,
} from "sys";

const nativeRequire = createRequire(__filename);

export type MacOSWindowButtonNativeAdapter = Readonly<{
  attach(
    nativeWindowHandle: Buffer,
  ): WindowButtonGeometryResult;
  detach(
    nativeWindowHandle: Buffer,
  ): WindowButtonDetachResult;
  enable(key: string): boolean;
  measure(
    nativeWindowHandle: Buffer,
  ): WindowButtonGeometryResult;
}>;

type MacOSWindowButtonSpacingHost = Pick<
  BrowserWindow,
  "getNativeWindowHandle" | "isDestroyed"
>;

type MacOSWindowButtonSpacingFacts = Readonly<{
  adapter?: MacOSWindowButtonNativeAdapter;
  platform: NodeJS.Platform;
}>;

export type MacOSWindowButtonSpacingBinding = Readonly<{
  dispose(): void;
  readGeometry(): WindowButtonGeometryResult;
  reconcile(): WindowButtonGeometryResult;
}>;

let cachedNativeAdapter: MacOSWindowButtonNativeAdapter | null | undefined;

function sysEntryPath(): string {
  // Node's deprecated built-in `sys` module wins bare-specifier resolution.
  // Resolve the workspace/package entry explicitly so this always reaches
  // Minke's native package in development and inside app.asar when packaged.
  return join(app.getAppPath(), "node_modules", "sys", "index.js");
}

function skipped(reason: string): WindowButtonGeometryResult {
  return Object.freeze({ reason, status: "skipped" });
}

function loadNativeAdapter(): MacOSWindowButtonNativeAdapter | null {
  if (cachedNativeAdapter !== undefined) return cachedNativeAdapter;
  try {
    const candidate = nativeRequire(
      sysEntryPath(),
    ) as Partial<MacOSWindowButtonNativeAdapter>;
    if (
      typeof candidate.enable === "function" &&
      typeof candidate.attach === "function" &&
      typeof candidate.detach === "function" &&
      typeof candidate.measure === "function" &&
      candidate.enable("sys.lencx.me")
    ) {
      cachedNativeAdapter = candidate as MacOSWindowButtonNativeAdapter;
      return cachedNativeAdapter;
    }
  } catch {
    // The bridge is Darwin-only. Preserve AppKit defaults when it cannot load.
  }
  cachedNativeAdapter = null;
  return cachedNativeAdapter;
}

function resolveAdapter(
  facts: MacOSWindowButtonSpacingFacts,
): MacOSWindowButtonNativeAdapter | null {
  return facts.adapter ?? loadNativeAdapter();
}

export function reconcileMacOSWindowButtonSpacing(
  host: Pick<
    MacOSWindowButtonSpacingHost,
    "getNativeWindowHandle" | "isDestroyed"
  >,
  facts: MacOSWindowButtonSpacingFacts,
): WindowButtonGeometryResult {
  if (facts.platform !== "darwin") return skipped("unsupported_platform");
  if (host.isDestroyed()) return skipped("window_destroyed");
  const adapter = resolveAdapter(facts);
  if (adapter === null) return skipped("native_adapter_unavailable");
  try {
    return adapter.attach(host.getNativeWindowHandle());
  } catch {
    return skipped("native_bridge_failed");
  }
}

export function bindMacOSWindowButtonSpacing(
  host: MacOSWindowButtonSpacingHost,
  facts: MacOSWindowButtonSpacingFacts,
): MacOSWindowButtonSpacingBinding {
  let disposed = false;
  let nativeWindowHandle: Buffer | undefined;

  const reconcile = (): WindowButtonGeometryResult => {
    if (disposed) return skipped("binding_disposed");
    const result = reconcileMacOSWindowButtonSpacing(host, facts);
    if (result.status !== "skipped" && nativeWindowHandle === undefined) {
      nativeWindowHandle = host.getNativeWindowHandle();
    }
    return result;
  };

  reconcile();

  return Object.freeze({
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (
        facts.platform === "darwin" &&
        nativeWindowHandle !== undefined &&
        !host.isDestroyed()
      ) {
        try {
          resolveAdapter(facts)?.detach(nativeWindowHandle);
        } catch {
          // The native controller also detaches on NSWindowWillClose.
        }
      }
      nativeWindowHandle = undefined;
    },
    readGeometry: () => {
      if (facts.platform !== "darwin") return skipped("unsupported_platform");
      if (host.isDestroyed()) return skipped("window_destroyed");
      const adapter = resolveAdapter(facts);
      if (adapter === null) return skipped("native_adapter_unavailable");
      try {
        return adapter.measure(host.getNativeWindowHandle());
      } catch {
        return skipped("native_bridge_failed");
      }
    },
    reconcile,
  });
}
