'use strict';

const assert = require('node:assert/strict');
const { writeFile } = require('node:fs/promises');
const { verifyWindowDrag } = require('./window-drag-ui.cjs');

const subagentScenario = {
  parentPrompt: 'Minke sidebar subagent parent test',
  parentTitle: 'Subagent Sidebar Test',
  parentReply: 'Parent session: the sidebar child has been started.',
  childTitle: 'Sidebar review child',
  childPrompt: 'Minke sidebar child session test',
  childReply: 'Child session: ready for review in the sidebar.',
  followupPrompt: 'Minke sidebar child followup test',
  followupReply: 'Child session: received the sidebar followup.',
};

async function verifySubagentSidebarUI({
  window, harnessUrl, harnessCookie, parentSessionId, rpc, rendererValue,
  waitFor, waitForAssistantMarker, promptThroughComposer,
  openedExternalUrls,
}) {
  const scenario = subagentScenario;
  await rpc(harnessUrl, 'session/prompt', {
    requestId: 'minke-sidebar-subagent-parent', sessionId: parentSessionId,
    mode: 'queue', content: [{ type: 'text', text: scenario.parentPrompt }],
  }, harnessCookie);
  await waitForAssistantMarker(harnessUrl, parentSessionId, scenario.parentReply, harnessCookie);
  const sessions = await rpc(harnessUrl, 'session/list', {}, harnessCookie, '_request');
  const children = sessions.items.find(item => item.sessionId === parentSessionId)?.projections?.values.subagentCatalog;
  assert.ok(Array.isArray(children), 'the native Session projection exposes its Subagent catalog');
  assert.equal(children.length, 1, 'the real subagent tool must create exactly one child');
  assert.equal(children[0].mode, 'continuable');
  await rpc(harnessUrl, 'session/rename', { sessionId: parentSessionId, title: scenario.parentTitle }, harnessCookie);
  window.setSize(1280, 900);
  await window.loadURL(harnessUrl);
  await waitFor(() => rendererValue(window, `() => {
    const parent = [...document.querySelectorAll('[data-conversation-content]')]
      .find(element => !element.closest('[data-sidebar-chat]'));
    return parent?.textContent.includes(${JSON.stringify(scenario.parentReply)})
      && parent.querySelector('[data-composer-input][contenteditable="true"]') !== null;
  }`), 'the selected parent conversation');
  assert.equal(await rendererValue(window, `() => document.querySelector('[data-composer-input][contenteditable="true"]')?.textContent`), '',
    'the parent composer starts empty after the native Sidebar checks');
  await verifyWindowDrag({ window, rendererValue }, 'active conversation');

  await rendererValue(window, `() => {
    const menu = [...document.querySelectorAll('button[aria-haspopup="menu"]')]
      .find(button => /More actions|更多操作/.test(button.getAttribute('aria-label')));
    if (!menu) throw new Error('Session More actions is missing');
    menu.click();
    return true;
  }`);
  await waitFor(() => rendererValue(window, `() => {
    const feedback = [...document.querySelectorAll('[role="menuitem"]')]
      .find(item => /Feedback|反馈/.test(item.textContent));
    if (!feedback) return false;
    feedback.click();
    return true;
  }`), 'native Feedback menu item');
  await waitFor(() => openedExternalUrls.includes('https://github.com/lencx/Minke/issues/new/choose'), 'Minke Issues navigation');
  assert.equal(await rendererValue(window, `() => document.querySelector('[role="dialog"]') !== null`), false,
    'Feedback must open Minke Issues without the DSH feedback dialog');
  process.stdout.write('[feedback-ui] native menu opens Minke Issues without uploading a Session\n');

  const parentDraft = 'Keep this parent draft while reviewing the child.';
  await rendererValue(window, `() => {
    const input = document.querySelector('[data-composer-input][contenteditable="true"]');
    input.focus();
    return true;
  }`);
  await window.webContents.insertText(parentDraft);
  const parentUrl = await rendererValue(window, '() => location.href');
  const assertParent = async () => {
    const state = await rendererValue(window, `() => {
      const parent = [...document.querySelectorAll('[data-conversation-content]')]
        .find(element => !element.closest('[data-sidebar-chat]'));
      return {
        url: location.href,
        draft: parent?.querySelector('[data-composer-input]')?.textContent,
        reply: parent?.textContent.includes(${JSON.stringify(scenario.parentReply)}),
      };
    }`);
    assert.deepEqual(state, { url: parentUrl, draft: parentDraft, reply: true });
  };
  await assertParent();

  const panelToggleId = `dsh-session-panel-toggle-${parentSessionId}`;
  const openAside = async () => {
    await waitFor(() => rendererValue(window, `() => {
      const trigger = document.getElementById(${JSON.stringify(panelToggleId)});
      if (!trigger || trigger.getAttribute('aria-disabled') === 'true') return false;
      if (trigger.getAttribute('aria-expanded') === 'false') trigger.click();
      return true;
    }`), 'parent Session panel');
    await waitFor(() => rendererValue(window, `() => {
      const trigger = document.getElementById(${JSON.stringify(panelToggleId)});
      const panel = document.getElementById(trigger?.getAttribute('aria-controls'));
      const buttons = panel?.querySelectorAll('[data-session-panel-section="subagents"] [role="tree"] button');
      const button = [...(buttons ?? [])]
        .find(element => element.getAttribute('aria-label') === ${JSON.stringify(`Open ${scenario.childTitle} in sidebar`)}
          || element.getAttribute('aria-label') === ${JSON.stringify(`在侧边栏打开 ${scenario.childTitle}`)});
      if (!button) return false;
      button.click();
      return true;
    }`), 'Open Subagent in sidebar action');
    await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-chat]')?.textContent.includes(${JSON.stringify(scenario.childReply)})`), 'child history in the Sidebar');
    await assertParent();
  };

  assert.equal(await rendererValue(window, '() => document.querySelectorAll("[data-sidebar-chat]").length'), 0);
  await openAside();
  await verifyWindowDrag({ window, rendererValue }, 'Subagent open in Sidebar');
  const childDraft = await rendererValue(window, '() => document.querySelector("[data-sidebar-chat] [data-composer-input]")?.textContent');
  assert.equal(childDraft, '', 'the child composer must not inherit the parent draft');
  await promptThroughComposer(window, scenario.followupPrompt, '[data-sidebar-chat]');
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-chat]')?.textContent.includes(${JSON.stringify(scenario.followupReply)})`), 'followup response in the child Session');
  await assertParent();
  if (process.env.MINKE_SUBAGENT_SIDEBAR_SCREENSHOT) {
    await writeFile(process.env.MINKE_SUBAGENT_SIDEBAR_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
  }
  process.stdout.write('[subagent-sidebar-ui] open child, independent parent draft and child followup passed\n');

  await rendererValue(window, `() => {
    const pane = document.querySelector('[data-sidebar-chat]').closest('[data-dockkit-pane]');
    const close = pane.querySelector('[data-dockkit-tab][aria-selected="true"] [data-dockkit-tab-close]');
    if (!close) throw new Error('Subagent tab close control is missing');
    close.click();
    return true;
  }`);
  await waitFor(() => rendererValue(window, '() => document.querySelector("[data-sidebar-chat]") === null'), 'closed child Sidebar tab');
  await assertParent();
  await openAside();
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-chat]')?.textContent.includes(${JSON.stringify(scenario.followupReply)})`), 'child followup retained after reopening');
  const reloaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
  window.webContents.reload();
  await reloaded;
  await waitFor(() => rendererValue(window, `() => document.querySelector('[data-sidebar-chat]')?.textContent.includes(${JSON.stringify(scenario.followupReply)})`), 'Sidebar child restored after refresh');
  const restored = await rendererValue(window, `() => {
    const parent = [...document.querySelectorAll('[data-conversation-content]')]
      .find(element => !element.closest('[data-sidebar-chat]'));
    return parent?.textContent.includes(${JSON.stringify(scenario.parentReply)});
  }`);
  assert.equal(restored, true, 'refresh must restore the parent beside the child');
  process.stdout.write('[subagent-sidebar-ui] close, reopen and refresh restoration passed\n');
}

module.exports = { subagentScenario, verifySubagentSidebarUI };
