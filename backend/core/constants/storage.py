"""Supabase storage bucket and upload limit constants."""

BUCKET_EVENT_IMAGES = "event-images"
BUCKET_AVATARS = "avatars"
BUCKET_CLUB_LOGOS = "club-logos"
BUCKET_QR_ASSETS = "qr-assets"

# Keep these in sync with supabase/migrations bucket file_size_limit values.
MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024
MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024
