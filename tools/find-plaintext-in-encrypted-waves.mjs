#!/usr/bin/env node
/**
 * Find plain text stored inside end-to-end encrypted waves (v2.143.0).
 *
 * WHY THIS EXISTS
 * ---------------
 * Replies and edits made from the focus view and the thread panel were sent
 * without encryption, in every wave, since those views were written (v2.6.0,
 * v2.38.0). In an encrypted wave they were stored as text the server can read.
 * The main wave view encrypted correctly. v2.143.0 encrypts in every view and
 * the server refuses plain text in an encrypted wave; this lists what was
 * stored before that.
 *
 * WHAT IT FINDS
 * -------------
 * For each wave with encryption on (waves.encrypted 1, or 2 = partly
 * migrated), written by people (not bots, not deleted, not empty):
 * - pings stored with encrypted = 0;
 * - earlier versions in ping_history that are not ciphertext (an edit keeps
 *   the text it replaced, so a plain reply that was later edited, or a plain
 *   edit of an encrypted ping, leaves plain text there).
 * A wave with encrypted = 2 is one whose creator started encrypting older
 * messages and did not finish; its plain pings may be those, not leaks.
 *
 * Read-only. Prints counts and wave ids, never content.
 *
 * Usage (from the repo root on the node):
 *   node tools/find-plaintext-in-encrypted-waves.mjs
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

// Ciphertext as the client stores it: base64 of at least a GCM tag.
const looksEncrypted = (s) => typeof s === 'string' && s.length >= 24 && /^[A-Za-z0-9+/]+={0,2}$/.test(s);

const waves = db.prepare(`SELECT id, encrypted, created_at FROM waves WHERE encrypted IN (1, 2) ORDER BY created_at`).all();
const plainPings = db.prepare(`
  SELECT id, created_at FROM pings
  WHERE wave_id = ? AND COALESCE(encrypted, 0) = 0 AND COALESCE(deleted, 0) = 0
    AND bot_id IS NULL AND content != ''
`);
const history = db.prepare(`
  SELECT h.content FROM ping_history h JOIN pings p ON p.id = h.ping_id
  WHERE p.wave_id = ? AND COALESCE(p.deleted, 0) = 0 AND p.bot_id IS NULL
`);

let totalPings = 0;
let totalHistory = 0;
const rows = [];
for (const w of waves) {
  const pings = plainPings.all(w.id);
  const plainHistory = history.all(w.id).filter(h => h.content && !looksEncrypted(h.content)).length;
  if (!pings.length && !plainHistory) continue;
  totalPings += pings.length;
  totalHistory += plainHistory;
  const dates = pings.map(p => p.created_at).sort();
  rows.push(`  ${w.id}  ${w.encrypted === 2 ? 'partly migrated' : 'encrypted'}  plain pings: ${pings.length}  plain earlier versions: ${plainHistory}${dates.length ? `  ${dates[0].slice(0, 10)} to ${dates.at(-1).slice(0, 10)}` : ''}`);
}

console.log(`Database: ${dbFile}`);
console.log(`Encrypted waves: ${waves.length}`);
console.log(`Waves holding plain text: ${rows.length}  (plain pings: ${totalPings}, plain earlier versions: ${totalHistory})`);
for (const r of rows) console.log(r);
if (rows.length) console.log('\nNothing was changed.');
