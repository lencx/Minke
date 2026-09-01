import { app } from "electron";
import started from "electron-squirrel-startup";
import { runDesktopApplication } from "./application";
import {
  isCredentialStorageHelperProcess,
  runCredentialStorageHelper,
} from "./credential-storage-helper";

if (isCredentialStorageHelperProcess()) {
  void runCredentialStorageHelper().then(
    (exitCode) => {
      app.exit(exitCode);
    },
    () => {
      app.exit(1);
    },
  );
} else if (started) {
  app.quit();
} else {
  runDesktopApplication();
}
