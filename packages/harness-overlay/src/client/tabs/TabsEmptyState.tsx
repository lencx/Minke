import type {
  TabsTranslate,
} from "./locales.ts";
import type {
  TabRendererRegistry,
} from "./registry.ts";
import type {
  TabCreateContext,
} from "./types.ts";

export interface TabsEmptyStateProps {
  readonly renderers: TabRendererRegistry;
  readonly context: TabCreateContext;
  readonly t: TabsTranslate;
  readonly onCreated?: () => void;
}

/** Shared chooser for first-use and subsequent tab creation. */
export function TabsEmptyState({
  renderers,
  context,
  t,
  onCreated,
}: TabsEmptyStateProps) {
  return (
    <div
      className="minke-tabs-empty"
      role="group"
      aria-label={t("panel.create")}
    >
      <div className="minke-tabs-empty__options">
        {renderers.creators().map((option) => (
          <button
            key={option.id}
            type="button"
            className="minke-tabs-empty__option"
            data-option={option.id}
            onClick={() => {
              option.create(context);
              onCreated?.();
            }}
          >
            <span
              className="minke-tabs-empty__icon"
              aria-hidden="true"
            >
              {option.icon}
            </span>
            <span className="minke-tabs-empty__label">
              {option.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
