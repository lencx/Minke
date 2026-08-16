import {
  createElement,
  type ReactNode,
} from "react";
import type {
  LucideIconData,
  LucideIconNode,
} from "@lucide/icons";

function renderNode(
  node: LucideIconNode,
  index: number,
): ReactNode {
  const [tag, attributes, children] = node;
  return createElement(
    tag,
    {
      ...attributes,
      key: attributes.key ?? `${tag}-${index}`,
    },
    children?.map(renderNode),
  );
}

export interface LucideIconProps {
  icon: LucideIconData;
  size?: number;
}

/** Render official Lucide icon data through the product's React surface. */
export function LucideIcon({
  icon,
  size = 16,
}: LucideIconProps): ReactNode {
  const sourceSize = "size" in icon
    ? icon.size
    : Math.max(icon.width, icon.height);
  return (
    <svg
      viewBox={`0 0 ${sourceSize} ${sourceSize}`}
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icon.node.map(renderNode)}
    </svg>
  );
}
