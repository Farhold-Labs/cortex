#!/usr/bin/env bash
#
# Send an encrypted, verified backup of a Cortex node to S3-compatible storage.
#
# WHY THIS EXISTS
#
# Every backup a node took lived on that node. ~/backups holds verified
# snapshots, but a lost disk, a deleted VPS or a provider outage takes them with
# it — the backups would fail at exactly the moment they were needed.
#
# WHAT IT SENDS
#
# One archive per run: a consistent snapshot of the live database, verified the
# same way as tools/backup-release-db.sh, together with server/.env,
# ecosystem.config.cjs and firebase-service-account.json when present. The .env
# is not optional: it holds the field-encryption keys, and a database without
# them is unreadable in all the places that matter.
#
# Uploads are not included. A node on S3 storage already keeps them in a bucket;
# a node on local storage should move to S3 storage first.
#
# ENCRYPTION
#
# The archive is encrypted to a GPG PUBLIC key before it leaves the box. The
# node holds no secret that can decrypt it. Someone who takes over the node gets
# the live data, which they already have, but not the history; someone who gets
# only the bucket credentials gets ciphertext. The private key lives off the
# node, and restoring needs it.
#
# RETENTION
#
# This script never deletes. Retention is a lifecycle rule on the bucket, so the
# credentials this script needs could not erase the history even if misused
# (unless they also carry deleteFiles — scope them write-only where possible).
#
# CONFIGURATION — a file readable by its owner only (the script refuses
# otherwise), default ~/.config/cortex/offsite-backup.env:
#
#   OFFSITE_S3_ENDPOINT=https://s3.us-east-005.backblazeb2.com
#   OFFSITE_S3_REGION=us-east-005
#   OFFSITE_S3_BUCKET=…
#   OFFSITE_S3_ACCESS_KEY=…
#   OFFSITE_S3_SECRET_KEY=…
#   OFFSITE_RECIPIENT=$HOME/.config/cortex/offsite-backup.pub.asc
#   OFFSITE_PREFIX=…            # optional, default: this node's hostname
#
# USAGE
#
#   tools/offsite-backup.sh
#   OFFSITE_CONFIG=/path/to/file tools/offsite-backup.sh
#
# Exits non-zero unless the object in the bucket has the size it was sent with.
#
set -uo pipefail

CONFIG="${OFFSITE_CONFIG:-$HOME/.config/cortex/offsite-backup.env}"
SERVER_DIR="${SERVER_DIR:-$HOME/cortex/server}"
DB="${DB_FILE:-data/farhold.db}"

fail() { echo "OFFSITE BACKUP FAILED: $*" >&2; exit 1; }

[ -f "$CONFIG" ] || fail "no config at $CONFIG"
# The file holds the bucket's secret key.
case "$(stat -c %a "$CONFIG")" in
  600|400) ;;
  *) fail "$CONFIG is readable by others (mode $(stat -c %a "$CONFIG")); chmod 600 it" ;;
esac
set -a
# shellcheck disable=SC1090
. "$CONFIG" || fail "could not read $CONFIG"
set +a
for v in OFFSITE_S3_ENDPOINT OFFSITE_S3_REGION OFFSITE_S3_BUCKET OFFSITE_S3_ACCESS_KEY OFFSITE_S3_SECRET_KEY OFFSITE_RECIPIENT; do
  [ -n "${!v:-}" ] || fail "$v is not set in $CONFIG"
done
[ -s "$OFFSITE_RECIPIENT" ] || fail "no public key at $OFFSITE_RECIPIENT"
PREFIX="${OFFSITE_PREFIX:-$(hostname -s 2>/dev/null || echo node)}"

for bin in gpg zstd tar node; do command -v "$bin" >/dev/null || fail "$bin is not installed"; done
[ -f "$SERVER_DIR/$DB" ] || fail "no database at $SERVER_DIR/$DB"

umask 077
WORK=$(mktemp -d "${TMPDIR:-/tmp}/cortex-offsite.XXXXXX") || fail "mktemp"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/stage/server/data" "$WORK/gnupg"

