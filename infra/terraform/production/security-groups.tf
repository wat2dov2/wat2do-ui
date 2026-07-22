resource "aws_security_group" "load_balancer" {
  name        = "${local.name_prefix}-alb"
  description = "CloudFront-only ingress for the wat2do Application Load Balancer."
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "load_balancer_cloudfront" {
  security_group_id = aws_security_group.load_balancer.id
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront_origin_facing.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "load_balancer_frontend" {
  security_group_id            = aws_security_group.load_balancer.id
  referenced_security_group_id = aws_security_group.task.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
}

resource "aws_security_group" "task" {
  name        = "${local.name_prefix}-task"
  description = "Private wat2do ECS task traffic."
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "task_frontend_from_load_balancer" {
  security_group_id            = aws_security_group.task.id
  referenced_security_group_id = aws_security_group.load_balancer.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
}

resource "aws_vpc_security_group_egress_rule" "task_https" {
  security_group_id = aws_security_group.task.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "task_dns_udp" {
  security_group_id = aws_security_group.task.id
  cidr_ipv4         = aws_vpc.main.cidr_block
  ip_protocol       = "udp"
  from_port         = 53
  to_port           = 53
}

resource "aws_vpc_security_group_egress_rule" "task_dns_tcp" {
  security_group_id = aws_security_group.task.id
  cidr_ipv4         = aws_vpc.main.cidr_block
  ip_protocol       = "tcp"
  from_port         = 53
  to_port           = 53
}
