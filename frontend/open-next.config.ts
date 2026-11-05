import type { OpenNextConfig } from "@opennextjs/aws/types/open-next.js";

/**
 * How the website runs on AWS (infra/terraform/web): one streaming Lambda
 * behind CloudFront, Next's data cache in S3, revalidateTag through DynamoDB
 * and background revalidation through SQS. The table and queue names reach the
 * Lambda as environment variables set by Terraform.
 */
const config = {
  default: {
    override: {
      wrapper: "aws-lambda-streaming",
      incrementalCache: "s3-lite",
      tagCache: "dynamodb-nextMode",
      queue: "sqs-lite",
    },
  },
} satisfies OpenNextConfig;

export default config;
