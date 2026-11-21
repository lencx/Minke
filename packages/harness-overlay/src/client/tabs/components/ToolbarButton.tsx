import type { ComponentProps, ReactNode } from "react";
import { Button } from "@deepseek-ai/dsh-client-ui-primitives";

export interface ToolbarButtonProps {
  label: string;
  disabled?: boolean;
  pressed?: boolean;
  activeTone?: "success";
  onClick: () => void;
  children: ComponentProps<typeof Button>["children"];
}

export function ToolbarButton(props: ToolbarButtonProps): ReactNode {
  return (
    <Button
      size="sm"
      type="button"
      className="minke-tabs-toolbar__button"
      data-minke-icon-button
      aria-label={props.label}
      aria-pressed={props.pressed}
      data-active-tone={props.activeTone}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </Button>
  );
}
