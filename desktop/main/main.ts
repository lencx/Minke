import { app } from "electron";
import started from "electron-squirrel-startup";
import { runDesktopApplication } from "./application";

if (started) {
  app.quit();
} else {
  runDesktopApplication();
}
