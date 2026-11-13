#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/opt/agentify-erp}"
SERVICE="${2:-agentify-erp}"
DOMAIN="${3:-agentifyerp.co}"
NODE_DIR=/opt/node22
NODE_VERSION=v22.23.3

export DEBIAN_FRONTEND=noninteractive
# a non-interactive ssh session has a minimal PATH: /opt/node22/bin is not in it
export PATH="$NODE_DIR/bin:$PATH"

have() { command -v "$1" >/dev/null 2>&1; }

if ! have curl || ! have rsync || ! have git || ! have tar; then
  apt-get update -y -qq
  apt-get install -y -qq curl rsync git ca-certificates xz-utils
fi

# ffmpeg builds the finished Creative Studio reels (joins clips, puts the voice inside the video). Optional: without it reels stay 8 seconds.
if ! have ffmpeg || ! have ffprobe; then
  echo "installing ffmpeg"
  apt-get update -y -qq && apt-get install -y -qq ffmpeg || echo "ffmpeg install failed; reels will stay 8 seconds with the voice as a separate file"
fi

if [ ! -x "$NODE_DIR/bin/node" ]; then
  echo "installing Node $NODE_VERSION to $NODE_DIR"
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz" -o /tmp/node22.tar.xz
  tar -xJf /tmp/node22.tar.xz -C /opt
  mv "/opt/node-$NODE_VERSION-linux-x64" "$NODE_DIR"
  rm -f /tmp/node22.tar.xz
fi
echo "node: $("$NODE_DIR/bin/node" -v)"

# pm2 lives in $NODE_DIR/bin, which is not on the PATH of a non-interactive session
if [ ! -x "$NODE_DIR/bin/pm2" ]; then
  "$NODE_DIR/bin/npm" install -g pm2
fi
echo "pm2: $("$NODE_DIR/bin/pm2" --version 2>/dev/null || echo unknown)"

mkdir -p "$APP_DIR/server" "$APP_DIR/client"

if [ ! -f "$APP_DIR/server/.env" ]; then
  : "${JWT_SECRET:?JWT_SECRET is required to create server/.env}"
  {
    echo "PORT=4000"
    echo "NODE_ENV=production"
    echo "ERP_BASE_DOMAIN=${ERP_BASE_DOMAIN:-}"
    echo "JWT_SECRET=${JWT_SECRET}"
    echo "ERP_SECRETS_KEY=${ERP_SECRETS_KEY:-}"
    if [ -n "${PLATFORM_ADMIN_EMAIL:-}" ]; then
      echo "PLATFORM_ADMIN_EMAIL=${PLATFORM_ADMIN_EMAIL}"
    fi
    if [ -n "${PLATFORM_ADMIN_PASSWORD:-}" ]; then
      echo "PLATFORM_ADMIN_PASSWORD=${PLATFORM_ADMIN_PASSWORD}"
    fi
  } > "$APP_DIR/server/.env"
  chmod 600 "$APP_DIR/server/.env"
  echo "created $APP_DIR/server/.env"
else
  # An existing file is kept, except that ERP_BASE_DOMAIN must follow this deployment: the app builds every
  # workspace address from it, so a domain change that never reaches server/.env silently keeps the old one.
  if [ -n "${ERP_BASE_DOMAIN:-}" ] && grep -q '^ERP_BASE_DOMAIN=' "$APP_DIR/server/.env"; then
    if ! grep -qx "ERP_BASE_DOMAIN=${ERP_BASE_DOMAIN}" "$APP_DIR/server/.env"; then
      sed -i "s|^ERP_BASE_DOMAIN=.*|ERP_BASE_DOMAIN=${ERP_BASE_DOMAIN}|" "$APP_DIR/server/.env"
      echo "server/.env ERP_BASE_DOMAIN=${ERP_BASE_DOMAIN} (updated)"
    fi
  else
    echo "keeping existing server/.env"
  fi
fi

# Object storage settings (GitHub secrets S3_*): written to server/.env whenever the deploy has them, so they never live in git.
# Values are never printed. Without them the app keeps storing private files on this server, as before.
for k in S3_ENDPOINT S3_REGION S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY GOOGLE_MAPS_API_KEY GOOGLE_MAPS_MAP_ID MAP_PROVIDER MAPTILER_API_KEY LOCATIONIQ_KEY GEOCODE_PROVIDER; do
  v="${!k:-}"
  if [ -n "$v" ]; then
    { grep -v "^${k}=" "$APP_DIR/server/.env" || true; printf '%s=%s\n' "$k" "$v"; } > "$APP_DIR/server/.env.tmp"
    chmod 600 "$APP_DIR/server/.env.tmp" && mv "$APP_DIR/server/.env.tmp" "$APP_DIR/server/.env"
    echo "server/.env $k set"
  fi
