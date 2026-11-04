output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  value = aws_ecs_service.application.name
}

output "application_task_definition_family" {
  value = aws_ecs_task_definition.application.family
}

output "task_security_group_id" {
  value = aws_security_group.task.id
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.main.id
}

output "cloudfront_domain_name" {
  value = aws_cloudfront_distribution.main.domain_name
}

output "load_balancer_dns_name" {
  value = aws_lb.main.dns_name
}

output "assets_bucket_name" {
  value = aws_s3_bucket.assets.id
}

output "assets_public_base_url" {
  value = "https://${var.domain_name}/media"
}

output "database_host" {
  value = aws_db_instance.main.address
}

output "database_port" {
  value = aws_db_instance.main.port
}

output "database_master_username" {
  value = aws_db_instance.main.username
}

output "database_master_secret_arn" {
  description = "Secrets Manager secret RDS keeps the master password in."
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
}

output "data_api_url" {
  value = "https://${local.data_api_domain_name}"
}
