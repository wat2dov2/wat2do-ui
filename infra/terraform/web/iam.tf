# The Mac mini's API and ingestion jobs: email through SES and media in S3.
# Its access key is created by hand and kept in ~/wat2do-data/config/backend.env.
resource "aws_iam_user" "api" {
  name = "wat2do-api"
}

data "aws_iam_policy_document" "api" {
  statement {
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = ["*"]
    condition {
      test     = "StringLike"
      variable = "ses:FromAddress"
      values   = ["*@${var.domain_name}"]
    }
  }
  statement {
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.media.arn}/*"]
  }
}

resource "aws_iam_user_policy" "api" {
  user   = aws_iam_user.api.name
  name   = "wat2do-api"
  policy = data.aws_iam_policy_document.api.json
}

# The Mac mini's deploy job (infra/mac-mini/deploy.sh): uploads each build to
# the web bucket and the functions, then clears CloudFront's cache.
# Its access key is the AWS CLI profile wat2do-deploy on the Mac.
resource "aws_iam_user" "deploy" {
  name = "wat2do-web-deploy"
}

data "aws_iam_policy_document" "deploy" {
  statement {
    actions   = ["s3:PutObject", "s3:DeleteObject", "s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]
  }
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.web.arn]
  }
  statement {
    actions = ["lambda:UpdateFunctionCode", "lambda:GetFunction", "lambda:GetFunctionConfiguration"]
    resources = [
      aws_lambda_function.server.arn,
      aws_lambda_function.image.arn,
      aws_lambda_function.revalidation.arn,
      aws_lambda_function.warmer.arn,
    ]
  }
  statement {
    actions   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation", "cloudfront:GetDistributionConfig"]
    resources = [aws_cloudfront_distribution.web.arn]
  }
}

resource "aws_iam_user_policy" "deploy" {
  user   = aws_iam_user.deploy.name
  name   = "wat2do-web-deploy"
  policy = data.aws_iam_policy_document.deploy.json
}
