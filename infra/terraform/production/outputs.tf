output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  value = aws_ecs_service.application.name
}

output "application_task_definition_family" {
  value = aws_ecs_task_definition.application.family
}

output "jobs_task_definition_arn" {
  value = aws_ecs_task_definition.jobs.arn
}

output "private_subnet_ids" {
  value = [for subnet in aws_subnet.private : subnet.id]
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
