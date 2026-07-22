resource "aws_ecs_cluster" "main" {
  name = local.name_prefix

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_task_definition" "application" {
  family                   = "wat2do-production-app"
  cpu                      = "1024"
  memory                   = "2048"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  volume {
    name = "backend-tmp"
  }

  volume {
    name = "frontend-tmp"
  }

  volume {
    name = "frontend-cache"
  }

  volume {
    name = "frontend-prerender"
  }

  container_definitions = jsonencode([
    {
      name                   = "backend"
      image                  = var.backend_image
      essential              = true
      cpu                    = 512
      memory                 = 1024
      readonlyRootFilesystem = true
      portMappings = [{
        containerPort = 8000
        hostPort      = 8000
        protocol      = "tcp"
      }]
      environment = [for name, value in local.backend_runtime_environment : { name = name, value = value }]
      secrets     = local.runtime_secret_references
      mountPoints = [{
        sourceVolume  = "backend-tmp"
        containerPath = "/tmp"
        readOnly      = false
      }]
      healthCheck = {
        command     = ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')\""]
        interval    = 15
        timeout     = 5
        retries     = 3
        startPeriod = 20
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.backend.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    },
    {
      name                   = "frontend-cache-init"
      image                  = var.frontend_image
      essential              = false
      cpu                    = 0
      memoryReservation      = 32
      readonlyRootFilesystem = true
      user                   = "0"
      command                = ["sh", "-c", "chown 999:999 /app/.next/cache && chmod 0755 /app/.next/cache && cp -a /app/.next/server/app/. /writable-prerender/ && chown -R 999:999 /writable-prerender"]
      mountPoints = [
        {
          sourceVolume  = "frontend-cache"
          containerPath = "/app/.next/cache"
          readOnly      = false
        },
        {
          sourceVolume  = "frontend-prerender"
          containerPath = "/writable-prerender"
          readOnly      = false
        },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.frontend.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "cache-init"
        }
      }
    },
    {
      name                   = "frontend"
      image                  = var.frontend_image
      essential              = true
      cpu                    = 512
      memory                 = 1024
      readonlyRootFilesystem = true
      dependsOn = [
        {
          containerName = "backend"
          condition     = "HEALTHY"
        },
        {
          containerName = "frontend-cache-init"
          condition     = "SUCCESS"
        },
      ]
      portMappings = [{
        containerPort = 3000
        hostPort      = 3000
        protocol      = "tcp"
      }]
      environment = [for name, value in local.frontend_runtime_environment : { name = name, value = value }]
      secrets = [
        {
          name      = "EVENT_FEED_REVALIDATION_SECRET"
          valueFrom = "${var.runtime_secret_arn}:EVENT_FEED_REVALIDATION_SECRET::"
        },
      ]
      mountPoints = [
        {
          sourceVolume  = "frontend-tmp"
          containerPath = "/tmp"
          readOnly      = false
        },
        {
          sourceVolume  = "frontend-cache"
          containerPath = "/app/.next/cache"
          readOnly      = false
        },
        {
          sourceVolume  = "frontend-prerender"
          containerPath = "/app/.next/server/app"
          readOnly      = false
        },
      ]
      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:3000/healthz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))\""]
        interval    = 15
        timeout     = 5
        retries     = 3
        startPeriod = 20
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.frontend.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    },
  ])
}

resource "aws_ecs_task_definition" "jobs" {
  family                   = "wat2do-production-jobs"
  cpu                      = "1024"
  memory                   = "2048"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.jobs_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  volume {
    name = "jobs-tmp"
  }

  container_definitions = jsonencode([
    {
      name                   = "backend-jobs"
      image                  = var.backend_image
      essential              = true
      cpu                    = 1024
      memory                 = 2048
      readonlyRootFilesystem = true
      command                = ["python", "-c", "raise SystemExit('A job command override is required')"]
      environment            = [for name, value in local.backend_jobs_environment : { name = name, value = value }]
      secrets                = local.runtime_secret_references
      mountPoints = [{
        sourceVolume  = "jobs-tmp"
        containerPath = "/tmp"
        readOnly      = false
      }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.jobs.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    },
  ])
}
