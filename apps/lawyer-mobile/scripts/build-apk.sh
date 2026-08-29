#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/../.." && pwd)"
cd "$ROOT"

load_env() {
  local f="$1"
  [ -f "$f" ] || return 0
  echo "Loading env: $f"
  set -a
  # shellcheck disable=SC1090
  source "$f"
  set +a
}

load_env "$REPO_ROOT/.env.local"
load_env "$REPO_ROOT/.env"
load_env "$ROOT/.env"

export SUPABASE_URL="${SUPABASE_URL:-${NEXT_PUBLIC_SUPABASE_URL:-}}"
export SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}}"
export API_BASE_URL="${API_BASE_URL:-http://10.0.2.2:5088}"
export NEXT_BASE_URL="${NEXT_BASE_URL:-https://qalatlaw.com}"

if ! command -v flutter >/dev/null 2>&1; then
  if [ -x /c/src/flutter/bin/flutter ]; then
    export PATH="/c/src/flutter/bin:$PATH"
  elif [ -n "${FLUTTER_ROOT:-}" ] && [ -x "$FLUTTER_ROOT/bin/flutter" ]; then
    export PATH="$FLUTTER_ROOT/bin:$PATH"
  fi
fi

if ! command -v flutter >/dev/null 2>&1; then
  echo "Flutter not installed / not in PATH (try C:\\src\\flutter\\bin)"
  exit 1
fi

if [ ! -d android ]; then
  flutter create . --project-name qalat_lawyer_mobile --org com.qalat.lawyer
fi

flutter pub get

: "${SUPABASE_URL:?Missing NEXT_PUBLIC_SUPABASE_URL in .env.local}"
: "${SUPABASE_ANON_KEY:?Missing NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local}"

flutter build apk --release \
  --dart-define=SUPABASE_URL="$SUPABASE_URL" \
  --dart-define=SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
  --dart-define=API_BASE_URL="$API_BASE_URL" \
  --dart-define=NEXT_BASE_URL="$NEXT_BASE_URL"

echo "APK: $ROOT/build/app/outputs/flutter-apk/app-release.apk"
