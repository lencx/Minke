import { SquareTerminal } from "@lucide/icons";
import type {
  ReactNode,
} from "react";
import {
  LucideIcon,
} from "@minke/harness-overlay/client/tabs/components/LucideIcon.tsx";

export function TerminalIcon(props: {
  size?: number;
}): ReactNode {
  return (
    <LucideIcon
      icon={SquareTerminal}
      size={props.size ?? 17}
    />
  );
}
