import type {
  Menu,
  MenuItem,
  MenuItemConstructorOptions,
} from "electron";
import type {
  DesktopLocaleRuntime,
  DesktopMessageKey,
} from "../i18n.ts";
import {
  DEFAULT_SHORTCUT_BINDINGS,
  isShortcutBinding,
  parseShortcutBindings,
  type ProductShortcutActionId,
  type ShortcutBindings,
} from "../../packages/harness-overlay/src/shortcut-contract.ts";

const OWNED_MENU_ID_PREFIX = "minke.shortcut.";

const MENU_ITEM_IDS = Object.freeze({
  "settings.open": `${OWNED_MENU_ID_PREFIX}settings.open`,
  "session.new": `${OWNED_MENU_ID_PREFIX}session.new`,
  "sidebar.toggle": `${OWNED_MENU_ID_PREFIX}sidebar.toggle`,
} satisfies Record<ProductShortcutActionId, string>);

const MENU_LABEL_KEYS = Object.freeze({
  "settings.open": "menu.settings",
  "session.new": "menu.newSession",
  "sidebar.toggle": "menu.toggleSidebar",
} satisfies Record<ProductShortcutActionId, DesktopMessageKey>);

const KEY_ACCELERATORS: Readonly<Record<string, string>> = Object.freeze({
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  Backquote: "`",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Equal: "=",
  Escape: "Esc",
  Minus: "-",
  Period: ".",
  Quote: "'",
  Semicolon: ";",
  Slash: "/",
});

type MenuKind = "app" | "file" | "view";

type ApplicationMenuPort = Readonly<{
  buildFromTemplate(template: MenuItemConstructorOptions[]): Menu;
  getApplicationMenu(): Menu | null;
  setApplicationMenu(menu: Menu | null): void;
}>;

type ShortcutMenuLocale = Pick<
  DesktopLocaleRuntime,
  "subscribe" | "t"
>;

type BaseTopLevelMenu = Readonly<{
  kind: MenuKind | undefined;
  template: MenuItemConstructorOptions;
}>;

export type ShortcutMenuBinding = Readonly<{
  updateBindings(bindings: ShortcutBindings): void;
  refreshBaseMenu(): void;
  dispose(): void;
}>;

/** Convert Minke's canonical binding grammar to Electron accelerator syntax. */
export function shortcutBindingToAccelerator(
  binding: string | null,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (binding === null || binding === "") return undefined;
  if (!isShortcutBinding(binding)) {
    throw new TypeError(`invalid shortcut binding ${JSON.stringify(binding)}`);
  }

  const tokens = binding.split("+");
  const key = tokens.pop();
  if (key === undefined) return undefined;
  const modifiers = tokens.map((token) => {
    if (token === "Mod") return "CommandOrControl";
    if (token === "Ctrl") return "Control";
    if (token === "Meta") {
      return platform === "darwin" ? "Command" : "Super";
    }
    return token;
  });
  return [...modifiers, KEY_ACCELERATORS[key] ?? key].join("+");
}

/**
 * Add Minke actions to the native application menu without owning or
 * replacing Electron's standard role-based menu.
 */
export function bindShortcutMenu(
  menu: ApplicationMenuPort,
  locale: ShortcutMenuLocale,
  initialBindings: ShortcutBindings,
  dispatch: (id: ProductShortcutActionId) => void,
  platform: NodeJS.Platform = process.platform,
): ShortcutMenuBinding {
  let bindings = parseShortcutBindings(initialBindings);
  let baseMenu = snapshotBaseMenu(
    menu.getApplicationMenu(),
    platform,
  );
  let disposed = false;

  const rebuild = (): void => {
    if (disposed) return;
    const entries = baseMenu.map(({ kind, template }) => ({
      kind,
      template: cloneTemplate(template),
    }));
    injectActions(
      entries,
      locale,
      bindings,
      dispatch,
      platform,
    );
    menu.setApplicationMenu(
      menu.buildFromTemplate(entries.map((entry) => entry.template)),
    );
  };
  const unsubscribeLocale = locale.subscribe(rebuild);
  rebuild();

  return Object.freeze({
    updateBindings(nextBindings) {
      if (disposed) return;
      bindings = parseShortcutBindings(nextBindings);
      rebuild();
    },
    refreshBaseMenu() {
      if (disposed) return;
      baseMenu = snapshotBaseMenu(
        menu.getApplicationMenu(),
        platform,
      );
      rebuild();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeLocale();
    },
  });
}

