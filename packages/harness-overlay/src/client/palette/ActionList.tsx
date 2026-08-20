import type { ReactNode } from "react";
import {
  formatShortcutBinding,
  type ShortcutPlatform,
} from "../binding.ts";
import type {
  PaletteActionGroup,
  PaletteActionView,
} from "../runtime.ts";
import type { PaletteTranslate } from "./locales.ts";
import type { CommandPaletteRuntime } from "./runtime.ts";

const GROUPS: readonly PaletteActionGroup[] = [
  "session",
  "open",
  "view",
  "application",
];

function ActionRow(props: {
  action: PaletteActionView;
  active: boolean;
  platform: ShortcutPlatform;
  runtime: CommandPaletteRuntime;
}): ReactNode {
  const { action, active, platform, runtime } = props;
  const disabled = action.disabledReason !== undefined;
  return (
    <button
      id={`minke-command-${action.id}`}
      className="minke-command-palette__action"
      type="button"
      role="option"
      aria-selected={active}
      aria-disabled={disabled}
      data-active={active || undefined}
      disabled={disabled}
      tabIndex={-1}
      onMouseMove={() => runtime.select(action.id)}
      onClick={() => runtime.execute(action.id)}
    >
      <span className="minke-command-palette__action-copy">
        <span className="minke-command-palette__action-label">
          {action.label}
        </span>
        {action.disabledReason !== undefined && (
          <span className="minke-command-palette__disabled-reason">
            {action.disabledReason}
          </span>
        )}
      </span>
      {action.binding !== null && (
        <kbd className="minke-command-palette__shortcut">
          {formatShortcutBinding(action.binding, platform)}
        </kbd>
      )}
    </button>
  );
}

export function CommandPaletteActionList(props: {
  actions: readonly PaletteActionView[];
  activeId: string | undefined;
  grouped: boolean;
  platform: ShortcutPlatform;
  runtime: CommandPaletteRuntime;
  t: PaletteTranslate;
}): ReactNode {
  const renderAction = (action: PaletteActionView) => (
    <ActionRow
      key={action.id}
      action={action}
      active={action.id === props.activeId}
      platform={props.platform}
      runtime={props.runtime}
    />
  );
  if (!props.grouped) return props.actions.map(renderAction);

  return GROUPS.map((group) => {
    const actions = props.actions.filter((action) => action.group === group);
    if (actions.length === 0) return null;
    return (
      <div
        key={group}
        className="minke-command-palette__group"
        role="group"
        aria-labelledby={`minke-command-group-${group}`}
      >
        <div
          id={`minke-command-group-${group}`}
          className="minke-command-palette__group-label"
        >
          {props.t(`group.${group}`)}
        </div>
        {actions.map(renderAction)}
      </div>
    );
  });
}
