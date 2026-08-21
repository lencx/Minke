interface VisualViewportOwner {
  readonly visualViewport?: EventTarget | null;
}

/** Schedule a terminal refit when browser chrome or a soft keyboard moves. */
export function observeTerminalVisualViewport(
  view: VisualViewportOwner,
  onChange: () => void,
): () => void {
  const viewport = view.visualViewport;
  if (viewport === undefined || viewport === null) {
    return () => {};
  }
  viewport.addEventListener("resize", onChange, {
    passive: true,
  });
  viewport.addEventListener("scroll", onChange, {
    passive: true,
  });
  return () => {
    viewport.removeEventListener("resize", onChange);
    viewport.removeEventListener("scroll", onChange);
  };
}
