// Atomic client build.
//
// `vite build` empties its output directory before writing the new one. The dev
// box serves client/dist straight out of this working copy, so an in-place
// build makes the live site 404 for the length of the build — a hard refresh
// during that window gets "Not found", and the service worker then falls back
// to its cached shell, which can be several versions old.
//
// So: build into a staging directory, patch the service worker there, and only
// then swap it into place. Two renames, microseconds, and a failed build leaves
// the previous dist untouched rather than deleted.
import { spawnSync } from 'child_process';
import { rmSync, existsSync, renameSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');
const STAGING = join(ROOT, 'dist.staging');
const PREVIOUS = join(ROOT, 'dist.previous');

const run = (cmd, args, env = {}) => {
  const res = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
  if (res.status !== 0) {
    // Leave dist alone — the site keeps serving the last good build.
    rmSync(STAGING, { recursive: true, force: true });
    console.error(`\n[build] failed: ${cmd} ${args.join(' ')} (exit ${res.status}) — dist left untouched`);
    process.exit(res.status || 1);
  }
};

rmSync(STAGING, { recursive: true, force: true });

// Heap cap matters: the smaller VPS OOMs on an unbounded build.
run('node', [
  '--max-old-space-size=768',
  './node_modules/vite/bin/vite.js', 'build',
  '--outDir', 'dist.staging',
  '--emptyOutDir',
]);

run('node', ['scripts/inject-sw-assets.mjs'], { CORTEX_OUT_DIR: 'dist.staging' });

// Swap. The only window where dist is absent is between these two renames.
rmSync(PREVIOUS, { recursive: true, force: true });
if (existsSync(DIST)) renameSync(DIST, PREVIOUS);
renameSync(STAGING, DIST);
rmSync(PREVIOUS, { recursive: true, force: true });

console.log('[build] swapped dist into place atomically');
