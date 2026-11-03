locals {
  database_port = 5432
}

resource "random_password" "database_master" {
  length  = 48
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = local.name_prefix
  subnet_ids = [for subnet in aws_subnet.public : subnet.id]
}

resource "aws_db_parameter_group" "main" {
  name        = "${local.name_prefix}-postgres17"
  family      = "postgres17"
  description = "PostgreSQL 17 settings for the wat2do production database."

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements,pg_cron"
    apply_method = "pending-reboot"
  }

  parameter {
    name         = "cron.database_name"
    value        = "postgres"
    apply_method = "pending-reboot"
  }
}

resource "aws_db_instance" "main" {
  identifier = local.name_prefix
  engine     = "postgres"
  # Automatic minor upgrades can move the instance past this version. When a
  # plan proposes a downgrade, set this to the version the instance now runs.
  engine_version = "17.11"
  instance_class = "db.t4g.medium"

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_type          = "gp3"
  storage_encrypted     = true

  username = "wat2do_admin"
  password = random_password.database_master.result
  port     = local.database_port

  db_subnet_group_name   = aws_db_subnet_group.main.name
  parameter_group_name   = aws_db_parameter_group.main.name
  vpc_security_group_ids = [aws_security_group.database.id]
  # The Mac mini and GitHub-hosted runners connect directly; rds.force_ssl
  # rejects every connection that does not use TLS.
  publicly_accessible = true

  backup_retention_period   = 7
  copy_tags_to_snapshot     = true
  delete_automated_backups  = false
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name_prefix}-final"

  auto_minor_version_upgrade            = true
  performance_insights_enabled          = true
  performance_insights_retention_period = 7
}

resource "aws_security_group" "database" {
  name        = "${local.name_prefix}-database"
  description = "PostgreSQL access to the wat2do production database."
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "database_from_task" {
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = aws_security_group.task.id
  ip_protocol                  = "tcp"
  from_port                    = local.database_port
  to_port                      = local.database_port
}

resource "aws_vpc_security_group_ingress_rule" "database_from_data_api" {
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = aws_security_group.data_api.id
  ip_protocol                  = "tcp"
  from_port                    = local.database_port
  to_port                      = local.database_port
}

resource "aws_vpc_security_group_ingress_rule" "database_public" {
  security_group_id = aws_security_group.database.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = local.database_port
  to_port           = local.database_port
}

resource "aws_vpc_security_group_egress_rule" "task_database" {
  security_group_id            = aws_security_group.task.id
  referenced_security_group_id = aws_security_group.database.id
  ip_protocol                  = "tcp"
  from_port                    = local.database_port
  to_port                      = local.database_port
}
