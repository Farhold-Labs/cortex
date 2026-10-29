// v2.125.0 — the two-panel wave list: a Community or category opens in its
// own panel, with a rail of everything else on desktop and a drill-down on a
// phone. These pin the pieces that decide what goes where, which the list, the
// panels and the rail all share.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const load = () => import(path.join(root, 'client/src/utils/waveGroups.js'));

test('initials: two words, one word, emoji and punctuation skipped', async () => {
  const { initialsFor } = await load();
  assert.equal(initialsFor('My Private Test Community'), 'MP');
  assert.equal(initialsFor('Main'), 'MA');
  assert.equal(initialsFor('🎭 Main Stage'), 'MS');
  assert.equal(initialsFor('#general'), 'GE');
  assert.equal(initialsFor('Rock &amp; Roll'), 'RR', 'stored names are entity-encoded');
  assert.equal(initialsFor('élan vital'), 'ÉV');
  assert.equal(initialsFor(''), '?');
});

test('grouping: channel waves leave the personal lists; a pinned one still counts toward its channel', async () => {
  const { groupWaves, unreadOf } = await load();
  const channels = [{ id: 'ch1', communityId: 'c1' }];
  const categories = [{ id: 'k1' }];
  const waves = [
    { id: 'a', category_id: 'k1', unread_count: 1 },
    { id: 'b', unread_count: 2 },
    { id: 'c', channelId: 'ch1', category_id: 'k1', unread_count: 4 },
    { id: 'd', channelId: 'ch1', pinned: true, unread_count: 8 },
  ];
  const g = groupWaves(waves, categories, channels);
  assert.deepEqual(g.categorized.k1.map(w => w.id), ['a'], 'the shared grouping wins over a personal category');
  assert.deepEqual(g.uncategorized.map(w => w.id), ['b']);
  assert.deepEqual(g.byChannel.ch1.map(w => w.id), ['c']);
  assert.deepEqual(g.pinned.map(w => w.id), ['d']);
  assert.equal(unreadOf(g.allByChannel.ch1), 12, 'pinned channel wave counts toward the channel');
  assert.equal(unreadOf([{ id: 'b', unread_count: 2 }], { b: { count: 5 } }), 5, 'a notification count takes precedence');
});

test('back: a press that lands on our own entry is not ours to handle', () => {
  const hook = read('client/src/hooks/useSystemBack.js');
  assert.match(hook, /if \(event\?\.state && event\.state\[marker\]\) return;/);
  const app = read('client/src/views/MainApp.jsx');
  assert.match(app, /useSystemBack\(panelBackArmed, \(\) => setOpenContainer\(null\), \{ marker: 'cortex-panel' \}\)/);
  // Armed only with no wave over the panel, so its entry sits beneath the wave's.
  assert.match(app, /else if \(!selectedWave\) setPanelBackArmed\(true\);/);
});

test('the rail: desktop only, and a wave tile leaves the panel alone', () => {
  const app = read('client/src/views/MainApp.jsx');
  assert.match(app, /\{!isMobile && !sidebarCollapsed && openContainerValid && \(\s*<WaveRail/);
  assert.match(app, /onSelectWave=\{\(wave\) => \{ if \(wave\.id !== selectedWave\?\.id\) keepPanelRef\.current = true; selectWave\(wave\); \}\}/);
  const rail = read('client/src/components/waves/WaveRail.jsx');
  // Categories if you use them, otherwise one tile per wave.
  assert.match(app, /looseWaves: waveCategories\.length === 0 \? g\.uncategorized : null/);
  assert.match(rail, /\{looseWaves \? looseWaves\.map\(waveTile\) :/);
  // A colour from a CSS variable cannot take a hex alpha suffix.
  assert.doesNotMatch(rail, /\$\{color\}[0-9a-f]{2}`/);
});

test('a lost Community or deleted category closes its panel, only once the real lists are in', () => {
  const app = read('client/src/views/MainApp.jsx');
  assert.match(app, /openContainer\.kind === 'community' && communitiesLoaded/);
  assert.match(app, /openContainer\.kind === 'category' && categoriesLoaded/);
});