function injectActions(
  entries: Array<{
    kind: MenuKind | undefined;
    template: MenuItemConstructorOptions;
  }>,
  locale: ShortcutMenuLocale,
  bindings: ShortcutBindings,
  dispatch: (id: ProductShortcutActionId) => void,
  platform: NodeJS.Platform,
): void {
  const accelerators = effectiveAccelerators(bindings, platform);
  let appMenu = entries.find((entry) => entry.kind === "app");
  let fileMenu = entries.find((entry) => entry.kind === "file");
  let viewMenu = entries.find((entry) => entry.kind === "view");

  if (platform === "darwin" && appMenu === undefined) {
    appMenu = {
      kind: "app",
      template: {
        label: "Minke",
        submenu: [],
      },
    };
    entries.unshift(appMenu);
  }
  if (fileMenu === undefined) {
    fileMenu = {
      kind: "file",
      template: {
        label: locale.t("menu.file"),
        submenu: [],
      },
    };
    entries.push(fileMenu);
  }
  if (viewMenu === undefined) {
    viewMenu = {
      kind: "view",
      template: {
        label: locale.t("menu.view"),
        submenu: [],
      },
    };
    entries.push(viewMenu);
  }

  const newSession = actionMenuItem(
    "session.new",
    locale,
    accelerators,
    dispatch,
  );
  const settings = actionMenuItem(
    "settings.open",
    locale,
    accelerators,
    dispatch,
  );
  const toggleSidebar = actionMenuItem(
    "sidebar.toggle",
    locale,
    accelerators,
    dispatch,
  );

  prependGroup(
    submenuOf(fileMenu.template),
    platform === "darwin"
      ? [newSession]
      : [newSession, settings],
    `${OWNED_MENU_ID_PREFIX}file.separator`,
  );
  prependGroup(
    submenuOf(viewMenu.template),
    [toggleSidebar],
    `${OWNED_MENU_ID_PREFIX}view.separator`,
  );
  if (platform === "darwin" && appMenu !== undefined) {
    insertSettings(
      submenuOf(appMenu.template),
      settings,
    );
  }
}

function effectiveAccelerators(
  overrides: ShortcutBindings,
  platform: NodeJS.Platform,
): Record<ProductShortcutActionId, string | undefined> {
  const ids = Object.keys(
    DEFAULT_SHORTCUT_BINDINGS,
  ) as ProductShortcutActionId[];
  const effective = Object.fromEntries(
    ids.map((id) => {
      const binding = Object.hasOwn(overrides, id)
        ? overrides[id]
        : DEFAULT_SHORTCUT_BINDINGS[id];
      return [
        id,
        shortcutBindingToAccelerator(binding ?? null, platform),
      ];
    }),
  ) as Record<ProductShortcutActionId, string | undefined>;

  const counts = new Map<string, number>();
  for (const accelerator of Object.values(effective)) {
    if (accelerator === undefined) continue;
    counts.set(accelerator, (counts.get(accelerator) ?? 0) + 1);
  }
  for (const id of ids) {
    const accelerator = effective[id];
    if (
      accelerator !== undefined &&
      (counts.get(accelerator) ?? 0) > 1
    ) {
      effective[id] = undefined;
    }
  }
  return effective;
}

function actionMenuItem(
  id: ProductShortcutActionId,
  locale: ShortcutMenuLocale,
  accelerators: Record<ProductShortcutActionId, string | undefined>,
  dispatch: (id: ProductShortcutActionId) => void,
): MenuItemConstructorOptions {
  const accelerator = accelerators[id];
  return {
    id: MENU_ITEM_IDS[id],
    label: locale.t(MENU_LABEL_KEYS[id]),
    ...(accelerator === undefined ? {} : { accelerator }),
    click: () => dispatch(id),
  };
}

