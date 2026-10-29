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
for k in S3_ENDPOINT S3_REGION S3_BUCKET S3_ACCESS_KEY S3_SECRET_KEY; do
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
echo "bootstrap ok"
