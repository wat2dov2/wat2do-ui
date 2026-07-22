data "aws_partition" "current" {}

data "aws_caller_identity" "current" {}

resource "aws_iam_openid_connect_provider" "github_actions" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["ab9d0263244dd0326eb67015705a667e79cfe998"]
}

locals {
  github_oidc_condition_prefix = replace(aws_iam_openid_connect_provider.github_actions.url, "https://", "")
}

data "aws_iam_policy_document" "github_production_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_actions.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc_condition_prefix}:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc_condition_prefix}:repository"
      values   = [var.github_repository]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc_condition_prefix}:ref"
      values   = ["refs/heads/main"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc_condition_prefix}:sub"
      values   = ["repo:${var.github_repository}:environment:${var.github_production_environment}"]
    }
  }
}

data "aws_iam_policy_document" "terraform_assume_role" {
  source_policy_documents = [data.aws_iam_policy_document.github_production_assume_role.json]

  dynamic "statement" {
    for_each = length(var.local_administrator_principal_arns) == 0 ? [] : [true]

    content {
      effect  = "Allow"
      actions = ["sts:AssumeRole"]

      principals {
        type        = "AWS"
        identifiers = tolist(var.local_administrator_principal_arns)
      }
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "wat2do-production-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_production_assume_role.json
}

resource "aws_iam_role" "terraform" {
  name               = "wat2do-production-terraform"
  assume_role_policy = data.aws_iam_policy_document.terraform_assume_role.json
}

resource "aws_iam_role_policy_attachment" "terraform_administrator" {
  role       = aws_iam_role.terraform.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AdministratorAccess"
}
