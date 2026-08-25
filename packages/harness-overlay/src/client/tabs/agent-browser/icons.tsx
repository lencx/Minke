import type { ReactNode } from "react";
import {
  MousePointerClick,
} from "@lucide/icons";
import {
  LucideIcon,
} from "@minke/harness-overlay/client/tabs/components/LucideIcon.ts";
import {
  BrowserAnnotationIcon,
} from "@minke/harness-overlay/client/tabs/browser-annotation/BrowserAnnotationIcon.tsx";

/** Control-transfer action for the embedded Agent Browser page. */
export function BrowserControlIcon(
  props: { readonly size?: number },
): ReactNode {
  return (
    <LucideIcon
      icon={MousePointerClick}
      size={props.size ?? 14}
    />
  );
}

/** Enter the host-owned DOM comment picker. */
export function BrowserAnnotateIcon(
  props: { readonly size?: number },
): ReactNode {
  return <BrowserAnnotationIcon size={props.size} />;
}
