import { app, type BrowserWindow } from "electron";
import { createRequire } from "node:module";
import { join } from "node:path";
import type {
  WindowButtonGeometryResult,
} from "sys";

const nativeRequire = createRequire(__filename);

export const MACOS_WINDOW_BUTTON_SIZE = 10;
export const MACOS_WINDOW_BUTTON_CENTER_PITCH = 14;

export type MacOSWindowButtonNativeAdapter = Readonly<{
  enable(key: string): boolean;
  readWindowButtonGeometry(
    nativeWindowHandle: Buffer,
  ): WindowButtonGeometryResult;
  setWindowButtonCenterPitch(
    nativeWindowHandle: Buffer,
    centerPitch: number,
  ): WindowButtonGeometryResult;
  setWindowButtonSize(
    nativeWindowHandle: Buffer,
    buttonSize: number,
  ): WindowButtonGeometryResult;
}>;

type MacOSWindowButtonSpacingHost = Pick<
  BrowserWindow,
  "getNativeWindowHandle" | "isDestroyed" | "off" | "on"
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
      typeof candidate.readWindowButtonGeometry === "function" &&
      typeof candidate.setWindowButtonCenterPitch === "function" &&
      typeof candidate.setWindowButtonSize === "function" &&
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
    const nativeWindowHandle = host.getNativeWindowHandle();
    const sizeResult = adapter.setWindowButtonSize(
      nativeWindowHandle,
      MACOS_WINDOW_BUTTON_SIZE,
    );
    if (sizeResult.status === "skipped") return sizeResult;
    return adapter.setWindowButtonCenterPitch(
      nativeWindowHandle,
      MACOS_WINDOW_BUTTON_CENTER_PITCH,
    );
  } catch {
    return skipped("native_bridge_failed");
  }
}

export function bindMacOSWindowButtonSpacing(
  host: MacOSWindowButtonSpacingHost,
  facts: MacOSWindowButtonSpacingFacts,
): MacOSWindowButtonSpacingBinding {
  let disposed = false;
  let scheduled = false;

  const reconcile = (): WindowButtonGeometryResult =>
    disposed
      ? skipped("binding_disposed")
      : reconcileMacOSWindowButtonSpacing(host, facts);

  const schedule = (): void => {
    if (disposed || scheduled) return;
    scheduled = true;
    setImmediate(() => {
      scheduled = false;
      if (!disposed) reconcile();
    });
  };

  const reconcileOnResize = (): void => {
    if (!disposed) reconcile();
  };

  host.on("ready-to-show", schedule);
  host.on("show", schedule);
  host.on("restore", schedule);
  host.on("maximize", schedule);
  host.on("unmaximize", schedule);
  host.on("leave-full-screen", schedule);
  // Electron restores AppKit's default spacing before it emits resize.
  // Repair synchronously so the following native redraw sees the 14pt pitch.
  host.on("resize", reconcileOnResize);
  reconcile();

  return Object.freeze({
    dispose: () => {
      if (disposed) return;
      disposed = true;
      host.off("ready-to-show", schedule);
      host.off("show", schedule);
      host.off("restore", schedule);
      host.off("maximize", schedule);
      host.off("unmaximize", schedule);
      host.off("leave-full-screen", schedule);
      host.off("resize", reconcileOnResize);
    },
    readGeometry: () => {
      if (facts.platform !== "darwin") return skipped("unsupported_platform");
      if (host.isDestroyed()) return skipped("window_destroyed");
      const adapter = resolveAdapter(facts);
      if (adapter === null) return skipped("native_adapter_unavailable");
      try {
        return adapter.readWindowButtonGeometry(
          host.getNativeWindowHandle(),
        );
      } catch {
        return skipped("native_bridge_failed");
      }
    },
    reconcile,
  });
}
