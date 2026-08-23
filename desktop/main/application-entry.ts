import type { App } from "electron";
import { configureAppDataPaths } from "./app-data-paths.ts";

export const PRODUCT_NAME = "Minke";

/**
 * Claims the desktop process before Electron acquires durable state. Returns
 * false after requesting quit when another instance already owns the app.
 */
export function prepareDesktopApplication(
  app: Pick<
    App,
    | "getPath"
    | "quit"
    | "requestSingleInstanceLock"
    | "setName"
    | "setPath"
  >,
): boolean {
  app.setName(PRODUCT_NAME);
  configureAppDataPaths(app);
  if (app.requestSingleInstanceLock()) return true;
  app.quit();
  return false;
}
