// Keep the previous builds' hashed assets for a while (v2.127.0).
//
// A deploy used to replace client/dist outright, deleting every file of the
// build before it. A page still running that build — an Android app resumed
// from the background, a tab left open for days — then asked for one of its
// lazily loaded screens, got a 404, and went blank. The login screen is one of
// them, so the moment such a page signed out, or its session expired, nobody
// could sign in again without clearing the app's cache.
//
// Hashed files never change meaning: a name is one exact file. So the files an
// older build needs are copied forward into the new one, and dropped once they
// are older than MAX_AGE_DAYS. A file's age is its modification time, which is
// when the build that made it ran, and the copy keeps it.
//
// Used by scripts/build.mjs, and by the production deploy, which unpacks a
// prebuilt dist:   node client/scripts/carry-assets.mjs <old dist> <new dist>
import { existsSync, readdirSync, statSync, copyFileSync, utimesSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

export const MAX_AGE_DAYS = 30;

export function carryAssets(fromDist, toDist, { now = Date.now(), maxAgeDays = MAX_AGE_DAYS } = {}) {
  const from = join(fromDist, 'assets');
  const to = join(toDist, 'assets');
  const result = { carried: 0, expired: 0, bytes: 0 };
  if (!existsSync(from) || !existsSync(to)) return result;
  const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    const dest = join(to, name);
    const st = statSync(src);
    if (!st.isFile() || existsSync(dest)) continue;
    if (st.mtimeMs < cutoff) { result.expired++; continue; }
    copyFileSync(src, dest);
    utimesSync(dest, st.atime, st.mtime);
    result.carried++;
    result.bytes += st.size;
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [fromDist, toDist] = process.argv.slice(2);
  if (!fromDist || !toDist) {
    console.error('usage: node carry-assets.mjs <old dist> <new dist>');
    process.exit(2);
  }
  const r = carryAssets(fromDist, toDist);
  console.log(`[carry-assets] kept ${r.carried} earlier file(s) (${(r.bytes / 1024).toFixed(0)} KB), dropped ${r.expired} older than ${MAX_AGE_DAYS} days`);
}
