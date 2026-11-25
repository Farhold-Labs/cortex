'use strict';

// Watch parties for Plex (v2.156.0) rebuild the watch_parties table: it named
// a Jellyfin connection (NOT NULL, with a foreign key). An older database's
// parties must come through as Jellyfin parties, and the table must end up
// exactly as a fresh install makes it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = path.resolve(__dirname, '..');
const Database = require(path.join(root, 'server/node_modules/better-sqlite3'));

const OLD_TABLE = `
  CREATE TABLE watch_parties (
    id TEXT PRIMARY KEY,
    wave_id TEXT NOT NULL REFERENCES waves(id) ON DELETE CASCADE,
    host_user_id TEXT NOT NULL REFERENCES users(id),
    jellyfin_connection_id TEXT NOT NULL REFERENCES jellyfin_connections(id),
    jellyfin_item_id TEXT NOT NULL,
    media_title TEXT,
    media_type TEXT,
    status TEXT DEFAULT 'active',
    playback_position INTEGER DEFAULT 0,
    is_playing INTEGER DEFAULT 0,
    last_sync_at TEXT,
    created_at TEXT NOT NULL,
    ended_at TEXT
  );
  CREATE INDEX idx_watch_parties_wave ON watch_parties(wave_id);
  CREATE INDEX idx_watch_parties_status ON watch_parties(status);
  CREATE INDEX idx_watch_parties_host ON watch_parties(host_user_id);
`;

const schemaOf = (file) => {
  const d = new Database(file, { readonly: true });
  try {
    return d.prepare("SELECT type, name, sql FROM sqlite_master WHERE tbl_name = 'watch_parties' ORDER BY type, name").all();
  } finally { d.close(); }
};

test('an older database\'s watch parties come through the rebuild as Jellyfin parties', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-wp-migration-'));
  try {
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const fresh = path.join(temp, 'fresh.db');
    new DatabaseSQLite({ dbPath: fresh }).db.close();

    // An older database: the v2.14.0 table, holding a party.
    const old = path.join(temp, 'old.db');
    const setup = new DatabaseSQLite({ dbPath: old });
    setup.createUser({ id: 'u-host', handle: 'host', email: 'host@example.test', passwordHash: 'x', displayName: 'Host' });
    const wave = setup.createWave({ title: 'Movie night', createdBy: 'u-host' });
    const conn = setup.createJellyfinConnection({ userId: 'u-host', serverUrl: 'http://127.0.0.1:1', accessToken: 'x', jellyfinUserId: 'j', serverName: 'J' });
    setup.db.exec('DROP TABLE watch_parties');
    setup.db.exec(OLD_TABLE);
    setup.db.prepare(`INSERT INTO watch_parties (id, wave_id, host_user_id, jellyfin_connection_id, jellyfin_item_id, media_title, media_type, status, playback_position, is_playing, last_sync_at, created_at)
                      VALUES ('wp-old', ?, 'u-host', ?, 'item1', 'Feature', 'Movie', 'active', 42, 1, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`).run(wave.id, conn.id);
    setup.db.close();

    const migrated = new DatabaseSQLite({ dbPath: old });
    const party = migrated.getWatchParty('wp-old');
    const active = migrated.getActiveWatchPartyForWave(wave.id);
    migrated.db.close();

    assert.equal(party.provider, 'jellyfin');
    assert.equal(party.connectionId, conn.id);
    assert.equal(party.itemId, 'item1');
    assert.equal(party.playbackPosition, 42);
    assert.equal(party.isPlaying, true);
    assert.equal(party.mediaTitle, 'Feature');
    assert.equal(active?.id, 'wp-old');
    assert.deepEqual(schemaOf(old), schemaOf(fresh));
    assert.ok(!schemaOf(old).some(r => /jellyfin_connection_id/.test(r.sql || '')));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
