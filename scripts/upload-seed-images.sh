#!/bin/bash
# Upload seed images to Supabase Storage buckets via CLI.
# Requires: supabase link (run from project root: supabase link --project-ref <ref>)
# Run: ./scripts/upload-seed-images.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEED_DIR="${SCRIPT_DIR}/seed-images"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

mkdir -p "$SEED_DIR"
cd "$SEED_DIR"

# Download placeholder images if not present
if [ ! -f "event1.jpg" ]; then
  echo "Downloading placeholder images..."
  curl -sL "https://picsum.photos/800/600" -o event1.jpg
  curl -sL "https://picsum.photos/800/600?random=2" -o event2.jpg
  curl -sL "https://picsum.photos/400/400" -o avatar1.jpg
  curl -sL "https://picsum.photos/200/200" -o logo1.png
fi

cd "$PROJECT_ROOT"

# Check if supabase is linked
if ! supabase status 2>/dev/null | head -1 | grep -q "Linked"; then
  echo "Run: supabase link --project-ref vgfwgjwahedyieaknkcd"
  exit 1
fi

echo "Uploading to event-images..."
supabase storage cp "${SEED_DIR}/event1.jpg" "ss:///event-images/seed-event1.jpg" --content-type "image/jpeg" 2>/dev/null || true
supabase storage cp "${SEED_DIR}/event2.jpg" "ss:///event-images/seed-event2.jpg" --content-type "image/jpeg" 2>/dev/null || true

echo "Uploading to avatars..."
supabase storage cp "${SEED_DIR}/avatar1.jpg" "ss:///avatars/seed-avatar1.jpg" --content-type "image/jpeg" 2>/dev/null || true

echo "Uploading to club-logos..."
supabase storage cp "${SEED_DIR}/logo1.png" "ss:///club-logos/seed-logo1.png" --content-type "image/png" 2>/dev/null || true

echo "Uploading to qr-assets..."
supabase storage cp "${SEED_DIR}/event1.jpg" "ss:///qr-assets/seed-poster1.jpg" --content-type "image/jpeg" 2>/dev/null || true

echo "Done. Seed images uploaded to Supabase Storage."
