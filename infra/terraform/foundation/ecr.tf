resource "aws_ecr_repository" "frontend" {
  provider             = aws.application
  name                 = "wat2do/frontend"
  force_delete         = true
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_repository" "backend" {
  provider             = aws.application
  name                 = "wat2do/backend"
  force_delete         = true
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "frontend" {
  provider   = aws.application
  repository = aws_ecr_repository.frontend.name
  policy     = local.ecr_lifecycle_policy
}

resource "aws_ecr_lifecycle_policy" "backend" {
  provider   = aws.application
  repository = aws_ecr_repository.backend.name
  policy     = local.ecr_lifecycle_policy
}
