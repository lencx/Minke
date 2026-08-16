import type { ReactNode } from "react";
import Plus from "@lucide/icons/icons/plus";
import X from "@lucide/icons/icons/x";
import {
  LucideIcon,
} from "./LucideIcon.tsx";

export function CloseIcon(props: { size?: number }): ReactNode {
  return (
    <LucideIcon icon={X} size={props.size} />
  );
}

export function PlusIcon(
  props: { size?: number },
): ReactNode {
  return (
    <LucideIcon
      icon={Plus}
      size={props.size}
    />
  );
}