TS=$(date -u +%Y%m%d-%H%M%S)
NAME="${PREFIX}-${TS}.tar.zst.gpg"
KEY="${PREFIX}/${NAME}"

# A consistent snapshot of the live database, then proof that it is one.
cd "$SERVER_DIR" || fail "cd $SERVER_DIR"
node -e '
const Database = require("better-sqlite3");
const [src, out] = process.argv.slice(1);
const db = new Database(src, { readonly: true });
db.backup(out).then(() => {
  db.close();
  const b = new Database(out, { readonly: true });
  const ok = b.pragma("integrity_check")[0].integrity_check;
  let users = null;
  try { users = b.prepare("SELECT COUNT(*) c FROM users").get().c; } catch {}
  const pings = (() => { try { return b.prepare("SELECT COUNT(*) c FROM pings").get().c; } catch { return "?"; } })();
  b.close();
  console.log(`  integrity=${ok}  users=${users ?? "?"}  pings=${pings}`);
  if (ok !== "ok" || users === null) process.exit(1);
}).catch(e => { console.error("snapshot failed:", e.message); process.exit(1); });
' "$DB" "$WORK/stage/server/data/farhold.db" || fail "database snapshot did not verify"
rm -f "$WORK/stage/server/data/farhold.db-shm" "$WORK/stage/server/data/farhold.db-wal"

[ -f .env ] || fail "no server/.env — a backup without the field keys cannot be restored"
cp .env "$WORK/stage/server/.env"
[ -f firebase-service-account.json ] && cp firebase-service-account.json "$WORK/stage/server/"
[ -f ../ecosystem.config.cjs ] && cp ../ecosystem.config.cjs "$WORK/stage/"

# Encrypt to the public key only. A throwaway keyring: nothing is imported into
# the user's own, and no trust database decides whether the key is accepted.
tar -C "$WORK/stage" -cf - . \
  | zstd -q -19 \
  | gpg --homedir "$WORK/gnupg" --batch --quiet --no-tty --trust-model always \
        --recipient-file "$OFFSITE_RECIPIENT" --encrypt -o "$WORK/$NAME" \
  || fail "archive or encryption failed"
[ -s "$WORK/$NAME" ] || fail "encrypted archive is empty"

SIZE=$(stat -c %s "$WORK/$NAME")
echo "  $NAME  $SIZE bytes"

# Upload with the AWS SDK the server already depends on, then read back the
# object's size: "the request returned" is not "the file is there".
node --input-type=module -e '
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(process.cwd() + "/package.json");
const { S3Client, PutObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const [file, key, size] = process.argv.slice(1);
const s3 = new S3Client({
  endpoint: process.env.OFFSITE_S3_ENDPOINT,
  region: process.env.OFFSITE_S3_REGION,
  credentials: { accessKeyId: process.env.OFFSITE_S3_ACCESS_KEY, secretAccessKey: process.env.OFFSITE_S3_SECRET_KEY },
  forcePathStyle: true,
});
const Bucket = process.env.OFFSITE_S3_BUCKET;
try {
  await s3.send(new PutObjectCommand({
    // A buffer, as storage.js sends: archives are a few MB, and a stream body
    // switches the SDK to chunked uploads that not every S3 host accepts.
    Bucket, Key: key, Body: fs.readFileSync(file), ContentType: "application/pgp-encrypted",
  }));
  const head = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
  if (Number(head.ContentLength) !== Number(size)) {
    console.error(`stored size ${head.ContentLength} != sent ${size}`);
    process.exit(1);
  }
  console.log(`  uploaded s3://${Bucket}/${key}`);
} catch (e) {
  console.error("upload failed:", e.name, e.message);
  process.exit(1);
}
' "$WORK/$NAME" "$KEY" "$SIZE" || fail "upload did not verify"

# For anything watching: when the last good backup left this box.
date -u +%Y-%m-%dT%H:%M:%SZ > "$HOME/.offsite-backup-last-ok"
echo "verified."
