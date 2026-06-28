#!/usr/bin/env bash
# Run on Hostinger VPS as root (Ubuntu/Debian)
# Usage: bash vps-setup.sh

set -euo pipefail

APP_DIR="/var/www/qalat-law"
APP_NAME="qalat-law"
NODE_MAJOR=20

echo "==> Installing system packages..."
apt-get update -qq
apt-get install -y -qq curl git nginx certbot python3-certbot-nginx

if ! command -v node &>/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt "$NODE_MAJOR" ]]; then
  echo "==> Installing Node.js ${NODE_MAJOR}..."
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -
  apt-get install -y -qq nodejs
fi

npm install -g pm2

mkdir -p "$APP_DIR"
chown -R "${SUDO_USER:-root}:www-data" "$APP_DIR" 2>/dev/null || true

if [[ ! -f "$APP_DIR/package.json" ]]; then
  echo ""
  echo "Project not found in $APP_DIR"
  echo "Upload or clone the repo first, e.g.:"
  echo "  git clone <your-repo-url> $APP_DIR"
  echo "Then create $APP_DIR/.env.local with Supabase keys and re-run this script."
  exit 1
fi

if [[ ! -f "$APP_DIR/.env.local" ]]; then
  echo "ERROR: Create $APP_DIR/.env.local first (Supabase keys)."
  exit 1
fi

cd "$APP_DIR"
echo "==> Installing dependencies..."
npm ci

echo "==> Building Next.js (standalone)..."
npm run build

echo "==> Starting with PM2..."
pm2 delete "$APP_NAME" 2>/dev/null || true
pm2 start npm --name "$APP_NAME" -- start
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo ""
echo "==> Done. App should run on http://127.0.0.1:3000"
echo "Configure nginx reverse proxy + SSL next (see scripts/nginx-qalat.conf.example)."
