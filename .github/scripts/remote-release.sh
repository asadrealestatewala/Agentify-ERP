#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/opt/agentify-erp}"
SERVICE="${2:-agentify-erp}"
NODE_DIR=/opt/node22
NODE="$NODE_DIR/bin/node"
NPM="$NODE_DIR/bin/npm"
PM2="$NODE_DIR/bin/pm2"

# a non-interactive ssh session has a minimal PATH: /opt/node22/bin is not in it
export PATH="$NODE_DIR/bin:$PATH"

if [ ! -x "$NODE" ]; then
  echo "Node 22 not found at $NODE (bootstrap did not run?)"
  exit 1
fi

if [ ! -x "$PM2" ]; then
  echo "pm2 not found at $PM2 (bootstrap did not install it?)"
  exit 1
fi

start_service() {
  cd "$APP_DIR/server"
  "$NPM" install --omit=dev --no-audit --no-fund
  # The pm2 daemon keeps whatever environment it was first started with, and the app lets real environment
  # variables win over server/.env (see server/src/env.js). Exporting the file here means a changed
  # ERP_BASE_DOMAIN reaches the new process instead of being shadowed by a stale one.
  set -a
  # shellcheck disable=SC1091
  . "$APP_DIR/server/.env" 2>/dev/null || true
  set +a
  "$PM2" delete "$SERVICE" >/dev/null 2>&1 || true
  "$PM2" start src/index.js --name "$SERVICE" \
    --interpreter "$NODE" --node-args "--disable-warning=ExperimentalWarning"
  "$PM2" save
}

healthy() {
  for _ in 1 2 3 4 5 6; do
    sleep 5
    if curl -fsS http://127.0.0.1:4000/health >/dev/null; then return 0; fi
  done
  return 1
}

start_service

if ! healthy; then
  echo "health check failed"
  "$PM2" logs "$SERVICE" --lines 60 --nostream || true
  if [ -d "$APP_DIR/server.prev/src" ]; then
    echo "restoring the previous release"
    rsync -a --delete --exclude node_modules --exclude data --exclude uploads --exclude .env "$APP_DIR/server.prev/" "$APP_DIR/server/"
    start_service || true
    if healthy; then echo "previous release restored and healthy"; else echo "previous release did not start either; see pm2 logs"; fi
  fi
  exit 1
fi

# start again after a reboot of the server (installs the system service once; harmless to repeat)
"$PM2" startup systemd -u "$(id -un)" --hp "$HOME" >/dev/null 2>&1 || true
"$PM2" save >/dev/null 2>&1 || true

curl -fsS http://127.0.0.1:4000/health
echo
echo "release ok: $SERVICE healthy on port 4000"
