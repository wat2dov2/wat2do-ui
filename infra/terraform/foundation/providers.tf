provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}

provider "aws" {
  alias  = "application"
  region = var.application_region

  default_tags {
    tags = local.common_tags
  }
}
