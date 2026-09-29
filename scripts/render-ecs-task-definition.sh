#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "Usage: $0 <task-definition.json> <frontend-image> <backend-image>" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Apply the release's runtime budget before Terraform runs, so the first
# deployment receives the same heap and container settings as infrastructure.
jq --arg frontend_image "$2" --arg backend_image "$3" \
  --slurpfile runtime "$repo_root/backend/controlbox/ecs_runtime.json" \
  --slurpfile discovery "$repo_root/backend/controlbox/discovery_cache.json" '
  $runtime[0] as $runtime
  | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy, .deregisteredAt)
  | .cpu = ($runtime.task_cpu | tostring)
  | .memory = ($runtime.task_memory_mib | tostring)
  | ([.containerDefinitions[] | select(.name == "backend") | .environment[] | select(.name == "STORAGE_BUCKET_NAME" or .name == "AWS_REGION")]) as $storage_env
  | .containerDefinitions |= map(
    if .name == "frontend" then
      .image = $frontend_image
      | .cpu = $runtime.frontend_cpu
      | .memoryReservation = $runtime.frontend_memory_reservation_mib
      | .environment = (
          [.environment[] | select(.name != "STORAGE_BUCKET_NAME" and .name != "AWS_REGION" and .name != "NODE_OPTIONS")]
          + $storage_env
          + [{name: "NODE_OPTIONS", value: ("--max-old-space-size=" + ($runtime.frontend_heap_mib | tostring))}]
        )
      | .healthCheck.startPeriod = ([$discovery[0].readiness_timeout_seconds, 300] | min)
    elif .name == "frontend-cache-init" then
      .image = $frontend_image
      | .memoryReservation = $runtime.cache_init_memory_reservation_mib
    elif .name == "backend" then
      .image = $backend_image
      | .cpu = $runtime.backend_cpu
      | .memoryReservation = $runtime.backend_memory_reservation_mib
    else . end
  )
' "$1"
