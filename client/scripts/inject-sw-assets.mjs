// Post-build: reads the Vite manifest and injects hashed asset URLs
// into dist/sw.js so the service worker can pre-cache them at install time.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
// The build stages into a temporary directory and swaps it into place (see
// scripts/build.mjs), so the directory to patch is not always literally "dist".
const OUT_DIR = process.env.CORTEX_OUT_DIR || 'dist';
const manifestPath = join(ROOT, OUT_DIR, '.vite', 'manifest.json');
const swPath = join(ROOT, OUT_DIR, 'sw.js');

if (!existsSync(manifestPath)) {
  console.warn('[inject-sw-assets] Vite manifest not found — skipping SW injection.');
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

// Collect every JS and CSS file produced by the build
const assets = Object.values(manifest)
  .flatMap(entry => [entry.file, ...(entry.css ?? [])])
  .filter(Boolean)
  .map(f => `/${f}`)
  .sort();

const injection = `const PRECACHE_ASSETS = ${JSON.stringify(assets, null, 2)};`;

let sw = readFileSync(swPath, 'utf8');

// Replace the placeholder comment AND the empty fallback declaration that
// follows it in one shot. Replacing only the comment left the original
// `const PRECACHE_ASSETS = [];` in place, producing two `const` declarations
// (a SyntaxError that silently prevented the service worker from installing).
const placeholder = /\/\/ __PRECACHE_ASSETS__\s*\r?\n\s*const PRECACHE_ASSETS = \[\];/;
if (!placeholder.test(sw)) {
  console.warn('[inject-sw-assets] Placeholder/declaration not found in sw.js — skipping.');
  process.exit(0);
}

sw = sw.replace(placeholder, injection);

// Bump the cache names to the current app version so every release gets a
// fresh cache. Without this the hardcoded name never changes, so the SW's
// activate handler never purges the old cache and the stale-while-revalidate
// app shell keeps serving the previous build (users had to Ctrl+Shift+R).
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
sw = sw.replace(/const CACHE_NAME = 'cortex-v[^']+';/, `const CACHE_NAME = 'cortex-v${version}';`);
sw = sw.replace(/const API_CACHE_NAME = 'cortex-api-v[^']+';/, `const API_CACHE_NAME = 'cortex-api-v${version}';`);

writeFileSync(swPath, sw, 'utf8');

console.log(`[inject-sw-assets] Cache name set to cortex-v${version}`);
console.log(`[inject-sw-assets] Injected ${assets.length} assets into ${OUT_DIR}/sw.js`);
assets.forEach(a => console.log(`  ${a}`));
