const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(root, 'server/package.json'));

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

test('media grants are bound to provider, owner, connection, item and current wave membership', async () => {
  const { canAccessMedia } = await import('../server/lib/media-access.js');
  let share = { provider: 'plex', connectionId: 'plex-1', itemId: '111', waveId: 'wave', ownerId: 'owner' };
  const members = new Set(['owner', 'member']);
  const scope = { db: { getMediaShare: () => share }, canAccessWave: (wave, user) => wave === 'wave' && members.has(user),
    userId: 'member', provider: 'plex', connection: { id: 'plex-1', userId: 'owner' }, itemId: '111', shareId: 'share' };
  assert.equal(canAccessMedia(scope), true);
  for (const changed of [{ userId: 'outsider' }, { itemId: '112' }, { provider: 'jellyfin' }, { shareId: null }, { itemId: '../111' }, { connection: { id: 'plex-2', userId: 'owner' } }, { connection: { id: 'plex-1', userId: 'other-owner' } }]) {
    assert.equal(canAccessMedia({ ...scope, ...changed }), false);
  }
  members.delete('member'); assert.equal(canAccessMedia(scope), false);
  members.add('member'); members.delete('owner'); assert.equal(canAccessMedia(scope), false);
  members.add('owner'); share = null; assert.equal(canAccessMedia(scope), false);
});

