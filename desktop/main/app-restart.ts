export const DEVELOPMENT_RESTART_EXIT_CODE = 75;

interface RestartableDesktopApp {
  readonly isPackaged: boolean;
  relaunch(): void;
  quit(): void;
}

/**
 * Keep packaged relaunches native, but let the Forge parent replace a
 * development Electron child so its renderer server remains alive.
 */
export function requestDesktopRestart(
  app: RestartableDesktopApp,
  requestDevelopmentRestart: (exitCode: number) => void,
): void {
  if (app.isPackaged) {
    app.relaunch();
  } else {
    requestDevelopmentRestart(DEVELOPMENT_RESTART_EXIT_CODE);
  }
  app.quit();
}
