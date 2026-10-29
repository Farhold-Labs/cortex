// Alert priority icons were the emoji 🚨 ⚠️ ℹ️ 🎉, which show as boxes on
// systems without an emoji font (and in the font's colours, not the alert's,
// where there is one). v2.122.3 draws them: client/src/components/ui/AlertPriorityIcon.jsx.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

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

test('counterfactual: the v2.122.2 code is caught', () => {
  // The lines these views had before v2.122.3. Embedded rather than read from
  // git: CI's checkout has no tags.
  const old = [
    "critical: { icon: '🚨', color: 'var(--accent-orange)', showLabel: true },",
    "warning: { icon: '⚠️', color: 'var(--accent-amber)' },",
    "info: { icon: 'ℹ️', color: 'var(--accent-teal)', label: 'INFO' },",
    "celebration: { icon: '🎉', color: 'var(--accent-purple)' }",
    '<option value="info">ℹ️ Info</option>',
    '<option value="critical">🚨 Critical</option>',
    '<option value="celebration">🎉 Celebration</option>',
    '⚠️ ALERT: {alert.event}',
    "fontWeight: 500 }}>🚨 SYSTEM ALERTS</div>",
  ].join('\n');
  assert.strictEqual(emojiIcons(old).length, 9);
  // The empty celebration icon the crawl bar had is not an emoji, and is not flagged.
  assert.deepStrictEqual(emojiIcons("celebration: { icon: '', color: 'x' },"), []);
});
