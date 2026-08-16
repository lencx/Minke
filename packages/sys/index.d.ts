export type WindowButtonGeometry = Readonly<{
  buttonHeight: number;
  buttonWidth: number;
  centerPitches: readonly [number, number];
  status: 'applied' | 'observed';
}>;

export type WindowButtonGeometryResult =
  | WindowButtonGeometry
  | Readonly<{
    reason: string;
    status: 'skipped';
  }>;

export function enable(key: string): boolean;

export function readWindowButtonGeometry(
  nativeWindowHandle: Buffer,
): WindowButtonGeometryResult;

export function setWindowButtonCenterPitch(
  nativeWindowHandle: Buffer,
  centerPitch: number,
): WindowButtonGeometryResult;

export function setWindowButtonSize(
  nativeWindowHandle: Buffer,
  buttonSize: number,
): WindowButtonGeometryResult;
