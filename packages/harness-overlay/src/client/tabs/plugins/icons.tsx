import type { ReactNode } from "react";
import {
  Power,
  Puzzle,
} from "@lucide/icons";
import {
  LucideIcon,
} from "@minke/harness-overlay/client/tabs/components/LucideIcon.ts";

export function PluginIcon(
  props: { size?: number },
): ReactNode {
  return (
    <LucideIcon icon={Puzzle} size={props.size ?? 17} />
  );
}

export function PluginPowerIcon(): ReactNode {
  return <LucideIcon icon={Power} size={14} />;
}
