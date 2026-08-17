import type { App } from "electron";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** Pin all durable Electron data below the user's Minke home. */
export function configureAppDataPaths(
  app: Pick<App, "getPath" | "setPath">,
): void {
  const dataPath = join(app.getPath("home"), ".minke");
  mkdirSync(dataPath, { recursive: true, mode: 0o700 });
  app.setPath("userData", dataPath);
  app.setPath("sessionData", dataPath);
}
