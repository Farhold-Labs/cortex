#!/usr/bin/env node
/**
 * Regenerate server/schema.sql from the live schema (v2.66.1)
 *
 * WHY THIS EXISTS
 * ---------------
 * schema.sql kept drifting from reality. Tables and columns were added only to
 * applySchemaUpdates(), so a brand-new install built from schema.sql came up
 * incomplete and then crashed at runtime. That bit us three times:
 *
 *   v2.61.1  no such column: user_key_id   (boot crash on a fresh node)
 *   v2.61.1  no such table: custom_themes  (theme load + wave creation broken)
 *   v2.64.1  notifications has no column named group_key
 *            (ALL notifications, push, and the reaction/mention/reply routes
 *             dead on every fresh install since v2.0.0)
 *
 * HOW TO ADD SCHEMA
 * -----------------
 *   1. Put the change in applySchemaUpdates() so existing databases migrate.
 *   2. Run this script.
 *   3. Commit schema.sql alongside your change.
 *
 * The script builds a database the way a real node does (schema.sql + every
 * migration), dumps the result, rewrites schema.sql from it, then verifies that
 * schema.sql ALONE produces an identical schema. It exits non-zero if not, so it
 * is safe to wire into CI.
 *
 * Usage:  node tools/generate-schema.mjs [--check]
 *         --check  verify only; do not rewrite schema.sql (for CI)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.join(ROOT, 'server');

// better-sqlite3 lives in server/node_modules, so resolve from there rather than
// requiring this script to be run from any particular directory
const require = createRequire(pathToFileURL(path.join(SERVER_DIR, 'package.json')));
const Database = require('better-sqlite3');
const SCHEMA_PATH = path.join(SERVER_DIR, 'schema.sql');
const CHECK_ONLY = process.argv.includes('--check');

// fts5 creates these automatically behind the virtual table; they must not be
// written into schema.sql or SQLite will refuse to create the virtual table.
const SHADOW = /^pings_fts_(data|idx|docsize|config|content)$/;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-schema-'));
const cleanup = () => fs.rmSync(tmpDir, { recursive: true, force: true });

function dumpObjects(dbPath) {
  const d = new Database(dbPath, { readonly: true });
  const rows = d.prepare(`
    SELECT type, name, tbl_name, sql FROM sqlite_master
    WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'trigger' THEN 2 ELSE 3 END, rowid
  `).all();
  d.close();
  return rows.filter(r => !SHADOW.test(r.name));
}

// Compare ignoring whitespace and IF NOT EXISTS, which sqlite_master strips
function fingerprint(rows) {
  const m = {};
  for (const r of rows) {
    m[`${r.type}:${r.name}`] = r.sql.replace(/\s+/g, ' ').replace(/ IF NOT EXISTS/gi, '').trim();
  }
  return m;
}

function withIfNotExists(sql) {
  return sql.trim().replace(/;+$/, '')
    .replace(/^CREATE TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ')
    .replace(/^CREATE VIRTUAL TABLE\s+/i, 'CREATE VIRTUAL TABLE IF NOT EXISTS ')
    .replace(/^CREATE (UNIQUE )?INDEX\s+/i, (_, u) => `CREATE ${u || ''}INDEX IF NOT EXISTS `)
    .replace(/^CREATE TRIGGER\s+/i, 'CREATE TRIGGER IF NOT EXISTS ') + ';';
}

async function main() {
  const { default: DatabaseSQLite } = await import(pathToFileURL(path.join(SERVER_DIR, 'database-sqlite.js')).href);

  // 1. Authoritative: schema.sql + every migration, exactly as a real node builds it
  const authPath = path.join(tmpDir, 'authoritative.db');
  const authDb = new DatabaseSQLite({ dbPath: authPath });
  authDb.db.close();
  const authoritative = dumpObjects(authPath);

  const tables   = authoritative.filter(r => r.type === 'table');
  const indexes  = authoritative.filter(r => r.type === 'index');
  const triggers = authoritative.filter(r => r.type === 'trigger');

  // 2. Render, grouping each table with its own indexes
  const byTable = {};
  for (const i of indexes) (byTable[i.tbl_name] ||= []).push(i);

  const out = [
    '-- Cortex SQLite Database Schema',
    '--',
    '-- Terminology:',
    '--   pings (formerly droplets) - individual messages',
    '--   crews (formerly groups) - user groups',
    '--   burst (formerly ripple) - break-out threads',
    '--',
    '-- ⚠️  GENERATED FILE — do not add tables here by hand.',
    '--',
    '-- This is a dump of the schema a fully-migrated database actually has. Historically',
    '-- this file drifted from the live schema: tables and columns were added only to',
    '-- applySchemaUpdates(), so fresh installs came up incomplete and crashed at runtime',
    '-- (see CHANGELOG v2.61.1 and v2.64.1).',
    '--',
    '-- To add schema: put the change in applySchemaUpdates() so existing databases migrate,',
    '-- then run `node tools/generate-schema.mjs` and commit both.',
    '',
  ];

  for (const t of tables) {
    out.push(withIfNotExists(t.sql));
    for (const i of byTable[t.name] || []) out.push(withIfNotExists(i.sql));
    out.push('');
  }
  if (triggers.length) {
    out.push('-- ============ Full-text search triggers ============');
    for (const tr of triggers) { out.push(withIfNotExists(tr.sql)); out.push(''); }
  }

  const rendered = out.join('\n').replace(/\n+$/, '') + '\n';
  const current = fs.existsSync(SCHEMA_PATH) ? fs.readFileSync(SCHEMA_PATH, 'utf8') : '';

  if (CHECK_ONLY) {
    if (rendered !== current) {
      console.error('❌ schema.sql is out of date — run: node tools/generate-schema.mjs');
      cleanup();
      process.exit(1);
    }
  } else {
    fs.writeFileSync(SCHEMA_PATH, rendered);
  }

  // 3. Verify schema.sql ALONE builds the identical schema
  const solePath = path.join(tmpDir, 'schema-only.db');
  const sole = new Database(solePath);
  sole.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  sole.close();

  const A = fingerprint(dumpObjects(solePath));
  const B = fingerprint(authoritative);

  const missing  = Object.keys(B).filter(k => !(k in A));
  const extra    = Object.keys(A).filter(k => !(k in B));
  const mismatch = Object.keys(A).filter(k => k in B && A[k] !== B[k]);

  console.log(`tables ${tables.length}  indexes ${indexes.length}  triggers ${triggers.length}`);
  console.log(`schema.sql alone: ${Object.keys(A).length} objects | migrated: ${Object.keys(B).length} objects`);

  if (missing.length || extra.length || mismatch.length) {
    console.error('❌ schema.sql does NOT match the migrated schema');
    if (missing.length)  console.error('   missing :', missing.slice(0, 10));
    if (extra.length)    console.error('   extra   :', extra.slice(0, 10));
    if (mismatch.length) console.error('   differs :', mismatch.slice(0, 10));
    cleanup();
    process.exit(1);
  }

  console.log(CHECK_ONLY ? '✅ schema.sql is up to date' : '✅ schema.sql regenerated and verified');
  cleanup();
}

main().catch(err => { console.error(err); cleanup(); process.exit(1); });
