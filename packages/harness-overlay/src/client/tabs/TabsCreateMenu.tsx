import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  createPortal,
} from "react-dom";
import {
  detectShortcutPlatform,
  formatShortcutBinding,
  formatShortcutBindingAria,
  type ShortcutPlatform,
} from "../shortcuts/binding.ts";
import type {
  TabsPanelPlacement,
} from "./constants.ts";
import type {
  TabCreateContext,
  TabCreateOption,
} from "./types.ts";

const MENU_WIDTH = 224;
const MENU_WIDTH_APPLE = 240;
const MENU_WIDTH_OTHER = 288;
const MENU_ROW_HEIGHT = 36;
const MENU_COARSE_ROW_HEIGHT = 44;
const MENU_VERTICAL_PADDING = 10;
const MENU_ROW_GAP = 1;
const VIEWPORT_GUTTER = 8;
const ANCHOR_GAP = 6;

interface TabsCreateMenuGeometry {
  readonly bottom?: number;
  readonly left: number;
  readonly maxHeight: number;
  readonly side: "above" | "below";
  readonly top?: number;
  readonly width: number;
}

export interface TabsCreateMenuProps {
  readonly anchor: HTMLElement | null;
  readonly context: TabCreateContext;
  readonly focusBoundary?: HTMLElement | null;
  readonly id?: string;
  readonly label: string;
  readonly onClose: () => void;
  readonly onCreated?: () => void;
  readonly open: boolean;
  readonly options: readonly TabCreateOption[];
  readonly placement: TabsPanelPlacement;
  readonly shortcutBinding?: (
    optionId: string,
  ) => string | null | undefined;
  readonly shortcutPlatform?: ShortcutPlatform;
}

const menuFocusableSelector = [
  'button:not(:disabled):not([tabindex="-1"])',
  '[href]:not([tabindex="-1"])',
  'input:not(:disabled):not([tabindex="-1"])',
  'select:not(:disabled):not([tabindex="-1"])',
  'textarea:not(:disabled):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableItems(
  menu: HTMLDivElement,
): readonly HTMLButtonElement[] {
  return [
    ...menu.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    ),
  ];
}

function sameGeometry(
  left: TabsCreateMenuGeometry | undefined,
  right: TabsCreateMenuGeometry,
): boolean {
  return (
    left?.bottom === right.bottom &&
    left?.left === right.left &&
    left?.maxHeight === right.maxHeight &&
    left?.side === right.side &&
    left?.top === right.top &&
    left?.width === right.width
  );
}

function focusBesideAnchor(
  anchor: HTMLElement,
  menu: HTMLDivElement,
  boundary: HTMLElement | undefined,
  backwards: boolean,
): void {
  const root: ParentNode = boundary ?? anchor.ownerDocument;
  const candidates = [
    ...root.querySelectorAll<HTMLElement>(
      menuFocusableSelector,
    ),
  ].filter(
    (element) =>
      !menu.contains(element) &&
      element.closest('[hidden], [aria-hidden="true"]') === null,
  );
  const current = candidates.indexOf(anchor);
  if (current < 0 || candidates.length === 0) {
    anchor.focus({ preventScroll: true });
    return;
  }
  const offset = backwards ? -1 : 1;
  const next =
    (current + offset + candidates.length) %
    candidates.length;
  candidates[next]?.focus({ preventScroll: true });
}

/**
 * Anchored new-tab picker that keeps the active tab visible while choosing
 * another content type.
 */
