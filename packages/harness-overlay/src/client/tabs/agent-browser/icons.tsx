import type { ReactNode } from "react";
import {
  MessageSquarePlus,
  MousePointerClick,
} from "@lucide/icons";
import {
  LucideIcon,
} from "@minke/harness-overlay/client/tabs/components/LucideIcon.ts";

/** Control-transfer action for the embedded Agent Browser page. */
export function BrowserControlIcon(
  props: { readonly size?: number },
): ReactNode {
  return (
    <LucideIcon
      icon={MousePointerClick}
      size={props.size ?? 13}
    />
  );
}

/** Enter the host-owned DOM comment picker. */
export function BrowserAnnotateIcon(
  props: { readonly size?: number },
): ReactNode {
  return (
    <LucideIcon
      icon={MessageSquarePlus}
      size={props.size ?? 13}
    />
  );
}
