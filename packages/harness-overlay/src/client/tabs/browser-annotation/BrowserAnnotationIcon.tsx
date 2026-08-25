import {
  MessageCirclePlus,
} from "@lucide/icons";
import type {
  ReactNode,
} from "react";
import {
  LucideIcon,
} from "@minke/harness-overlay/client/tabs/components/LucideIcon.ts";

/** Shared entry icon for selecting webpage content into Chat. */
export function BrowserAnnotationIcon(
  props: { readonly size?: number },
): ReactNode {
  return (
    <LucideIcon
      icon={MessageCirclePlus}
      size={props.size ?? 14}
    />
  );
}
