import type { OpenNextConfig } from "@opennextjs/aws/types/open-next.js";
import sharpPackage from "./node_modules/sharp/package.json" with { type: "json" };

/**
 * How the website runs on AWS (infra/terraform/web): one streaming Lambda
 * behind CloudFront, Next's data cache in S3, revalidateTag through DynamoDB
 * and background revalidation through SQS. The table and queue names reach the
 * Lambda as environment variables set by Terraform.
 *
 * OpenNext leaves sharp out of the server bundle, but the Instagram slide route
 * draws posters with it, so the bundle gets the Linux arm64 build of the version
 * this build uses (infra/mac-mini/deploy.sh points Turbopack's link to it).
 */
const config = {
  default: {
    install: {
      packages: [`sharp@${sharpPackage.version}`],
      arch: "arm64",
      libc: "glibc",
    },
    override: {
      wrapper: "aws-lambda-streaming",
      incrementalCache: "s3-lite",
      tagCache: "dynamodb-nextMode",
      queue: "sqs-lite",
    },
  },
} satisfies OpenNextConfig;

export default config;
