#!/usr/bin/env bash
#
# Take a verified pre-release backup of a Cortex node's database.
#
# WHY THIS EXISTS
#
# The standing rule is that no migrating release ships without a verified
# database backup. It was being honoured by hand, with an inline `node -e` typed
# fresh each time — which is how three directories with three naming schemes
# came to exist on one node (~/db-backups, ~/backups, ~/cortex-backups), and how
# a release once shipped with no backup at all because nested shell quoting ate
# the variables and the failure printed nothing.
#
# One writer, one destination, one name shape, and it verifies what it wrote.
#
#   BACKUP_DIR   where snapshots go          (default ~/backups)
#   NODE_LABEL   prefix for the filename     (default: this node's hostname)
#
# USAGE
#
#   tools/backup-release-db.sh 2.105.6
#   BACKUP_DIR=/mnt/big tools/backup-release-db.sh 2.105.6
#
# Exits non-zero if the backup is missing, empty, or fails its integrity check —
# so `backup && deploy` genuinely gates the deploy on a good backup.
#
set -uo pipefail

VERSION="${1:-}"
[ -z "$VERSION" ] && { echo "usage: $(basename "$0") <version>   e.g. $(basename "$0") 2.105.6" >&2; exit 2; }

BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
NODE_LABEL="${NODE_LABEL:-$(hostname -s 2>/dev/null || echo node)}"
SERVER_DIR="${SERVER_DIR:-$HOME/cortex/server}"

[ -d "$SERVER_DIR" ] || { echo "no server directory at $SERVER_DIR" >&2; exit 1; }
cd "$SERVER_DIR" || exit 1

DB=$(ls -1 data/*.db 2>/dev/null | head -1)
[ -z "$DB" ] || [ ! -f "$DB" ] && { echo "no database found under $SERVER_DIR/data" >&2; exit 1; }

mkdir -p "$BACKUP_DIR" || exit 1
TS=$(date +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/${NODE_LABEL}-pre-${VERSION}-${TS}.db"

# Free space first. A backup that fills the disk is worse than no backup: it
# takes the live database down with it.
NEED_KB=$(du -k "$DB" | cut -f1)
FREE_KB=$(df -Pk "$BACKUP_DIR" | awk 'NR==2 {print $4}')
if [ "$FREE_KB" -lt $((NEED_KB + 51200)) ]; then
  echo "REFUSING: $(( FREE_KB / 1024 ))M free, need ~$(( NEED_KB / 1024 ))M plus headroom." >&2
  echo "          Run tools/prune-backups.sh --apply, or resize the disk." >&2
  exit 1
fi

echo "backing up $DB -> $OUT"

# .backup() rather than cp: a consistent snapshot of a live database.
node -e '
const Database = require("better-sqlite3");
const [src, out] = process.argv.slice(1);
const db = new Database(src, { readonly: true });
db.backup(out)
  .then(() => { db.close(); })
  .catch(e => { console.error("backup failed:", e.message); process.exit(1); });
' "$DB" "$OUT" || { echo "BACKUP FAILED" >&2; rm -f "$OUT"; exit 1; }

[ -s "$OUT" ] || { echo "BACKUP FAILED: $OUT is missing or empty" >&2; rm -f "$OUT"; exit 1; }

# Verified, not merely written. "A backup exists" and "a backup is readable" are
# different claims, and only the second one is worth anything.
node -e '
const Database = require("better-sqlite3");
const b = new Database(process.argv[1], { readonly: true });
const ok = b.pragma("integrity_check")[0].integrity_check;
const counts = ["users", "waves", "pings"].map(t => {
  try { return `${t}=${b.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c}`; } catch { return `${t}=?`; }
}).join(" ");
b.close();
console.log(`  integrity=${ok}  ${counts}`);
if (ok !== "ok") process.exit(1);
' "$OUT" || { echo "BACKUP FAILED ITS INTEGRITY CHECK — not usable, removing" >&2; rm -f "$OUT"; exit 1; }

# Opening the backup to verify it creates WAL sidecars. A completed .backup() is
# a self-contained database, so they are litter — and litter this very toolchain
# then has to prune as "orphaned journals". Don't create it.
rm -f "$OUT-shm" "$OUT-wal"

echo "  $(du -h "$OUT" | cut -f1)  $OUT"
echo "verified."
