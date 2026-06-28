// Post-build: reads the Vite manifest and injects hashed asset URLs
// into dist/sw.js so the service worker can pre-cache them at install time.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const manifestPath = join(ROOT, 'dist', '.vite', 'manifest.json');
const swPath = join(ROOT, 'dist', 'sw.js');

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
writeFileSync(swPath, sw, 'utf8');

console.log(`[inject-sw-assets] Injected ${assets.length} assets into dist/sw.js`);
assets.forEach(a => console.log(`  ${a}`));
