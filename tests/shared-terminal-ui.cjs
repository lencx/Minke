'use strict';

const assert = require('node:assert/strict');
const { readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');

/** Real input, preference updates and renderer reload against the production PTY. */
exports.verifySharedTerminalUI = async ({ window, rendererValue, waitFor, workspace, click, pressKey, pressShortcut, pressEnter, typeKeys, assertIconButtons }) => {
  const toggle = '[data-minke-new-session-tabs-action] [data-minke-tabs-placement="bottom"]';
  const bottom = '.minke-tabs-panel[data-placement="bottom"]';
  const screen = bottom + ' [data-terminal-placement="bottom"]:not([hidden]) [data-terminal-renderer="dsh"]';
  const file = join(workspace, 'shared-bottom-terminal.txt');
  const run = async (command, expected) => {
    await writeFile(file, 'waiting');
    await waitFor(() => rendererValue(window, `() => document.querySelector('${screen} .xterm-helper-textarea') !== null && document.querySelector('${screen} [role="status"]') === null`), 'connected DSH bottom Terminal');
    await click(screen + ' .xterm-screen');
    await waitFor(() => rendererValue(window, `() => document.activeElement === document.querySelector('${screen} .xterm-helper-textarea')`), 'DSH bottom Terminal keyboard focus');
    typeKeys(command);
    pressEnter();
    await waitFor(async () => (await readFile(file, 'utf8')).trim() === expected, 'bottom shell command output');
  };
  const checkAppearance = async size => {
    const appearances = await waitFor(async () => {
      const value = await rendererValue(window, `() => {
        const selectors = ['[data-sidebar-right-panel] [data-terminal-renderer="dsh"]', '${screen}'];
        return selectors.map(selector => {
          const root = document.querySelector(selector), rows = root?.querySelector('.xterm-rows');
          if (!rows) return null;
          const style = getComputedStyle(rows);
          return { font: style.fontFamily, size: style.fontSize, line: rows.firstElementChild?.getBoundingClientRect().height, background: getComputedStyle(root).backgroundColor };
        });
      }`);
      return value.every(item => item?.size === size + 'px') && value;
    }, 'shared live Terminal typography');
    assert.deepEqual(appearances[0], appearances[1], 'both placements share font, line spacing and background');
    assert.ok(appearances[0].font.includes('monospace'), 'migrated General font preferences reach the native screen');
  };
  await click(toggle);
  await run(process.platform === 'win32'
    ? 'set "minke_bottom_state=retained"&echo assigned > shared-bottom-terminal.txt'
    : 'minke_bottom_state=retained; printf "%s" $$ > shared-bottom-pid.txt; printf assigned > shared-bottom-terminal.txt', 'assigned');
  const shellPid = process.platform === 'win32' ? undefined : Number(await readFile(join(workspace, 'shared-bottom-pid.txt'), 'utf8'));
  if (shellPid !== undefined) assert.ok(Number.isSafeInteger(shellPid) && shellPid > 0);
  await checkAppearance(16);

  await pressShortcut(',');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-shortcut-modal="settings"]') !== null`), 'Settings for shared typography');
  await click('button[aria-label="More font settings"]');
  await click('button[aria-label="Increase code font size"]');
  await waitFor(() => rendererValue(window, `() => getComputedStyle(document.body).getPropertyValue('--dsh-code-font-size').trim() === '12px'`), 'General code size 12');
  for (const size of [17, 18]) {
    await click('button[aria-label="Increase terminal font size"]');
    await waitFor(() => rendererValue(window, `() => getComputedStyle(document.body).getPropertyValue('--dsh-terminal-font-size').trim() === '${size}px'`), 'General terminal size ' + size);
  }
  const settingsNav = '[data-shortcut-modal="settings"] nav button';
  const minkeSettingsIndex = await rendererValue(window, `() =>
    [...document.querySelectorAll(${JSON.stringify(settingsNav)})]
      .findIndex(button => button.textContent.trim() === 'Minke' &&
        button.querySelector('[data-slot="settings.section.icon"] svg[viewBox="0 0 832 832"]'))
  `);
  assert.ok(minkeSettingsIndex >= 0, 'native Settings navigation renders the Minke mark');
  await click(settingsNav, minkeSettingsIndex);
  assert.equal(await rendererValue(window, `() => document.querySelector('[data-minke-terminal-settings] input[aria-describedby~="minke-terminal-settings-font-size-help"]') === null`), true, 'no duplicate terminal font editor');
  const lineHeight = '[data-minke-terminal-settings] input[aria-describedby~="minke-terminal-settings-line-height-help"]';
  await click(lineHeight);
  await waitFor(() => rendererValue(window, `() => document.activeElement === document.querySelector('${lineHeight}')`), 'line spacing keyboard focus');
  pressKey('Up');
  // Native input updates its value before React publishes the draft preview.
  // Observe that edit before sending the separate blur/commit action.
  await waitFor(() => rendererValue(window, `() => document.querySelector('${lineHeight}')?.value === '1.35' && document.querySelector('.minke-terminal-settings__preview-code')?.style.lineHeight === '1.35'`), 'line spacing draft preview');
  pressKey('Tab');
  await waitFor(() => rendererValue(window, `async () => (await window.minkeDesktop.terminal.readSettings()).lineHeight === 1.35`), 'Minke line spacing remains editable');
  assert.equal(await rendererValue(window, `async () => (await window.minkeDesktop.terminal.readSettings()).fontSize`), 16, 'legacy typography remains a backup');
  const closeIndex = await rendererValue(window, `() => [...document.querySelectorAll('[data-shortcut-modal="settings"] button')].findIndex(button => button.textContent.trim() === 'Close')`);
  assert.ok(closeIndex >= 0, 'native Settings exposes its accessible Close action');
  await click('[data-shortcut-modal="settings"] button', closeIndex);
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-shortcut-modal="settings"]') === null`), 'close typography settings');
  await checkAppearance(18);
  const checkState = () => run(process.platform === 'win32'
    ? 'echo %minke_bottom_state% > shared-bottom-terminal.txt'
    : 'printf "%s" "$minke_bottom_state" > shared-bottom-terminal.txt', 'retained');
  await checkState();
  await assertIconButtons(bottom + ' button[aria-haspopup="menu"]', 18);
  await click(bottom + ' button[aria-haspopup="menu"]');
  await click('[data-minke-tabs-create-menu] [data-option="terminal"]');
  await run(process.platform === 'win32'
    ? 'echo second > shared-bottom-terminal.txt'
    : 'printf second > shared-bottom-terminal.txt', 'second');
  assert.equal(await rendererValue(window, `() => [...document.querySelectorAll('${bottom} [data-terminal-placement="bottom"]')].filter(element => element.checkVisibility({ checkVisibilityCSS: true })).length`), 1, 'only the selected bottom tab paints its screen');
  await click(bottom + ' [role="tab"]', 0);
  await checkState();
  await click(bottom + ' .minke-tab__close', 1);
  process.stdout.write('[shared-terminal-ui] both placements use DSH, share saved/live typography and preserve shell state\n');
  return async () => {
    await click(toggle);
    await checkState();
    await checkAppearance(18);
    await click(bottom + ' .minke-tab__close');
    await waitFor(() => rendererValue(window, `() => document.querySelector('${screen}') === null`), 'explicitly closed bottom terminal');
    if (shellPid !== undefined) await waitFor(() => {
      try { process.kill(shellPid, 0); return false; }
      catch (error) { if (error.code === 'ESRCH') return true; throw error; }
    }, 'DSH closes the bottom shell process');
    process.stdout.write('[shared-terminal-ui] refresh reconnects the original bottom shell and saved settings; explicit close ends its process\n');
  };
};
