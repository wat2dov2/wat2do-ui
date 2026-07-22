data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

resource "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name    = "wat2do-production-all-viewer-except-host"
  comment = "Forward dynamic requests without forwarding the viewer Host header."

  cookies_config {
    cookie_behavior = "all"
  }

  headers_config {
    header_behavior = "allExcept"

    headers {
      items = ["host"]
    }
  }

  query_strings_config {
    query_string_behavior = "all"
  }
}

resource "aws_cloudfront_origin_request_policy" "none" {
  name    = "wat2do-production-origin-none"
  comment = "Static Next.js assets require no viewer request forwarding."

  cookies_config {
    cookie_behavior = "none"
  }

  headers_config {
    header_behavior = "none"
  }

  query_strings_config {
    query_string_behavior = "none"
  }
}

resource "aws_cloudfront_cache_policy" "next_static" {
  name        = "wat2do-production-next-static"
  comment     = "Content-addressed Next.js static files."
  min_ttl     = 0
  default_ttl = 31536000
  max_ttl     = 31536000

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
      query_string_behavior = "none"
    }
  }
}

resource "aws_cloudfront_cache_policy" "next_image" {
  name        = "wat2do-production-next-image"
  comment     = "Cache Next.js image variants by optimizer query parameters and Accept."
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

resource "aws_cloudfront_distribution" "main" {
  enabled             = true
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  comment             = "wat2do production"
  price_class         = "PriceClass_All"
  aliases             = [var.domain_name, "www.${var.domain_name}"]
  wait_for_deployment = true

  origin {
    domain_name = "origin.${var.domain_name}"
    origin_id   = "wat2do-production-alb"

    custom_header {
      name  = "X-Forwarded-Host"
      value = var.domain_name
    }

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id         = "wat2do-production-alb"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD", "OPTIONS"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    compress                 = true
  }

  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = "wat2do-production-alb"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD", "OPTIONS"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    compress                 = true
  }

  ordered_cache_behavior {
    path_pattern             = "/_next/static/*"
    target_origin_id         = "wat2do-production-alb"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = aws_cloudfront_cache_policy.next_static.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.none.id
    compress                 = true
  }

  ordered_cache_behavior {
    path_pattern           = "/_next/image*"
    target_origin_id       = "wat2do-production-alb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = aws_cloudfront_cache_policy.next_image.id
    compress               = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.cloudfront.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  depends_on = [aws_route53_record.origin]
}
