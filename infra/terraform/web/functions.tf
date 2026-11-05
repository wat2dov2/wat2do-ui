# The website's Lambda functions, built by OpenNext (frontend/open-next.config.ts).
# Terraform owns their settings; infra/mac-mini/deploy.sh uploads each build's
# code, so Terraform starts them from a placeholder and never replaces the code.

locals {
  # api.wat2do.io is the API every server-side fetch and /api rewrite targets.
  website_environment = {
    API_URL                        = "https://${var.api_origin}"
    STORAGE_PUBLIC_BASE_URL        = local.image_delivery.media_origin
    EVENT_FEED_REVALIDATION_SECRET = var.event_feed_revalidation_secret
    INSTAGRAM_SLIDE_RENDER_SECRET  = var.instagram_slide_render_secret
  }
  next_cache_environment = {
    CACHE_BUCKET_NAME         = aws_s3_bucket.web.id
    CACHE_BUCKET_KEY_PREFIX   = "_cache"
    CACHE_BUCKET_REGION       = data.aws_region.current.region
    CACHE_DYNAMO_TABLE        = aws_dynamodb_table.next_tags.name
    REVALIDATION_QUEUE_URL    = aws_sqs_queue.revalidation.url
    REVALIDATION_QUEUE_REGION = data.aws_region.current.region
  }
  log_retention_days = 14
}

data "aws_region" "current" {}

data "archive_file" "placeholder" {
  type        = "zip"
  output_path = "${path.module}/.terraform/placeholder.zip"
  source {
    filename = "index.mjs"
    content  = "export const handler = async () => ({ statusCode: 503, body: 'not deployed yet' });\n"
  }
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# Next's data cache: entries in S3, tag revalidation times in DynamoDB
# (OpenNext's dynamodb-nextMode keys each tag by both path and tag).
resource "aws_dynamodb_table" "next_tags" {
  name         = "wat2do-web-next-tags"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "tag"
  range_key    = "path"

  attribute {
    name = "tag"
    type = "S"
  }

  attribute {
    name = "path"
    type = "S"
  }
}

resource "aws_sqs_queue" "revalidation" {
  name                        = "wat2do-web-revalidation.fifo"
  fifo_queue                  = true
  receive_wait_time_seconds   = 20
  message_retention_seconds   = 3600
  visibility_timeout_seconds  = 60
  content_based_deduplication = false
}

# --- Server function: renders every page and Next's own /api routes ---

resource "aws_iam_role" "server" {
  name               = "wat2do-web-server"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "server_logs" {
  role       = aws_iam_role.server.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "server" {
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.web.arn}/_cache/*"]
  }
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.web.arn]
  }
  statement {
    actions   = ["dynamodb:BatchGetItem", "dynamodb:BatchWriteItem", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"]
    resources = [aws_dynamodb_table.next_tags.arn]
  }
  statement {
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.revalidation.arn]
  }
}

resource "aws_iam_role_policy" "server" {
  role   = aws_iam_role.server.id
  policy = data.aws_iam_policy_document.server.json
}

resource "aws_cloudwatch_log_group" "server" {
  name              = "/aws/lambda/wat2do-web-server"
  retention_in_days = local.log_retention_days
}

resource "aws_lambda_function" "server" {
  function_name = "wat2do-web-server"
  role          = aws_iam_role.server.arn
  runtime       = "nodejs22.x"
  architectures = ["arm64"]
  handler       = "index.handler"
  memory_size   = 1769 # one full vCPU
  timeout       = 30
  filename      = data.archive_file.placeholder.output_path

  environment {
    variables = merge(local.website_environment, local.next_cache_environment)
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.server.name
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_lambda_function_url" "server" {
  function_name      = aws_lambda_function.server.function_name
  authorization_type = "NONE"
  invoke_mode        = "RESPONSE_STREAM"
}

# A public function URL needs both grants since AWS's October 2025 change.
resource "aws_lambda_permission" "server_url" {
  statement_id           = "AllowPublicFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.server.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "server_invoke" {
  statement_id             = "AllowInvokeThroughFunctionUrl"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.server.function_name
  principal                = "*"
  invoked_via_function_url = true
}

# --- Revalidation: refreshes stale pages queued by the server function ---

resource "aws_iam_role" "revalidation" {
  name               = "wat2do-web-revalidation"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "revalidation_logs" {
  role       = aws_iam_role.revalidation.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "revalidation" {
  statement {
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [aws_sqs_queue.revalidation.arn]
  }
}

resource "aws_iam_role_policy" "revalidation" {
  role   = aws_iam_role.revalidation.id
  policy = data.aws_iam_policy_document.revalidation.json
}

resource "aws_cloudwatch_log_group" "revalidation" {
  name              = "/aws/lambda/wat2do-web-revalidation"
  retention_in_days = local.log_retention_days
}

resource "aws_lambda_function" "revalidation" {
  function_name = "wat2do-web-revalidation"
  role          = aws_iam_role.revalidation.arn
  runtime       = "nodejs22.x"
  architectures = ["arm64"]
  handler       = "index.handler"
  memory_size   = 256
  timeout       = 30
  filename      = data.archive_file.placeholder.output_path

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.revalidation.name
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_lambda_event_source_mapping" "revalidation" {
  event_source_arn = aws_sqs_queue.revalidation.arn
  function_name    = aws_lambda_function.revalidation.arn
  batch_size       = 5
}

# --- Warmer: keeps one server instance started, so visitors rarely wait on a cold start ---

resource "aws_iam_role" "warmer" {
  name               = "wat2do-web-warmer"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "warmer_logs" {
  role       = aws_iam_role.warmer.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "warmer" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.server.arn]
  }
}

resource "aws_iam_role_policy" "warmer" {
  role   = aws_iam_role.warmer.id
  policy = data.aws_iam_policy_document.warmer.json
}

resource "aws_cloudwatch_log_group" "warmer" {
  name              = "/aws/lambda/wat2do-web-warmer"
  retention_in_days = local.log_retention_days
}

resource "aws_lambda_function" "warmer" {
  function_name = "wat2do-web-warmer"
  role          = aws_iam_role.warmer.arn
  runtime       = "nodejs22.x"
  architectures = ["arm64"]
  handler       = "index.handler"
  memory_size   = 128
  timeout       = 15
  filename      = data.archive_file.placeholder.output_path

  environment {
    variables = {
      WARM_PARAMS = jsonencode([{ function = aws_lambda_function.server.function_name, concurrency = 1 }])
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.warmer.name
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_cloudwatch_event_rule" "warmer" {
  name                = "wat2do-web-warmer"
  schedule_expression = "rate(5 minutes)"
}

resource "aws_cloudwatch_event_target" "warmer" {
  rule = aws_cloudwatch_event_rule.warmer.name
  arn  = aws_lambda_function.warmer.arn
}

resource "aws_lambda_permission" "warmer" {
  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.warmer.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.warmer.arn
}
