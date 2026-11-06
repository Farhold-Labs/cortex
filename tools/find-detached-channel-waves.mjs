#!/usr/bin/env node
/**
 * Find waves that a deleted channel or a closed Community left behind (v2.140.0).
 *
 * WHY THIS EXISTS
 * ---------------
 * Before v2.140.0, deleting a channel or closing a Community cleared each
 * wave's channel_id and community_id and nothing else:
 *
 * - a PUBLIC wave in a channel (public to the channel's members) became public
 *   to everyone on the server;
 * - a NARROWED wave went back to its participant rows: the people it was
 *   narrowed to lost it unless they had a row, and anyone with an old row kept
 *   it. Its wave_audience rows were left behind, which is how it is found here.
 *
 * v2.140.0 takes every wave out through unfileWave() first. This finds the
 * ones that left before that.
 *
 * WHAT IT FINDS
 * -------------
 * - public waves outside any channel whose last Community audit entry put
 *   them in a channel (wave.create_in_channel or wave.file) and never took
 *   them out (wave.unfile, wave.review_move_out). Taken out by hand, a wave
 *   was the owner's choice; left by a deleted container, it was nobody's.
 * - waves outside any channel that still have wave_audience rows.
 *
 * Read-only. It changes nothing: participation may be encrypted
 * (WAVE_PARTICIPATION_KEY), so any repair belongs in the server, and who
 * should keep a wave is for a person to decide.
 *
 * Usage (from the repo root on the node):
 *   node tools/find-detached-channel-waves.mjs
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

const IN = ['wave.create_in_channel', 'wave.file'];
const OUT = ['wave.unfile', 'wave.review_move_out'];

const publicLeft = db.prepare(`
  SELECT w.id, w.title, w.created_at, c.name AS community, c.status AS community_status
  FROM waves w
  JOIN community_audit_log a ON a.target_type = 'wave' AND a.target_id = w.id
  LEFT JOIN communities c ON c.id = a.community_id
  WHERE w.privacy = 'public' AND w.channel_id IS NULL
    AND a.created_at = (SELECT MAX(a2.created_at) FROM community_audit_log a2
                        WHERE a2.target_type = 'wave' AND a2.target_id = w.id
                          AND a2.action IN (${[...IN, ...OUT].map(() => '?').join(', ')}))
    AND a.action IN (${IN.map(() => '?').join(', ')})
  GROUP BY w.id
  ORDER BY w.created_at
`).all(...IN, ...OUT, ...IN);

const narrowedLeft = db.prepare(`
  SELECT w.id, w.title, w.privacy, w.created_at,
         (SELECT COUNT(*) FROM wave_audience x WHERE x.wave_id = w.id) AS named
  FROM waves w
  WHERE w.channel_id IS NULL AND EXISTS (SELECT 1 FROM wave_audience x WHERE x.wave_id = w.id)
  ORDER BY w.created_at
`).all();

// Titles are entity-encoded in the database; ids are enough to act on.
console.log(`Database: ${dbFile}`);
console.log(`\nPublic waves left by a deleted channel or closed Community: ${publicLeft.length}`);
for (const w of publicLeft) {
  console.log(`  ${w.id}  "${w.title}"  community: ${w.community ?? '?'} (${w.community_status ?? '?'})  created ${w.created_at}`);
}
console.log(`\nNarrowed waves outside any channel (audience rows left behind): ${narrowedLeft.length}`);
for (const w of narrowedLeft) {
  console.log(`  ${w.id}  "${w.title}"  privacy: ${w.privacy}  named: ${w.named}  created ${w.created_at}`);
}

if (publicLeft.length || narrowedLeft.length) {
  console.log('\nNothing was changed. Decide each with its owner, or make a public one private from its wave settings.');
}
