locals {
  data_api_domain_name = "data.${var.domain_name}"
  data_api_port        = 3000
  data_api_admin_port  = 3001
  # postgrest/postgrest:v14.5, pinned to its multi-architecture index digest.
  data_api_image = "postgrest/postgrest@sha256:b574528fe109c8343c1247155734d03df8c34b462f342dca0ccc20244fc36ef9"

  # No PGRST_DB_ANON_ROLE: PostgREST rejects every request without a valid JWT.
  data_api_environment = {
    PGRST_DB_SCHEMAS           = "public"
    PGRST_DB_EXTRA_SEARCH_PATH = "public,extensions"
    PGRST_DB_MAX_ROWS          = "1000"
    PGRST_DB_POOL              = "10"
    PGRST_SERVER_PORT          = tostring(local.data_api_port)
    PGRST_ADMIN_SERVER_PORT    = tostring(local.data_api_admin_port)
    PGRST_OPENAPI_MODE         = "disabled"
  }
}

resource "aws_acm_certificate" "data_api" {
  domain_name       = local.data_api_domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "data_api_certificate_validation" {
  for_each = {
    for option in aws_acm_certificate.data_api.domain_validation_options : option.domain_name => {
      name   = option.resource_record_name
      record = option.resource_record_value
      type   = option.resource_record_type
    }
  }

  zone_id         = var.route53_zone_id
  name            = each.value.name
  records         = [each.value.record]
  type            = each.value.type
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "data_api" {
  certificate_arn         = aws_acm_certificate.data_api.arn
  validation_record_fqdns = [for record in aws_route53_record.data_api_certificate_validation : record.fqdn]
}

# The data API is served by the ALB directly, not through CloudFront. This
# specific record takes precedence over the school wildcard in dns.tf.
resource "aws_route53_record" "data_api" {
  zone_id = var.route53_zone_id
  name    = local.data_api_domain_name
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = false
  }
}

resource "aws_lb_listener_certificate" "data_api" {
  listener_arn    = aws_lb_listener.https.arn
  certificate_arn = aws_acm_certificate_validation.data_api.certificate_arn
}

resource "aws_lb_target_group" "data_api" {
  name        = "${local.name_prefix}-data-api"
  port        = local.data_api_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  health_check {
    enabled             = true
    path                = "/ready"
    protocol            = "HTTP"
    port                = tostring(local.data_api_admin_port)
    matcher             = "200"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
    timeout             = 5
  }
}

# Evaluated before the CloudFront origin rule, so requests for the data API
# host never need the CloudFront origin secret.
resource "aws_lb_listener_rule" "data_api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 50

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.data_api.arn
  }

  condition {
    host_header {
      values = [local.data_api_domain_name]
    }
  }
}

resource "aws_security_group" "data_api" {
  name        = "${local.name_prefix}-data-api"
  description = "PostgREST data API task traffic."
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "data_api_from_load_balancer" {
  security_group_id            = aws_security_group.data_api.id
  referenced_security_group_id = aws_security_group.load_balancer.id
  ip_protocol                  = "tcp"
  from_port                    = local.data_api_port
  to_port                      = local.data_api_port
}

resource "aws_vpc_security_group_ingress_rule" "data_api_admin_from_load_balancer" {
  security_group_id            = aws_security_group.data_api.id
  referenced_security_group_id = aws_security_group.load_balancer.id
  ip_protocol                  = "tcp"
  from_port                    = local.data_api_admin_port
  to_port                      = local.data_api_admin_port
}

resource "aws_vpc_security_group_egress_rule" "data_api_database" {
  security_group_id            = aws_security_group.data_api.id
  referenced_security_group_id = aws_security_group.database.id
  ip_protocol                  = "tcp"
  from_port                    = local.database_port
  to_port                      = local.database_port
}

resource "aws_vpc_security_group_egress_rule" "data_api_https" {
  security_group_id = aws_security_group.data_api.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "data_api_dns_udp" {
  security_group_id = aws_security_group.data_api.id
  cidr_ipv4         = aws_vpc.main.cidr_block
  ip_protocol       = "udp"
  from_port         = 53
  to_port           = 53
}

resource "aws_vpc_security_group_egress_rule" "data_api_dns_tcp" {
  security_group_id = aws_security_group.data_api.id
  cidr_ipv4         = aws_vpc.main.cidr_block
  ip_protocol       = "tcp"
  from_port         = 53
  to_port           = 53
}

resource "aws_vpc_security_group_egress_rule" "load_balancer_data_api" {
  security_group_id            = aws_security_group.load_balancer.id
  referenced_security_group_id = aws_security_group.data_api.id
  ip_protocol                  = "tcp"
  from_port                    = local.data_api_port
  to_port                      = local.data_api_port
}

resource "aws_vpc_security_group_egress_rule" "load_balancer_data_api_admin" {
  security_group_id            = aws_security_group.load_balancer.id
  referenced_security_group_id = aws_security_group.data_api.id
  ip_protocol                  = "tcp"
  from_port                    = local.data_api_admin_port
  to_port                      = local.data_api_admin_port
}

resource "aws_cloudwatch_log_group" "data_api" {
  name              = "/wat2do/production/data-api"
  retention_in_days = 30
}

resource "aws_ecs_task_definition" "data_api" {
  family                   = "${local.name_prefix}-data-api"
  cpu                      = "256"
  memory                   = "512"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.ecs_execution.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      name                   = "postgrest"
      image                  = local.data_api_image
      essential              = true
      readonlyRootFilesystem = true
      portMappings = [
        {
          containerPort = local.data_api_port
          hostPort      = local.data_api_port
          protocol      = "tcp"
        },
        {
          containerPort = local.data_api_admin_port
          hostPort      = local.data_api_admin_port
          protocol      = "tcp"
        },
      ]
      environment = [for name, value in local.data_api_environment : { name = name, value = value }]
      secrets = [
        {
          name      = "PGRST_DB_URI"
          valueFrom = "${var.runtime_secret_arn}:DATA_API_DB_URI::"
        },
        {
          name      = "PGRST_JWT_SECRET"
          valueFrom = "${var.runtime_secret_arn}:DATA_API_JWT_SECRET::"
        },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.data_api.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    },
  ])
}

resource "aws_ecs_service" "data_api" {
  name                               = "${local.name_prefix}-data-api"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.data_api.arn
  desired_count                      = 1
  enable_ecs_managed_tags            = true
  enable_execute_command             = false
  health_check_grace_period_seconds  = 60
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = [for subnet in aws_subnet.public : subnet.id]
    security_groups  = [aws_security_group.data_api.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.data_api.arn
    container_name   = "postgrest"
    container_port   = local.data_api_port
  }

  depends_on = [aws_lb_listener_rule.data_api]
}
