export const FILES_PREVIEW_DEFAULT_RATIO = 0.56;
export const FILES_PREVIEW_MIN_WIDTH = 180;
export const FILES_EXPLORER_MIN_WIDTH = 140;
export const FILES_PREVIEW_RESIZE_HANDLE_WIDTH = 9;

export function clampFilesPreviewWidth(
  containerWidth: number,
  requestedWidth: number,
): number {
  const safeContainer = Number.isFinite(containerWidth)
    ? Math.max(0, containerWidth)
    : 0;
  const maximum = Math.max(
    0,
    safeContainer -
      FILES_EXPLORER_MIN_WIDTH -
      FILES_PREVIEW_RESIZE_HANDLE_WIDTH,
  );
  const minimum = Math.min(FILES_PREVIEW_MIN_WIDTH, maximum);
  const safeRequested = Number.isFinite(requestedWidth)
    ? requestedWidth
    : safeContainer * FILES_PREVIEW_DEFAULT_RATIO;
  return Math.round(
    Math.min(maximum, Math.max(minimum, safeRequested)),
  );
}

export function defaultFilesPreviewWidth(
  containerWidth: number,
): number {
  return clampFilesPreviewWidth(
    containerWidth,
    containerWidth * FILES_PREVIEW_DEFAULT_RATIO,
  );
}
