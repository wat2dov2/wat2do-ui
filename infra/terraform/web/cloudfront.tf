# wat2do.io, www and every school subdomain. Paths go to:
#   /media/*             the media bucket
#   /api/* (most)        the API on the Mac mini (api.wat2do.io), with the /api prefix removed
#   /api/discovery, /api/revalidate-events, /api/render-instagram-slide
#                        Next's own routes on the server function
#   /_next/image*        the image optimizer
#   /_next/*, public/    the web bucket's _assets/
#   everything else      the server function

locals {
  public_root = "${path.module}/../../../frontend/public"
  # Each top-level entry of frontend/public: a file, or a folder as "<folder>/*".
  # A new top-level entry needs a terraform apply; deploy.sh refuses to deploy until then.
  public_patterns = sort(distinct([
    for file in fileset(local.public_root, "**") :
    length(split("/", file)) == 1 ? file : "${split("/", file)[0]}/*"
  ]))
  discovery_cache = jsondecode(file("${path.module}/../../../backend/controlbox/discovery_cache.json"))
  next_routes     = ["/api/discovery", "/api/revalidate-events", "/api/render-instagram-slide"]

  server_origin = "server"
  image_origin  = "image"
  assets_origin = "assets"
  media_origin  = "media"
  # Until every file under ~/wat2do-data/media is in the bucket, a file S3 does
  # not have yet comes from the Mac's disk (Caddy's /media/* on api.wat2do.io).
  # Remove this origin, the origin group and Caddy's media block once it is.
  media_on_mac_origin = "media-on-mac"
  media_group         = "media-group"
  api_origin          = "api"
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

# Forwards cookies, query strings and viewer headers, but not Host (a function
# URL and api.wat2do.io each need their own).
data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

data "aws_cloudfront_origin_request_policy" "none" {
  name = "Managed-CORS-S3Origin"
}

# Each school is its own subdomain, and the website resolves it from
# X-Forwarded-Host. The API trusts X-Wat2Do-Viewer-Ip beside the origin secret
# (Caddy on the Mac). CloudFront overwrites both, whatever the visitor sent.
resource "aws_cloudfront_function" "viewer" {
  name    = "wat2do-web-viewer"
  runtime = "cloudfront-js-2.0"
  comment = "Forward the viewer's host and address."
  publish = true
  code    = <<-EOT
    function handler(event) {
      var request = event.request;
      request.headers['x-forwarded-host'] = { value: request.headers.host.value };
      request.headers['x-wat2do-viewer-ip'] = { value: event.viewer.ip };
      return request;
    }
  EOT
}

# The API serves at its root: /api/events on the site is /events on api.wat2do.io.
resource "aws_cloudfront_function" "api" {
  name    = "wat2do-web-api"
  runtime = "cloudfront-js-2.0"
  comment = "Forward the viewer's host and address and drop the /api prefix."
  publish = true
  code    = <<-EOT
    function handler(event) {
      var request = event.request;
      request.headers['x-forwarded-host'] = { value: request.headers.host.value };
      request.headers['x-wat2do-viewer-ip'] = { value: event.viewer.ip };
      request.uri = request.uri.substring(4) || '/';
      return request;
    }
  EOT
}

# Media keys have no media/ prefix.
resource "aws_cloudfront_function" "media" {
  name    = "wat2do-web-media"
  runtime = "cloudfront-js-2.0"
  comment = "Drop the /media prefix."
  publish = true
  code    = <<-EOT
    function handler(event) {
      var request = event.request;
      request.uri = request.uri.substring(6);
      return request;
    }
  EOT
}

# Pages are cached only when Next marks them public (s-maxage); the school host
# and the RSC request headers are part of the key.
resource "aws_cloudfront_cache_policy" "server" {
  name        = "wat2do-web-server"
  min_ttl     = 0
  default_ttl = 0
  max_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "whitelist"
      headers {
        items = [
          "x-forwarded-host",
          "rsc",
          "next-router-prefetch",
          "next-router-segment-prefetch",
          "next-router-state-tree",
          "next-url",
        ]
      }
    }
    query_strings_config {
      query_string_behavior = "all"
    }
  }
}

