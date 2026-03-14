#!/usr/bin/env bash
# Verify QR resolve endpoints. Usage: ./scripts/verify_qr_endpoints.sh [BASE_URL] [POSTER_ID]
# Default: BASE_URL=http://localhost:8000, POSTER_ID from list_posters.py output
set -e
BASE_URL="${1:-http://localhost:8000}"
POSTER_ID="${2:-}"
if [ -z "$POSTER_ID" ]; then
  echo "Usage: $0 [BASE_URL] [POSTER_ID]"
  echo "Getting poster ID from database..."
  POSTER_ID=$(cd "$(dirname "$0")/.." && python scripts/list_posters.py | head -1 | cut -f1)
  if [ -z "$POSTER_ID" ]; then
    echo "No poster in DB. Create one from the app (Marketing or Generate QR Assets), then run again."
    exit 1
  fi
  echo "Using poster ID: $POSTER_ID"
fi

echo "=== 1. GET /qr/{id} without lat/lon (inactive poster → 202 requires_location) ==="
STATUS=$(curl -s -o /tmp/qr_resp_1.json -w "%{http_code}" "$BASE_URL/qr/$POSTER_ID")
echo "HTTP $STATUS"
cat /tmp/qr_resp_1.json | head -c 200
echo ""

echo ""
echo "=== 2. GET /qr/{id}?lat=43.47&lon=-80.54 (first scan → 200 + activate poster) ==="
STATUS=$(curl -s -o /tmp/qr_resp_2.json -w "%{http_code}" "$BASE_URL/qr/$POSTER_ID?lat=43.47&lon=-80.54")
echo "HTTP $STATUS"
cat /tmp/qr_resp_2.json | head -c 200
echo ""

echo ""
echo "=== 3. GET /qr/{id} again (active poster → 200, no lat/lon needed) ==="
STATUS=$(curl -s -o /tmp/qr_resp_3.json -w "%{http_code}" "$BASE_URL/qr/$POSTER_ID")
echo "HTTP $STATUS"
cat /tmp/qr_resp_3.json | head -c 200
echo ""

echo ""
echo "=== 4. List posters (confirm is_active=True) ==="
cd "$(dirname "$0")/.." && python scripts/list_posters.py
