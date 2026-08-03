data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

// Each school is served from its own subdomain, and the app resolves that school
// from X-Forwarded-Host. The backend also needs one trusted viewer IP for
// privacy-preserving scan hashing. CloudFront overwrites both headers before the
// request reaches the origin.
resource "aws_cloudfront_function" "forward_viewer_host" {
  name    = "wat2do-production-forward-viewer-host"
  runtime = "cloudfront-js-2.0"
  comment = "Preserve viewer host and pass the CloudFront viewer IP to the origin."
  publish = true

  code = <<-EOT
    function handler(event) {
      var request = event.request;
      if (request.headers.host) {
        request.headers['x-forwarded-host'] = { value: request.headers.host.value };
      }
      request.headers['x-wat2do-viewer-ip'] = { value: event.viewer.ip };
      return request;
    }
  EOT
}

// AWS's managed policy removes the viewer Host while forwarding dynamic viewer
// request data, including the function-owned Wat2Do viewer IP header.
data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
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
  aliases             = [var.domain_name, "www.${var.domain_name}", "*.${var.domain_name}"]
  wait_for_deployment = true

  origin {
    domain_name = "origin.${var.domain_name}"
    origin_id   = "wat2do-production-alb"

    custom_header {
      name  = "X-Wat2Do-Origin-Verify"
      value = var.cloudfront_origin_secret
    }

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  origin {
    domain_name              = aws_s3_bucket.assets.bucket_regional_domain_name
    origin_id                = "wat2do-production-assets"
    origin_access_control_id = aws_cloudfront_origin_access_control.assets.id
  }

  default_cache_behavior {
    target_origin_id         = "wat2do-production-alb"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD", "OPTIONS"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    compress                 = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.forward_viewer_host.arn
    }
  }

  ordered_cache_behavior {
    path_pattern             = "/media/*"
    target_origin_id         = "wat2do-production-assets"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS"]
    cached_methods           = ["GET", "HEAD", "OPTIONS"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_optimized.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.none.id
    compress                 = true
  }

  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = "wat2do-production-alb"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD", "OPTIONS"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    compress                 = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.forward_viewer_host.arn
    }
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