# Public catalog snapshots are the same for every viewer of a school.
resource "aws_cloudfront_cache_policy" "discovery" {
  name        = "wat2do-web-discovery"
  min_ttl     = 0
  default_ttl = local.discovery_cache.cdn_ttl_seconds
  max_ttl     = local.discovery_cache.cdn_ttl_seconds

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "whitelist"
      query_strings {
        items = ["school", "resource"]
      }
    }
  }
}

resource "aws_cloudfront_cache_policy" "image" {
  name        = "wat2do-web-image"
  min_ttl     = 0
  default_ttl = 86400
  max_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "whitelist"
      headers {
        items = ["accept"]
      }
    }
    query_strings_config {
      query_string_behavior = "all"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "s3" {
  name                              = "wat2do-web-s3"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "web" {
  enabled         = true
  is_ipv6_enabled = true
  http_version    = "http2and3"
  comment         = "wat2do website"
  price_class     = "PriceClass_100"
  aliases         = [var.domain_name, "*.${var.domain_name}"]

  origin {
    origin_id   = local.server_origin
    domain_name = trimsuffix(trimprefix(aws_lambda_function_url.server.function_url, "https://"), "/")
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 60
    }
  }

  origin {
    origin_id   = local.image_origin
    domain_name = trimsuffix(trimprefix(aws_lambda_function_url.image.function_url, "https://"), "/")
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  origin {
    origin_id                = local.assets_origin
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_path              = "/_assets"
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  origin {
    origin_id                = local.media_origin
    domain_name              = aws_s3_bucket.media.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  origin {
    origin_id   = local.media_on_mac_origin
    domain_name = var.api_origin
    origin_path = "/media"
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  origin_group {
    origin_id = local.media_group
    failover_criteria {
      status_codes = [403, 404]
    }
    member {
      origin_id = local.media_origin
    }
    member {
      origin_id = local.media_on_mac_origin
    }
  }

  origin {
    origin_id   = local.api_origin
    domain_name = var.api_origin
    custom_header {
      name  = "X-Wat2Do-Origin-Verify"
      value = var.origin_verify_secret
    }
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 60
    }
  }

  default_cache_behavior {
    target_origin_id         = local.server_origin
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = aws_cloudfront_cache_policy.server.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    compress                 = true
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.viewer.arn
    }
  }

  ordered_cache_behavior {
    path_pattern             = "/media/*"
    target_origin_id         = local.media_group
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_optimized.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.none.id
    compress                 = true
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.media.arn
    }
  }

  ordered_cache_behavior {
    path_pattern             = "/api/discovery"
    target_origin_id         = local.server_origin
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = aws_cloudfront_cache_policy.discovery.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.none.id
    compress                 = true
  }

  dynamic "ordered_cache_behavior" {
    for_each = setsubtract(local.next_routes, ["/api/discovery"])
    content {
      path_pattern             = ordered_cache_behavior.value
      target_origin_id         = local.server_origin
      viewer_protocol_policy   = "redirect-to-https"
      allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
      cached_methods           = ["GET", "HEAD"]
      cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
      origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
      compress                 = true
      function_association {
        event_type   = "viewer-request"
        function_arn = aws_cloudfront_function.viewer.arn
      }
    }
  }

  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = local.api_origin
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    compress                 = true
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.api.arn
    }
  }

  ordered_cache_behavior {
    path_pattern           = "/_next/image*"
    target_origin_id       = local.image_origin
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = aws_cloudfront_cache_policy.image.id
    compress               = true
  }

  ordered_cache_behavior {
    path_pattern             = "/_next/data/*"
    target_origin_id         = local.server_origin
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = aws_cloudfront_cache_policy.server.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    compress                 = true
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.viewer.arn
    }
  }

  dynamic "ordered_cache_behavior" {
    for_each = concat(["/_next/*"], [for pattern in local.public_patterns : "/${pattern}"])
    content {
      path_pattern           = ordered_cache_behavior.value
      target_origin_id       = local.assets_origin
      viewer_protocol_policy = "redirect-to-https"
      allowed_methods        = ["GET", "HEAD", "OPTIONS"]
      cached_methods         = ["GET", "HEAD"]
      cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
      compress               = true
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.web.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}
