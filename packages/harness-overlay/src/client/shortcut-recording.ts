/**
 * Install the Escape guard used while a shortcut binding is being recorded.
 *
 * The implementation intentionally lives outside React so its event-ordering
 * contract can be verified independently of the Harness Settings shell.
 */
export function installShortcutRecordingEscapeGuard(
  target: Window,
  cancelRecording: () => void,
): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    cancelRecording();
  };

  target.addEventListener("keydown", onKeyDown, true);
  return () => {
    target.removeEventListener("keydown", onKeyDown, true);
  };
}
