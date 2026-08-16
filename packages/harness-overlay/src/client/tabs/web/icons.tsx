import type { ReactNode } from "react";
import ArrowLeft from "@lucide/icons/icons/arrow-left";
import ArrowRight from "@lucide/icons/icons/arrow-right";
import Globe from "@lucide/icons/icons/globe";
import Puzzle from "@lucide/icons/icons/puzzle";
import RotateCw from "@lucide/icons/icons/rotate-cw";
import Square from "@lucide/icons/icons/square";
import SquareArrowOutUpRight from "@lucide/icons/icons/square-arrow-out-up-right";
import {
  LucideIcon,
} from "../components/LucideIcon.tsx";

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
  return <LucideIcon icon={SquareArrowOutUpRight} />;
}

export function WebIcon(props: { size?: number }): ReactNode {
  return (
    <LucideIcon icon={Globe} size={props.size ?? 17} />
  );
}

export function PluginsIcon(
  props: { size?: number },
): ReactNode {
  return (
    <LucideIcon icon={Puzzle} size={props.size ?? 17} />
  );
}