done

if ! have nginx; then
  echo "installing nginx"
  apt-get update -y -qq && apt-get install -y -qq nginx || echo "nginx install failed; the app will only be reachable on port 4000"
fi

if have nginx && [ ! -f /etc/nginx/sites-available/agentify-erp ]; then
  cat > /etc/nginx/sites-available/agentify-erp <<'NGINXCONF'
server {
    listen 80;
    listen [::]:80;
    server_name __SERVER_NAMES__;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
NGINXCONF
  # in multi-tenant mode customer workspaces live on <slug>.<base domain>, so nginx must answer for the wildcard too
  NAMES="$DOMAIN"
  if [ -n "${ERP_BASE_DOMAIN:-}" ]; then NAMES="$DOMAIN *.$DOMAIN"; fi
  sed -i "s/__SERVER_NAMES__/$NAMES/g" /etc/nginx/sites-available/agentify-erp
  ln -sf /etc/nginx/sites-available/agentify-erp /etc/nginx/sites-enabled/agentify-erp
  if nginx -t; then
    systemctl enable nginx >/dev/null 2>&1 || true
    systemctl reload nginx >/dev/null 2>&1 || systemctl restart nginx || true
    echo "nginx configured for $DOMAIN"
  else
    rm -f /etc/nginx/sites-enabled/agentify-erp
    echo "nginx config test failed; skipped (site still on port 4000)"
  fi
fi

if have nginx; then
  systemctl enable nginx >/dev/null 2>&1 || true
  systemctl start nginx >/dev/null 2>&1 || true
fi

if have certbot && [ -f /etc/nginx/sites-available/agentify-erp ] && [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || echo "certbot failed (HTTP still works)"
fi

if [ -n "${ERP_BASE_DOMAIN:-}" ]; then
  echo "NOTE: workspaces at https://<slug>.$DOMAIN need a wildcard certificate (certbot --manual --preferred-challenges dns -d '*.$DOMAIN'); until then they work over http only."
fi
# FreeLLMAPI (extra free AI provider, docs/freellmapi-setup.md): installed once with Docker, published on 127.0.0.1:3001 ONLY (never on the
# internet). Best effort: any failure here is reported and ignored, so it can never stop a deploy. It is skipped when it already runs.
install_freellmapi() {
  local dir=/opt/freellmapi
  # FreeLLMAPI refuses to start in production without ENCRYPTION_KEY (it encrypts the provider keys it stores): make one once and keep it
  if [ -f "$dir/.env" ] && ! grep -q '^ENCRYPTION_KEY=[0-9a-f]\{64\}$' "$dir/.env"; then
    { grep -v '^ENCRYPTION_KEY=' "$dir/.env" || true; printf 'ENCRYPTION_KEY=%s\n' "$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"; } > "$dir/.env.tmp" && chmod 600 "$dir/.env.tmp" && mv "$dir/.env.tmp" "$dir/.env"
    echo "freellmapi: encryption key created"
    (cd "$dir" && docker compose up -d --force-recreate) || return 1
    sleep 8
  fi
  if have docker && docker ps --filter status=running --format '{{.Names}}' 2>/dev/null | grep -q freellmapi; then echo "freellmapi already running"; configure_freellmapi; return 0; fi
  if ! have docker; then echo "installing docker for freellmapi"; curl -fsSL https://get.docker.com | sh || return 1; fi
  mkdir -p "$dir"
  if [ ! -d "$dir/.git" ]; then git clone --depth 1 https://github.com/asadrealestatewala/freellmapi.git "$dir" || return 1; fi
  cd "$dir"
  [ -f .env ] || { : > .env; chmod 600 .env; }
  grep -q '^HOST_BIND=' .env || echo 'HOST_BIND=127.0.0.1' >> .env
  grep -q '^ENCRYPTION_KEY=[0-9a-f]\{64\}$' .env || printf 'ENCRYPTION_KEY=%s\n' "$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" >> .env
  docker compose pull || return 1
  docker compose up -d || return 1
  sleep 8
  if curl -fsS --max-time 8 http://127.0.0.1:3001/api/ping >/dev/null; then echo "freellmapi running on 127.0.0.1:3001"; else echo "freellmapi started but did not answer yet"; fi
  ss -ltn 2>/dev/null | grep -q '0.0.0.0:3001' && echo "WARNING: freellmapi is listening on all interfaces; check HOST_BIND"
  configure_freellmapi
  return 0
}

# First-run setup without a person: claim the dashboard (from inside the container, which counts as "this machine"), add the
# providers that need no key, and copy the unified key into Agentify's server/.env. The dashboard login is kept in a root-only
# file on the server (/opt/freellmapi/dashboard-login.txt), never in the deploy log. Safe to run again: it only fills what is missing.
configure_freellmapi() {
  local dir=/opt/freellmapi login="$dir/dashboard-login.txt" envf="$APP_DIR/server/.env"
  for i in $(seq 1 30); do curl -fsS --max-time 4 http://127.0.0.1:3001/api/ping >/dev/null 2>&1 && break; sleep 3; done
  if [ ! -f "$login" ]; then
    umask 077
    printf 'email=admin@agentify.local\npassword=%s\n' "$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)" > "$login"
  fi
  local email pass
  email="$(sed -n 's/^email=//p' "$login")"; pass="$(sed -n 's/^password=//p' "$login")"
  local key
  key="$(cd "$dir" && docker compose exec -T -e FL_EMAIL="$email" -e FL_PASS="$pass" freellmapi node -e '
    const B = "http://127.0.0.1:3001", j = (r) => r.json().catch(() => ({}));
    const post = (p, b, t) => fetch(B + p, { method: "POST", headers: { "Content-Type": "application/json", ...(t ? { Authorization: "Bearer " + t } : {}) }, body: JSON.stringify(b) });
    (async () => {
      const st = await j(await fetch(B + "/api/auth/status"));
      console.error("status", JSON.stringify({ needsSetup: st.needsSetup }));
      const body = { email: process.env.FL_EMAIL, password: process.env.FL_PASS };
      const s = await j(await post(st.needsSetup ? "/api/auth/setup" : "/api/auth/login", body));
      if (!s.token) { console.error("freellmapi: could not sign in to the dashboard: " + String(s?.error?.message || "").slice(0, 120)); process.exit(2); }
      for (const platform of ["kilo", "ovh", "aihorde"]) { await post("/api/keys", { platform, label: "keyless (added by Agentify deploy)" }, s.token).catch(() => {}); }
      const k = await j(await fetch(B + "/api/settings/api-key", { headers: { Authorization: "Bearer " + s.token } }));
      if (!k.apiKey) { console.error("freellmapi: no unified key"); process.exit(3); }
      process.stdout.write(k.apiKey);
    })().catch((e) => { console.error("freellmapi:", e.message); process.exit(1); });
  ' 2>"$dir/.setup-err")" || { echo "freellmapi: automatic setup did not finish (Agentify keeps working without it): $(tr -d '\r' < "$dir/.setup-err" | tail -3 | cut -c1-200)"; docker ps -a --filter name=freellmapi --format 'freellmapi container: {{.Status}}'; (cd "$dir" && docker compose logs --tail 8 freellmapi 2>&1 | grep -v -i 'setup code\|code:' | cut -c1-200 | sed 's/^/freellmapi log: /') || true; curl -sS -o /dev/null -w 'freellmapi ping from host: %{http_code}\n' --max-time 5 http://127.0.0.1:3001/api/ping || true; return 0; }
  [ -n "$key" ] || return 0
  [ -f "$envf" ] || return 0
  # set our three values, keep everything else in server/.env as it is
  { grep -v -E '^FREELLMAPI_(API_KEY|BASE_URL|ENABLED)=' "$envf" || true
    printf 'FREELLMAPI_API_KEY=%s\nFREELLMAPI_BASE_URL=http://127.0.0.1:3001/v1\nFREELLMAPI_ENABLED=1\n' "$key"; } > "$envf.tmp"
  chmod 600 "$envf.tmp" && mv "$envf.tmp" "$envf"
  echo "freellmapi configured: keyless providers added, unified key written to server/.env (key not shown)"
}
( install_freellmapi ) || echo "freellmapi install skipped or failed (deploy continues): see docs/freellmapi-setup.md"

echo "bootstrap ok"
