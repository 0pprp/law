#!/usr/bin/env bash
# Deploy lawyer API beside Next on the VPS
set -euo pipefail
APP_DIR="${APP_DIR:-/var/www/qalat-aldhaman/apps/lawyer-api}"
cd "$APP_DIR"
dotnet publish -c Release -o /var/www/qalat-lawyer-api
sudo systemctl restart qalat-lawyer-api || true
echo "Published to /var/www/qalat-lawyer-api"
