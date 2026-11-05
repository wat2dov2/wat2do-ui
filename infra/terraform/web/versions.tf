terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }

  # Created once by hand (versioned, private); use_lockfile locks in S3 itself.
  backend "s3" {
    bucket       = "wat2do-terraform-state-291667884807"
    key          = "web/terraform.tfstate"
    region       = "ca-central-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = "ca-central-1"

  allowed_account_ids = ["291667884807"]

  default_tags {
    tags = {
      project = "wat2do"
    }
  }
}

# CloudFront only accepts certificates from us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  allowed_account_ids = ["291667884807"]

  default_tags {
    tags = {
      project = "wat2do"
    }
  }
}

# Reads CLOUDFLARE_API_TOKEN (the zone's DNS token, Keychain item cloudflare-api-token).
provider "cloudflare" {}