function prependGroup(
  submenu: MenuItemConstructorOptions[],
  items: MenuItemConstructorOptions[],
  separatorId: string,
): void {
  if (items.length === 0) return;
  submenu.unshift(
    ...items,
    ...(submenu.length === 0
      ? []
      : [{
          id: separatorId,
          type: "separator" as const,
        }]),
  );
}

function insertSettings(
  submenu: MenuItemConstructorOptions[],
  settings: MenuItemConstructorOptions,
): void {
  const firstSeparator = submenu.findIndex(
    (item) => item.type === "separator",
  );
  const insertionIndex = firstSeparator < 0
    ? 0
    : firstSeparator + 1;
  submenu.splice(
    insertionIndex,
    0,
    settings,
    {
      id: `${OWNED_MENU_ID_PREFIX}app.separator`,
      type: "separator",
    },
  );
}

function submenuOf(
  item: MenuItemConstructorOptions,
): MenuItemConstructorOptions[] {
  if (!Array.isArray(item.submenu)) item.submenu = [];
  return item.submenu;
}

function snapshotBaseMenu(
  applicationMenu: Menu | null,
  platform: NodeJS.Platform,
): BaseTopLevelMenu[] {
  if (applicationMenu === null) return [];
  return applicationMenu.items
    .filter((item) => !isOwnedItem(item))
    .map((item, index) => ({
      kind: classifyTopLevel(item, index, platform),
      template: cloneMenuItem(item),
    }));
}

function classifyTopLevel(
  item: MenuItem,
  index: number,
  platform: NodeJS.Platform,
): MenuKind | undefined {
  if (
    item.role === "appMenu" ||
    (platform === "darwin" && index === 0)
  ) {
    return "app";
  }
  if (
    item.role === "fileMenu" ||
    submenuContainsRole(item, "close")
  ) {
    return "file";
  }
  if (
    item.role === "viewMenu" ||
    submenuContainsRole(item, "reload") ||
    submenuContainsRole(item, "toggleDevTools")
  ) {
    return "view";
  }
  return undefined;
}

function submenuContainsRole(
  item: MenuItem,
  role: string,
): boolean {
  return item.submenu?.items.some(
    (candidate) => candidate.role === role,
  ) ?? false;
}

function isOwnedItem(item: MenuItem): boolean {
  return (
    typeof item.id === "string" &&
    item.id.startsWith(OWNED_MENU_ID_PREFIX)
  );
}

function cloneMenuItem(item: MenuItem): MenuItemConstructorOptions {
  const base: MenuItemConstructorOptions = {
    ...(typeof item.id !== "string" || item.id === ""
      ? {}
      : { id: item.id }),
    type: item.type,
    ...(item.label === "" ? {} : { label: item.label }),
    ...(item.accessibilityLabel === ""
      ? {}
      : { accessibilityLabel: item.accessibilityLabel }),
    ...(item.sublabel === "" ? {} : { sublabel: item.sublabel }),
    ...(item.toolTip === "" ? {} : { toolTip: item.toolTip }),
    ...(item.accelerator === null
      ? {}
      : { accelerator: item.accelerator }),
    ...(item.icon === undefined ? {} : { icon: item.icon }),
    enabled: item.enabled,
    visible: item.visible,
    checked: item.checked,
    registerAccelerator: item.registerAccelerator,
    ...(item.sharingItem === undefined
      ? {}
      : { sharingItem: item.sharingItem }),
  };
  if (item.submenu !== undefined && item.submenu !== null) {
    return {
      ...base,
      type: "submenu",
      submenu: item.submenu.items
        .filter((child) => !isOwnedItem(child))
        .map(cloneMenuItem),
    };
  }
  if (item.role !== undefined) return { ...base, role: item.role };
  return {
    ...base,
    click: item.click as MenuItemConstructorOptions["click"],
  };
}

function cloneTemplate(
  item: MenuItemConstructorOptions,
): MenuItemConstructorOptions {
  return {
    ...item,
    ...(Array.isArray(item.submenu)
      ? { submenu: item.submenu.map(cloneTemplate) }
      : {}),
  };
}
