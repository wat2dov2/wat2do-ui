# infra/mac-mini/deploy.sh reads these names; keep them in step.
output "distribution_id" {
  value = aws_cloudfront_distribution.web.id
}

output "distribution_domain" {
  value = aws_cloudfront_distribution.web.domain_name
}

output "web_bucket" {
  value = aws_s3_bucket.web.id
}
