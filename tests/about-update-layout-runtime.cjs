'use strict';

const assert = require('node:assert/strict');
const { join } = require('node:path');
const { app, BrowserWindow } = require('electron');
const { buildSync } = require('esbuild');

const projectRoot = join(__dirname, '..');

async function waitFor(window, predicate, label) {
  const deadline = Date.now() + 2_000;
  while (!(await window.webContents.executeJavaScript(predicate))) {
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function assertRectStable(before, after, label) {
  for (const field of ['x', 'y', 'width', 'height']) {
    assert.ok(
      Math.abs(before[field] - after[field]) <= 0.25,
      `${label}.${field} moved from ${String(before[field])} to ${String(
        after[field],
      )}`,
    );
  }
}

function aboutBundle() {
  const source = `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import { AboutPanel } from "./packages/harness-overlay/src/client/about/view.tsx";
    import { en } from "./packages/harness-overlay/src/client/about/locales.ts";
    import aboutStyles from "./packages/harness-overlay/src/client/about/styles.css";

    const style = document.createElement("style");
    style.textContent = aboutStyles;
    document.head.append(style);

    const t = (key, params) =>
      en[key].replace(/\\{(\\w+)\\}/gu, (match, name) =>
        params !== undefined && Object.hasOwn(params, name)
          ? String(params[name])
          : match,
      );

    let resolveUpdate;
    const checkForUpdates = () =>
      new Promise((resolve) => {
        resolveUpdate = resolve;
      });

    globalThis.resolveAboutUpdate = (result) => {
      resolveUpdate(result);
    };

    createRoot(document.getElementById("root")).render(
      <AboutPanel
        checkForUpdates={checkForUpdates}
        iconUrl="data:image/gif;base64,R0lGODlhAQABAAAAACw="
        info={{
          available: true,
          productName: "Minke",
          version: "0.2.0",
          platform: "darwin",
          arch: "arm64",
        }}
        onClose={() => {}}
        openExternal={() => {}}
        t={t}
      />,
    );
  `;
  return buildSync({
    alias: {
      '@minke/harness-overlay': join(
        projectRoot,
        'packages',
        'harness-overlay',
        'src',
      ),
    },
    bundle: true,
    format: 'iife',
    jsx: 'automatic',
    loader: {
      '.css': 'text',
    },
    platform: 'browser',
    stdin: {
      contents: source,
      loader: 'tsx',
      resolveDir: projectRoot,
    },
    target: 'chrome120',
    write: false,
  }).outputFiles[0].text.replaceAll('</script>', '<\\/script>');
}

async function geometry(window) {
  return await window.webContents.executeJavaScript(`
    (() => {
      const rect = (selector) => {
        const value = document.querySelector(selector).getBoundingClientRect();
        return {
          x: value.x,
          y: value.y,
          width: value.width,
          height: value.height,
        };
      };
      return {
        panel: rect("[data-minke-about-dialog]"),
        update: rect("[data-minke-about-update-check]"),
        project: rect(".minke-about__action--primary"),
      };
    })()
  `);
}

async function run() {
  await app.whenReady();
  const window = new BrowserWindow({
    width: 380,
    height: 700,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.on(
    'console-message',
    (details) => {
      if (details.message) {
        console.error(`renderer: ${details.message}`);
      }
    },
  );
  const bundle = aboutBundle();
  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta
          http-equiv="Content-Security-Policy"
          content="default-src 'none'; img-src data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'"
        >
        <style>
          :root {
            --ds-font-family-code: ui-monospace;
          }
          html, body, #root {
            width: 100%;
            height: 100%;
            margin: 0;
          }
          *, *::before, *::after {
            animation: none !important;
            transition: none !important;
          }
        </style>
      </head>
      <body>
        <div id="root"></div>
        <script>${bundle}</script>
      </body>
    </html>
  `;

  try {
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    );
    await waitFor(
      window,
      'document.querySelector("[data-minke-about-update-check]") !== null',
      'About update button',
    );

    const initial = await geometry(window);
    await window.webContents.executeJavaScript(
      'document.querySelector("[data-minke-about-update-check]").click()',
    );
    await waitFor(
      window,
      'document.querySelector("[data-minke-about-update-check]").disabled',
      'update check to start',
    );
    const checking = await geometry(window);

    await window.webContents.executeJavaScript(
      'globalThis.resolveAboutUpdate("update-available")',
    );
    await waitFor(
      window,
      '!document.querySelector("[data-minke-about-update-check]").disabled && document.querySelector("[role=status] [data-active=true]") !== null',
      'update check to finish',
    );
    const complete = await geometry(window);

    assertRectStable(initial.update, checking.update, 'update button');
    assertRectStable(initial.project, checking.project, 'project button');
    assertRectStable(initial.panel, checking.panel, 'panel while checking');
    assertRectStable(initial.panel, complete.panel, 'panel after checking');
    process.stdout.write('About update layout runtime regression passed\n');
  } finally {
    window.destroy();
    app.quit();
  }
}

run().catch((error) => {
  console.error(error);
  app.exit(1);
});
