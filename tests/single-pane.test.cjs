// v2.126.0 — the home panel is one list under one header. Communities sit at
// the top of the same scroll as the person's waves; one Reorder arranges both,
// each in the order it already saved. These pin the structure, since the split
// (two headers, a capped Communities box) is easy to reintroduce.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.resolve(__dirname, '../client/src/components/waves/WaveList.jsx'), 'utf8');
const home = src.slice(src.indexOf('One section (v2.126.0)'), src.indexOf('export default WaveList'));

test('one header: no COMMUNITIES heading and no capped Communities box', () => {
  assert.ok(home.length > 0, 'home list marker present');
  assert.equal((home.match(/<ListSectionHeader/g) || []).length, 1, 'exactly one list header');
  assert.doesNotMatch(home, /title="COMMUNITIES"/);
  assert.doesNotMatch(home, /maxHeight: '45%'/);
});

test('Communities come first, inside the same scroll as the waves', () => {
  const scroll = home.indexOf('<div ref={listScrollRef}');
  const rows = home.indexOf('show="communityRows"');
  const waves = home.indexOf('show="waves"');
  assert.ok(scroll >= 0 && scroll < rows && rows < waves, 'scroll > community rows > waves');
  assert.doesNotMatch(home.slice(rows, waves), /ref={listScrollRef}/, 'one scroll container, not two');
});

test('one Reorder: Communities and waves each keep their own saved order', () => {
  assert.match(home, /reorderMode === 'home' \? \{ \.\.\.reorder, mode: 'communities' \}/);
  assert.match(home, /reorderMode === 'home' \? \{ \.\.\.reorder, mode: 'waves' \}/);
  assert.match(src, /setReorderMode\('home'\)/);
});

test('+ offers creating and joining when Communities are on; a plain new wave otherwise', () => {
  assert.match(src, /const createMenu = communitiesEnabled && onManageCommunities \?/);
  for (const what of ["'create'", "'browse'", "'join'"]) assert.ok(src.includes(`onManageCommunities(${what})`), what);
  assert.match(home, /onCreate=\{createMenu \? undefined : onNewWave\}/);
});

test('the header total counts every wave once', () => {
  assert.match(src, /const sectionUnread = useMemo\(\(\) => waves\.reduce\(/);
});

test('reordering Communities redraws the rows and the rail, and keeps them in the cache', () => {
  const main = fs.readFileSync(path.resolve(__dirname, '../client/src/views/MainApp.jsx'), 'utf8');
  const handler = main.slice(main.indexOf('const handleReorderCommunities'), main.indexOf('const handleReorderChannels'));
  assert.match(handler, /setMyCommunities\(communities\)/, 'myCommunities moves, not only the channels');
  assert.match(handler, /cacheCommunityChannels\(channels, user\?\.id, communities\)/);
  const cache = fs.readFileSync(path.resolve(__dirname, '../client/src/utils/waveCache.js'), 'utf8');
  const fn = cache.slice(cache.indexOf('export async function cacheCommunityChannels'), cache.indexOf('export async function getCachedCommunityChannels'));
  assert.doesNotMatch(fn, /communities = \[\]/, 'no default that wipes the saved Communities');
  assert.match(fn, /request\.result\?\.communities/, 'a channels-only write keeps the saved Communities');
});
