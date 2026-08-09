#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <release-sha> <github-env-file>" >&2
  exit 2
fi

release_sha="$1"
github_env_file="$2"
aws_region="${AWS_REGION:?AWS_REGION is required}"
aws_account_id="${AWS_ACCOUNT_ID:?AWS_ACCOUNT_ID is required}"
ecr_registry="$aws_account_id.dkr.ecr.$aws_region.amazonaws.com"

resolve_image() {
  local repository_name="$1"
  local digest

  digest="$(
    aws ecr describe-images \
      --region "$aws_region" \
      --repository-name "$repository_name" \
      --image-ids "imageTag=$release_sha" \
      --query 'imageDetails[0].imageDigest' \
      --output text
  )"

  if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "Release image $repository_name:$release_sha did not resolve to an immutable digest." >&2
    exit 1
  fi

  printf '%s/%s@%s' "$ecr_registry" "$repository_name" "$digest"
}

backend_image="$(resolve_image 'wat2do/backend')"
frontend_image="$(resolve_image 'wat2do/frontend')"
social_preview_image="$(resolve_image 'wat2do/social-preview')"

{
  printf 'TF_VAR_backend_image=%s\n' "$backend_image"
  printf 'TF_VAR_frontend_image=%s\n' "$frontend_image"
  printf 'TF_VAR_social_preview_image=%s\n' "$social_preview_image"
} >> "$github_env_file"

echo "Resolved backend, frontend, and social-preview images for release $release_sha."
