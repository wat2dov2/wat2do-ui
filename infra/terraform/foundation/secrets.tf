resource "aws_secretsmanager_secret" "runtime" {
  provider                = aws.application
  name                    = "wat2do/production/runtime"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "frontend_build" {
  provider                = aws.application
  name                    = "wat2do/production/frontend-build"
  recovery_window_in_days = 7
}
