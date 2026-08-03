resource "aws_cloudwatch_metric_alarm" "healthy_targets" {
  alarm_name          = "wat2do-production-healthy-targets"
  alarm_description   = "The wat2do target group has fewer than one healthy target."
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "HealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Minimum"
  threshold           = 1
  treat_missing_data  = "breaching"
  alarm_actions       = var.alarm_sns_topic_arn == null ? [] : [var.alarm_sns_topic_arn]

  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
    TargetGroup  = aws_lb_target_group.frontend.arn_suffix
  }
}

resource "aws_cloudwatch_metric_alarm" "target_5xx" {
  alarm_name          = "wat2do-production-target-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  statistic           = "Sum"
  threshold           = 5
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_sns_topic_arn == null ? [] : [var.alarm_sns_topic_arn]

  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
  }
}

resource "aws_cloudwatch_metric_alarm" "frontend_cpu" {
  alarm_name          = "wat2do-production-frontend-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_sns_topic_arn == null ? [] : [var.alarm_sns_topic_arn]

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.application.name
  }
}

resource "aws_cloudwatch_metric_alarm" "task_memory" {
  alarm_name          = "wat2do-production-task-memory"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 85
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_sns_topic_arn == null ? [] : [var.alarm_sns_topic_arn]

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.application.name
  }
}

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "wat2do-production"
  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        width  = 12
        height = 6
        properties = {
          region = var.aws_region
          title  = "ECS service health"
          stat   = "Average"
          period = 300
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ClusterName", aws_ecs_cluster.main.name, "ServiceName", aws_ecs_service.application.name],
            [".", "MemoryUtilization", ".", ".", ".", "."],
          ]
        }
      },
      {
        type   = "metric"
        width  = 12
        height = 6
        properties = {
          region = var.aws_region
          title  = "Application Load Balancer"
          stat   = "Sum"
          period = 300
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", aws_lb.main.arn_suffix],
            [".", "HTTPCode_ELB_4XX_Count", ".", "."],
            [".", "HTTPCode_Target_5XX_Count", ".", "."],
            [".", "UnHealthyHostCount", ".", ".", "TargetGroup", aws_lb_target_group.frontend.arn_suffix],
            [".", "TargetResponseTime", ".", ".", { stat = "Average" }],
          ]
        }
      },
    ]
  })
}
