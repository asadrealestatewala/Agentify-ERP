#!/usr/bin/env bash
# Gives every workspace address (<name>.<domain>) its own https certificate automatically.
#
# Needs one thing from you: a wildcard DNS record  *.<domain>  pointing at this server. Until that record exists this script
# only prints what to add and changes nothing. Once it resolves, nginx is replaced by Caddy, which asks the app
# (/api/platform/domain-check) before it requests a certificate, so only real workspaces get one. If Caddy does not come up
# healthy, nginx is started again and the site is left as it was.
set -uo pipefail

DOMAIN="${1:-agentifyerp.co}"
export DEBIAN_FRONTEND=noninteractive
have() { command -v "$1" >/dev/null 2>&1; }

# The base domain normally comes from the ERP_BASE_DOMAIN secret. When that secret was never added the deploy would
# print "single-company mode" and skip certificates forever, even though the running application is multi-tenant.
# Ask the app what its base domain is, so a missing secret cannot silently disable this step.
if [ -z "${ERP_BASE_DOMAIN:-}" ] && have curl; then
  # /api/platform/site only reports base_domain when the request uses the platform host name, so send it
  from_app="$(curl -fsS -m 10 -H "Host: $DOMAIN" http://127.0.0.1:4000/api/platform/site 2>/dev/null \
    | tr -d '\n' | sed -n 's/.*"base_domain"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
  if [ -n "$from_app" ]; then
    echo "tls: ERP_BASE_DOMAIN is not set for this deploy; taking the base domain from the running app: $from_app"
    ERP_BASE_DOMAIN="$from_app"
  fi
fi

if [ -z "${ERP_BASE_DOMAIN:-}" ]; then echo "tls: single-company mode, nothing to do"; exit 0; fi
if [ "${TLS_PROXY:-auto}" = "nginx" ]; then echo "tls: TLS_PROXY=nginx, leaving nginx in charge"; exit 0; fi

probe="wildcard-probe-$RANDOM.$DOMAIN"
main_ip="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}')"
probe_ip="$(getent ahostsv4 "$probe" | awk 'NR==1{print $1}')"
if [ -z "$probe_ip" ] || [ "$probe_ip" != "$main_ip" ]; then
  echo "tls: WILDCARD DNS IS MISSING. Workspace addresses such as https://acme.$DOMAIN cannot open until it exists."
  echo "tls: At the company that manages the DNS for $DOMAIN add an A record:  name  *.$DOMAIN  (or just * for the zone $DOMAIN)  value  ${main_ip:-the server IP}"
  echo "tls: Then run the Deploy workflow again; this step sets up the certificates by itself."
  exit 0
fi
echo "tls: wildcard DNS resolves ($probe -> $probe_ip)"

if systemctl is-active --quiet caddy && grep -q "domain-check" /etc/caddy/Caddyfile 2>/dev/null; then
  echo "tls: Caddy is already serving certificates for workspaces"
  exit 0
fi

if ! have caddy; then
  echo "tls: installing Caddy"
  apt-get update -y -qq
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y -qq
  apt-get install -y -qq caddy || { echo "tls: could not install Caddy; nginx is unchanged"; exit 0; }
fi

mkdir -p /etc/caddy
[ -f /etc/caddy/Caddyfile ] && cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-$(date +%s)"
cat > /etc/caddy/Caddyfile <<CADDYFILE
{
	on_demand_tls {
		ask http://127.0.0.1:4000/api/platform/domain-check
	}
}

$DOMAIN {
	request_body {
		max_size 50MB
	}
	reverse_proxy 127.0.0.1:4000
}

https:// {
	tls {
		on_demand
	}
	request_body {
		max_size 50MB
	}
	reverse_proxy 127.0.0.1:4000
}
CADDYFILE

if ! caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
  echo "tls: the Caddy configuration did not validate; nginx is unchanged"
  exit 0
fi

echo "tls: switching from nginx to Caddy"
nginx_was_active=0
if systemctl is-active --quiet nginx; then nginx_was_active=1; systemctl stop nginx; fi
systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy

ok=0
for _ in $(seq 1 12); do
  sleep 5
  if curl -fsS -m 10 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/health" >/dev/null 2>&1; then ok=1; break; fi
done

if [ "$ok" = "1" ]; then
  systemctl disable nginx >/dev/null 2>&1 || true
  echo "tls: Caddy is serving https://$DOMAIN and will issue a certificate for each new workspace when it is first opened"
else
  echo "tls: Caddy did not come up healthy within a minute; putting nginx back"
  systemctl stop caddy || true
  if [ "$nginx_was_active" = "1" ]; then systemctl start nginx || true; fi
  journalctl -u caddy -n 30 --no-pager 2>/dev/null | sed 's/^/    /' || true
fi
exit 0
