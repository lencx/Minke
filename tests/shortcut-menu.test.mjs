import assert from "node:assert/strict";
import test from "node:test";
import {
  bindShortcutMenu,
  shortcutBindingToAccelerator,
} from "@minke/desktop/main/shortcut-menu.ts";
import { DesktopLocaleRuntime } from "@minke/desktop/i18n.ts";
import {
  TAB_CREATE_SHORTCUT_DESCRIPTORS,
} from "@minke/harness-overlay/shortcut-contract.ts";

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

function submenuItems(host, suffix) {
  const item = customItem(host, suffix);
  assert.ok(Array.isArray(item.submenu));
  return item.submenu;
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
    customItem(host, "palette.open").accelerator,
    "CommandOrControl+K",
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
    Object.hasOwn(customItem(host, "composer.focus"), "accelerator"),
    false,
  );
  assert.equal(
    customItem(host, "session.back").accelerator,
    "CommandOrControl+[",
  );
  assert.equal(
    customItem(host, "session.forward").accelerator,
    "CommandOrControl+]",
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

  customItem(host, "palette.open").click();
  customItem(host, "settings.open").click();
  customItem(host, "session.new").click();
  customItem(host, "composer.focus").click();
  customItem(host, "session.back").click();
  customItem(host, "session.forward").click();
  customItem(host, "sidebar.toggle").click();
  customItem(host, "tabs.toggle").click();
  customItem(host, "tabs.bottom.toggle").click();
  assert.deepEqual(dispatched, [
    "palette.open",
    "settings.open",
    "session.new",
    "composer.focus",
    "session.back",
    "session.forward",
    "sidebar.toggle",
    "tabs.toggle",
    "tabs.bottom.toggle",
  ]);
  binding.dispose();
});

test("tab creation shortcuts are native commands grouped by placement", () => {
  const expectedCreators = [
    "files",
    "terminal",
    "browser",
    "browser-history",
    "plugins",
  ];
  for (const platform of ["darwin", "win32", "linux"]) {
    const host = fakeMenuHost(defaultMenu());
    const locale = new DesktopLocaleRuntime("en");
    const dispatched = [];
    const binding = bindShortcutMenu(
      host,
      locale,
      {},
      (id) => dispatched.push(id),
      platform,
    );

    const right = submenuItems(
      host,
      "tabs.right.create.submenu",
    );
    const bottom = submenuItems(
      host,
      "tabs.bottom.create.submenu",
    );
    const template = host.templates.at(-1);
    assert.ok(template);
    const fileMenu = template.find(
      (item) =>
        Array.isArray(item.submenu) &&
        item.submenu.some(
          (child) =>
            child.id ===
            `${CUSTOM_PREFIX}tabs.right.create.submenu`,
        ),
    );
    assert.ok(fileMenu);
    assert.ok(Array.isArray(fileMenu.submenu));
    assert.deepEqual(
      fileMenu.submenu
        .filter((item) =>
          item.id ===
            `${CUSTOM_PREFIX}tabs.right.create.submenu` ||
          item.id ===
            `${CUSTOM_PREFIX}tabs.bottom.create.submenu`
        )
        .map((item) => item.id),
      [
        `${CUSTOM_PREFIX}tabs.right.create.submenu`,
        `${CUSTOM_PREFIX}tabs.bottom.create.submenu`,
      ],
    );
    assert.equal(
      customItem(host, "tabs.right.create.submenu").label,
      "New Tab in Right Panel",
    );
    assert.equal(
      customItem(host, "tabs.bottom.create.submenu").label,
      "New Tab in Bottom Panel",
    );
    assert.deepEqual(
      right.map((item) => item.label),
      [
        "File Manager",
        "Terminal",
        "Browser",
        "Browser History",
        "Plugins",
      ],
    );
    assert.deepEqual(
      bottom.map((item) => item.label),
      [
        "File Manager",
        "Terminal",
        "Browser",
        "Browser History",
        "Plugins",
      ],
    );

    const expectedRight = TAB_CREATE_SHORTCUT_DESCRIPTORS
      .filter((descriptor) => descriptor.placement === "right");
    const expectedBottom = TAB_CREATE_SHORTCUT_DESCRIPTORS
      .filter((descriptor) => descriptor.placement === "bottom");
    assert.deepEqual(
      expectedRight.map((descriptor) => descriptor.creatorId),
      expectedCreators,
    );
    assert.deepEqual(
      expectedBottom.map((descriptor) => descriptor.creatorId),
      expectedCreators,
    );
    const keys = ["1", "2", "7", "8", "9"];
    assert.deepEqual(
      right.map(({ id, accelerator }) => ({ accelerator, id })),
      expectedRight.map((descriptor, index) => ({
        accelerator:
          `CommandOrControl+${keys[index]}`,
        id: `${CUSTOM_PREFIX}${descriptor.actionId}`,
      })),
    );
    assert.deepEqual(
      bottom.map(({ id, accelerator }) => ({ accelerator, id })),
      expectedBottom.map((descriptor, index) => ({
        accelerator:
          `CommandOrControl+Shift+${keys[index]}`,
        id: `${CUSTOM_PREFIX}${descriptor.actionId}`,
      })),
    );
    for (const item of [...right, ...bottom]) item.click();
    assert.deepEqual(
      dispatched,
      [...expectedRight, ...expectedBottom].map(
        (descriptor) => descriptor.actionId,
      ),
    );
    binding.dispose();
  }
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
    "composer.focus": "Mod+Shift+L",
    "sidebar.toggle": "Mod+Shift+S",
    "tabs.right.open.files": "Alt+1",
  });
  assert.equal(
    Object.hasOwn(customItem(host, "session.new"), "accelerator"),
    false,
  );
  assert.equal(
    customItem(host, "composer.focus").accelerator,
    "CommandOrControl+Shift+L",
  );
  assert.equal(
    customItem(host, "sidebar.toggle").accelerator,
    "CommandOrControl+Shift+S",
  );
  assert.equal(
    customItem(host, "tabs.right.open.files").accelerator,
    "Alt+1",
  );

  locale.setLocale("zh");
  assert.equal(customItem(host, "palette.open").label, "命令面板…");
  assert.equal(customItem(host, "settings.open").label, "设置…");
  assert.equal(customItem(host, "session.new").label, "新建会话");
  assert.equal(
    customItem(host, "composer.focus").label,
    "聚焦消息输入框",
  );
  assert.equal(customItem(host, "session.back").label, "返回上一会话");
  assert.equal(customItem(host, "session.forward").label, "前往下一会话");
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
  assert.equal(
    customItem(host, "tabs.right.create.submenu").label,
    "在右栏新建 Tab",
  );
  assert.equal(
    customItem(host, "tabs.bottom.create.submenu").label,
    "在底栏新建 Tab",
  );
  assert.deepEqual(
    submenuItems(host, "tabs.right.create.submenu").map(
      (item) => item.label,
    ),
    ["文件管理器", "终端", "浏览器", "浏览历史", "插件"],
  );

  binding.refreshBaseMenu();
  const ownedCommands = latestItems(host).filter(
    (item) =>
      item.id?.startsWith(CUSTOM_PREFIX) &&
      item.type !== "separator",
  );
  assert.equal(ownedCommands.length, 21);
  assert.equal(
    new Set(ownedCommands.map((item) => item.id)).size,
    ownedCommands.length,
  );

  const rebuilds = host.templates.length;
  binding.dispose();
  locale.setLocale("en");
  assert.equal(host.templates.length, rebuilds);
});
