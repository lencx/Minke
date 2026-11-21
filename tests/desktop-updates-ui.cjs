'use strict';

const assert = require('node:assert/strict');

/** Production preload and unmodified DSH sidebar consume the standard contract. */
async function verifyDesktopUpdatesUI({ window, rendererValue, waitFor, publish, opens }) {
  assert.deepEqual(await rendererValue(window, `async () => ({
    protocolVersion: window.dshDesktop.protocolVersion,
    state: await window.dshDesktop.updates.status(),
    privateUpdateCheck: typeof window.minkeDesktop.appUpdate.check,
    privateFileOpen: typeof window.minkeDesktop.files.open,
  })`), { protocolVersion: 1, state: { phase: 'idle' }, privateUpdateCheck: 'undefined', privateFileOpen: 'undefined' });

  // Narrow desktops start collapsed; DSH renders a badge there, not the full
  // update action. Open the sidebar before exercising its interactive control.
  if (await rendererValue(window, `() => !!document.querySelector('[data-sidebar-collapsed]')`)) {
    await waitFor(() => rendererValue(window, `() => !!document.querySelector('button[aria-label="Open sidebar"]')`), 'native sidebar expand control');
    await rendererValue(window, `() => { document.querySelector('button[aria-label="Open sidebar"]').click(); return true; }`);
    await waitFor(() => rendererValue(window, `() => !document.querySelector('[data-sidebar-collapsed]')`), 'expanded sidebar for native update actions');
  }

  const indicator = label => `button[aria-label=${JSON.stringify(label)}]`;
  const waitIndicator = label => waitFor(() => rendererValue(window,
    `() => document.querySelector(${JSON.stringify(indicator(label))}) !== null`), `native update label ${label}`).catch(async error => {
      const state = await rendererValue(window, `async () => ({
        viewport: { width: innerWidth, height: innerHeight },
        collapsed: !!document.querySelector('[data-sidebar-collapsed]'),
        update: await window.dshDesktop.updates.status(),
        labels: [...document.querySelectorAll('button[aria-label], [role="img"][aria-label]')].map(element => element.getAttribute('aria-label')),
      })`);
      throw new Error(error.message + '; ui=' + JSON.stringify(state), { cause: error });
    });
  publish({ phase: 'checking' });
  await waitIndicator('Checking for updates…');
  assert.equal(await rendererValue(window, `() => document.querySelector('button[aria-label="Checking for updates…"]').getAttribute('aria-disabled')`), 'true');
  const before = opens();
  await rendererValue(window, `() => { document.querySelector('button[aria-label="Checking for updates…"]').click(); return true; }`);
  assert.equal(opens(), before, 'checking disables the native action');
  publish({ phase: 'downloading', version: '9.0.0', percent: 42 });
  await waitIndicator('42%');
  await rendererValue(window, `() => { document.querySelector('button[aria-label="42%"]').click(); return true; }`);
  await waitFor(() => opens() === before + 1, 'download progress invokes the shell-owned update action');
  publish({ phase: 'available', version: '9.0.0' });
  await waitIndicator('Update');
  await rendererValue(window, `() => { document.querySelector('button[aria-label="Update"]').click(); return true; }`);
  await waitFor(() => opens() === before + 2, 'DSH indicator invokes standard updates.open');
  publish({ phase: 'error', failure: 'download', version: '9.0.0' });
  await waitIndicator('Retry update');
  await rendererValue(window, `() => { document.querySelector('button[aria-label="Retry update"]').click(); return true; }`);
  await waitFor(() => opens() === before + 3, 'native retry invokes standard updates.open');

  await rendererValue(window, `() => { document.querySelector('[data-minke-about-trigger]').click(); return true; }`);
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-minke-about-update-check]') !== null`), 'About update entry');
  await rendererValue(window, `() => { document.querySelector('[data-minke-about-update-check]').click(); return true; }`);
  await waitFor(() => opens() === before + 4, 'About invokes the same standard update action');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-minke-about-dialog]') === null`), 'About yields to the native update flow');
  publish({ phase: 'idle' });
  await waitFor(() => rendererValue(window, `() => document.querySelector('button[aria-label="Retry update"]') === null`), 'idle update indicator disappears');
  process.stdout.write('[desktop-updates-ui] native status, progress, retry and About entry passed\n');
}

module.exports = { verifyDesktopUpdatesUI };
