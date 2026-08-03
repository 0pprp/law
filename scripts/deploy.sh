#!/bin/bash
# Build on the host, then restart the container (no in-container npm install/build).
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/qalat-aldhaman}"
COMPOSE_DIR="${COMPOSE_DIR:-/root}"
SERVICE_NAME="${SERVICE_NAME:-qalatlaw}"

cd "$APP_DIR"

echo "==> Syncing code..."
git fetch origin
git reset --hard origin/main
git clean -fd

echo "==> Installing dependencies..."
npm ci --production=false

echo "==> Building Next.js (standalone)..."
npm run build

# Standalone needs static + public beside server.js
mkdir -p .next/standalone/.next
rm -rf .next/standalone/.next/static
cp -a .next/static .next/standalone/.next/static
rm -rf .next/standalone/public
cp -a public .next/standalone/public

echo "==> Restarting container (no rebuild)..."
cd "$COMPOSE_DIR"
if docker compose restart "$SERVICE_NAME" 2>/dev/null; then
  :
elif command -v docker-compose >/dev/null 2>&1; then
  docker-compose restart "$SERVICE_NAME"
else
  echo "ERROR: docker compose not found in $COMPOSE_DIR"
  exit 1
fi

echo "==> Deploy complete."
