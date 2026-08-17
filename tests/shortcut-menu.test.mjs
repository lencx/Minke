import assert from "node:assert/strict";
import test from "node:test";
import {
  bindShortcutMenu,
  shortcutBindingToAccelerator,
} from "@minke/desktop/main/shortcut-menu.ts";
import { DesktopLocaleRuntime } from "@minke/desktop/i18n.ts";

const CUSTOM_PREFIX = "minke.shortcut.";

function menuItem(options) {
  return {
    id: options.id,
    type: options.type ?? (
      options.submenu === undefined ? "normal" : "submenu"
    ),
    label: options.label ?? "",
    accessibilityLabel: "",
    sublabel: "",
    toolTip: "",
    accelerator: options.accelerator ?? null,
    icon: undefined,
    enabled: options.enabled ?? true,
    visible: options.visible ?? true,
    checked: options.checked ?? false,
    registerAccelerator: options.registerAccelerator ?? true,
    sharingItem: undefined,
    role: options.role,
    click: options.click ?? (() => {}),
    submenu: options.submenu === undefined
      ? undefined
      : { items: options.submenu.map(menuItem) },
  };
}

function applicationMenu(items) {
  return { items: items.map(menuItem) };
}

function fakeMenuHost(initialMenu) {
  let current = initialMenu;
  const templates = [];
  return {
    templates,
    buildFromTemplate(template) {
      templates.push(template);
      return applicationMenu(template);
    },
    getApplicationMenu() {
      return current;
    },
    setApplicationMenu(menu) {
      current = menu;
    },
  };
}

function defaultMenu() {
  return applicationMenu([
    {
      role: "appMenu",
      label: "Minke",
      submenu: [
        { role: "about", label: "About Minke" },
        { type: "separator" },
        { role: "services", label: "Services" },
        { role: "quit", label: "Quit" },
      ],
    },
    {
      role: "fileMenu",
      label: "File",
      submenu: [{ role: "close", label: "Close" }],
    },
    {
      role: "viewMenu",
      label: "View",
      submenu: [
        { role: "reload", label: "Reload" },
        { role: "toggleDevTools", label: "Developer Tools" },
      ],
    },
  ]);
}

function walk(items) {
  return items.flatMap((item) => [
    item,
    ...(Array.isArray(item.submenu) ? walk(item.submenu) : []),
  ]);
}

function latestItems(host) {
  const template = host.templates.at(-1);
  assert.ok(template);
  return walk(template);
}

function customItem(host, suffix) {
  const item = latestItems(host).find(
    (candidate) => candidate.id === `${CUSTOM_PREFIX}${suffix}`,
  );
  assert.ok(item, `missing native menu item ${suffix}`);
  return item;
}

test("canonical shortcuts map to Electron accelerators", () => {
  assert.equal(
    shortcutBindingToAccelerator("Mod+S", "darwin"),
    "CommandOrControl+S",
  );
  assert.equal(
    shortcutBindingToAccelerator("Mod+Shift+Comma", "darwin"),
    "CommandOrControl+Shift+,",
  );
  assert.equal(
    shortcutBindingToAccelerator("Meta+ArrowLeft", "darwin"),
    "Command+Left",
  );
  assert.equal(
    shortcutBindingToAccelerator("Meta+ArrowLeft", "linux"),
    "Super+Left",
  );
  assert.equal(shortcutBindingToAccelerator(null, "darwin"), undefined);
  assert.throws(
    () => shortcutBindingToAccelerator("S", "darwin"),
    /invalid shortcut binding/u,
  );
});

test("all product shortcuts are visible native menu commands", () => {
  const host = fakeMenuHost(defaultMenu());
  const locale = new DesktopLocaleRuntime("en");
  const dispatched = [];
  const binding = bindShortcutMenu(
    host,
    locale,
    {},
    (id) => dispatched.push(id),
    "darwin",
  );

  assert.equal(
    customItem(host, "settings.open").accelerator,
    "CommandOrControl+,",
  );
  assert.equal(
    customItem(host, "session.new").accelerator,
    "CommandOrControl+N",
  );
  assert.equal(
    customItem(host, "sidebar.toggle").accelerator,
    "CommandOrControl+S",
  );
  assert.equal(
    customItem(host, "tabs.toggle").accelerator,
    "CommandOrControl+P",
  );
  assert.equal(
    customItem(host, "tabs.bottom.toggle").accelerator,
    "CommandOrControl+B",
  );

  customItem(host, "settings.open").click();
  customItem(host, "session.new").click();
  customItem(host, "sidebar.toggle").click();
  customItem(host, "tabs.toggle").click();
  customItem(host, "tabs.bottom.toggle").click();
  assert.deepEqual(dispatched, [
    "settings.open",
    "session.new",
    "sidebar.toggle",
    "tabs.toggle",
    "tabs.bottom.toggle",
  ]);
  binding.dispose();
});

test("persisted and localized changes rebuild menu accelerators", () => {
  const host = fakeMenuHost(defaultMenu());
  const locale = new DesktopLocaleRuntime("en");
  const binding = bindShortcutMenu(
    host,
    locale,
    {},
    () => {},
    "darwin",
  );

  binding.updateBindings({
    "session.new": "",
    "sidebar.toggle": "Mod+Shift+S",
  });
  assert.equal(
    Object.hasOwn(customItem(host, "session.new"), "accelerator"),
    false,
  );
  assert.equal(
    customItem(host, "sidebar.toggle").accelerator,
    "CommandOrControl+Shift+S",
  );

  locale.setLocale("zh");
  assert.equal(customItem(host, "settings.open").label, "设置…");
  assert.equal(customItem(host, "session.new").label, "新建会话");
  assert.equal(
    customItem(host, "sidebar.toggle").label,
    "展开或折叠左侧栏",
  );
  assert.equal(
    customItem(host, "tabs.toggle").label,
    "展开或折叠右侧栏",
  );
  assert.equal(
    customItem(host, "tabs.bottom.toggle").label,
    "展开或折叠底部栏",
  );

  binding.refreshBaseMenu();
  assert.equal(
    latestItems(host).filter(
      (item) => item.id?.startsWith(CUSTOM_PREFIX),
    ).filter((item) => item.type !== "separator").length,
    5,
  );

  const rebuilds = host.templates.length;
  binding.dispose();
  locale.setLocale("en");
  assert.equal(host.templates.length, rebuilds);
});
