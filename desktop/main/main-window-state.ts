import type { BrowserWindow } from "electron";
import windowStateKeeper from "electron-window-state";
import { dirname } from "node:path";

const DEFAULT_MAIN_WINDOW_WIDTH = 1280;
const DEFAULT_MAIN_WINDOW_HEIGHT = 820;
const MAIN_WINDOW_STATE_FILE = "window-state.json";

type WindowState = Pick<
  ReturnType<typeof windowStateKeeper>,
  "height" | "manage" | "width" | "x" | "y"
>;

type WindowStateFactory = (
  options: Parameters<typeof windowStateKeeper>[0],
) => WindowState;

interface MainWindowBounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

/**
 * Restore the main window beside the unified desktop config, then let
 * electron-window-state persist subsequent bounds and native window modes.
 */
export function createStatefulMainWindow(
  minkeConfigPath: string,
  createWindow: (bounds: MainWindowBounds) => BrowserWindow,
  createState: WindowStateFactory = windowStateKeeper,
): BrowserWindow {
  const state = createState({
    defaultWidth: DEFAULT_MAIN_WINDOW_WIDTH,
    defaultHeight: DEFAULT_MAIN_WINDOW_HEIGHT,
    path: dirname(minkeConfigPath),
    file: MAIN_WINDOW_STATE_FILE,
    maximize: true,
    fullScreen: true,
  });
  const window = createWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
  });
  state.manage(window);
  return window;
}
