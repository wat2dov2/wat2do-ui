resource "aws_cloudwatch_event_connection" "event_change_alerts" {
  name               = "${local.name_prefix}-event-change-alerts"
  description        = "Bearer key the backend requires on its event change alerts webhook"
  authorization_type = "API_KEY"

  auth_parameters {
    api_key {
      key   = "Authorization"
      value = "Bearer ${var.event_change_alerts_key}"
    }
  }
}

resource "aws_cloudwatch_event_api_destination" "event_change_alerts" {
  name                             = "${local.name_prefix}-event-change-alerts"
  description                      = "Backend webhook that sends event change alerts once their changes go quiet"
  connection_arn                   = aws_cloudwatch_event_connection.event_change_alerts.arn
  invocation_endpoint              = "https://${var.domain_name}/api/webhooks/event-change-alerts"
  http_method                      = "POST"
  invocation_rate_limit_per_second = 5
}

resource "aws_cloudwatch_event_rule" "event_change_alerts" {
  name                = "${local.name_prefix}-event-change-alerts"
  description         = "Ask the backend every minute to send event change alerts that are due"
  schedule_expression = "rate(1 minute)"
}

data "aws_iam_policy_document" "event_change_alerts_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudwatch_event_rule.event_change_alerts.arn]
    }
  }
}

resource "aws_iam_role" "event_change_alerts" {
  name               = "${local.name_prefix}-event-change-alerts"
  assume_role_policy = data.aws_iam_policy_document.event_change_alerts_assume_role.json
}

data "aws_iam_policy_document" "event_change_alerts" {
  statement {
    sid       = "InvokeEventChangeAlertsWebhook"
    effect    = "Allow"
    actions   = ["events:InvokeApiDestination"]
    resources = [aws_cloudwatch_event_api_destination.event_change_alerts.arn]
  }
}

resource "aws_iam_role_policy" "event_change_alerts" {
  name   = "invoke-event-change-alerts-webhook"
  role   = aws_iam_role.event_change_alerts.id
  policy = data.aws_iam_policy_document.event_change_alerts.json
}

resource "aws_cloudwatch_event_target" "event_change_alerts" {
  rule     = aws_cloudwatch_event_rule.event_change_alerts.name
  arn      = aws_cloudwatch_event_api_destination.event_change_alerts.arn
  role_arn = aws_iam_role.event_change_alerts.arn

  # Like the pg_cron job it replaces, a missed minute is picked up by the next
  # one instead of being retried.
  retry_policy {
    maximum_event_age_in_seconds = 60
    maximum_retry_attempts       = 0
  }
}
