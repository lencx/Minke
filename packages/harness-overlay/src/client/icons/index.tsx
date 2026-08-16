import { KEYBOARD_ICON_PATHS } from "./data.ts";

export interface IconProps {
  size?: number;
  className?: string;
}

const KEYBOARD_ICON_CLASS =
  "lucide lucide-keyboard-icon lucide-keyboard";

/**
 * Product-owned keyboard glyph with the same size/className surface as
 * Harness ui-primitives icons.
 */
export const IconKeyboardOutline16 = ({
  size = 16,
  className,
}: IconProps) => (
  <svg
    width={size}
    height={size}
    className={
      className === undefined
        ? KEYBOARD_ICON_CLASS
        : `${KEYBOARD_ICON_CLASS} ${className}`
    }
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden
  >
    {KEYBOARD_ICON_PATHS.map((path) => (
      <path key={path} d={path} />
    ))}
    <rect width={20} height={16} x={2} y={4} rx={2} />
  </svg>
);

export {
  KEYBOARD_ICON_DATA_URL,
  KEYBOARD_ICON_PATHS,
  KEYBOARD_ICON_SVG,
} from "./data.ts";
