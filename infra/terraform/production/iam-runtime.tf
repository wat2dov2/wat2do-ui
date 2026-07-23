data "aws_iam_policy_document" "ecs_execution_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_execution" {
  name               = "wat2do-production-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_execution_assume_role.json
}

resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "ecs_execution_runtime_secret" {
  statement {
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.runtime_secret_arn]
  }
}

resource "aws_iam_role_policy" "ecs_execution_runtime_secret" {
  name   = "read-wat2do-runtime-secret"
  role   = aws_iam_role.ecs_execution.id
  policy = data.aws_iam_policy_document.ecs_execution_runtime_secret.json
}

resource "aws_iam_role" "ecs_task" {
  name               = "wat2do-production-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_execution_assume_role.json
}

resource "aws_iam_role" "jobs_task" {
  name               = "wat2do-production-jobs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_execution_assume_role.json
}
