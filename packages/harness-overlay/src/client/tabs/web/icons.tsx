import type { ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Globe,
  RotateCw,
  Square,
  SquareArrowOutUpRight,
} from "@lucide/icons";
import {
  LucideIcon,
} from "@minke/harness-overlay/client/tabs/components/LucideIcon.ts";

export function BackIcon(): ReactNode {
  return <LucideIcon icon={ArrowLeft} />;
}

export function ForwardIcon(): ReactNode {
  return <LucideIcon icon={ArrowRight} />;
}

export function ReloadIcon(): ReactNode {
  return <LucideIcon icon={RotateCw} />;
}

export function StopIcon(): ReactNode {
  return <LucideIcon icon={Square} size={14} />;
}

export function ExternalIcon(): ReactNode {
  return <LucideIcon icon={SquareArrowOutUpRight} size={14} />;
}

export function WebIcon(props: { size?: number }): ReactNode {
  return (
    <LucideIcon icon={Globe} size={props.size ?? 17} />
  );
}
