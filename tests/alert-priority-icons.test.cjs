// Alert priority icons were the emoji 🚨 ⚠️ ℹ️ 🎉, which show as boxes on
// systems without an emoji font (and in the font's colours, not the alert's,
// where there is one). v2.122.3 draws them: client/src/components/ui/AlertPriorityIcon.jsx.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const VIEWS = [
  'client/src/components/crawl/CrawlBar.jsx',
  'client/src/components/modals/AlertDetailModal.jsx',
  'client/src/components/admin/AlertsAdminPanel.jsx',
  'client/src/components/groups/GroupsView.jsx',
];

/** Places an alert priority is drawn as an emoji: a priority table's icon, a <select> option, the crawl bar's weather alert. */
function emojiIcons(text) {
  const out = [];
  for (const re of [
    /icon: '[^']*\p{Extended_Pictographic}[^']*'/gu,
    /<option value="(info|warning|critical|celebration)">\s*\p{Extended_Pictographic}/gu,
    /\p{Extended_Pictographic}️? ALERT:/gu,
    /\p{Extended_Pictographic}️? SYSTEM ALERTS/gu,
  ]) for (const m of text.matchAll(re)) out.push(m[0]);
  return out;
}

test('alert views draw priority icons instead of emoji', () => {
  for (const file of VIEWS) {
    const text = fs.readFileSync(path.join(REPO, file), 'utf8');
    assert.deepStrictEqual(emojiIcons(text), [], file);
    assert.match(text, /import AlertPriorityIcon from '\.\.\/ui\/AlertPriorityIcon\.jsx'/, `${file} should use AlertPriorityIcon`);
  }
});

test('every priority has a shape', () => {
  const icon = fs.readFileSync(path.join(REPO, 'client/src/components/ui/AlertPriorityIcon.jsx'), 'utf8');
  assert.match(icon, /const SHAPES = \{ critical: Critical, warning: Warning, info: Info, celebration: Celebration \}/);
  assert.doesNotMatch(icon.replace(/\/\*[\s\S]*?\*\//g, ''), /\p{Extended_Pictographic}/u);
});

test('counterfactual: the v2.122.2 views are caught', () => {
  let found = 0;
  for (const file of VIEWS) {
    const old = execFileSync('git', ['show', `v2.122.2:${file}`], { cwd: REPO, encoding: 'utf8' });
    found += emojiIcons(old).length;
  }
  // 4 tables (14 icons), 7 options, the weather alert and the SYSTEM ALERTS heading.
  assert.strictEqual(found, 23);
});
