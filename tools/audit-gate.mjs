#!/usr/bin/env node
/**
 * CI dependency gate: `npm audit --omit=dev` at moderate and above, with a
 * short, dated list of advisories excused for a stated reason.
 *
 *   node tools/audit-gate.mjs            (run in server/ or client/)
 *
 * Every other advisory fails the build, as plain `npm audit` did. An excused
 * advisory fails again on its review date, so an exception cannot quietly
 * become permanent: on that date either upstream has moved (delete the
 * entry) or someone decides again and writes down why.
 */
import { execFileSync } from 'node:child_process';

const EXCUSED = {
  // minimatch < 11.0.1, a pattern-amplification DoS, published 2026-10-30 with
  // a fix only in minimatch 11. Our copies arrive through glob/rimraf under
  // firebase-admin (google-gax temp clean-up) and electron-builder and the
  // Capacitor CLI (build tools). None matches a pattern a user supplies.
  // npm's "fix" downgrades those packages by years; forcing minimatch 11 on
  // the 3.x/5.x users would change the API under them. Excused by Jared
  // 2026-10-31 until upstream moves.
  'GHSA-g3hv-75wg-m249': '2026-11-30',
  // glob 9.0.0–14.0.1: an aborted glob can keep walking the filesystem after
  // its AbortSignal fires. Published the same minute, fixed only in glob 14,
  // through the same rimraf/glob copies; nothing here aborts a glob, and none
  // walks a path a user chose. Same reason, same review date.
  'GHSA-3g3m-2fjr-6pw4': '2026-11-30',
};

const LEVELS = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const today = new Date().toISOString().slice(0, 10);

let out;
try {
  out = execFileSync('npm', ['audit', '--json', '--omit=dev'], { encoding: 'utf8', maxBuffer: 64 << 20 });
} catch (err) {
  out = err.stdout; // npm audit exits non-zero whenever it finds anything
}
const report = JSON.parse(out || '{}');
if (report.error) {
  console.error('npm audit failed:', report.error.summary || report.error);
  process.exit(2);
}

const failing = new Map();
const excused = new Map();
for (const vuln of Object.values(report.vulnerabilities || {})) {
  for (const via of vuln.via) {
    if (typeof via !== 'object' || LEVELS[via.severity] < LEVELS.moderate) continue;
    const id = String(via.url || '').split('/').pop();
    const until = EXCUSED[id];
    const entry = `${id} ${via.severity} ${via.name} ${via.range} — ${via.title}`;
    if (until && today < until) excused.set(id, `${entry} (excused until ${until})`);
    else failing.set(id, until ? `${entry} (excuse expired ${until}: review it)` : entry);
  }
}

for (const line of excused.values()) console.log('excused:', line);
for (const line of failing.values()) console.log('FAIL:', line);
if (failing.size) process.exit(1);
console.log(`audit clean at moderate and above${excused.size ? `, ${excused.size} excused` : ''}`);
