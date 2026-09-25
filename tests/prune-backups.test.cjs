'use strict';

// tools/prune-backups.sh (v2.105.6).
//
// Release backups were never pruned. By 2026-09-25 the production node held
// ~1.3 GB of snapshots of the same 30 MB database across three directories,
// filled its 8.7 GB disk, and a release backup failed SQLITE_FULL with 18 MB
// free — which aborted the deploy correctly, but a node that cannot write is a
// node that cannot serve.
//
// This script deletes backups, so it is the last thing that should be trusted
// on inspection. What is pinned here is not "does it prune" but the properties
// that make it safe to point at a production box: dry run by default, never
// empty a directory, never touch what it does not recognise, idempotent.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const script = path.resolve(__dirname, '../tools/prune-backups.sh');

/** A home directory shaped like a real node's, with both timestamp formats. */
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-home-'));
  const dirs = ['db-backups', 'backups', 'cortex-backups'];
  for (const d of dirs) fs.mkdirSync(path.join(home, d));

  const write = (rel, bytes, daysAgo) => {
    const full = path.join(home, rel);
    fs.writeFileSync(full, Buffer.alloc(bytes));
    const when = new Date(Date.now() - daysAgo * 86400000);
    fs.utimesSync(full, when, when);
    return full;
  };

  // Six snapshots, newest first by mtime.
  ['2.100.0', '2.101.0', '2.102.0', '2.103.0', '2.104.0', '2.105.0'].forEach((v, i) => {
    write(`db-backups/farhold-pre-${v}-2026090${i + 1}-120000.db`, 4096, 30 - i);
  });
  // A second naming scheme, with paired journals, under the retention limit.
  ['2.82.0', '2.84.0'].forEach((v, i) => {
    const f = write(`backups/db-pre-${v}-20260909T17095${i}.db`, 4096, 20);
    fs.writeFileSync(`${f}-shm`, Buffer.alloc(64));
    fs.writeFileSync(`${f}-wal`, Buffer.alloc(0));
  });
  write('backups/env-pre-2.105.0.bak', 128, 5);            // must never be touched
  write('backups/orphan.db-wal', 64, 5);                   // journal with no parent
  write('backups/something-unrecognised.db', 4096, 60);    // not a known shape
  ['1', '2', '3'].forEach((n, i) => write(`backups/dist-pre-2.10${n}.0-17901699${n}.tar.gz`, 1024, 10 - i));
  write('cortex-backups/farhold-pre-2.99.0-20260919-052048.db', 4096, 40);  // lone snapshot

  return home;
}

const run = (home, args) =>
  execFileSync('bash', [script, ...args], { env: { ...process.env, HOME: home }, encoding: 'utf8' });

const list = (home, dir) => fs.readdirSync(path.join(home, dir)).sort();

test('prune-backups.sh is safe to point at a production node', async (t) => {
  await t.test('it deletes nothing unless asked', async () => {
    const home = fixture();
    try {
      const before = list(home, 'db-backups');
      const out = run(home, ['--keep', '3']);
      assert.match(out, /dry run/);
      assert.match(out, /nothing was deleted/);
      assert.deepEqual(list(home, 'db-backups'), before,
        'a script that removes backups must not do so because somebody typed its name');
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  await t.test('it keeps the newest N and prunes only the rest', async () => {
    const home = fixture();
    try {
      run(home, ['--keep', '3', '--apply']);
      const kept = list(home, 'db-backups');
      assert.equal(kept.length, 3);
      assert.ok(kept.some(f => f.includes('2.105.0')), 'the newest must survive');
      assert.ok(kept.some(f => f.includes('2.104.0')));
      assert.ok(kept.some(f => f.includes('2.103.0')));
      assert.ok(!kept.some(f => f.includes('2.100.0')), 'the oldest should be gone');
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  await t.test('a directory at or under the limit is left completely alone', async () => {
    const home = fixture();
    try {
      const before = list(home, 'cortex-backups');
      run(home, ['--keep', '3', '--apply']);
      assert.deepEqual(list(home, 'cortex-backups'), before,
        'one snapshot and a limit of three means nothing to do');
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  await t.test('it never touches what it does not recognise', async () => {
    const home = fixture();
    try {
      run(home, ['--keep', '1', '--apply']);
      const rest = list(home, 'backups');
      assert.ok(rest.includes('env-pre-2.105.0.bak'),
        'the env backup is kilobytes and the hardest thing here to reconstruct');
      assert.ok(rest.includes('something-unrecognised.db'),
        'an unknown filename is somebody else\'s file, not a candidate');
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  await t.test('journals go with their snapshot, and orphans go alone', async () => {
    const home = fixture();
    try {
      run(home, ['--keep', '3', '--apply']);
      const rest = list(home, 'backups');
      assert.ok(!rest.includes('orphan.db-wal'),
        'a journal beside a snapshot that no longer exists is useless on its own');
      assert.ok(rest.some(f => f.endsWith('.db-shm')),
        'but journals paired with a KEPT snapshot stay with it');
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  await t.test('running it twice finds nothing the second time', async () => {
    const home = fixture();
    try {
      run(home, ['--keep', '2', '--apply']);
      const out = run(home, ['--keep', '2', '--apply']);
      assert.match(out, /^0 file\(s\)/m, 'a cron job should settle, not keep finding work');
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });

  await t.test('it refuses to prune to nothing, or on nonsense input', async () => {
    const home = fixture();
    try {
      for (const args of [['--keep', '0'], ['--keep', 'abc'], ['--unknown']]) {
        assert.throws(() => run(home, args), /Error/,
          `expected a non-zero exit for ${args.join(' ')}`);
      }
      assert.ok(list(home, 'db-backups').length > 0, 'and a refusal changes nothing');
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
});
