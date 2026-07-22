variable "aws_region" {
  description = "AWS region for Terraform state and global foundation management."
  type        = string
  default     = "us-west-2"
}

variable "application_region" {
  description = "Canadian AWS region for Wat2Do application resources."
  type        = string
  default     = "ca-central-1"
}

variable "state_bucket_name" {
  description = "Globally unique S3 bucket name for Terraform state."
  type        = string
}

variable "domain_name" {
  description = "Authoritative public domain managed by Route 53."
  type        = string
  default     = "wat2do.io"
}

variable "github_repository" {
  description = "GitHub repository allowed to assume wat2do OIDC roles, in owner/name form."
  type        = string
  default     = "tonyqiu123/wat2do-ui"
}

variable "github_production_environment" {
  description = "GitHub Environment name required by production OIDC jobs."
  type        = string
  default     = "production"
}

variable "local_administrator_principal_arns" {
  description = "Explicit local AWS administrator principals allowed to assume the infrastructure role."
  type        = set(string)
  default     = []
}

variable "additional_dns_records" {
  description = "Non-application DNS records inventoried from the current DNS provider before nameserver cutover. Names must be fully qualified."
  type = list(object({
    name    = string
    type    = string
    ttl     = number
    records = list(string)
  }))
  default = []
}
