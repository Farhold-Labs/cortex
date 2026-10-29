// v2.127.0 — a page that outlived its build. Deploys used to delete every file
// of the previous build, so a page still running it (an Android app resumed
// from the background) got a 404 for its lazily loaded login screen and went
// blank on sign-out or session expiry, until the cache was cleared.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const load = () => import(path.join(root, 'client/scripts/carry-assets.mjs'));

function dist(dir, files) {
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  for (const [name, { body = name, ageDays = 0 }] of Object.entries(files)) {
    const p = path.join(dir, 'assets', name);
    fs.writeFileSync(p, body);
    const t = new Date(Date.now() - ageDays * 86400000);
    fs.utimesSync(p, t, t);
  }
}

test('earlier files are carried forward, the new build wins, old ones expire', async () => {
  const { carryAssets } = await load();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carry-'));
  const oldDist = path.join(tmp, 'old'), newDist = path.join(tmp, 'new');
  dist(oldDist, {
    'LoginScreen-OLD.js': { ageDays: 3 },
    'LoginScreen-OLD.js.br': { ageDays: 3 },
    'shared-SAME.js': { body: 'old copy', ageDays: 3 },
    'ancient-X.js': { ageDays: 45 },
  });
  dist(newDist, { 'LoginScreen-NEW.js': {}, 'shared-SAME.js': { body: 'new copy' } });

  const r = carryAssets(oldDist, newDist);
  const names = fs.readdirSync(path.join(newDist, 'assets')).sort();
  assert.deepEqual(names, ['LoginScreen-NEW.js', 'LoginScreen-OLD.js', 'LoginScreen-OLD.js.br', 'shared-SAME.js']);
  assert.equal(fs.readFileSync(path.join(newDist, 'assets/shared-SAME.js'), 'utf8'), 'new copy', 'never overwrites the new build');
  assert.deepEqual({ carried: r.carried, expired: r.expired }, { carried: 2, expired: 1 });

  // The copy keeps its age, so it expires on schedule after further deploys
  // instead of being renewed by each one.
  const age = Date.now() - fs.statSync(path.join(newDist, 'assets/LoginScreen-OLD.js')).mtimeMs;
  assert.ok(age > 2.9 * 86400000, 'mtime preserved');
  const again = path.join(tmp, 'again');
  dist(again, { 'x.js': {} });
  assert.equal(carryAssets(newDist, again, { now: Date.now() + 28 * 86400000 }).expired, 2, 'expires 30 days after its build');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('a missing old dist is not an error (first install)', async () => {
  const { carryAssets } = await load();
  assert.deepEqual(carryAssets('/nonexistent-a', '/nonexistent-b'), { carried: 0, expired: 0, bytes: 0 });
});

test('the build carries assets after the service worker is stamped, before the swap', () => {
  const b = read('client/scripts/build.mjs');
  const inject = b.indexOf("'scripts/inject-sw-assets.mjs'");
  const carry = b.indexOf('carryAssets(DIST, STAGING)');
  const swap = b.indexOf('renameSync(STAGING, DIST)');
  assert.ok(inject > 0 && inject < carry && carry < swap,
    'inject → carry → swap: carried files must not be precached by the new service worker');
});

test('a chunk that will not load reloads once, then offers RELOAD instead of looping', () => {
  const l = read('client/src/utils/lazyComponent.jsx');
  assert.match(l, /<ChunkBoundary>\s*<React\.Suspense/, 'every lazyComponent has the boundary');
  assert.match(l, /Failed to fetch dynamically imported module/);
  assert.match(l, /RELOAD_WINDOW_MS = 60 \* 1000/);
  assert.match(l, /if \(!isChunkLoadError\(error\)\) throw error;/, 'other errors pass through');
  const app = read('client/CortexApp.jsx');
  assert.match(app, /<ChunkBoundary>\s*<AuthProvider>/, 'raw React.lazy screens are covered at the root');
  assert.match(app, /vite:preloadError/);
  assert.match(app, /unhandledrejection/);
});
