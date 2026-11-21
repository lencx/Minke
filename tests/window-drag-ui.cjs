'use strict';

const assert = require('node:assert/strict');

/** Check composed native drag rectangles, including controls that punch holes. */
async function verifyWindowDrag({ window, rendererValue }, state) {
  if (process.platform !== 'darwin') return;
  const result = await rendererValue(window, `() => {
    const regions = [...document.querySelectorAll('*')].flatMap(element => {
      const region = getComputedStyle(element).getPropertyValue('-webkit-app-region').trim();
      if (!['drag', 'no-drag'].includes(region) || !element.checkVisibility({ checkVisibilityCSS: true })) return [];
      return [{ rect: element.getBoundingClientRect(), drag: region === 'drag' }];
    });
    const draggable = (x, y) => {
      let drag = false;
      for (const { rect, drag: next } of regions) {
        if (x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom) drag = next;
      }
      return drag;
    };
    const marked = [...document.querySelectorAll('[data-window-drag]')];
    const rows = marked.filter(row => {
      const rect = row.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + 2;
      const hit = document.elementFromPoint(x, y);
      return rect.top < 55 && rect.width > 80 && row.contains(hit);
    });
    const dead = [], swallowed = [];
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + 2;
      if (!draggable(x, y)) dead.push({ x, y, row: row.tagName });
      for (const control of row.querySelectorAll('button, [role="tab"], input')) {
        const box = control.getBoundingClientRect();
        const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
        if (control.contains(document.elementFromPoint(cx, cy)) && draggable(cx, cy)) {
          swallowed.push(control.getAttribute('aria-label') || control.textContent);
        }
      }
    }
    const chrome = rows.length ? undefined : marked.map(row => {
      const rect = row.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 2);
      const scrollers = [];
      for (let element = row; element; element = element.parentElement) {
        if (element.scrollTop || element.scrollLeft) {
          scrollers.push({ className: element.className, left: element.scrollLeft, top: element.scrollTop });
        }
      }
      return { row: row.tagName, className: row.className, rect: rect.toJSON(),
        hit: hit && { tag: hit.tagName, className: hit.className }, scrollers };
    });
    return { rows: rows.length, chrome, dead, swallowed };
  }`);
  assert.ok(result.rows > 0, `${state}: visible top chrome is required: ${JSON.stringify(result.chrome)}`);
  assert.deepEqual(result.dead, [], `${state}: blank titlebar regions must drag`);
  assert.deepEqual(result.swallowed, [], `${state}: native controls must keep pointer events`);
}

async function observeWindowDragRecall({ window, rendererValue }) {
  if (process.platform !== 'darwin') return;
  await rendererValue(window, `() => {
    globalThis.windowDragRecalls = 0;
    new MutationObserver(records => {
      globalThis.windowDragRecalls += records.length;
    }).observe(document.body, { attributes: true, attributeFilter: ['data-window-drag-recall'] });
    return true;
  }`);
}

async function verifyWindowDragRecall({ window, rendererValue }) {
  if (process.platform !== 'darwin') return;
  assert.ok(await rendererValue(window, '() => globalThis.windowDragRecalls > 0'),
    'DSH must recollect native window rectangles after layout changes');
}

module.exports = { verifyWindowDrag, observeWindowDragRecall, verifyWindowDragRecall };
