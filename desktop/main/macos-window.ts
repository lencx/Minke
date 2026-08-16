import type { BrowserWindowConstructorOptions } from "electron";

/**
 * Native macOS window chrome. Other platforms retain their normal frame and
 * opaque background instead of receiving a partial imitation of macOS glass.
 */
export function macOSWindowOptions():
  | Partial<BrowserWindowConstructorOptions>
  | undefined {
  if (process.platform !== "darwin") return undefined;
  return {
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 9, y: 10 },
    transparent: true,
    backgroundColor: "#00000000",
    vibrancy: "under-window",
    visualEffectState: "followWindow",
  };
}
