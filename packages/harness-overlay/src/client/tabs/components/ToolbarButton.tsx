import type { ReactNode } from "react";

export interface ToolbarButtonProps {
  label: string;
  disabled?: boolean;
  pressed?: boolean;
  activeTone?: "success";
  onClick: () => void;
  children: ReactNode;
}

export function ToolbarButton(props: ToolbarButtonProps): ReactNode {
  return (
    <button
      type="button"
      className="minke-tabs-toolbar__button"
      aria-label={props.label}
      aria-pressed={props.pressed}
      data-active-tone={props.activeTone}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
