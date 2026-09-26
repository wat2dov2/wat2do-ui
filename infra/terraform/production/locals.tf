locals {
  name_prefix = "wat2do-production"
  common_tags = {
    Application = "wat2do"
    Environment = "production"
    ManagedBy   = "terraform"
  }

  availability_zones      = slice(data.aws_availability_zones.available.names, 0, 2)
  discovery_cache_control = jsondecode(file("${path.module}/../../../backend/controlbox/discovery_cache.json"))
  image_delivery_control  = jsondecode(file("${path.module}/../../../backend/controlbox/image_delivery.json"))

  frontend_runtime_environment = {
    NODE_ENV                = "production"
    AWS_REGION              = var.aws_region
    STORAGE_BUCKET_NAME     = aws_s3_bucket.assets.id
    PORT                    = "3000"
    HOSTNAME                = "0.0.0.0"
    BACKEND_API_URL         = "http://127.0.0.1:8000"
    STORAGE_PUBLIC_BASE_URL = "https://${var.domain_name}/media"
  }

  backend_runtime_environment = {
    ENVIRONMENT                     = "production"
    CORS_ORIGINS                    = jsonencode(["https://${var.domain_name}", "https://www.${var.domain_name}", "https://wat2do.ca", "https://www.wat2do.ca"])
    CORS_ORIGIN_REGEX               = "^https://[a-z0-9-]+[.]${var.domain_name}$"
    COOKIE_DOMAIN                   = ".${var.domain_name}"
    COOKIE_SECURE                   = "true"
    REFRESH_COOKIE_PATH             = "/api/auth/refresh"
    POSTER_VISITOR_COOKIE_PATH      = "/api/qr"
    FRONTEND_URL                    = "https://${var.domain_name}"
    EVENT_FEED_REVALIDATION_URL     = "http://127.0.0.1:3000/api/revalidate-events"
    EVENT_FEED_REVALIDATION_TIMEOUT = "3"
    INSTAGRAM_SLIDE_RENDER_URL      = "http://127.0.0.1:3000/api/render-instagram-slide"
    EMAIL_PROVIDER                  = "resend"
    EMAIL_FROM                      = var.email_from
    AWS_REGION                      = var.aws_region
    STORAGE_BUCKET_NAME             = aws_s3_bucket.assets.id
    STORAGE_PUBLIC_BASE_URL         = "https://${var.domain_name}/media"
  }

  runtime_secret_keys = [
    "SUPABASE_URL",
    "SUPABASE_KEY",
    "SUPABASE_SECRET_KEY",
    "DATABASE_URL",
    "OPENAI_API_KEY",
    "APIFY_API_TOKEN",
    "INSTAGRAM_TOKEN_ENCRYPTION_KEY",
    "EMAIL_PROVIDER_API_KEY",
    "EMAIL_UNSUBSCRIBE_SECRET",
    "EVENT_FEED_REVALIDATION_SECRET",
    "INSTAGRAM_SLIDE_RENDER_SECRET",
    "POSTER_HASH_SECRET",
    "POSTER_CONFIRMATION_SECRET",
  ]

  runtime_secret_references = [
    for key in local.runtime_secret_keys : {
      name      = key
      valueFrom = "${var.runtime_secret_arn}:${key}::"
    }
  ]
}
