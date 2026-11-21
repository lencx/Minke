'use strict';

const assert = require('node:assert/strict');

/** Drive annotation → PNG + reference draft through the production bridge. */
async function verifyBrowserCommentDraft({ window, guest, model, rendererValue, waitFor }) {
  const previousRequests = model.requests.length;
  const draft = 'Please review this page.';
  await rendererValue(window, `() => {
    document.querySelector('[data-composer-input][contenteditable="true"]').focus();
    return true;
  }`);
  await window.webContents.insertText(draft);
  await rendererValue(window, `() => {
    document.querySelector('.minke-tabs-native-host:has(.minke-agent-browser__view) button[aria-label="Annotate page"]').click();
    return true;
  }`);
  await waitFor(() => rendererValue(window, `() =>
    document.querySelector('.minke-agent-browser__view[data-annotation-phase="active"]') !== null
  `), 'browser annotation mode');
  const point = await guest.executeJavaScript(`(() => {
    const rect = document.querySelector('button').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await guest.debugger.sendCommand('Input.dispatchMouseEvent', {
      type, ...point, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1,
    });
  }
  await waitFor(() => rendererValue(window, `() =>
    document.querySelector('.minke-agent-browser__annotation-editor textarea') !== null
  `), 'annotation comment editor');
  await rendererValue(window, `() => {
    document.querySelector('.minke-agent-browser__annotation-editor textarea').focus();
    return true;
  }`);
  await window.webContents.insertText('Keep this button easy to find.');
  await waitFor(() => rendererValue(window, `() => {
    const button = document.querySelector('.minke-agent-browser__annotation-add');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }`), 'saved browser comment');
  await waitFor(() => rendererValue(window, `() => {
    const button = document.querySelector('.minke-agent-browser__annotation-send-action');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }`), 'annotation handoff');
  await waitFor(() => rendererValue(window, `() =>
    document.querySelector('[data-composer-chip="browser-comments"]') !== null &&
    document.querySelector('[data-composer-card] img[alt="minke-browser-comments.png"]') !== null
  `), 'screenshot and reference staged in the real composer');
  await waitFor(() => rendererValue(window, `() =>
    document.querySelector('.minke-agent-browser__view[data-annotation-phase]') === null
  `), 'annotation mode closes after staging the draft');
  const state = await rendererValue(window, `() => ({
    text: document.querySelector('[data-composer-input]').textContent,
    chips: document.querySelectorAll('[data-composer-chip="browser-comments"]').length,
  })`);
  assert.equal(state.text.startsWith(draft), true);
  assert.equal(state.chips, 1);
  assert.equal(model.requests.length, previousRequests, 'staging must not send a model request');

  // Leave the later browser-close turn image-free; this check covers draft
  // admission, while upstream owns image encoding/upload on explicit submit.
  await rendererValue(window, `() => {
    const image = document.querySelector('[data-composer-card] img[alt="minke-browser-comments.png"]');
    image.closest('button').parentElement.querySelector('button[aria-label]').click();
    return true;
  }`);
  await waitFor(() => rendererValue(window, `() =>
    document.querySelector('[data-composer-card] img[alt="minke-browser-comments.png"]') === null
  `), 'removed annotation image');
  await rendererValue(window, `() => {
    const input = document.querySelector('[data-composer-input]');
    input.focus();
    const range = document.createRange();
    range.selectNodeContents(input);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    return true;
  }`);
  // Use the awaited editing command, as promptThroughComposer does, instead
  // of racing a raw Backspace event with Lexical's selection reconciliation.
  await window.webContents.insertText('');
  await waitFor(() => rendererValue(window, `() =>
    document.querySelector('[data-composer-input]').textContent === '' &&
    document.querySelector('[data-composer-card] img[alt="minke-browser-comments.png"]') === null
  `), 'cleared annotation draft');
  process.stdout.write('[agent-browser-e2e] Browser annotations staged PNG and reference without sending, preserving the existing draft\n');
}

module.exports = { verifyBrowserCommentDraft };
