variable "domain_name" {
  type    = string
  default = "wat2do.io"
}

variable "cloudflare_zone_id" {
  type    = string
  default = "88ab65a8559126f8e62f8bcd7ad08b85"
}

# The Mac mini's API behind the Cloudflare tunnel (infra/mac-mini/Caddyfile).
variable "api_origin" {
  type    = string
  default = "api.wat2do.io"
}

# Secrets live in ~/wat2do-data/config/web.tfvars on the Mac mini, never in git.

# Same value as ORIGIN_VERIFY_SECRET in ~/wat2do-data/config/caddy.env.
variable "origin_verify_secret" {
  type      = string
  sensitive = true
}

# Same value as the backend's EVENT_FEED_REVALIDATION_SECRET.
variable "event_feed_revalidation_secret" {
  type      = string
  sensitive = true
}

# Same value as the backend's INSTAGRAM_SLIDE_RENDER_SECRET.
variable "instagram_slide_render_secret" {
  type      = string
  sensitive = true
}

variable "budget_alert_email" {
  type    = string
  default = "tonyqiu@wat2do.io"
}
