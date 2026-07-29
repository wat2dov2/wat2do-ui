resource "aws_cloudwatch_log_group" "frontend" {
  name              = "/wat2do/production/frontend"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/wat2do/production/backend"
  retention_in_days = 30
}
