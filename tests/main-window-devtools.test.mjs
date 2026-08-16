import assert from "node:assert/strict";
import test from "node:test";
import {
  bindMainWindowDevToolsShortcut,
} from "@minke/desktop/main/main-window-devtools.ts";
import {
  bindShortcutMenu,
} from "@minke/desktop/main/shortcut-menu.ts";
import { DesktopLocaleRuntime } from "@minke/desktop/i18n.ts";

function menuItem(options) {
  const submenu = Array.isArray(options.submenu)
    ? new FakeMenu(options.submenu.map(menuItem))
    : (options.submenu ?? null);
  return {
    accelerator: options.accelerator ?? null,
    accessibilityLabel: options.accessibilityLabel ?? "",
    checked: options.checked ?? false,
    click: options.click ?? (() => {}),
    enabled: options.enabled ?? true,
    icon: options.icon,
    id: options.id ?? "",
    label: options.label ?? "",
    registerAccelerator: options.registerAccelerator ?? true,
    role: options.role,
    sharingItem: options.sharingItem,
    sublabel: options.sublabel ?? "",
    submenu,
    toolTip: options.toolTip ?? "",
    type: options.type ?? (submenu === null ? "normal" : "submenu"),
    userAccelerator: options.userAccelerator ?? null,
    visible: options.visible ?? true,
  };
}

class FakeMenu {
  constructor(items) {
    this.items = items;
  }
}

class MenuPort {
  current;

  constructor(template) {
    this.current = this.buildFromTemplate(template);
  }

  buildFromTemplate(template) {
    return new FakeMenu(template.map(menuItem));
  }

  getApplicationMenu() {
    return this.current;
  }

  setApplicationMenu(menu) {
    this.current = menu;
  }
}

function defaultMenu() {
  return new MenuPort([
    {
      label: "View",
      role: "viewMenu",
      submenu: [
        { label: "Reload", role: "reload" },
        {
          accelerator: "Alt+Command+I",
          label: "Toggle Developer Tools",
          role: "toggledevtools",
        },
      ],
    },
  ]);
}

function findDevToolsItem(menu) {
  const pending = [...menu.items];
  while (pending.length > 0) {
    const item = pending.shift();
    if (
      item.id === "minke.main-window.toggle-devtools" ||
      item.role === "toggleDevTools"
    ) {
      return item;
    }
    if (item.submenu !== undefined && item.submenu !== null) {
      pending.push(...item.submenu.items);
    }
  }
  return undefined;
}

test("DevTools keeps its native role and macOS accelerator", () => {
  const menu = defaultMenu();
  bindMainWindowDevToolsShortcut(
    menu,
    "darwin",
  );
  const item = findDevToolsItem(menu.current);

  assert.ok(item);
  assert.equal(item.role, "toggleDevTools");
  assert.equal(item.label, "Toggle Developer Tools");
  assert.equal(item.accelerator, "Alt+Command+I");
  assert.equal(menu.current.items[0].role, undefined);
  assert.equal(menu.current.items[0].submenu.items[0].role, "reload");
});

test("rebinding the menu does not duplicate the native DevTools item", () => {
  const menu = defaultMenu();
  bindMainWindowDevToolsShortcut(
    menu,
    "darwin",
  );
  bindMainWindowDevToolsShortcut(
    menu,
    "darwin",
  );

  const items = menu.current.items.flatMap(
    (item) => item.submenu?.items ?? [item],
  ).filter(
    (item) => item.id === "minke.main-window.toggle-devtools",
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].role, "toggleDevTools");
});

test("a missing default role gets a hidden native accelerator", () => {
  const menu = new MenuPort([
    {
      label: "File",
      submenu: [{ label: "Close", role: "close" }],
    },
  ]);
  bindMainWindowDevToolsShortcut(
    menu,
    "linux",
  );
  const item = findDevToolsItem(menu.current);

  assert.ok(item);
  assert.equal(item.role, "toggleDevTools");
  assert.equal(item.accelerator, "Control+Shift+I");
  assert.equal(item.visible, false);
});

test("shortcut menu rebuild preserves the native DevTools role", () => {
  const menu = defaultMenu();
  bindMainWindowDevToolsShortcut(
    menu,
    "darwin",
  );
  const shortcutBinding = bindShortcutMenu(
    menu,
    new DesktopLocaleRuntime("en"),
    {},
    () => {},
    "darwin",
  );
  const item = findDevToolsItem(menu.current);

  assert.ok(item);
  assert.equal(item.role, "toggleDevTools");
  assert.equal(item.accelerator, "Alt+Command+I");

  shortcutBinding.dispose();
});
