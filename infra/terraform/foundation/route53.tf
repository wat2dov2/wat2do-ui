resource "aws_route53_zone" "primary" {
  name = var.domain_name
}

# Preserve the existing public CAA issuers and allow ACM to issue the new
# CloudFront and Application Load Balancer certificates.
resource "aws_route53_record" "caa" {
  zone_id = aws_route53_zone.primary.zone_id
  name    = var.domain_name
  type    = "CAA"
  ttl     = 300
  records = [
    "0 issue \"amazon.com\"",
    "0 issue \"letsencrypt.org\"",
    "0 issue \"pki.goog\"",
    "0 issue \"sectigo.com\"",
  ]
}

resource "aws_route53_record" "additional" {
  for_each = local.additional_dns_records

  zone_id = aws_route53_zone.primary.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = each.value.ttl
  records = each.value.records
}
