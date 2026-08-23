import type { ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CircleAlert,
  CircleCheck,
  Download,
  House,
  Power,
  Puzzle,
  RefreshCw,
  Square,
  SquareArrowOutUpRight,
  Trash2,
  X,
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

export function PluginInstallIcon(): ReactNode {
  return <LucideIcon icon={Download} size={14} />;
}

export function PluginUninstallIcon(): ReactNode {
  return <LucideIcon icon={Trash2} size={14} />;
}

export function PluginPowerIcon(): ReactNode {
  return <LucideIcon icon={Power} size={14} />;
}

export function PluginSuccessIcon(): ReactNode {
  return <LucideIcon icon={CircleCheck} size={15} />;
}

export function PluginWarningIcon(): ReactNode {
  return <LucideIcon icon={CircleAlert} size={15} />;
}

export function PluginBrowserIcon(): ReactNode {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.419 2.865 8.166 6.839 9.489.5.092.682-.217.682-.48 0-.237-.009-.866-.014-1.7-2.782.604-3.369-1.343-3.369-1.343-.455-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.607.069-.607 1.004.071 1.532 1.031 1.532 1.031.892 1.529 2.341 1.087 2.91.831.091-.646.349-1.087.635-1.337-2.221-.253-4.555-1.111-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.269.098-2.646 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0 1 12 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.748-1.025 2.748-1.025.546 1.377.202 2.393.1 2.646.64.699 1.028 1.592 1.028 2.683 0 3.842-2.337 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.337-.012 2.415-.012 2.744 0 .266.18.576.688.478A10.001 10.001 0 0 0 22 12c0-5.523-4.477-10-10-10Z" />
    </svg>
  );
}

export function PluginClearIcon(): ReactNode {
  return <LucideIcon icon={X} size={13} />;
}

export function PluginBackIcon(): ReactNode {
  return <LucideIcon icon={ArrowLeft} size={14} />;
}

export function PluginForwardIcon(): ReactNode {
  return <LucideIcon icon={ArrowRight} size={14} />;
}

export function PluginHomeIcon(): ReactNode {
  return <LucideIcon icon={House} size={14} />;
}

export function PluginRefreshIcon(): ReactNode {
  return <LucideIcon icon={RefreshCw} size={14} />;
}

export function PluginStopIcon(): ReactNode {
  return <LucideIcon icon={Square} size={12} />;
}

export function PluginExternalIcon(): ReactNode {
  return (
    <LucideIcon icon={SquareArrowOutUpRight} size={14} />
  );
}
