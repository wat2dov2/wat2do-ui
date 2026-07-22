resource "aws_sqs_queue" "scheduler_dead_letter" {
  name                      = "wat2do-production-scheduler-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

resource "aws_scheduler_schedule_group" "jobs" {
  name = "wat2do-production-jobs"
}

data "aws_iam_policy_document" "scheduler" {
  statement {
    effect    = "Allow"
    actions   = ["ecs:RunTask"]
    resources = [aws_ecs_task_definition.jobs.arn]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.main.arn]
    }
  }

  statement {
    effect  = "Allow"
    actions = ["iam:PassRole"]
    resources = [
      aws_iam_role.ecs_execution.arn,
      aws_iam_role.jobs_task.arn,
    ]
  }

  statement {
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.scheduler_dead_letter.arn]
  }
}

resource "aws_iam_role_policy" "scheduler" {
  name   = "run-wat2do-production-jobs"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler.json
}

locals {
  scheduled_jobs = {
    directory_scrape = {
      expression = "cron(0 8 * * ? *)"
      command    = ["timeout", "50m", "python", "jobs/scrape_directories.py", "--max-pages", "5"]
    }
  }
}

resource "aws_scheduler_schedule" "jobs" {
  for_each = local.scheduled_jobs

  name                         = "wat2do-production-${replace(each.key, "_", "-")}"
  group_name                   = aws_scheduler_schedule_group.jobs.name
  schedule_expression          = each.value.expression
  schedule_expression_timezone = "UTC"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_ecs_cluster.main.arn
    role_arn = aws_iam_role.scheduler.arn
    input = jsonencode({
      containerOverrides = [{
        name    = "backend-jobs"
        command = each.value.command
      }]
    })

    ecs_parameters {
      launch_type         = "FARGATE"
      task_definition_arn = aws_ecs_task_definition.jobs.arn

      network_configuration {
        assign_public_ip = false
        security_groups  = [aws_security_group.task.id]
        subnets          = [for subnet in aws_subnet.private : subnet.id]
      }
    }

    dead_letter_config {
      arn = aws_sqs_queue.scheduler_dead_letter.arn
    }

    retry_policy {
      maximum_event_age_in_seconds = 3600
      maximum_retry_attempts       = 1
    }
  }
}
