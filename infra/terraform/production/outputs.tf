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

output "social_preview_function_name" {
  value = aws_lambda_function.social_preview.function_name
}

output "social_preview_queue_url" {
  value = aws_sqs_queue.social_preview.url
}
