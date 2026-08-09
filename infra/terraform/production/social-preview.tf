locals {
  social_preview_control = jsondecode(
    file("${path.module}/../../../backend/controlbox/social_previews.json")
  )
}

resource "aws_sqs_queue" "social_preview_dead_letter" {
  name                      = "${local.name_prefix}-social-preview-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "social_preview" {
  name                       = "${local.name_prefix}-social-preview"
  message_retention_seconds  = 345600
  receive_wait_time_seconds  = 20
  visibility_timeout_seconds = local.social_preview_control.function_timeout_seconds * 2
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.social_preview_dead_letter.arn
    maxReceiveCount     = local.social_preview_control.maximum_receive_count
  })
}

data "aws_iam_policy_document" "social_preview_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "social_preview" {
  name               = "${local.name_prefix}-social-preview"
  assume_role_policy = data.aws_iam_policy_document.social_preview_assume_role.json
}

resource "aws_iam_role_policy_attachment" "social_preview_basic_execution" {
  role       = aws_iam_role.social_preview.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "social_preview" {
  statement {
    sid       = "ReadRuntimeSecret"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.runtime_secret_arn]
  }

  statement {
    sid       = "WriteSocialPreviewAssets"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.assets.arn}/media/social-previews/*"]
  }

  statement {
    sid    = "UseSocialPreviewQueue"
    effect = "Allow"
    actions = [
      "sqs:ChangeMessageVisibility",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:ReceiveMessage",
      "sqs:SendMessage",
    ]
    resources = [aws_sqs_queue.social_preview.arn]
  }
}

resource "aws_iam_role_policy" "social_preview" {
  name   = "render-school-social-previews"
  role   = aws_iam_role.social_preview.id
  policy = data.aws_iam_policy_document.social_preview.json
}

resource "aws_cloudwatch_log_group" "social_preview" {
  name              = "/aws/lambda/${local.name_prefix}-social-preview"
  retention_in_days = 30
}

resource "aws_lambda_function" "social_preview" {
  function_name = "${local.name_prefix}-social-preview"
  role          = aws_iam_role.social_preview.arn
  package_type  = "Image"
  image_uri     = var.social_preview_image
  architectures = ["x86_64"]

  memory_size                    = local.social_preview_control.memory_megabytes
  timeout                        = local.social_preview_control.function_timeout_seconds
  reserved_concurrent_executions = local.social_preview_control.reserved_concurrency

  environment {
    variables = {
      ASSETS_BUCKET_NAME     = aws_s3_bucket.assets.id
      ASSETS_PUBLIC_BASE_URL = "https://${var.domain_name}/media"
      DOMAIN_NAME            = var.domain_name
      QUEUE_URL              = aws_sqs_queue.social_preview.url
      RUNTIME_SECRET_ARN     = var.runtime_secret_arn
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.social_preview,
    aws_iam_role_policy.social_preview,
    aws_iam_role_policy_attachment.social_preview_basic_execution,
  ]
}

resource "aws_lambda_event_source_mapping" "social_preview" {
  event_source_arn        = aws_sqs_queue.social_preview.arn
  function_name           = aws_lambda_function.social_preview.arn
  batch_size              = 1
  function_response_types = ["ReportBatchItemFailures"]

  scaling_config {
    maximum_concurrency = local.social_preview_control.reserved_concurrency
  }
}

resource "aws_cloudwatch_event_rule" "social_preview" {
  name                = "${local.name_prefix}-social-preview"
  description         = "Queue every school's event-feed social preview on a bounded cadence."
  schedule_expression = local.social_preview_control.refresh_interval_hours == 1 ? "rate(1 hour)" : "rate(${local.social_preview_control.refresh_interval_hours} hours)"
}

resource "aws_cloudwatch_event_target" "social_preview" {
  rule      = aws_cloudwatch_event_rule.social_preview.name
  target_id = "social-preview-scheduler"
  arn       = aws_lambda_function.social_preview.arn
}

resource "aws_lambda_permission" "social_preview_scheduler" {
  statement_id  = "AllowEventBridgeScheduler"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.social_preview.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.social_preview.arn
}

resource "aws_cloudwatch_metric_alarm" "social_preview_errors" {
  alarm_name          = "${local.name_prefix}-social-preview-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_sns_topic_arn == null ? [] : [var.alarm_sns_topic_arn]

  dimensions = {
    FunctionName = aws_lambda_function.social_preview.function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "social_preview_dead_letters" {
  alarm_name          = "${local.name_prefix}-social-preview-dead-letters"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 300
  statistic           = "Maximum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_sns_topic_arn == null ? [] : [var.alarm_sns_topic_arn]

  dimensions = {
    QueueName = aws_sqs_queue.social_preview_dead_letter.name
  }
}
