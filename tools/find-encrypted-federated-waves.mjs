#!/usr/bin/env node
/**
 * Find end-to-end encrypted waves that people on other servers are in (v2.142.0).
 *
 * WHY THIS EXISTS
 * ---------------
 * Federation carries no wave key, nonce or key version, so people on other
 * servers cannot read an encrypted wave: they see ciphertext. Their own pings
 * arrive in plain text, and are stored that way inside the "encrypted" wave.
 * v2.142.0 refuses to put the two together. This lists the waves that were
 * put together before that.
 *
 * WHAT IT FINDS
 * -------------
 * Encrypted waves (waves.encrypted = 1) that are Verse-Wide, an origin with
 * other servers, or this server's copy of a wave elsewhere, with:
 * - the servers it is shared with (wave_federation), people elsewhere listed
 *   on it (wave_remote_members) and invitations still open;
 * - how many pings from other servers are cached in it (remote_pings), which
 *   are the ones stored in plain text.
 *
 * Read-only. Titles may be encrypted or entity-encoded; ids are enough to act on.
 *
 * Usage (from the repo root on the node):
 *   node tools/find-encrypted-federated-waves.mjs
 *
 *   SERVER_DIR  the server directory (default: ../server relative to this file)
 *   DB_FILE     the database (default: <SERVER_DIR>/data/farhold.db)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(process.env.SERVER_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '../server'));
const serverRequire = createRequire(path.join(serverDir, 'package.json'));
serverRequire('dotenv').config({ path: path.join(serverDir, '.env'), quiet: true });
const Database = serverRequire('better-sqlite3');

const dbFile = process.env.DB_FILE || path.join(serverDir, 'data/farhold.db');
if (!fs.existsSync(dbFile)) { console.error(`No database at ${dbFile}`); process.exit(1); }

const db = new Database(dbFile, { readonly: true });
if (process.env.DB_ENCRYPTION_KEY) db.pragma(`key = '${process.env.DB_ENCRYPTION_KEY.replace(/'/g, "''")}'`);

const has = (table) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(table);
const count = (table, where, id) => (has(table) ? db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`).get(id).c : 0);

const waves = db.prepare(`
  SELECT id, federation_state, privacy, origin_node, created_at
  FROM waves
  WHERE encrypted = 1
    AND (federation_state IN ('origin', 'participant') OR privacy IN ('crossServer', 'cross-server'))
  ORDER BY created_at
`).all();

console.log(`Database: ${dbFile}`);
console.log(`\nEncrypted waves with people on other servers: ${waves.length}`);
for (const w of waves) {
  const servers = count('wave_federation', 'wave_id = ?', w.id);
  const people = count('wave_remote_members', 'wave_id = ?', w.id);
  const asked = count('remote_wave_invitations', 'wave_id = ?', w.id);
  const plain = count('remote_pings', 'wave_id = ? AND deleted = 0', w.id);
  const kind = w.federation_state === 'participant' ? `copy of a wave on ${w.origin_node || '?'}` : 'started here';
  console.log(`  ${w.id}  ${kind}  servers: ${servers}  people elsewhere: ${people}  open invitations: ${asked}  pings from elsewhere (plain text): ${plain}  created ${w.created_at}`);
}
if (waves.length) console.log('\nNothing was changed.');