export function TabsCreateMenu({
  anchor,
  context,
  focusBoundary,
  id,
  label,
  onClose,
  onCreated,
  open,
  options,
  placement,
  shortcutBinding,
  shortcutPlatform = detectShortcutPlatform(),
}: TabsCreateMenuProps): ReactNode {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const focusedAnchorRef = useRef<HTMLElement | null>(null);
  const [geometry, setGeometry] =
    useState<TabsCreateMenuGeometry>();
  const menuWidth = shortcutBinding === undefined
    ? MENU_WIDTH
    : shortcutPlatform === "apple"
      ? MENU_WIDTH_APPLE
      : MENU_WIDTH_OTHER;

  useLayoutEffect(() => {
    if (!open || anchor === null) {
      setGeometry(undefined);
      return;
    }
    const document = anchor.ownerDocument;
    const view = document.defaultView;
    if (view === null) return;
    const update = (): void => {
      const bounds = anchor.getBoundingClientRect();
      const width = Math.max(0, Math.min(
        menuWidth,
        view.innerWidth - VIEWPORT_GUTTER * 2,
      ));
      const left = Math.min(
        Math.max(
          VIEWPORT_GUTTER,
          bounds.right - width,
        ),
        Math.max(
          VIEWPORT_GUTTER,
          view.innerWidth - width - VIEWPORT_GUTTER,
        ),
      );
      const belowTop = Math.max(
        VIEWPORT_GUTTER,
        bounds.bottom + ANCHOR_GAP,
      );
      const aboveBottom = Math.min(
        view.innerHeight - VIEWPORT_GUTTER,
        bounds.top - ANCHOR_GAP,
      );
      const belowAvailable = Math.max(
        0,
        view.innerHeight - belowTop - VIEWPORT_GUTTER,
      );
      const aboveAvailable = Math.max(
        0,
        aboveBottom - VIEWPORT_GUTTER,
      );
      const rowHeight =
        view.matchMedia?.("(pointer: coarse)").matches === true
          ? MENU_COARSE_ROW_HEIGHT
          : MENU_ROW_HEIGHT;
      const desiredHeight =
        MENU_VERTICAL_PADDING +
        options.length * rowHeight +
        Math.max(0, options.length - 1) * MENU_ROW_GAP;
      const side =
        belowAvailable >= desiredHeight ||
        belowAvailable >= aboveAvailable
          ? "below"
          : "above";
      const next: TabsCreateMenuGeometry = {
        left,
        maxHeight:
          side === "below"
            ? belowAvailable
            : aboveAvailable,
        side,
        width,
        ...(side === "below"
          ? { top: belowTop }
          : {
              bottom:
                view.innerHeight -
                aboveBottom,
            }),
      };
      setGeometry((current) =>
        sameGeometry(current, next) ? current : next
      );
    };
    update();
    view.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    return () => {
      view.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
    };
  }, [anchor, menuWidth, open, options.length]);

  useLayoutEffect(() => {
    if (!open) {
      focusedAnchorRef.current = null;
      return;
    }
    if (
      anchor === null ||
      geometry === undefined ||
      focusedAnchorRef.current === anchor
    ) return;
    focusedAnchorRef.current = anchor;
    const focusFirst = (): void => {
      const menu = menuRef.current;
      if (menu === null) return;
      focusableItems(menu)[0]?.focus({ preventScroll: true });
    };
    queueMicrotask(focusFirst);
  }, [anchor, geometry, open]);

  useEffect(() => {
    if (!open || anchor === null) return;
    const document = anchor.ownerDocument;
    const NodeConstructor = document.defaultView?.Node;
    const closeFromOutside = (event: globalThis.Event): void => {
      const target = event.target;
      if (
        NodeConstructor === undefined ||
        !(target instanceof NodeConstructor) ||
        anchor.contains(target) ||
        menuRef.current?.contains(target) === true
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener(
      "pointerdown",
      closeFromOutside,
      true,
    );
    return () => {
      document.removeEventListener(
        "pointerdown",
        closeFromOutside,
        true,
      );
    };
  }, [anchor, onClose, open]);

  const handleKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      anchor?.focus({ preventScroll: true });
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      const menu = menuRef.current;
      onClose();
      if (anchor !== null && menu !== null) {
        focusBesideAnchor(
          anchor,
          menu,
          focusBoundary ?? undefined,
          event.shiftKey,
        );
      }
      return;
    }
    const menu = menuRef.current;
    if (menu === null) return;
    const items = focusableItems(menu);
    if (items.length === 0) return;
    const current = items.indexOf(
      event.currentTarget.ownerDocument
        .activeElement as HTMLButtonElement,
    );
    let next: number;
    if (event.key === "ArrowDown") {
      next = current < 0 ? 0 : (current + 1) % items.length;
    } else if (event.key === "ArrowUp") {
      next =
        current <= 0 ? items.length - 1 : current - 1;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = items.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    items[next]?.focus({ preventScroll: true });
  };

  if (
    !open ||
    anchor === null ||
    geometry === undefined ||
    typeof document === "undefined"
  ) {
    return null;
  }

  return createPortal(
    <div
      id={id}
      ref={menuRef}
      className="minke-tabs-create-menu"
      data-minke-tabs-create-menu=""
      data-placement={placement}
      data-side={geometry.side}
      role="menu"
      aria-label={label}
      style={{
        bottom: geometry.bottom,
        left: geometry.left,
        maxHeight: geometry.maxHeight,
        top: geometry.top,
        width: geometry.width,
      }}
      onKeyDown={handleKeyDown}
    >
      {options.map((option) => {
        const resolvedBinding = shortcutBinding?.(option.id);
        const binding =
          typeof resolvedBinding === "string" &&
            resolvedBinding.length > 0
            ? resolvedBinding
            : undefined;
        return (
          <button
            key={option.id}
            type="button"
            className="minke-tabs-create-menu__item"
            data-option={option.id}
            role="menuitem"
            aria-keyshortcuts={
              binding === undefined
                ? undefined
                : formatShortcutBindingAria(
                    binding,
                    shortcutPlatform,
                  )
            }
            onClick={() => {
              option.create(context);
              onClose();
              onCreated?.();
            }}
          >
            <span
              className="minke-tabs-create-menu__icon"
              aria-hidden="true"
            >
              {option.icon}
            </span>
            <span className="minke-tabs-create-menu__label">
              {option.label}
            </span>
            {binding !== undefined && (
              <kbd
                className="minke-tabs-create-menu__shortcut"
                aria-hidden="true"
              >
                {formatShortcutBinding(binding, shortcutPlatform)}
              </kbd>
            )}
          </button>
        );
      })}
    </div>,
    anchor.ownerDocument.body,
  );
}
