#!/usr/bin/env bash
# Sifou Phone — one-command installer for a fresh Ubuntu/Debian VPS.
#
#   curl -fsSL https://raw.githubusercontent.com/sifou-phone/Store/claude/brave-clarke-0wubdq/deploy/install.sh | sudo bash
#   curl -fsSL .../deploy/install.sh | sudo bash -s -- sifouphone.com     # with your own domain (HTTPS)
#
# Run it again at any time to update the store to the latest code. Data is kept.
set -euo pipefail

DOMAIN="${1:-}"
REPO="${REPO:-https://github.com/sifou-phone/Store.git}"
BRANCH="${BRANCH:-claude/brave-clarke-0wubdq}"
APP_DIR=/opt/sifou-store
DATA_DIR=/var/lib/sifou-store
ENV_FILE=/etc/sifou-store.env
APP_USER=sifou
SERVICE=sifou-store

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: curl ... | sudo bash" >&2
  exit 1
fi
export DEBIAN_FRONTEND=noninteractive

say "System packages"
apt-get update -y
apt-get install -y curl git ca-certificates gnupg sqlite3 openssl debian-keyring debian-archive-keyring apt-transport-https

# Small VPS plans have little RAM; a swap file keeps npm from running out of memory.
if ! swapon --show | grep -q . && [ ! -f /swapfile ]; then
  say "Adding 1 GB swap"
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! node -v 2>/dev/null | grep -qE '^v(2[2-9]|[3-9][0-9])\.'; then
  say "Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"

say "Store code ($BRANCH)"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$APP_DIR" reset --hard FETCH_HEAD
else
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
(cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund)
mkdir -p "$DATA_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR"

NEW_PASSWORD=""
if [ ! -f "$ENV_FILE" ]; then
  NEW_PASSWORD="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 14)"
  cat > "$ENV_FILE" <<ENV
PORT=3000
HOST=127.0.0.1
DATA_DIR=$DATA_DIR
ADMIN_PASSWORD=$NEW_PASSWORD
ENV
  chmod 600 "$ENV_FILE"
fi

say "Service"
cat > "/etc/systemd/system/$SERVICE.service" <<UNIT
[Unit]
Description=Sifou Phone store
After=network.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"

say "Web server (Caddy)"
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi
if [ -n "$DOMAIN" ]; then
  SITE="$DOMAIN, www.$DOMAIN"
elif [ -f /etc/caddy/.sifou-site ]; then
  SITE="$(cat /etc/caddy/.sifou-site)"   # keep the domain from a previous install
else
  SITE=":80"
fi
echo "$SITE" > /etc/caddy/.sifou-site
cat > /etc/caddy/Caddyfile <<CADDY
$SITE {
	encode gzip
	request_body {
		max_size 60MB
	}
	reverse_proxy 127.0.0.1:3000
}
CADDY
systemctl enable caddy >/dev/null
systemctl reload caddy 2>/dev/null || systemctl restart caddy

say "Daily backups"
cat > /etc/cron.daily/sifou-store-backup <<'BACKUP'
#!/bin/sh
# Keeps 14 days of database + photo backups in /var/backups/sifou-store
set -e
DEST=/var/backups/sifou-store
STAMP=$(date +%Y-%m-%d)
mkdir -p "$DEST"
sqlite3 /var/lib/sifou-store/store.db ".backup '$DEST/store-$STAMP.db'"
tar -czf "$DEST/uploads-$STAMP.tar.gz" -C /var/lib/sifou-store uploads
find "$DEST" -type f -mtime +14 -delete
BACKUP
chmod 755 /etc/cron.daily/sifou-store-backup

sleep 2
if systemctl is-active --quiet "$SERVICE" && curl -fsS -o /dev/null http://127.0.0.1:3000/; then
  STATUS="running"
else
  STATUS="NOT running — check: journalctl -u $SERVICE -n 50"
fi
IP="$(curl -fsS -4 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
URL="http://$IP"
[ "$SITE" != ":80" ] && URL="https://${SITE%%,*}"

cat <<DONE

============================================================
  Sifou Phone store: $STATUS
  Store:      $URL
  Dashboard:  $URL/admin
DONE
if [ -n "$NEW_PASSWORD" ]; then
  echo "  Password:   $NEW_PASSWORD      (write it down, then change it in Settings)"
fi
cat <<DONE
  Update:     run the same install command again
  Backups:    /var/backups/sifou-store (daily, 14 days)
============================================================
DONE
