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

export function measure(
  nativeWindowHandle: Buffer,
): WindowButtonGeometryResult;

export function setPitch(
  nativeWindowHandle: Buffer,
  centerPitch: number,
): WindowButtonGeometryResult;

export function setSize(
  nativeWindowHandle: Buffer,
  buttonSize: number,
): WindowButtonGeometryResult;
