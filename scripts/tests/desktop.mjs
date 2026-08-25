#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const taskFiles = Object.freeze({
  core: Object.freeze([
    "agent-browser-cdp-annotation.test.mjs",
    "agent-browser-main.test.mjs",
    "agent-browser-process-channel.test.mjs",
    "app-data-paths.test.mjs",
    "app-update-settings.test.mjs",
    "app-update.test.mjs",
    "appimage-packaging.test.mjs",
    "assertion-policy.test.mjs",
    "cross-platform-packaging.test.mjs",
    "desktop-i18n.test.mjs",
    "development-restart.test.mjs",
    "electron-locales.test.mjs",
    "embedded-node-permissions.test.mjs",
    "github-actions-package.test.mjs",
    "github-release.test.mjs",
    "harness-session.test.mjs",
    "main-window-devtools.test.mjs",
    "macos-tray.test.mjs",
    "minke-config.test.mjs",
    "navigation-policy.test.mjs",
    "package-artifact.test.mjs",
    "sys-native-module.test.mjs",
  ]),
  harness: Object.freeze([
    "agent-browser-contract.test.mjs",
    "agent-browser-tools.test.mjs",
    "harness-boot-manifest.test.mjs",
    "harness-contract.test.mjs",
    "harness-launch.test.mjs",
    "harness-overlay.test.mjs",
    "harness-runtime-patches.test.mjs",
    "harness-runtime-prune.test.mjs",
    "harness-runtime-state.test.mjs",
    "harness-source-boundary.test.mjs",
    "module-boundaries.test.mjs",
    "path-aliases.test.mjs",
    "web-search.test.mjs",
  ]),
  ui: Object.freeze([
    "agent-browser-annotations.test.mjs",
    "agent-browser-chat.test.mjs",
    "agent-browser-tabs.test.mjs",
    "bootstrap-theme.test.mjs",
    "browser-settings.test.mjs",
    "client-actions.test.mjs",
    "command-palette.test.mjs",
    "data-home-settings.test.mjs",
    "macos-window-css.test.mjs",
    "mobile-web-viewport.test.mjs",
    "minke-settings.test.mjs",
    "plugin-catalog.test.mjs",
    "pwa.test.mjs",
    "session-export.test.mjs",
    "session-navigation.test.mjs",
    "shortcut-binding.test.mjs",
    "shortcut-i18n.test.mjs",
    "shortcut-menu.test.mjs",
    "shortcut-recording.test.mjs",
    "shortcut-runtime.test.mjs",
    "shortcut-settings.test.mjs",
    "style-runtime.test.mjs",
    "tabs.test.mjs",
    "terminal-settings.test.mjs",
    "terminal-tabs.test.mjs",
    "web-tab-annotations.test.mjs",
    "web-search-settings.test.mjs",
    "window-theme.test.mjs",
  ]),
  host: Object.freeze([
    "im-discord.test.mjs",
    "im-gateway.test.mjs",
    "im-telegram.test.mjs",
    "im-weixin.test.mjs",
    "local-model-settings.test.mjs",
    "minke-host.test.mjs",
    "model-runtime.test.mjs",
    "remote.test.mjs",
    "discord-network.test.mjs",
    "remote-hub.test.mjs",
  ]),
});

const taskNames = Object.freeze(Object.keys(taskFiles));

function usage() {
  return [
    "usage: desktop.mjs <all|task...>",
    `tasks: ${taskNames.join(", ")}`,
  ].join("\n");
}

function selectedTasks(args) {
  if (args.length === 0 || args.includes("all")) {
    if (args.length > 1) {
      throw new Error(`"all" cannot be combined with task names\n${usage()}`);
    }
    return taskNames;
  }
  const selected = [...new Set(args)];
  const unknown = selected.filter(
    (task) => !Object.hasOwn(taskFiles, task),
  );
  if (unknown.length > 0) {
    throw new Error(
      `unknown desktop test task: ${unknown.join(", ")}\n${usage()}`,
    );
  }
  return selected;
}

async function run(
  command,
  args,
) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          signal === null
            ? `${command} exited with code ${String(code)}`
            : `${command} exited on ${signal}`,
        ),
      );
    });
  });
}

async function assertTaskCatalog() {
  const owner = new Map();
  for (const [task, files] of Object.entries(taskFiles)) {
    for (const file of files) {
      const existing = owner.get(file);
      if (existing !== undefined) {
        throw new Error(
          `${file} belongs to both ${existing} and ${task}`,
        );
      }
      owner.set(file, task);
      await access(join(projectRoot, "tests", file));
    }
  }
}

async function main() {
  const tasks = selectedTasks(process.argv.slice(2));
  await assertTaskCatalog();
  await run(process.execPath, [
    "scripts/harness/build-product-packages.mjs",
  ]);
  for (const task of tasks) {
    const files = taskFiles[task];
    if (files === undefined) continue;
    console.log(`\nDesktop test task: ${task}`);
    await run(process.execPath, [
      "--import",
      "./scripts/register-path-aliases.mts",
      "--test",
      ...files.map((file) => `tests/${file}`),
    ]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
