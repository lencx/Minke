import type { ReactNode } from "react";
import {
  CircleCheck,
  CircleAlert,
  Download,
  KeyRound,
  PackageOpen,
  Puzzle,
  RefreshCw,
  Search,
  Square,
  SquareArrowOutUpRight,
  Star,
} from "@lucide/icons";
import {
  LucideIcon,
} from "@minke/harness-overlay/client/tabs/components/LucideIcon.ts";

export function PluginCatalogIcon(
  props: { size?: number },
): ReactNode {
  return (
    <LucideIcon icon={Puzzle} size={props.size ?? 17} />
  );
}

export function PluginEmptyIcon(
  props: { size?: number },
): ReactNode {
  return (
    <LucideIcon icon={PackageOpen} size={props.size ?? 24} />
  );
}

export function PluginRefreshIcon(): ReactNode {
  return <LucideIcon icon={RefreshCw} />;
}

export function PluginStopIcon(): ReactNode {
  return <LucideIcon icon={Square} size={13} />;
}

export function PluginSearchIcon(): ReactNode {
  return <LucideIcon icon={Search} />;
}

export function PluginExternalIcon(): ReactNode {
  return <LucideIcon icon={SquareArrowOutUpRight} />;
}

export function PluginStarIcon(): ReactNode {
  return <LucideIcon icon={Star} size={12} />;
}

export function PluginWarningIcon(): ReactNode {
  return <LucideIcon icon={CircleAlert} size={15} />;
}

export function PluginInstallIcon(): ReactNode {
  return <LucideIcon icon={Download} size={13} />;
}

export function PluginInstalledIcon(): ReactNode {
  return <LucideIcon icon={CircleCheck} size={13} />;
}

export function PluginCredentialIcon(): ReactNode {
  return <LucideIcon icon={KeyRound} size={14} />;
}
