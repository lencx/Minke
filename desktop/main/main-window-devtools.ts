import type {
  Menu,
  MenuItem,
  MenuItemConstructorOptions,
} from "electron";

const DEVTOOLS_MENU_ITEM_ID = "minke.main-window.toggle-devtools";

type MainWindowMenuPort = Readonly<{
  buildFromTemplate(template: MenuItemConstructorOptions[]): Menu;
  getApplicationMenu(): Menu | null;
  setApplicationMenu(menu: Menu | null): void;
}>;

function defaultDevToolsAccelerator(
  platform: NodeJS.Platform,
): string {
  return platform === "darwin"
    ? "Alt+Command+I"
    : "Control+Shift+I";
}

function cloneMenuItemBase(
  item: MenuItem,
): MenuItemConstructorOptions {
  return {
    ...(item.id === "" ? {} : { id: item.id }),
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
}

function isMainWindowDevToolsItem(item: MenuItem): boolean {
  return (
    item.role?.toLowerCase() === "toggledevtools" ||
    item.id === DEVTOOLS_MENU_ITEM_ID
  );
}

/**
 * Preserve Electron's native DevTools role while normalizing its accelerator.
 *
 * On macOS the native role owns the Command+Option+I key equivalent. Replacing
 * it with a plain click callback makes that accelerator inert after another
 * application-menu rebuild.
 */
export function bindMainWindowDevToolsShortcut(
  menu: MainWindowMenuPort,
  platform: NodeJS.Platform = process.platform,
): void {
  let replacedDefaultItem = false;

  const cloneItem = (item: MenuItem): MenuItemConstructorOptions => {
    const base = cloneMenuItemBase(item);

    if (isMainWindowDevToolsItem(item)) {
      replacedDefaultItem = true;
      return {
        ...base,
        id: DEVTOOLS_MENU_ITEM_ID,
        type: "normal",
        role: "toggleDevTools",
        accelerator:
          item.accelerator ??
          item.userAccelerator ??
          defaultDevToolsAccelerator(platform),
      };
    }

    if (item.submenu !== undefined && item.submenu !== null) {
      return {
        ...base,
        type: "submenu",
        submenu: item.submenu.items.map(cloneItem),
      };
    }

    if (item.role !== undefined) {
      return { ...base, role: item.role };
    }

    return {
      ...base,
      click: item.click as MenuItemConstructorOptions["click"],
    };
  };

  const applicationMenu = menu.getApplicationMenu();
  const template = applicationMenu === null
    ? []
    : applicationMenu.items.map(cloneItem);

  if (!replacedDefaultItem) {
    template.push({
      id: DEVTOOLS_MENU_ITEM_ID,
      label: "Toggle Developer Tools",
      role: "toggleDevTools",
      accelerator: defaultDevToolsAccelerator(platform),
      acceleratorWorksWhenHidden: true,
      visible: false,
    });
  }

  menu.setApplicationMenu(menu.buildFromTemplate(template));
}
