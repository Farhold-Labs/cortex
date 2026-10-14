#!/usr/bin/env node
/**
 * Copy a node's local uploads into its S3-compatible bucket (v2.117.0).
 *
 * WHY THIS EXISTS
 * ---------------
 * Since v2.117.0 a node can keep uploads in a private bucket (STORAGE_PROVIDER=s3).
 * Cortex hands out the same /uploads/<key> and /api/media/<file> URLs either
 * way, and serves a file from disk if it is there, from the bucket if not. So
 * moving a node's existing files is just: copy them into the bucket under the
 * same keys. Once they are in the bucket, a new server does not need the
 * uploads directory at all — that is how farhold moved to its new VPS.
 *
 * WHAT IT DOES
 * ------------
 * - Copies every file under server/uploads to the bucket, key = its path
 *   relative to uploads (e.g. 'messages/user-…-123.png').
 * - Skips files already in the bucket with the same size and MD5, so it is
 *   safe to re-run; a second run after a successful one copies nothing.
 * - Checks each upload's ETag against the file's MD5 and reports mismatches.
 * - NEVER deletes anything from disk. Files keep being served from disk until
 *   someone removes them there.
 * - Skips names the S3 route would refuse to serve (anything outside
 *   [A-Za-z0-9._-/]) and lists them; those stay local-only.
 *
 * Usage (from the repo root on the node, with server/.env set for S3):
 *   node tools/copy-uploads-to-s3.mjs            # dry run: what would be copied
 *   node tools/copy-uploads-to-s3.mjs --apply    # copy
 *
 *   SERVER_DIR  the server directory (default: ../server relative to this file)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(process.env.SERVER_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '../server'));
const serverRequire = createRequire(path.join(serverDir, 'package.json'));
serverRequire('dotenv').config({ path: path.join(serverDir, '.env'), quiet: true });
const { S3Client, PutObjectCommand, HeadObjectCommand } = serverRequire('@aws-sdk/client-s3');

const apply = process.argv.includes('--apply');
const e = process.env;
if (e.STORAGE_PROVIDER !== 's3') {
  console.error('STORAGE_PROVIDER is not s3 in server/.env — nothing to copy to.');
  process.exit(1);
}
for (const name of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY']) {
  if (!e[name]) { console.error(`${name} is not set in server/.env`); process.exit(1); }
}

const s3 = new S3Client({
  endpoint: e.S3_ENDPOINT, region: e.S3_REGION || 'us-east-1', forcePathStyle: true,
  credentials: { accessKeyId: e.S3_ACCESS_KEY, secretAccessKey: e.S3_SECRET_KEY },
});
const Bucket = e.S3_BUCKET;
const root = path.join(serverDir, 'uploads');

// The stored type is informational only: Cortex decides the served type from
// the extension (see storage.stream), never from what the bucket says.
const TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'audio/ogg', '.ogv': 'video/ogg', '.mov': 'video/quicktime', '.m4v': 'video/mp4',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.oga': 'audio/ogg', '.opus': 'audio/opus',
};

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return walk(full);
  return entry.isFile() ? [full] : []; // symlinks and the like are not uploads
});
const md5 = (buf) => `"${crypto.createHash('md5').update(buf).digest('hex')}"`;

if (!fs.existsSync(root)) {
  console.log(`No uploads directory at ${root} — nothing to copy.`);
  process.exit(0);
}

let copied = 0, present = 0, bytes = 0;
const skipped = [], mismatched = [];
for (const file of walk(root)) {
  const key = path.relative(root, file).split(path.sep).join('/');
  if (!/^[A-Za-z0-9._\-/]+$/.test(key)) { skipped.push(key); continue; }
  const body = fs.readFileSync(file);
  const head = await s3.send(new HeadObjectCommand({ Bucket, Key: key })).catch(() => null);
  if (head && head.ContentLength === body.length && head.ETag === md5(body)) { present++; continue; }
  copied++; bytes += body.length;
  if (!apply) continue;
  const put = await s3.send(new PutObjectCommand({
    Bucket, Key: key, Body: body, ContentType: TYPES[path.extname(key).toLowerCase()] || 'application/octet-stream',
  }));
  if (put.ETag !== md5(body)) mismatched.push(key);
}

console.log(`${apply ? 'Copied' : 'Would copy'} ${copied} file(s), ${(bytes / 1048576).toFixed(1)} MB to ${Bucket}; already there: ${present}.`);
if (skipped.length) console.log(`Skipped ${skipped.length} file(s) whose names the bucket route will not serve (they stay local):\n  ${skipped.join('\n  ')}`);
if (mismatched.length) {
  console.log(`Checksum mismatch on ${mismatched.length} file(s) — re-run to retry:\n  ${mismatched.join('\n  ')}`);
  process.exit(1);
}
if (!apply && copied) console.log('Dry run. Re-run with --apply to copy.');
