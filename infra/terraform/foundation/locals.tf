locals {
  common_tags = {
    Application = "wat2do"
    Environment = "production"
    ManagedBy   = "terraform"
  }

  additional_dns_records = {
    for record in var.additional_dns_records : "${record.name}:${record.type}" => record
  }
}
