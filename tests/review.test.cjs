const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const clientRequire = createRequire(path.join(root, 'client/package.json'));
const serverRequire = createRequire(path.join(root, 'server/package.json'));
const { pathToFileURL } = require('node:url');
const serverSource = fs.readFileSync(path.join(root, 'server/server.js'), 'utf8');

// Load individual production route callbacks without starting background jobs,
// touching the real database, or sending email/federation requests.
function route(method, url, globals = {}) {
  const start = serverSource.indexOf(`app.${method}('${url}',`);
  assert.notEqual(start, -1);
  const callback = serverSource.indexOf('(req, res) => {', start);
  const end = serverSource.indexOf('\n});', callback);
  return vm.runInNewContext(`(${serverSource.slice(callback, end + 2)})`, {
    console: { log() {}, error() {}, warn() {} },
    sanitizeInput: x => x,
    ...globals,
  });
}
function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
function request(body = {}) { return { body, params: { id: 'ping', waveId: 'wave' }, user: { userId: 'reader' } }; }

for (const [body, postAllowed, repliesAllowed, code] of [
  [{ wave_id: 'wave', content: 'hello' }, false, true, 'POSTING_RESTRICTED'],
  [{ wave_id: 'wave', content: 'hello', parent_id: 'parent' }, true, false, 'REPLIES_DISABLED'],
]) {
  test(`legacy message creation enforces ${code}`, () => {
    const handler = route('post', '/api/messages', {
      db: { getWave: () => ({ id: 'wave' }) },
      canAccessWaveFromCache: () => true,
      canPostToWave: () => postAllowed,
      waveAllowsReplies: () => repliesAllowed,
    });
    const res = response(); handler(request(body), res);
    assert.equal(res.statusCode, 403); assert.equal(res.body.code, code);
  });
}
for (const allowed of [false, true]) {
  test(`legacy reactions reject ${allowed ? 'disabled reactions' : 'private wave outsiders'}`, () => {
    const handler = route('post', '/api/messages/:id/react', {
      db: { getMessage: () => ({ waveId: 'private' }), getWave: () => ({}) },
      canAccessWaveFromCache: () => allowed,
      waveAllowsReactions: () => false,
    });
    const res = response(); handler(request({ emoji: '👍' }), res);
    assert.equal(res.statusCode, 403);
  });
}
for (const endpoint of ['/api/pings/:id/read', '/api/messages/:id/read']) {
  test(`${endpoint} rejects unauthorized read receipts before mutation`, () => {
    const handler = route('post', endpoint, {
      db: { getPing: () => ({ waveId: 'private' }) },
      canAccessWaveFromCache: () => false,
    });
    const res = response(); handler(request(), res); assert.equal(res.statusCode, 403);
  });
}
for (const endpoint of ['/api/pings/:id', '/api/messages/:id']) {
  for (const content of [undefined, null, {}, 42]) {
    test(`${endpoint} rejects non-string content ${JSON.stringify(content)}`, () => {
      const handler = route('put', endpoint, { db: { getMessage: () => ({ authorId: 'reader' }) } });
      const res = response(); handler(request({ content }), res); assert.equal(res.statusCode, 400);
    });
  }
}
test('watch party lookup uses the real database API and denies outsiders', () => {
  const handler = route('get', '/api/watch-parties/:waveId', {
    db: { getWave: () => ({ id: 'wave' }) }, canAccessWaveFromCache: () => false,
  });
  const res = response(); handler(request(), res); assert.equal(res.statusCode, 404);
});
test('watch party creation notifies other participants through the multi-session broadcaster', () => {
  const sent = [];
  const handler = route('post', '/api/watch-parties', {
    db: { getWave: () => ({ id: 'wave' }), userOwnsJellyfinConnection: () => true, createWatchParty: () => ({ id: 'party' }) },
    canAccessWaveFromCache: () => true,
    participation: { getWaveParticipants: () => ['reader', 'other'] },
    broadcastToUser: (...args) => sent.push(args),
  });
  const res = response(); handler(request({ waveId: 'wave', connectionId: 'connection', itemId: 'item' }), res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.party.id, 'party');
  assert.equal(sent.length, 1); assert.equal(sent[0][0], 'other'); assert.equal(sent[0][1].type, 'watch_party_started');
});
test('watch party deletion notifies participants after ending the party', () => {
  const sent = [];
  const handler = route('delete', '/api/watch-parties/:id', {
    db: { getWatchParty: () => ({ hostUserId: 'reader', waveId: 'wave' }), endWatchParty: () => true },
    participation: { getWaveParticipants: () => ['reader', 'other'] },
    broadcastToUser: (...args) => sent.push(args),
  });
  const res = response(); handler(request(), res);
  assert.equal(res.body.success, true); assert.equal(sent.length, 2);
});
test('Electron only accepts web server URLs and safe external protocols', async () => {
  const { isServerUrl, isExternalUrl } = await import('../client/electron/url-policy.js');
  for (const url of ['https://example.com', 'http://localhost:3000']) assert.equal(isServerUrl(url), true);
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'https://user:pass@example.com', null, {}]) assert.equal(isServerUrl(url), false);
  for (const url of ['file:///tmp/app.exe', 'smb://host/share', 'javascript:alert(1)', 'ms-settings:foo']) assert.equal(isExternalUrl(url), false);
  assert.equal(isExternalUrl('mailto:user@example.com'), true);
});
test('local storage rejects keys escaping uploads', async () => {
  const { storage } = await import('../server/storage.js');
  storage.uploadsDir = path.join(os.tmpdir(), 'cortex-uploads');
  for (const key of ['../secret', 'media/../../secret', '/etc/passwd', '..\\secret', '']) assert.throws(() => storage.getLocalPath(key));
  assert.equal(storage.getLocalPath('media/video.mp4'), path.join(storage.uploadsDir, 'media/video.mp4'));
});
test('configured encryption fails closed with ordinary SQLite', async () => {
  const { DatabaseSQLite } = await import('../server/database-sqlite.js');
  const old = process.env.DB_ENCRYPTION_KEY;
  process.env.DB_ENCRYPTION_KEY = 'test-key';
  try { assert.throws(() => new DatabaseSQLite({ dbPath: ':memory:' }), /encryption could not be enabled/); }
  finally { if (old === undefined) delete process.env.DB_ENCRYPTION_KEY; else process.env.DB_ENCRYPTION_KEY = old; }
});
test('post-build service worker matches both compressed representations', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-sw-test-'));
  try {
    fs.mkdirSync(path.join(dir, '.vite'));
    fs.writeFileSync(path.join(dir, '.vite/manifest.json'), JSON.stringify({ main: { file: 'assets/main.js', css: ['assets/main.css'] } }));
    fs.copyFileSync(path.join(root, 'client/public/sw.js'), path.join(dir, 'sw.js'));
    execFileSync(process.execPath, [path.join(root, 'client/scripts/inject-sw-assets.mjs')], { env: { ...process.env, CORTEX_OUT_DIR: dir } });
    const sw = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8');
    const zlib = require('node:zlib');
    assert.equal(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'sw.js.gz'))).toString(), sw);
    assert.equal(zlib.brotliDecompressSync(fs.readFileSync(path.join(dir, 'sw.js.br'))).toString(), sw);
    assert.ok(sw.includes('/assets/main.js'));
    new vm.Script(sw);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('message and preview HTML strip executable markup while preserving rich content', async () => {
  const { JSDOM } = clientRequire('jsdom');
  const dom = new JSDOM(''); global.window = dom.window;
  try {
    const { sanitizeMessageHtml } = await import('../client/src/utils/html.js');
    const dirty = '<img src="x" onerror="alert(1)"><a href="javascript:alert(1)">bad</a><svg onload="alert(1)"></svg><script>alert(1)</script>';
    const clean = sanitizeMessageHtml(dirty);
    assert.doesNotMatch(clean, /onerror|onload|javascript:|<script|<svg/);
    const rich = sanitizeMessageHtml('<strong>hello</strong><span data-user-id="user">@name</span><video controls src="/api/media/test.mp4"></video><a href="/uploads/file.pdf" download="file.pdf">file</a>');
    for (const fragment of ['<strong>', 'data-user-id="user"', '<video', 'download="file.pdf"']) assert.ok(rich.includes(fragment));
  } finally { delete global.window; dom.window.close(); }
});
test('fresh SQLite schema supports user, wave, ping and reaction lifecycle', async () => {
  const { DatabaseSQLite } = await import('../server/database-sqlite.js');
  const db = new DatabaseSQLite({ dbPath: ':memory:' });
  try {
    db.createUser({ id: 'review-user', handle: 'review', email: 'review@example.test', passwordHash: 'test-only', displayName: 'Review' });
    const wave = db.createWave({ title: 'Review wave', createdBy: 'review-user' });
    const ping = db.createMessage({ waveId: wave.id, authorId: 'review-user', content: 'hello <script>alert(1)</script>' });
    assert.doesNotMatch(db.getMessage(ping.id).content, /<script/);
    assert.equal(db.toggleMessageReaction(ping.id, 'review-user', '👍').success, true);
    assert.equal(db.updateMessage(ping.id, 'edited').content, 'edited');
    assert.equal(db.deleteMessage(ping.id, 'review-user').success, true);
    assert.equal(db.getMessage(ping.id).deleted, true);
  } finally { db.db.close(); }
});
test('session database failures reject authentication', () => {
  const start = serverSource.indexOf('function validateSession(token) {');
  const end = serverSource.indexOf('\n}\n', start) + 2;
  const validate = vm.runInNewContext(`(${serverSource.slice(start, end)})`, {
    SESSION_TRACKING_ENABLED: true,
    db: { hasSessionTable: () => true, getSessionByTokenHash() { throw new Error('database unavailable'); } },
    hashToken: x => x, console: { error() {} },
  });
  assert.equal(validate('token').valid, false);
});
test('media routes use session-aware authentication', () => {
  for (const endpoint of ['/api/media/:filename', '/api/jellyfin/stream/:connectionId/:itemId', '/api/jellyfin/thumbnail/:connectionId/:itemId', '/api/plex/video/:connectionId/:ratingKey', '/api/plex/thumbnail/:connectionId/:ratingKey']) {
    assert.ok(serverSource.includes(`app.get('${endpoint}', authenticateToken,`), endpoint);
  }
});
test('authentication middleware rejects revoked sessions before handlers run', () => {
  const start = serverSource.indexOf('function authenticateToken(req, res, next) {');
  const end = serverSource.indexOf('\n}\n', start) + 2;
  const authenticate = vm.runInNewContext(`(${serverSource.slice(start, end)})`, {
    JWT_SECRET: 'test', jwt: { verify(token, secret, callback) { callback(null, { userId: 'reader' }); } },
    validateSession: () => ({ valid: false, reason: 'Session revoked' }),
  });
  const res = response();
  authenticate({ headers: {}, query: { token: 'revoked' } }, res, () => assert.fail('must not reach handler'));
  assert.equal(res.statusCode, 401);
});
test('patched Sharp still processes uploaded images', async () => {
  const { default: sharp } = await import(pathToFileURL(serverRequire.resolve('sharp')).href);
  const output = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#336699' } }).resize(2, 2).webp().toBuffer();
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, 'webp'); assert.equal(metadata.width, 2);
});
test('patched Nodemailer still composes messages without network access', async () => {
  const { default: nodemailer } = await import(pathToFileURL(serverRequire.resolve('nodemailer')).href);
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const result = await transport.sendMail({ from: 'server@example.test', to: 'user@example.test', subject: 'Review', text: 'Test message' });
  const message = JSON.parse(result.message); assert.equal(message.subject, 'Review'); assert.equal(message.text, 'Test message');
});
