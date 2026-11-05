resource "aws_acm_certificate" "web" {
  provider                  = aws.us_east_1
  domain_name               = var.domain_name
  subject_alternative_names = ["*.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Cloudflare adds issuewild CAA records for its own certificate authorities, so
# Amazon needs one too for the *.wat2do.io name (the zone's issue records,
# amazon.com among them, cover the apex).
resource "cloudflare_dns_record" "caa_amazon_wildcard" {
  zone_id = var.cloudflare_zone_id
  name    = var.domain_name
  type    = "CAA"
  ttl     = 300
  data = {
    flags = 0
    tag   = "issuewild"
    value = "amazon.com"
  }
}

# The apex and the wildcard share one validation record.
locals {
  certificate_validation = one([
    for option in aws_acm_certificate.web.domain_validation_options : option
    if option.domain_name == var.domain_name
  ])
}

resource "cloudflare_dns_record" "certificate_validation" {
  zone_id = var.cloudflare_zone_id
  name    = trimsuffix(local.certificate_validation.resource_record_name, ".")
  type    = local.certificate_validation.resource_record_type
  content = trimsuffix(local.certificate_validation.resource_record_value, ".")
  ttl     = 300
  proxied = false
}

resource "aws_acm_certificate_validation" "web" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.web.arn
  validation_record_fqdns = [local.certificate_validation.resource_record_name]

  depends_on = [cloudflare_dns_record.certificate_validation, cloudflare_dns_record.caa_amazon_wildcard]
}
