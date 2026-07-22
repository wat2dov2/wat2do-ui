locals {
  name_prefix = "wat2do-production"
  common_tags = {
    Application = "wat2do"
    Environment = "production"
    ManagedBy   = "terraform"
  }

  availability_zones = slice(data.aws_availability_zones.available.names, 0, 2)

  frontend_runtime_environment = {
    NODE_ENV        = "production"
    PORT            = "3000"
    HOSTNAME        = "0.0.0.0"
    BACKEND_API_URL = "http://127.0.0.1:8000"
  }

  backend_runtime_environment = {
    ENVIRONMENT                     = "production"
    CORS_ORIGINS                    = jsonencode(["https://${var.domain_name}", "https://www.${var.domain_name}"])
    COOKIE_DOMAIN                   = ".${var.domain_name}"
    COOKIE_SECURE                   = "true"
    REFRESH_COOKIE_PATH             = "/api/auth/refresh"
    FRONTEND_URL                    = "https://${var.domain_name}"
    EVENT_FEED_REVALIDATION_URL     = "http://127.0.0.1:3000/api/revalidate-events"
    EVENT_FEED_REVALIDATION_TIMEOUT = "3"
    EMAIL_PROVIDER                  = "resend"
    EMAIL_FROM                      = var.email_from
  }

  # A standalone job task has no colocated frontend container. Its authenticated
  # invalidations intentionally use the public API behavior, which CloudFront
  # forwards without caching.
  backend_jobs_environment = merge(local.backend_runtime_environment, {
    EVENT_FEED_REVALIDATION_URL = "https://${var.domain_name}/api/revalidate-events"
  })

  runtime_secret_keys = [
    "SUPABASE_URL",
    "SUPABASE_KEY",
    "SUPABASE_SECRET_KEY",
    "DATABASE_URL",
    "OPENAI_API_KEY",
    "APIFY_API_TOKEN",
    "EMAIL_PROVIDER_API_KEY",
    "EVENT_FEED_REVALIDATION_SECRET",
  ]

  runtime_secret_references = [
    for key in local.runtime_secret_keys : {
      name      = key
      valueFrom = "${var.runtime_secret_arn}:${key}::"
    }
  ]
}
