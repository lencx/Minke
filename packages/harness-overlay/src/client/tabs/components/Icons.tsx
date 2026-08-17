import type { ReactNode } from "react";
import { Plus, X } from "@lucide/icons";
import {
  LucideIcon,
} from "./LucideIcon.ts";

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