test('HLS resource references cannot escape their server or be forged across viewers', async () => {
  const { HlsSessions } = await import('../server/lib/media-proxy.js');
  let now = 0;
  const registry = new HlsSessions({ now: () => now, ttl: 100 });
  const base = 'https://media.example/video/:/transcode/universal/start.m3u8';
  const session = registry.create({ serverUrl: 'https://media.example', userId: 'member' }, base);
  const playlist = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin?X-Plex-Token=secret"\n#EXT-X-MAP:URI="init.mp4"\nvariant.m3u8\nsegment.ts\n';
  const result = registry.rewrite(session, playlist, base, 'app-token');
  assert.doesNotMatch(result, /media\.example|X-Plex-Token|secret/);
  assert.equal((result.match(/\/api\/plex\/hls\//g) || []).length, 4);
  assert.equal(registry.get(session.id, 'outsider'), null);
  assert.equal(session.resources.get('forged'), undefined);
  for (const value of ['https://evil.example/segment.ts', '//evil.example/segment.ts', '/library/metadata/999', 'file:///tmp/key', '../outside.ts']) {
    assert.throws(() => registry.rewrite(session, `#EXTM3U\n${value}`, base, 'app-token'));
  }
  now = 101; assert.equal(registry.get(session.id, 'member'), null);
});

test('client playback URL resolution never attaches app credentials to an upstream origin', async () => {
  const { mediaPlaybackUrl } = await import('../client/src/utils/media.js');
  const resolved = new URL(mediaPlaybackUrl('/api/plex/video/plex-1/111?share=grant', 'https://cortex.example/api', 'app-token'));
  assert.equal(resolved.searchParams.get('share'), 'grant');
  assert.equal(resolved.searchParams.get('token'), 'app-token');
  assert.throws(() => mediaPlaybackUrl('https://upstream.example/video', 'https://cortex.example/api', 'app-token'));
  assert.throws(() => mediaPlaybackUrl('/api/auth/me', 'https://cortex.example/api', 'app-token'));
});

test('embed detection retains grants through plaintext HTML escaping and encrypted plaintext', async () => {
  const { detectEmbedUrls } = await import('../client/src/utils/embed.js');
  const sanitize = serverRequire('sanitize-html');
  for (const provider of ['jellyfin', 'plex']) {
    const content = `cortex://${provider}/connection-1/111?name=Test&type=movie&share=share-123`;
    for (const value of [content, sanitize(content)]) {
      const embed = detectEmbedUrls(value).find(e => e.platform === provider);
      assert.equal(embed.shareId, 'share-123');
    }
  }
});

test('HTTP media authorization and proxies against disposable Cortex and upstream servers', { timeout: 60000 }, async t => {
  const secret = 'UPSTREAM-CREDENTIAL-DO-NOT-EXPOSE';
  const jwtSecret = 'isolated-media-test-signing-key';
  const password = 'Review123!';
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-media-test-'));
  let upstreamBase, redirectHits = 0, redirectVideo = false, hostilePlaylist = false, invalidContent = false;
  const upstreamRequests = [];
  const upstream = http.createServer((req, res) => {
    upstreamRequests.push({ url: req.url, headers: req.headers });
    const url = new URL(req.url, upstreamBase);
    if (url.pathname === '/redirect-target') { redirectHits++; res.end('redirected'); return; }
    if (req.headers['x-plex-token'] !== secret && req.headers['x-emby-token'] !== secret) { res.writeHead(401); res.end(); return; }
    if (url.pathname.startsWith('/library/metadata/')) {
      const id = url.pathname.split('/')[3];
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ MediaContainer: { Metadata: [{ ratingKey: id, title: 'Test video', duration: 1000, Media: [{ container: id === '222' ? 'mkv' : 'mp4', videoCodec: 'h264', Part: [{ key: `/library/parts/${id}/file.mp4` }] }] }] } }));
    } else if (url.pathname.endsWith('/decision')) {
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ MediaContainer: { generalDecisionCode: 1000 } }));
    } else if (url.pathname.endsWith('/start.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.end(hostilePlaylist ? '#EXTM3U\nhttps://evil.example/steal.ts\n' : `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvariant.m3u8?X-Plex-Token=${secret}\n`);
    } else if (url.pathname.endsWith('/variant.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.end(`#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin?X-Plex-Token=${secret}"\n#EXTINF:1,\nsegment.ts\n#EXT-X-ENDLIST\n`);
    } else if (url.pathname.endsWith('key.bin')) {
      res.setHeader('Content-Type', 'application/octet-stream'); res.end('0123456789abcdef');
    } else if (url.pathname.includes('/Images/') || url.pathname === '/photo/:/transcode') {
      res.setHeader('Content-Type', 'image/png'); res.end(Buffer.from([137, 80, 78, 71]));
    } else if (url.pathname.includes('/library/parts/') || url.pathname.includes('/Videos/') || url.pathname.endsWith('.ts')) {
      if (redirectVideo) { res.writeHead(302, { Location: `${upstreamBase}/redirect-target` }); res.end(); return; }
      res.setHeader('Content-Type', invalidContent ? 'text/html' : 'video/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
      if (req.headers.range) { res.statusCode = 206; res.setHeader('Content-Range', 'bytes 0-3/8'); res.end('vide'); }
      else res.end('videotest');
    } else { res.writeHead(404); res.end(); }
  });
  let child, output = '';
  try {
    upstreamBase = await listen(upstream);
    const serverDir = path.join(temp, 'server'); fs.mkdirSync(serverDir);
    for (const name of fs.readdirSync(path.join(root, 'server'))) {
      if (/\.(js|sql)$/.test(name) || name === 'package.json') fs.copyFileSync(path.join(root, 'server', name), path.join(serverDir, name));
    }
    fs.cpSync(path.join(root, 'server/lib'), path.join(serverDir, 'lib'), { recursive: true });
    fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(serverDir, 'node_modules'), 'dir');
    fs.mkdirSync(path.join(serverDir, 'data'));
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const db = new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
    const hash = serverRequire('bcryptjs').hashSync(password, 4);
    for (const id of ['owner', 'member', 'outsider']) db.createUser({ id, handle: id, email: `${id}@example.test`, passwordHash: hash, displayName: id });
    const wave = db.createWave({ title: 'Private media', createdBy: 'owner', participants: ['member'] });
    const otherWave = db.createWave({ title: 'Other wave', createdBy: 'outsider' });
    // Match existing at-rest token format; this fixture never uses real credentials.
    const key = jwtSecret.slice(0, 32).padEnd(32, '0');
    const encrypted = Buffer.from([...secret].map((c, i) => c.charCodeAt(0) ^ key.charCodeAt(i % key.length))).toString('base64');
    const plex = db.createPlexConnection({ userId: 'owner', serverUrl: upstreamBase, accessToken: encrypted, plexUserId: 'upstream-user', serverName: 'Fixture', machineIdentifier: 'fixture' });
    const jellyfin = db.createJellyfinConnection({ userId: 'owner', serverUrl: upstreamBase, accessToken: encrypted, jellyfinUserId: 'upstream-user', serverName: 'Fixture' });
    db.db.close();
    fs.appendFileSync(path.join(serverDir, 'server.js'), "\nserver.on('listening', () => console.log('MEDIA_TEST_PORT=' + server.address().port));\n");
    child = spawn(process.execPath, ['server.js'], { cwd: serverDir,
      env: { PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0', USE_SQLITE: 'true', JWT_SECRET: jwtSecret,
        FEDERATION_ENABLED: 'false', SEED_DEMO_DATA: 'false', RATE_LIMIT_API_MAX: '10000', RATE_LIMIT_LOGIN_MAX: '100' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
    const deadline = Date.now() + 20000;
    while (!/MEDIA_TEST_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('Cortex startup failed: ' + output.slice(-5000));
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const base = `http://127.0.0.1:${output.match(/MEDIA_TEST_PORT=(\d+)/)[1]}`;
    const tokens = {};
    const request = (url, user = 'member', options = {}) => fetch(base + url, { ...options,
      headers: { ...(tokens[user] ? { Authorization: `Bearer ${tokens[user]}` } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
      body: options.body ? JSON.stringify(options.body) : undefined });
    for (const user of ['owner', 'member', 'outsider']) {
      const res = await request('/api/auth/login', null, { method: 'POST', body: { handle: user, password } });
      const data = await res.json(); assert.equal(res.status, 200, JSON.stringify(data)); assert.ok(data.token); tokens[user] = data.token;
    }
    const createShare = async (provider, connectionId, itemId = '111') => {
      const res = await request('/api/media/shares', 'owner', { method: 'POST', body: { provider, connectionId, itemId, waveId: wave.id } });
      const body = await res.json(); assert.equal(res.status, 201, JSON.stringify(body)); return body.share.id;
    };
    let plexShare, jellyShare, hlsRoot, hlsGrant;
    await t.test('only owners can mint grants, and only in waves they can post to', async () => {
      const body = { provider: 'plex', connectionId: plex.id, itemId: '111', waveId: wave.id };
      assert.equal((await request('/api/media/shares', 'member', { method: 'POST', body })).status, 403);
      assert.equal((await request('/api/media/shares', 'owner', { method: 'POST', body: { ...body, waveId: otherWave.id } })).status, 403);
      plexShare = await createShare('plex', plex.id); jellyShare = await createShare('jellyfin', jellyfin.id);
    });
    await t.test('outsiders, ungranted legacy links and substituted items fail before contacting upstream', async () => {
      const count = upstreamRequests.length;
      for (const [provider, connectionId, grant] of [['plex', plex.id, plexShare], ['jellyfin', jellyfin.id, jellyShare]]) {
        for (const operation of ['stream', 'video', 'thumbnail', 'item']) {
          assert.equal((await request(`/api/${provider}/${operation}/${connectionId}/111?share=${grant}`, 'outsider')).status, 403);
          assert.equal((await request(`/api/${provider}/${operation}/${connectionId}/112?share=${grant}`)).status, 403);
          assert.equal((await request(`/api/${provider}/${operation}/${connectionId}/111`)).status, 403);
          assert.equal((await request(`/api/${provider}/${operation}/${connectionId}/111?share=${grant}`, null)).status, 401);
        }
      }
      assert.equal(upstreamRequests.length, count);
    });
    await t.test('authorized direct media and thumbnails proxy bytes/ranges without upstream credentials', async () => {
      for (const [provider, connectionId, grant] of [['plex', plex.id, plexShare], ['jellyfin', jellyfin.id, jellyShare]]) {
        const res = await request(`/api/${provider}/stream/${connectionId}/111?share=${grant}`);
        const body = await res.json(); assert.equal(res.status, 200, JSON.stringify(body));
        assert.ok(body.streamUrl.startsWith(`/api/${provider}/video/`)); assert.ok(!JSON.stringify(body).includes(secret));
        const video = await request(body.streamUrl, 'member', { headers: { Range: 'bytes=0-3' } });
        assert.equal(video.status, 206); assert.equal(video.headers.get('content-range'), 'bytes 0-3/8');
        assert.equal(await video.text(), 'vide'); assert.equal(video.headers.get('cache-control'), 'private, no-store');
        const thumbnail = await request(`/api/${provider}/thumbnail/${connectionId}/111?share=${grant}`);
        assert.equal(thumbnail.status, 200); assert.equal(thumbnail.headers.get('cache-control'), 'private, no-store'); await thumbnail.arrayBuffer();
      }
      assert.ok(upstreamRequests.every(r => !r.url.includes(secret)));
    });
    await t.test('HLS master, variant, key and segment URLs stay on Cortex and remain user-scoped', async () => {
      const grant = await createShare('plex', plex.id, '222');
      hlsGrant = grant;
      const res = await request(`/api/plex/stream/${plex.id}/222?share=${grant}`);
      const info = await res.json(); assert.equal(res.status, 200, JSON.stringify(info));
      hlsRoot = info.streamUrl; assert.ok(hlsRoot.startsWith('/api/plex/hls/')); assert.ok(!JSON.stringify(info).includes(secret));
      const masterResponse = await request(hlsRoot); const master = await masterResponse.text(); assert.equal(masterResponse.status, 200, master);
      assert.ok(!master.includes(secret)); assert.ok(!master.includes(upstreamBase));
      const variantUrl = master.split('\n').find(line => line.startsWith('/api/'));
      const variantResponse = await request(variantUrl); const variant = await variantResponse.text(); assert.equal(variantResponse.status, 200, variant);
      assert.ok(!variant.includes(secret));
      const keyUrl = variant.match(/URI="([^"]+)"/)[1];
      const keyResponse = await request(keyUrl); assert.equal(await keyResponse.text(), '0123456789abcdef');
      const segmentUrl = variant.split('\n').find(line => line.startsWith('/api/'));
      const segment = await request(segmentUrl); assert.equal(segment.status, 200); assert.equal(await segment.text(), 'videotest');
      assert.equal((await request(variantUrl, 'outsider')).status, 404);
      hostilePlaylist = true; assert.equal((await request(hlsRoot)).status, 502); hostilePlaylist = false;
    });
    await t.test('malformed ranges and HTML masquerading as media are rejected', async () => {
      const count = upstreamRequests.length;
      const url = `/api/jellyfin/video/${jellyfin.id}/111?share=${jellyShare}`;
      assert.equal((await request(url, 'member', { headers: { Range: 'bytes=-' } })).status, 416);
      assert.equal(upstreamRequests.length, count);
      invalidContent = true; assert.equal((await request(url)).status, 502); invalidContent = false;
    });
    await t.test('feed imports never return stored upstream credentials', async () => {
      const response = await request('/api/jellyfin/feed-import', 'owner', { method: 'POST', body: { connectionId: jellyfin.id, itemId: '111', title: 'Test' } });
      const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body));
      assert.ok(body.import.id); assert.equal(body.import.accessToken, undefined);
      assert.ok(!JSON.stringify(body).includes(encrypted));
    });
    await t.test('upstream redirects are not followed or exposed', async () => {
      redirectVideo = true;
      const response = await request(`/api/plex/video/${plex.id}/111?share=${plexShare}`);
      assert.equal(response.status, 502); assert.equal(response.headers.get('location'), null); assert.equal(redirectHits, 0);
      redirectVideo = false;
    });
    await t.test('watch-party access is restricted to its exact item and current participants', async () => {
      const started = await request('/api/watch-parties', 'owner', { method: 'POST', body: { waveId: wave.id, connectionId: jellyfin.id, itemId: '111' } });
      const data = await started.json(); assert.equal(started.status, 200, JSON.stringify(data));
      const party = data.party.id;
      const WebSocket = serverRequire('ws');
      const joinState = async user => {
        const ws = new WebSocket(base.replace('http:', 'ws:'));
        try {
          await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
          const exchange = (message, predicate) => new Promise((resolve, reject) => {
            const timer = setTimeout(() => { ws.off('message', receive); reject(new Error('WebSocket timeout')); }, 3000);
            const receive = bytes => {
              const value = JSON.parse(bytes);
              if (predicate(value)) { clearTimeout(timer); ws.off('message', receive); resolve(value); }
            };
            ws.on('message', receive); ws.send(JSON.stringify(message));
          });
          await exchange({ type: 'auth', token: tokens[user] }, value => value.type === 'auth_success');
          return await exchange({ type: 'watch_party_join', partyId: party }, value => value.type.startsWith('watch_party_'));
        } finally { ws.terminate(); }
      };
      assert.equal((await joinState('outsider')).type, 'watch_party_not_found');
      assert.equal((await joinState('member')).type, 'watch_party_state');
      const url = `/api/jellyfin/video/${jellyfin.id}/111?party=${party}`;
      const video = await request(url); assert.equal(video.status, 200); await video.arrayBuffer();
      assert.equal((await request(url, 'outsider')).status, 403);
      assert.equal((await request(`/api/jellyfin/video/${jellyfin.id}/112?party=${party}`)).status, 403);
      assert.equal((await request(`/api/watch-parties/${party}`, 'owner', { method: 'DELETE' })).status, 200);
      assert.equal((await request(url)).status, 403);
    });
    await t.test('revoking a share or removing a member denies subsequent requests, including HLS', async () => {
      assert.equal((await request(`/api/media/shares/${plexShare}`, 'outsider', { method: 'DELETE' })).status, 404);
      assert.equal((await request(`/api/media/shares/${plexShare}`, 'owner', { method: 'DELETE' })).status, 200);
      assert.equal((await request(`/api/plex/video/${plex.id}/111?share=${plexShare}`)).status, 403);
      assert.equal((await request(`/api/media/shares/${hlsGrant}`, 'owner', { method: 'DELETE' })).status, 200);
      assert.equal((await request(hlsRoot)).status, 403);
      const newGrant = await createShare('plex', plex.id, '222');
      const newInfo = await (await request(`/api/plex/stream/${plex.id}/222?share=${newGrant}`)).json();
      hlsRoot = newInfo.streamUrl;
      assert.equal((await request(`/api/waves/${wave.id}/participants/member`, 'owner', { method: 'DELETE' })).status, 200);
      assert.equal((await request(`/api/jellyfin/video/${jellyfin.id}/111?share=${jellyShare}`)).status, 403);
      assert.equal((await request(hlsRoot)).status, 403);
    });
    await t.test('logged-out sessions cannot use even the owner playback path', async () => {
      assert.equal((await request('/api/auth/logout', 'owner', { method: 'POST' })).status, 200);
      assert.equal((await request(`/api/plex/video/${plex.id}/111`, 'owner')).status, 401);
    });
    assert.ok(!output.includes(secret), 'upstream credential appeared in application logs');
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve));
    }
    if (upstream.listening) await close(upstream);
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('HLS session/resource limits do not evict another viewer when one viewer restarts playback', async () => {
  const { HlsSessions } = await import('../server/lib/media-proxy.js');
  const registry = new HlsSessions({ maxPerUser: 1, maxSessions: 3, maxResources: 2 });
  const url = 'https://media.example/video/:/transcode/universal/start.m3u8';
  const scope = { serverUrl: 'https://media.example', userId: 'member' };
  const first = registry.create(scope, url);
  const other = registry.create({ ...scope, userId: 'other' }, url);
  const next = registry.create(scope, url);
  assert.equal(registry.get(first.id, 'member'), null);
  assert.equal(registry.get(other.id, 'other'), other);
  registry.register(next, 'https://media.example/video/:/transcode/universal/segment.ts');
  assert.throws(() => registry.register(next, 'https://media.example/video/:/transcode/universal/overflow.ts'));
});
