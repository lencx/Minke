export type WindowButtonGeometry = Readonly<{
  buttonHeight: number;
  buttonWidth: number;
  centerPitches: readonly [number, number];
  status: 'attached' | 'observed';
}>;

export type WindowButtonSkipped = Readonly<{
  reason: string;
  status: 'skipped';
}>;

export type WindowButtonGeometryResult =
  | WindowButtonGeometry
  | WindowButtonSkipped;

export type WindowButtonDetachResult =
  | Readonly<{
    status: 'detached';
  }>
  | WindowButtonSkipped;

export function enable(key: string): boolean;

export function attach(
  nativeWindowHandle: Buffer,
): WindowButtonGeometryResult;

export function detach(
  nativeWindowHandle: Buffer,
): WindowButtonDetachResult;

export function measure(
  nativeWindowHandle: Buffer,
): WindowButtonGeometryResult;
