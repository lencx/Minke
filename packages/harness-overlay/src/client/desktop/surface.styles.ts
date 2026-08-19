import {
  defineOverlayStyle,
} from "../shared/style-runtime.ts";
import DESKTOP_SURFACE_STYLES from "./surface.css";

export { DESKTOP_SURFACE_STYLES };

/** Install the macOS desktop-surface stylesheet. */
export const installDesktopSurfaceStyles = defineOverlayStyle(
  "desktop-surface",
  DESKTOP_SURFACE_STYLES,
);
