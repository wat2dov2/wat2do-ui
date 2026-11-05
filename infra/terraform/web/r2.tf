# Media (uploads, ingested posters and their thumbnails, videos, logos) lives in
# Cloudflare R2, which charges nothing for bandwidth, behind Cloudflare's cache
# at media.wat2do.io. Keys are <bucket>/<file>; every object carries its own
# Cache-Control (immutable) from the API that wrote it.
locals {
  cloudflare_account_id = "01f4dc27fe12aec220b0e79cb83b02df"
  media_host            = trimprefix(local.image_delivery.media_origin, "https://")
}

resource "cloudflare_r2_bucket" "media" {
  account_id = local.cloudflare_account_id
  name       = "wat2do-media"
  location   = "enam"
}

resource "cloudflare_r2_custom_domain" "media" {
  account_id  = local.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.media.name
  domain      = local.media_host
  zone_id     = var.cloudflare_zone_id
  enabled     = true
  min_tls     = "1.2"
}

# Edge locations ask a nearby upper tier before R2, so a file is fetched from R2
# about once, not once per location.
resource "cloudflare_tiered_cache" "zone" {
  zone_id = var.cloudflare_zone_id
  value   = "on"
}
