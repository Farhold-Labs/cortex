#!/usr/bin/env bash
#
# Prune old release backups on a Cortex node.
#
# WHY THIS EXISTS
#
# The standing rule is that no migrating release ships without a verified
# database backup. Nothing was ever pruning them. By 2026-09-25 farhold held
# ~1.3 GB of snapshots of the same 30 MB database across three directories with
# three naming schemes, filled its 8.7 GB disk, and a release backup failed
# SQLITE_FULL with 18 MB free — which correctly aborted the deploy, but a node
# that cannot write is a node that cannot serve.
#
# Keeping every backup forever is not a backup policy. Keeping the most recent
# few is.
#
# SAFETY
#
#   * DRY RUN BY DEFAULT. Pass --apply to actually delete. A script that
#     removes backups should never do so because somebody typed its name.
#   * It never empties a directory: the newest KEEP snapshots always survive,
#     and if a directory holds KEEP or fewer it is left completely alone.
#   * It matches explicit snapshot patterns, never a bare *.db. An unrecognised
#     file is left where it is.
#   * env-pre-*.bak is never touched — a few kilobytes, and the one thing that
#     is genuinely hard to reconstruct.
#   * Ordering is by modification time, not by filename. Two timestamp formats
#     are in circulation (20260909T170959 and 20260923-125241) and mtime is not
#     ambiguous between them.
#
# USAGE
#
#   tools/prune-backups.sh                 # show what would go
#   tools/prune-backups.sh --apply         # do it
#   tools/prune-backups.sh --keep 3        # change the retention
#   tools/prune-backups.sh --keep 5 --apply
#
set -uo pipefail

KEEP=4              # snapshots to retain per directory
KEEP_DIST=2         # client bundles: rebuildable from git, so keep fewer
APPLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --keep) KEEP="${2:?--keep needs a number}"; shift 2 ;;
    --keep-dist) KEEP_DIST="${2:?--keep-dist needs a number}"; shift 2 ;;
    -h|--help) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

case "$KEEP" in ''|*[!0-9]*) echo "--keep must be a whole number" >&2; exit 2 ;; esac
[ "$KEEP" -lt 1 ] && { echo "--keep must be at least 1: never prune to nothing" >&2; exit 2; }

DIRS=("$HOME/db-backups" "$HOME/backups" "$HOME/cortex-backups")

# Snapshot name shapes seen in the wild. Explicit, so nothing unexpected matches.
PATTERNS=('farhold-pre-*.db' 'farhold-post-*.db' 'farhold-prod-pre-*.db'
          'db-pre-*.db' 'db-post-*.db' 'pmp-pre-*.db' 'pmp-post-*.db')

human() { local k=$1; if [ "$k" -ge 1048576 ]; then echo "$((k/1048576))G"; elif [ "$k" -ge 1024 ]; then echo "$((k/1024))M"; else echo "${k}K"; fi; }

freed_kb=0
would_delete=0

echo "Cortex backup retention — keep $KEEP snapshot(s) per directory, $KEEP_DIST client bundle(s)"
[ "$APPLY" -eq 1 ] && echo "MODE: applying" || echo "MODE: dry run (pass --apply to delete)"
echo "disk before: $(df -h / | awk 'NR==2 {print $4" free of "$2" ("$5" used)"}')"
echo

remove() {   # remove <file> — and any -shm/-wal sibling that belongs to it
  local f=$1 kb
  for target in "$f" "$f-shm" "$f-wal"; do
    [ -e "$target" ] || continue
    kb=$(du -k "$target" 2>/dev/null | cut -f1); kb=${kb:-0}
    freed_kb=$((freed_kb + kb))
    would_delete=$((would_delete + 1))
    if [ "$APPLY" -eq 1 ]; then rm -f -- "$target"; fi
  done
}

for dir in "${DIRS[@]}"; do
  [ -d "$dir" ] || continue
  echo "=== $dir"

  # Collect snapshots, newest first, without depending on filename format.
  mapfile -t snaps < <(
    for pat in "${PATTERNS[@]}"; do
      find "$dir" -maxdepth 1 -type f -name "$pat" -printf '%T@\t%p\n' 2>/dev/null
    done | sort -rn | cut -f2-
  )

  if [ "${#snaps[@]}" -le "$KEEP" ]; then
    echo "    ${#snaps[@]} snapshot(s) — at or under the limit, leaving alone"
  else
    echo "    ${#snaps[@]} snapshot(s); keeping the newest $KEEP:"
    for i in $(seq 0 $((KEEP-1))); do echo "      keep   $(basename "${snaps[$i]}")"; done
    for i in $(seq "$KEEP" $(( ${#snaps[@]} - 1 ))); do
      echo "      prune  $(basename "${snaps[$i]}")"
      remove "${snaps[$i]}"
    done
  fi

  # Client bundles: reproducible from git, so they get a shorter leash.
  mapfile -t dists < <(find "$dir" -maxdepth 1 -type f -name 'dist-pre-*.tar.gz' -printf '%T@\t%p\n' 2>/dev/null | sort -rn | cut -f2-)
  if [ "${#dists[@]}" -gt "$KEEP_DIST" ]; then
    for i in $(seq "$KEEP_DIST" $(( ${#dists[@]} - 1 ))); do
      echo "      prune  $(basename "${dists[$i]}")  (client bundle, rebuildable)"
      remove "${dists[$i]}"
    done
  fi

  # -shm/-wal left beside a snapshot that no longer exists. Useless on their
  # own: a completed .backup() is a self-contained database.
  while IFS= read -r stray; do
    parent="${stray%-shm}"; parent="${parent%-wal}"
    [ -e "$parent" ] && continue
    echo "      prune  $(basename "$stray")  (orphaned journal)"
    remove "$stray"
  done < <(find "$dir" -maxdepth 1 -type f \( -name '*.db-shm' -o -name '*.db-wal' \) 2>/dev/null)

  echo
done

echo "${would_delete} file(s), $(human "$freed_kb") $([ "$APPLY" -eq 1 ] && echo 'freed' || echo 'would be freed')"
if [ "$APPLY" -eq 1 ]; then
  echo "disk after:  $(df -h / | awk 'NR==2 {print $4" free of "$2" ("$5" used)"}')"
else
  echo "nothing was deleted — re-run with --apply"
fi
