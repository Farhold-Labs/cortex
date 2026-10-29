// v2.131.1 — the wave list's ⋮ and + menus float above the page. They were
// `position: absolute` under their button inside the scrolling list, so a menu
// opened on the last Community hung below the list and gave the panel scroll
// bars (reproduced headlessly: opening it created a 289×221 scrolling box).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('the menu renders into <body> with fixed coordinates and stays in the window', () => {
  const menu = read('client/src/components/ui/FloatingMenu.jsx');
  assert.match(menu, /createPortal\(/);
  assert.match(menu, /document\.body/);
  assert.match(menu, /position: 'fixed', left: pos/);
  assert.match(menu, /const above = a\.top - 4 - m\.height;/, 'opens upward when there is no room below');
  assert.match(menu, /e\.stopPropagation\(\)/, 'a click in the menu does not reach the row');
});

test('no wave-list or section menu hangs inside the list any more', () => {
  for (const f of ['client/src/components/waves/WaveList.jsx', 'client/src/components/ui/CollapsibleSection.jsx']) {
    const src = read(f);
    assert.doesNotMatch(src, /top: '100%'/, `${f} still positions a menu under its button`);
    assert.match(src, /<FloatingMenu anchorRef=/, `${f} uses FloatingMenu`);
  }
  // WaveRowMenu, the Community row, HeaderMenu (+ and ⋮) and PanelMenu.
  assert.equal((read('client/src/components/waves/WaveList.jsx').match(/<FloatingMenu anchorRef=/g) || []).length, 4);
});
