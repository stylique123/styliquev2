#!/usr/bin/env bash
# Stylique live test setup for the Stylee store.
# Run this once (from the repo root) before starting the dev stack.
#
# Prerequisites:
#   - .env exists at the repo root with the vars listed below
#   - Postgres + Redis are running (pnpm infra:up)
#   - Cloudflare tunnel is running and its URL is in .env as SHOPIFY_APP_URL
#
# Usage:
#   bash scripts/setup-live-test.sh

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

echo "=== Stylique Live Test Setup (Stylee store) ==="
echo ""

# ── Load .env so check_env can read it ────────────────────────────────────
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC2046
  export $(grep -v '^#' "$ENV_FILE" | grep -v '^[[:space:]]*$' | xargs)
else
  echo "⚠️  No .env found at $REPO_ROOT — creating one from template..."
  if [ -f "$REPO_ROOT/apps/shopify-app/.env.stylee-template" ]; then
    cp "$REPO_ROOT/apps/shopify-app/.env.stylee-template" "$ENV_FILE"
    echo "   Copied .env.stylee-template → .env"
    echo "   Fill in the placeholder values and re-run this script."
    exit 1
  fi
fi

# ── Required env var checker ───────────────────────────────────────────────
MISSING=0

check_env() {
  local var="$1"
  local hint="${2:-}"
  if [ -z "${!var}" ]; then
    echo "❌ Missing required env var: $var${hint:+ — $hint}"
    MISSING=1
  else
    echo "✅ $var is set"
  fi
}

warn_env() {
  local var="$1"
  local hint="${2:-}"
  if [ -z "${!var}" ]; then
    echo "⚠️  Optional (feature degraded without): $var${hint:+ — $hint}"
  else
    echo "✅ $var is set"
  fi
}

echo "── Required ──────────────────────────────────────────────────────"
check_env SHOPIFY_API_KEY      "copy client_id from apps/shopify-app/shopify.app.toml"
check_env SHOPIFY_API_SECRET   "Partners dashboard → your app → Client credentials → reveal"
check_env GEMINI_API_KEY       "https://aistudio.google.com/app/apikey"
check_env DATABASE_URL         "postgres://stylique:stylique@localhost:5432/stylique"

echo ""
echo "── Optional ──────────────────────────────────────────────────────"
warn_env REDIS_URL             "redis://localhost:6379 — queues and rate-limiting"
warn_env RESEND_API_KEY        "OTP emails will fall back to console.log"
warn_env REPLICATE_API_TOKEN   "VTO render disabled without this"
warn_env APP_ENCRYPTION_KEY    "run: openssl rand -hex 32"

if [ "$MISSING" = "1" ]; then
  echo ""
  echo "Fix the missing required vars in $ENV_FILE, then re-run this script."
  exit 1
fi

# ── App proxy subpath verification ────────────────────────────────────────
echo ""
echo "── Verifying app proxy config ────────────────────────────────────"
TOML="$REPO_ROOT/apps/shopify-app/shopify.app.toml"
if [ -f "$TOML" ]; then
  SUBPATH=$(grep -E '^subpath' "$TOML" | sed 's/.*= *"//' | tr -d '"')
  PREFIX=$(grep -E '^prefix' "$TOML" | sed 's/.*= *"//' | tr -d '"')
  if [ "$SUBPATH" = "stylique" ]; then
    echo "✅ app_proxy subpath = \"stylique\""
  else
    echo "⚠️  app_proxy subpath is \"$SUBPATH\" — expected \"stylique\""
    echo "   Update [app_proxy] subpath in shopify.app.toml"
  fi
  if [ "$PREFIX" = "apps" ]; then
    echo "✅ app_proxy prefix  = \"apps\""
  else
    echo "⚠️  app_proxy prefix is \"$PREFIX\" — expected \"apps\""
  fi
  # Confirm proxy URL points at the /proxy/shopper route
  PROXY_URL=$(grep -E '^url' "$TOML" | head -1 | sed 's/.*= *"//' | tr -d '"')
  if echo "$PROXY_URL" | grep -q '/proxy/shopper'; then
    echo "✅ app_proxy url ends with /proxy/shopper"
  else
    echo "⚠️  app_proxy url ($PROXY_URL) does not end with /proxy/shopper"
    echo "   Expected: https://<tunnel>/proxy/shopper"
  fi
else
  echo "⚠️  shopify.app.toml not found — skipping proxy verification"
fi

# ── Proxy route endpoint check ─────────────────────────────────────────────
echo ""
echo "── Verifying proxy route endpoints ──────────────────────────────"
PROXY_ROUTE="$REPO_ROOT/apps/shopify-app/app/routes/proxy.shopper.\$.tsx"
EXPECTED_PATHS=(
  "api/product"
  "api/entitlement"
  "api/shopper/me"
  "api/chat"
  "api/chat/stream"
  "api/tryon/render"
  "api/fit"
  "api/style"
  "api/events"
)
if [ -f "$PROXY_ROUTE" ]; then
  for path in "${EXPECTED_PATHS[@]}"; do
    if grep -q "\"$path\"" "$PROXY_ROUTE"; then
      echo "✅ proxy handles: $path"
    else
      echo "⚠️  proxy route missing case for: $path"
    fi
  done
else
  echo "⚠️  proxy.shopper.\$.tsx not found — cannot verify endpoints"
fi

# ── DB migration ───────────────────────────────────────────────────────────
echo ""
echo "=== Running DB migration ==="
pnpm --filter @stylique/db exec prisma migrate deploy

# ── Seed dev data ──────────────────────────────────────────────────────────
echo ""
echo "=== Seeding dev data ==="
pnpm db:seed

# ── Build worker ───────────────────────────────────────────────────────────
echo ""
echo "=== Building worker ==="
pnpm --filter @stylique/worker build

# ── Done ───────────────────────────────────────────────────────────────────
echo ""
echo "✅ Setup complete!"
echo ""
echo "Start the full dev stack:"
echo "  Terminal 1: pnpm worker:dev"
echo "  Terminal 2: pnpm shopify:app-server"
echo "  Terminal 3: pnpm shopify:tunnel"
echo "  Terminal 4: pnpm shopify:dev"
echo ""
echo "  (or shortcut: pnpm shopify:smoke)"
echo ""
echo "Install on the Stylee store when Shopify CLI prompts you."
echo "Then run the smoke test (with the app running):"
echo "  BASE_URL=https://<your-tunnel>.trycloudflare.com pnpm tsx scripts/smoke-test.ts"
