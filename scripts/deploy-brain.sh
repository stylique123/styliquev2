#!/usr/bin/env bash
# P1 — Deploy the repaired Mira brain when Railway auth is renewed.
#
# Founder directive: "Railway authentication currently needs renewal, so
# production still runs older behavior." This script is staged so the deploy
# is one command once you've run `railway login` against the renewed token.
#
# What it ships:
#   - apps/web         → stylique-web service (the canonical brain at /api/mira)
#   - apps/shopify-app → stylique-app service (the App-Proxy adapter)
#   - apps/worker      → stylique-worker service (catalog-sync, size-chart-extract)
#
# Pre-flight: this script REFUSES to run if there are uncommitted changes,
# typecheck is dirty, or HEAD isn't pushed — those are the three things that
# silently kill a Railway deploy (stale code, broken build, wrong commit
# rolled forward).
#
# Usage:
#   ./scripts/deploy-brain.sh
#   ./scripts/deploy-brain.sh --service stylique-web   # one-service mode

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SERVICE="${SERVICE:-all}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --service) SERVICE="$2"; shift 2 ;;
    *) echo "unknown arg: $1"; exit 1 ;;
  esac
done

echo "── Pre-flight ──"
if ! command -v railway >/dev/null; then
  echo "✗ railway CLI not installed. brew install railway / npm i -g @railway/cli"; exit 1
fi
if ! railway whoami >/dev/null 2>&1; then
  echo "✗ Railway auth expired or missing. Run: railway login"; exit 1
fi
if ! git diff --quiet HEAD; then
  echo "✗ Uncommitted changes. Commit or stash before deploy."; exit 1
fi
if ! git diff --cached --quiet; then
  echo "✗ Staged changes uncommitted. Commit before deploy."; exit 1
fi
HEAD_REMOTE="$(git rev-parse "@{u}" 2>/dev/null || echo "")"
HEAD_LOCAL="$(git rev-parse HEAD)"
if [[ -n "$HEAD_REMOTE" && "$HEAD_REMOTE" != "$HEAD_LOCAL" ]]; then
  echo "✗ HEAD not pushed. Run: git push"; exit 1
fi
echo "  HEAD: $(git log --oneline -1)"
echo
echo "── Typecheck ──"
pnpm -r typecheck
echo
echo "── Deploy (Railway) ──"
deploy_one() {
  local svc="$1"
  echo "→ ${svc}"
  railway up --service "${svc}" --detach
}
case "$SERVICE" in
  all)
    deploy_one stylique-web
    deploy_one stylique-app
    deploy_one stylique-worker
    ;;
  stylique-web|stylique-app|stylique-worker)
    deploy_one "$SERVICE"
    ;;
  *) echo "unknown --service: $SERVICE"; exit 1 ;;
esac
echo
echo "✓ Deploy(s) queued. Watch in the Railway dashboard."
echo
echo "── POST-DEPLOY CHECKLIST ──"
echo "1. Verify model env on Railway:"
echo "     railway variables --service stylique-web | grep MIRA_MODEL"
echo "   Founder pilot finding: production was running gemini-2.5-pro and reading"
echo "   materially worse than local Flash+fallback (6.36s latency, weak climate"
echo "   recognition). Code defaults are gemini-2.5-flash; if MIRA_MODEL is set to"
echo "   gemini-2.5-pro on Railway, UNSET it (or set it to gemini-2.5-flash):"
echo "     railway variables --service stylique-web --remove MIRA_MODEL"
echo
echo "2. Smoke the brain (try-on regression — Mira bug A):"
echo "     curl -s https://stylique-web.up.railway.app/api/mira -X POST \\"
echo "       -H 'content-type: application/json' \\"
echo "       -d '{\"message\":\"can I see it on me before I buy?\"}' | jq '.decision.route'"
echo "   expected: \"try_on\""
echo
echo "3. Smoke the conversion proxy (founder panel finding — was 404):"
echo "     curl -s https://stylique-web.up.railway.app/api/mira/conversion -X POST \\"
echo "       -H 'content-type: application/json' \\"
echo "       -d '{\"productHandle\":\"wrap-coat-camel\"}' | jq '.ok'"
echo "   expected: true (independent verify that the upstream endpoint exists;"
echo "   the App-Proxy case is now wired in proxy.shopper.\$.tsx for the storefront)."
echo
echo "4. Watch Gemini 429 quota for ~15 min — founder panel showed local 429 spikes."
echo "   If you see them in production logs, raise the Gemini project quota or"
echo "   route to a second project via MIRA_FALLBACK_MODEL."
