variable "aws_region" {
  description = "AWS region for the production VPC and ECS workload."
  type        = string
  default     = "ca-central-1"
}

variable "domain_name" {
  description = "Public domain served by CloudFront."
  type        = string
  default     = "wat2do.io"
}

variable "cloudfront_origin_secret" {
  description = "Random secret sent by CloudFront and required by the origin ALB."
  type        = string
  sensitive   = true

  validation {
    condition = (
      length(var.cloudfront_origin_secret) >= 32
      && length(var.cloudfront_origin_secret) <= 128
      && can(regex("^[A-Za-z0-9_-]+$", var.cloudfront_origin_secret))
    )
    error_message = "cloudfront_origin_secret must be 32 to 128 URL-safe characters."
  }
}

variable "frontend_image" {
  description = "Initial immutable frontend ECR image URI with a digest."
  type        = string
}

variable "backend_image" {
  description = "Initial immutable backend ECR image URI with a digest."
  type        = string
}

variable "runtime_secret_arn" {
  description = "ARN of the Secrets Manager secret containing runtime values."
  type        = string
}

variable "route53_zone_id" {
  description = "Route 53 hosted zone ID created by the foundation root."
  type        = string
}

variable "vpc_cidr" {
  description = "Production VPC CIDR."
  type        = string
  default     = "10.20.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "Two public subnet CIDRs, one per selected availability zone."
  type        = list(string)
  default     = ["10.20.0.0/24", "10.20.1.0/24"]
}

variable "private_subnet_cidrs" {
  description = "Two private subnet CIDRs, one per selected availability zone."
  type        = list(string)
  default     = ["10.20.10.0/24", "10.20.11.0/24"]
}

variable "email_from" {
  description = "Sender identity used by the Resend notification provider."
  type        = string
  default     = "wat2do <newsletter@wat2do.io>"
}

variable "alarm_sns_topic_arn" {
  description = "Optional existing SNS topic ARN for alarm notifications."
  type        = string
  default     = null
  nullable    = true
}
