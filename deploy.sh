#!/usr/bin/env bash
#
# deploy.sh — One-command deploy for the bim-assistant SPA (Palo Alto-safe).
#
# Flow: build dist/ locally -> aws s3 sync to salfa-bim-agent-01 -> CloudFront invalidation
# No CI, no GitHub webhooks, no outbound integration — survives corporate proxy.
#
# Usage:
#   ./deploy.sh            # full deploy (build + sync + invalidate)
#   ./deploy.sh --skip-build   # only sync existing dist/ (fast iteration)
#   ./deploy.sh --no-invalidate # skip CloudFront cache clear
#
# Prereqs: aws CLI authed as marvin-deploy (default profile), node/npm installed
set -euo pipefail

BUCKET="salfa-bim-agent-01"
DIST_ID="ENV7WSFW9JE83"
URL="https://d2uqdooorn7smq.cloudfront.net"
REGION="us-east-1"

SKIP_BUILD=0
NO_INVALIDATE=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --no-invalidate) NO_INVALIDATE=1 ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

echo "=== Who am I? ==="
aws sts get-caller-identity --output text 2>&1 | awk '{print "  ", $1, "-", $2}'

if [ "$SKIP_BUILD" -eq 0 ]; then
  echo "=== Build dist/ ==="
  npm run build
else
  echo "=== Skipping build (using existing dist/) ==="
fi

test -d dist || { echo "ERROR: dist/ not found — run without --skip-build first"; exit 1; }

echo "=== Sync to s3://$BUCKET ==="
aws s3 sync dist/ "s3://$BUCKET" --delete \
  --region "$REGION" \
  --cache-control "public, max-age=31536000, immutable" \
  --exclude "index.html" \
  --exclude "*.html"

# index.html (and any non-hashed html) must revalidate often for SPA updates
aws s3 sync dist/ "s3://$BUCKET" --delete \
  --region "$REGION" \
  --cache-control "no-cache" \
  --include "*.html"

echo "=== Invalidate CloudFront cache ($DIST_ID) ==="
if [ "$NO_INVALIDATE" -eq 0 ]; then
  INV_ID=$(aws cloudfront create-invalidation \
    --distribution-id "$DIST_ID" \
    --paths "/*" \
    --query 'Invalidation.Id' --output text)
  echo "  Invalidation $INV_ID created — edge caches clear in ~1-2 min"
else
  echo "  Skipped (--no-invalidate)"
fi

echo ""
echo "=== DONE — live at $URL ==="
echo "  (Allow ~1-2 min for cache purge to reach all edges)"
