export interface PackagedApplicationLayout {
  readonly appRoot: string;
  readonly executablePath: string;
  readonly outputRoot: string;
  readonly resourcesRoot: string;
}

export function applicationResourcesRoot(
  appRoot: string,
  platform: string,
): string;

export function applicationExecutablePath(
  appRoot: string,
  platform: string,
): string;

export function packagedApplicationLayout(
  projectRoot: string,
  platform?: string,
  arch?: string,
): PackagedApplicationLayout;
