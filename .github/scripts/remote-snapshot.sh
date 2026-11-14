#!/usr/bin/env bash
# Runs on the server before new code is uploaded: keeps a copy of the data and of the current code, so a bad release can be
# undone (remote-release.sh restores the code copy when the health check fails). Safe on a brand-new server (does nothing).
set -euo pipefail

APP_DIR="${1:-/opt/agentify-erp}"
BACKUPS=/opt/agentify-erp-backups

if [ ! -d "$APP_DIR/server/src" ]; then
  echo "no previous release to snapshot"
  exit 0
fi

mkdir -p "$BACKUPS"
stamp="$(date +%Y%m%d-%H%M%S)"
if [ -d "$APP_DIR/server/data" ]; then
  # The app keeps running while this copies, so a live SQLite file (e.g. platform.db-wal) can change mid-read. GNU tar then
  # exits 1 ("file changed as we read it") even though the archive was written; only exit 2+ is a real failure.
  rc=0
  tar --warning=no-file-changed -czf "$BACKUPS/data-$stamp.tgz" -C "$APP_DIR/server" data || rc=$?
  if [ "$rc" -gt 1 ]; then echo "data backup failed (tar exit $rc)"; exit "$rc"; fi
  [ "$rc" -eq 1 ] && echo "note: some data files changed while being copied (app is live); backup kept"
  echo "data backup: $BACKUPS/data-$stamp.tgz"
  # keep the 10 newest
  ls -1t "$BACKUPS"/data-*.tgz 2>/dev/null | tail -n +11 | xargs -r rm -f
fi

rm -rf "$APP_DIR/server.prev"
mkdir -p "$APP_DIR/server.prev"
rsync -a --exclude node_modules --exclude data --exclude uploads --exclude .env "$APP_DIR/server/" "$APP_DIR/server.prev/"
echo "code snapshot: $APP_DIR/server.prev"
