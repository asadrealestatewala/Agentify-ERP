#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/opt/agentify-erp}"
SERVICE="${2:-agentify-erp}"
DOMAIN="${3:-}"
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
  # process.loadEnvFile() lets a real environment variable win over server/.env, and the pm2 daemon keeps
  # handing its own (possibly stale) environment to every app it spawns. Take the value this deployment
  # decided on, put it in this shell's environment, and restart the daemon from it.
  if [ -z "${ERP_BASE_DOMAIN:-}" ] && [ -f "$APP_DIR/server/.env" ]; then
    ERP_BASE_DOMAIN="$(sed -n 's/^ERP_BASE_DOMAIN=//p' "$APP_DIR/server/.env" | head -n1 | tr -d '\r')"
  fi
  if [ -n "${ERP_BASE_DOMAIN:-}" ]; then export ERP_BASE_DOMAIN; fi

  "$PM2" kill >/dev/null 2>&1 || true
  sleep 3
  "$PM2" delete "$SERVICE" >/dev/null 2>&1 || true

  # whatever is still holding the port belongs to an older start (another manager, or a process systemd
  # brought back); if it stays the new app cannot bind, and every check keeps talking to the stale one
  stale="$(ss -ltnp 'sport = :4000' 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u | tr '\n' ' ' || true)"
  if [ -n "$stale" ]; then
    echo "diag: port 4000 still held by pid(s): $stale - stopping them"
    for p in $stale; do kill "$p" 2>/dev/null || true; done
    sleep 3
  else
    echo "diag: port 4000 was free"
  fi

  # no ecosystem file here: pm2's env block replaces the child's whole environment, which leaves the app
  # unable to boot. The daemon above was restarted from this shell, so it already carries the domain.
  "$PM2" start "$APP_DIR/server/src/index.js" --name "$SERVICE" --interpreter "$NODE" --update-env
  "$PM2" save

  # The God daemon inherits this ssh session's cgroup, and sshd tears that cgroup down when the session
  # closes - so anything we start here would be killed the moment the deploy finishes. Install pm2's unit
  # and restart it so systemd owns the daemon, then re-adopt what we just saved.
  "$PM2" startup systemd -u "$(id -un)" --hp "$HOME" >/dev/null 2>&1 || true
  systemctl daemon-reload >/dev/null 2>&1 || true
  if systemctl restart "pm2-$(id -un)" >/dev/null 2>&1; then
    echo "diag: pm2 now runs under systemd, so it outlives this ssh session"
  else
    echo "diag: pm2-$(id -un) could not be restarted; the daemon may not survive this session"
  fi
  sleep 5

  echo "diag: node processes:"
  ps -eo pid,etimes,cmd 2>/dev/null | grep -E '[n]ode|[p]m2' | sed 's/^/    /' || true
  echo "diag: listeners on 4000:"
  ss -ltnp 'sport = :4000' 2>/dev/null | sed 's/^/    /' || true
  echo "diag: server/.env ERP_BASE_DOMAIN=$(sed -n 's/^ERP_BASE_DOMAIN=//p' "$APP_DIR/server/.env" 2>/dev/null | head -n1 | tr -d '\r')"
  echo "diag: shell     ERP_BASE_DOMAIN=${ERP_BASE_DOMAIN:-<unset>}"
  echo "release env: ERP_BASE_DOMAIN=${ERP_BASE_DOMAIN:-<unset>}"
}

healthy() {
  # bootstrapping every workspace (schema upgrades, site defaults, demo rows) takes about 40s on this box
  for _ in $(seq 1 36); do
    sleep 5
    if curl -fsS http://127.0.0.1:4000/health >/dev/null; then return 0; fi
  done
  return 1
}

start_service

if ! healthy; then
  echo "health check failed"
  "$PM2" list || true
  "$PM2" describe "$SERVICE" 2>/dev/null | grep -Ei 'cwd|status|restart|interpreter|script' | sed 's/^/  pm2| /' || true
  "$PM2" logs "$SERVICE" --lines 40 --nostream 2>&1 | sed 's/^/  log| /' || true

  # where is the pm2-managed process actually parked? state/wchan/syscall say it without guessing
  pid="$("$PM2" pid "$SERVICE" 2>/dev/null | head -n1 | tr -d '[:space:]')"
  if [ -n "$pid" ] && [ -r "/proc/$pid/status" ]; then
    echo "== pid $pid is parked =="
    grep -E '^(State|Threads|VmRSS)' "/proc/$pid/status" | sed 's/^/  st| /' || true
    echo "  wchan:   $(cat "/proc/$pid/wchan" 2>/dev/null)"
    echo "  syscall: $(cat "/proc/$pid/syscall" 2>/dev/null)"
    echo "== its environment, compared with this shell =="
    tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | sort > /tmp/pm2app.env
    env | sort > /tmp/shell.env
    diff /tmp/shell.env /tmp/pm2app.env | sed 's/^/  env| /' || true
    echo "== its threads =="
    for t in $(ls "/proc/$pid/task" 2>/dev/null); do
      echo "  thread $t: $(cat "/proc/$pid/task/$t/wchan" 2>/dev/null)"
    done
    echo "== files it holds =="
    ls -l "/proc/$pid/fd" 2>/dev/null | awk '{print "  " $NF}' | grep -E 'data|\.db|\.env|socket|pipe' | sed 's/^/  /' || true
  else
    echo "== could not read pid $pid =="
  fi

  # run the same entry point in this session so its exact stop point lands in the log
  echo "== foreground boot, 45s =="
  ( cd "$APP_DIR/server" && timeout 45 "$NODE" src/index.js 2>&1 | sed 's/^/  boot| /' ) || true
  echo "== foreground boot finished =="
  echo "== listeners now =="
  ss -ltnp 2>/dev/null | sed 's/^/  /' || true

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

# A stale ERP_BASE_DOMAIN anywhere above would let the app start healthy while building every workspace
# address on the wrong host, so check what the running process actually reports for this deployment's domain.
if [ -n "$DOMAIN" ] && command -v curl >/dev/null 2>&1; then
  got="$(curl -fsS -m 10 -H "Host: $DOMAIN" http://127.0.0.1:4000/api/platform/site 2>/dev/null \
    | tr -d '\n' | sed -n 's/.*"base_domain"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
  if [ "$got" != "$DOMAIN" ]; then
    echo "WARNING: the running app reports base_domain='${got:-none}' but this deployment serves '$DOMAIN'"
    echo "WARNING: workspace addresses would be built on the wrong host - check ERP_BASE_DOMAIN in server/.env"
  else
    echo "release domain ok: $got"
  fi
fi

echo "release ok: $SERVICE healthy on port 4000"
