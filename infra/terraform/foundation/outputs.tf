output "state_bucket_name" {
  value = aws_s3_bucket.terraform_state.id
}

output "route53_zone_id" {
  value = aws_route53_zone.primary.zone_id
}

output "route53_name_servers" {
  value = aws_route53_zone.primary.name_servers
}

output "frontend_ecr_repository_url" {
  value = aws_ecr_repository.frontend.repository_url
}

output "backend_ecr_repository_url" {
  value = aws_ecr_repository.backend.repository_url
}

output "runtime_secret_arn" {
  value = aws_secretsmanager_secret.runtime.arn
}

output "frontend_build_secret_arn" {
  value = aws_secretsmanager_secret.frontend_build.arn
}

output "github_deployment_role_arn" {
  value = aws_iam_role.github_deploy.arn
}

output "terraform_role_arn" {
  value = aws_iam_role.terraform.arn
}
