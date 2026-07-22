# Project: AWS Terraform Migration

Status: planned and implementation-scoped.
Owner: Tony.

## 1. Goal

Replace the wat2do Vercel frontend and Railway backend with one Terraform-managed AWS deployment.

Keep Supabase as the database, authentication provider, and object-storage provider.

Run the Next.js frontend and FastAPI backend together in one Amazon ECS Fargate task.

Build both application containers in GitHub Actions, push immutable images to Amazon ECR, and deploy one coherent ECS task-definition revision for each successful commit to `main`.

Move recurring backend compute from GitHub-hosted runners to EventBridge Scheduler and one-off ECS tasks.

Move authoritative DNS for `wat2do.io` from Vercel DNS to Route 53.

This is a direct replacement for a toy project.
There is no staging environment, canary deployment, blue-green deployment, parallel production stack, migration benchmark phase, or extended rollback window.

## 2. Locked decisions

- Keep Supabase and its existing project unchanged.
- Use the existing AWS account unless implementation discovers that the available account cannot be administered.
- Use `us-west-2` because the current Supabase database pooler is in `us-west-2`.
- Use Terraform for AWS infrastructure.
- Use GitHub Actions for CI/CD orchestration.
- Use GitHub OIDC to authenticate to AWS.
- Do not use long-lived AWS access keys in GitHub after bootstrap.
- Use Amazon ECR for frontend and backend images.
- Use Amazon ECS with the Fargate capacity provider.
- Use Linux ARM64 containers.
- Run exactly one ECS service task.
- Run the frontend and backend as two containers in the same task.
- Route public traffic only to the frontend container.
- Let the frontend proxy `/api/*` requests to the backend over `127.0.0.1`.
- Let the backend call the frontend revalidation route over `127.0.0.1`.
- Use one Application Load Balancer as the ECS ingress.
- Use CloudFront in front of the Application Load Balancer.
- Cache immutable Next.js assets at CloudFront.
- Do not cache HTML or API responses at CloudFront.
- Let the single Next.js process own ISR state.
- Do not add Redis, ElastiCache, EFS, DynamoDB, or a custom Next.js cache handler.
- Do not configure ECS autoscaling.
- Use Route 53 for authoritative DNS.
- Use ACM for TLS certificates.
- Use Secrets Manager for runtime secret values.
- Do not store secret values in Terraform state.
- Use CloudWatch for application logs and basic service alarms.
- Replace scheduled GitHub-hosted application compute with EventBridge Scheduler and ECS tasks.
- Delete the nightly redeployment workflow.
- Delete Railway and Vercel deployment logic when AWS production is working.
- Do not retain compatibility branches that deploy the same application to multiple providers.

## 3. Explicitly out of scope

- Migrating Supabase PostgreSQL to RDS or Aurora.
- Migrating Supabase authentication to Cognito.
- Migrating Supabase Storage to S3.
- Changing the Supabase schema or historical migrations.
- Rewriting application API contracts.
- Replacing OpenAI, Apify, Resend, PostHog, or Mapbox.
- Adding a staging environment.
- Adding multiple AWS accounts.
- Adding multi-region deployment.
- Adding ECS autoscaling.
- Adding more than one frontend instance.
- Adding a shared Next.js cache.
- Adding AWS WAF.
- Adding Global Accelerator.
- Adding Kubernetes or EKS.
- Adding AWS Amplify Hosting.
- Adding OpenNext, SST, or a Lambda adapter.
- Adding a service mesh.
- Adding database read replicas.
- Preserving Vercel or Railway as a fallback provider after completion.
- Optimizing infrastructure primarily for high availability.
- Changing product behavior unrelated to AWS hosting.

## 4. Existing implementation being reused

### 4.1 Container deployment pattern

The reference repository at `/Users/tonyqiu/Desktop/projects/2025/bug-free-octo-spork` already demonstrates the basic release loop.

Its workflow:

1. Builds an ARM64 backend container.
2. Pushes the container to ECR.
3. Forces a deployment of an existing ECS service.
4. Waits for ECS to replace the running task.

The wat2do implementation will reuse that general flow.

The wat2do implementation will replace the reference repository's mutable `latest` tag, long-lived IAM user credentials, manually created infrastructure, public task IP, and shell-based ECR cleanup.

### 4.2 Existing wat2do container boundary

The repository already has separate production containers:

- `backend/Dockerfile` runs FastAPI with Uvicorn on port 8000.
- `frontend/Dockerfile` builds and runs Next.js on port 3000.
- `docker-compose.yml` already models the frontend depending on a healthy backend.
- `frontend/next.config.ts` already proxies same-origin `/api/*` requests to the backend.

The ECS task will preserve those two application boundaries.

### 4.3 Existing ISR ownership

The current frontend and backend already define one on-demand revalidation path.

- `frontend/src/features/events/api/eventFeed.server.ts` owns event-feed cache tags and the one-hour cache policy.
- `frontend/src/app/api/revalidate-events/route.ts` authenticates invalidation requests and calls `revalidateTag` and `revalidatePath`.
- `backend/services/event_feed_revalidation.py` calls the frontend route after event writes.

Those files should remain functionally unchanged.

The AWS runtime must satisfy the assumptions those files already make.

## 5. Target architecture

```text
Internet
  -> Route 53
  -> CloudFront
  -> public Application Load Balancer
  -> private ECS Fargate task
       -> Next.js frontend on port 3000
       -> FastAPI backend on port 8000
       -> frontend calls backend through 127.0.0.1:8000
       -> backend calls frontend through 127.0.0.1:3000
  -> Supabase in us-west-2
```

The Fargate task runs in private subnets.

The Application Load Balancer runs in public subnets.

The private subnets use one NAT gateway for Supabase, ECR, OpenAI, Apify, Resend, and other outbound HTTPS traffic.

The ECS service keeps one task running.

The ECS deployment configuration uses `minimumHealthyPercent = 0` and `maximumPercent = 100`.

This stop-before-start deployment strategy deliberately prevents two Next.js instances from running at once.

Short deployment downtime is acceptable for this project.

## 6. Proposed Terraform layout

Use two flat Terraform root configurations.

Do not create reusable modules until a second real environment or application requires them.

```text
infra/
  terraform/
    foundation/
      versions.tf
      providers.tf
      variables.tf
      locals.tf
      state.tf
      route53.tf
      ecr.tf
      secrets.tf
      github-oidc.tf
      iam-deploy.tf
      outputs.tf
      foundation.tfvars.example

    production/
      versions.tf
      providers.tf
      backend.tf
      variables.tf
      locals.tf
      data.tf
      network.tf
      security-groups.tf
      iam-runtime.tf
      cloudwatch.tf
      certificates.tf
      load-balancer.tf
      ecs-task.tf
      ecs-service.tf
      scheduler.tf
      cloudfront.tf
      dns.tf
      alarms.tf
      outputs.tf
      production.tfvars.example
```

Commit `.terraform.lock.hcl` for both root configurations.

Do not commit real `.tfvars` files, Terraform plans, local state, crash logs, or `.terraform` directories.

## 7. Foundation Terraform scope

### 7.1 Terraform state

Create one private S3 bucket for Terraform state.

Configure:

- S3 public-access blocking.
- S3 bucket versioning.
- Server-side encryption.
- A deny policy for non-TLS access.
- Object ownership enforced.
- Lifecycle retention for old noncurrent state versions.

Use separate state keys:

```text
foundation/terraform.tfstate
production/terraform.tfstate
```

Enable native S3 state locking with `use_lockfile = true`.

Do not create a DynamoDB lock table.

The first foundation apply must use local state because the state bucket does not exist yet.

Immediately run `terraform init -migrate-state` after the state bucket exists.

### 7.2 Route 53 hosted zone

Create the authoritative Route 53 hosted zone for `wat2do.io`.

Add every required non-application DNS record to Terraform before changing registrar nameservers.

The implementation audit must include:

- MX records.
- SPF records.
- DKIM records.
- DMARC records.
- Domain-verification records.
- Resend records.
- Any Supabase custom-domain records.
- Any unrelated subdomains that must continue resolving.

The registrar nameserver change is the only expected action that may not be automatable through AWS or repository tooling.

### 7.3 ECR repositories

Create:

- `wat2do/frontend`
- `wat2do/backend`

Configure both repositories with:

- Immutable image tags.
- Scan on push.
- AES-256 server-side encryption.
- A lifecycle policy that retains the most recent 20 release images.
- A lifecycle policy that removes untagged images after seven days.

Use the full Git commit SHA as the release tag.

Do not push or deploy `latest`.

### 7.4 Secrets Manager containers

Create secret containers without secret versions:

- `wat2do/production/runtime`
- `wat2do/production/frontend-build`

The runtime secret contains backend runtime secrets and the shared frontend revalidation secret.

The frontend-build secret contains values required while running `next build`.

Populate secret values outside Terraform with `aws secretsmanager put-secret-value`.

Never pass secret JSON through Terraform variables.

Never print secret JSON during setup.

### 7.5 GitHub OIDC

Create or reuse the AWS IAM OIDC provider for `token.actions.githubusercontent.com`.

Create a deployment role trusted only by the wat2do GitHub repository.

Restrict the production trust policy to:

- The exact GitHub repository.
- The `main` branch.
- The configured GitHub production environment when an environment is used.

The deployment role needs only:

- ECR authorization-token access.
- ECR image upload actions for the two wat2do repositories.
- Read access to the frontend-build secret.
- ECS task-definition read and registration actions.
- ECS service update and describe actions for the wat2do cluster and service.
- `iam:PassRole` for the exact ECS execution and task roles.
- CloudWatch Logs read access needed by deployment diagnostics.

Do not grant the deployment role general IAM, VPC, Route 53, or account-administration permissions.

Create a separate infrastructure role for Terraform operations.

The infrastructure role may be broad enough to manage the resources enumerated in this plan, but it must be trusted only by the repository's Terraform workflow and approved local administrators.

### 7.6 Foundation outputs

Output:

- Terraform state bucket name.
- Route 53 hosted-zone ID.
- Route 53 nameservers.
- Frontend ECR repository URL.
- Backend ECR repository URL.
- Runtime secret ARN.
- Frontend-build secret ARN.
- GitHub deployment-role ARN.
- Terraform-role ARN.

Do not output secret values.

## 8. Production networking

### 8.1 VPC

Create one VPC in `us-west-2`.

Use a CIDR large enough for the current task and normal future growth without creating an oversized network.

Recommended allocation:

```text
VPC: 10.20.0.0/16
Public subnet A: 10.20.0.0/24
Public subnet B: 10.20.1.0/24
Private subnet A: 10.20.10.0/24
Private subnet B: 10.20.11.0/24
```

Enable DNS support and DNS hostnames.

Select two availability zones dynamically from available `us-west-2` zones.

Do not hardcode availability-zone names if the account may expose a different zone mapping.

### 8.2 Public networking

Create:

- One internet gateway.
- One public route table.
- One default route through the internet gateway.
- Two public route-table associations.
- One Elastic IP.
- One NAT gateway in public subnet A.

The Application Load Balancer and NAT gateway live in public subnets.

### 8.3 Private networking

Create one private route table.

Route `0.0.0.0/0` through the NAT gateway.

Associate both private subnets with the private route table.

The ECS service and scheduled ECS tasks run only in private subnets.

Do not assign public IP addresses to ECS tasks.

### 8.4 VPC endpoints

Do not add VPC endpoints initially.

The tasks already require general internet egress for Supabase and external APIs, so the NAT gateway remains necessary.

Adding ECR, S3, Logs, Secrets Manager, or STS endpoints would add infrastructure without eliminating the NAT dependency.

## 9. Security groups

### 9.1 CloudFront to Application Load Balancer

Create an Application Load Balancer security group.

Allow inbound HTTPS only from the AWS-managed CloudFront origin-facing prefix list.

Allow outbound traffic only to the ECS task security group on frontend port 3000.

Do not open the Application Load Balancer to arbitrary internet source CIDRs.

### 9.2 Application Load Balancer to ECS

Create one ECS task security group.

Allow inbound TCP port 3000 only from the Application Load Balancer security group.

Do not allow inbound traffic to port 8000.

Allow outbound HTTPS traffic for Supabase and external services.

Allow outbound DNS traffic required by the VPC resolver.

The frontend and backend do not need security-group rules to communicate with each other because containers in the same Fargate task share the task network namespace and can use `127.0.0.1`.

## 10. TLS and DNS names

### 10.1 Certificates

Create one ACM certificate in `us-east-1` for CloudFront.

Include:

- `wat2do.io`
- `www.wat2do.io`

Create one ACM certificate in `us-west-2` for the Application Load Balancer origin.

Include:

- `origin.wat2do.io`

Use DNS validation through the Terraform-managed Route 53 zone.

Use Terraform provider aliases for `us-west-2` and `us-east-1`.

### 10.2 Origin hostname

Create `origin.wat2do.io` as a Route 53 alias to the Application Load Balancer.

CloudFront uses `origin.wat2do.io` as its HTTPS origin.

The origin hostname is infrastructure plumbing and is not a user-facing deployment environment.

### 10.3 Public hostnames

Create Route 53 aliases for:

- `wat2do.io`
- `www.wat2do.io`

Both aliases point to the CloudFront distribution.

Do not create a second user-facing AWS test hostname.

## 11. Application Load Balancer

Create one internet-facing Application Load Balancer spanning the two public subnets.

Create one HTTPS listener on port 443.

Use the regional ACM certificate for `origin.wat2do.io`.

Create one IP target group for frontend port 3000.

Configure the health check:

- Protocol: HTTP.
- Path: `/healthz`.
- Port: traffic port.
- Success code: 200.
- Healthy threshold: 2.
- Unhealthy threshold: 3.
- Interval: 15 seconds.
- Timeout: 5 seconds.

The Application Load Balancer must not target the backend container.

The frontend remains the only public ingress path and preserves the existing same-origin `/api` contract.

## 12. CloudFront

### 12.1 Distribution

Create one CloudFront distribution with:

- Aliases for `wat2do.io` and `www.wat2do.io`.
- The `us-east-1` ACM certificate.
- HTTP-to-HTTPS redirect.
- HTTP/2 and HTTP/3 enabled.
- Compression enabled.
- IPv6 enabled.
- TLS 1.2 as the minimum viewer protocol.
- `origin.wat2do.io` as the custom HTTPS origin.

### 12.2 Default behavior

The default behavior handles Next.js pages and dynamic routes.

Configure:

- All required HTTP methods.
- Caching disabled.
- All query strings forwarded.
- All cookies forwarded.
- Viewer headers forwarded except the original `Host` header.
- Authorization forwarded.
- Response streaming preserved.

The default behavior must not retain HTML at the CloudFront edge.

### 12.3 API behavior

Add an `/api/*` behavior.

Configure:

- All HTTP methods.
- Caching disabled.
- Request bodies forwarded.
- All query strings forwarded.
- All cookies forwarded.
- Authorization forwarded.
- Relevant CORS and content headers forwarded.

This behavior covers normal API proxy calls and `/api/revalidate-events`.

### 12.4 Next.js static behavior

Add a `/_next/static/*` behavior.

Configure:

- GET and HEAD only.
- Long-lived optimized caching.
- Compression enabled.
- No cookies in the cache key.
- No query strings in the cache key.
- No authorization forwarding.

Next.js static asset filenames are content-addressed and safe to cache immutably.

### 12.5 Next.js image behavior

Add a `/_next/image*` behavior.

Configure:

- GET and HEAD only.
- A custom cache policy that includes all image optimizer query parameters.
- The `Accept` header in the cache key.
- No cookies.
- Compression enabled.

Do not use the generic static-asset cache policy for `/_next/image` because image variants depend on query parameters and accepted formats.

### 12.6 ISR constraint

Do not cache school-page HTML at CloudFront.

The Next.js server remains the only owner of page and data revalidation.

The existing `revalidateTag(tag, "max")` behavior may serve one stale response while regeneration occurs.

ISR verification must account for that stale-while-revalidate behavior.

## 13. ECS cluster and service

### 13.1 ECS cluster

Create one ECS cluster named consistently with `wat2do-production`.

Enable Container Insights.

Use the Fargate capacity provider.

Do not configure Fargate Spot for the continuously running application task.

### 13.2 Application task definition

Create one ARM64 Linux Fargate task definition.

Initial task sizing:

- Task CPU: 1024 units.
- Task memory: 2048 MiB.
- Ephemeral storage: default 20 GiB.

Define two essential containers:

- `frontend`
- `backend`

Allocate 512 CPU units and 1024 MiB memory to each container initially.

Use `awsvpc` network mode.

Do not mount EFS.

Do not mount Docker volumes.

### 13.3 Backend container

Configure:

- Container port 8000.
- A container health check against `http://127.0.0.1:8000/health`.
- CloudWatch Logs using the `awslogs` driver.
- A non-root runtime user.
- Read-only application source where practical.
- A writable `/tmp`.

The backend does not receive a public load-balancer target.

### 13.4 Frontend container

Configure:

- Container port 3000.
- A container health check against `http://127.0.0.1:3000/healthz`.
- A dependency on the backend reaching `HEALTHY`.
- CloudWatch Logs using the `awslogs` driver.
- A non-root runtime user.
- A writable `.next/cache` directory.
- A writable `/tmp`.

### 13.5 Service

Create one ECS service with:

- Desired count: 1.
- Fargate capacity provider.
- Private subnets.
- Public IP assignment disabled.
- Frontend target-group registration.
- ECS managed tags enabled.
- Deployment circuit breaker enabled.
- Automatic rollback enabled.
- Health-check grace period configured.
- `minimumHealthyPercent = 0`.
- `maximumPercent = 100`.
- ECS Exec disabled by default.

The stop-before-start policy prevents transient duplicate frontend cache owners.

If ECS Exec is later required for diagnosis, add it intentionally with a dedicated IAM policy and audit logging.

### 13.6 Task-definition ownership

Terraform owns:

- Task family.
- CPU and memory.
- Roles.
- Port mappings.
- Environment structure.
- Secret references.
- Log configuration.
- Health checks.
- Service configuration.

GitHub Actions owns:

- Application image versions.
- New release task-definition revisions.
- ECS service updates to those release revisions.

Configure the Terraform ECS service to ignore drift only for the active task-definition revision.

Do not ignore changes to desired count, networking, target groups, deployment configuration, or tags.

When Terraform changes the task-definition structure, the infrastructure workflow must register the updated base revision and then trigger the normal application deployment workflow so the service receives both current images and current infrastructure settings.

## 14. IAM runtime roles

### 14.1 ECS execution role

Create one ECS execution role.

Grant:

- ECR image pull permissions.
- CloudWatch Logs stream creation and writes.
- `secretsmanager:GetSecretValue` for `wat2do/production/runtime`.
- KMS decrypt only if a customer-managed KMS key is introduced.

Do not grant application-level AWS permissions to the execution role.

### 14.2 ECS task role

Create one application task role.

The initial application task does not need broad AWS API access because application state remains in Supabase.

Grant no S3, DynamoDB, ECS, IAM, or Secrets Manager read permissions to application code unless a verified runtime call requires them.

### 14.3 Scheduler role

Create one EventBridge Scheduler execution role.

Grant:

- `ecs:RunTask` for the exact jobs task-definition family.
- `iam:PassRole` for the exact ECS execution and jobs task roles.

Restrict runs to the wat2do cluster.

### 14.4 Job task role

Create one jobs task role.

Keep it empty unless a job directly calls an AWS API.

Supabase and external API credentials are injected by ECS rather than fetched by application code.

## 15. Runtime configuration contract

### 15.1 Backend environment

Audit `backend/core/config.py` and every direct `os.getenv` call before finalizing the task definition.

The expected non-secret backend environment includes:

- `ENVIRONMENT=production`
- `CORS_ORIGINS=["https://wat2do.io","https://www.wat2do.io"]`
- `COOKIE_DOMAIN=.wat2do.io`
- `COOKIE_SECURE=true`
- `REFRESH_COOKIE_PATH=/api/auth/refresh`
- `FRONTEND_URL=https://wat2do.io`
- `EVENT_FEED_REVALIDATION_URL=http://127.0.0.1:3000/api/revalidate-events`
- `EVENT_FEED_REVALIDATION_TIMEOUT=3`

The expected secret-backed backend environment includes:

- `SUPABASE_URL`
- `SUPABASE_KEY`
- `SUPABASE_SECRET_KEY`
- `DATABASE_URL`
- `OPENAI_API_KEY`
- `APIFY_API_TOKEN`
- `EMAIL_PROVIDER_API_KEY`
- `EVENT_FEED_REVALIDATION_SECRET`

Set `EMAIL_PROVIDER=resend` and the configured `EMAIL_FROM` as non-secret values unless implementation confirms a reason to keep them secret.

Do not copy obsolete Railway, Vercel, or AWS credentials into the runtime secret.

### 15.2 Trusted proxy behavior

The frontend proxy calls the backend over loopback.

Keep loopback addresses as the only trusted proxies unless production verification shows that Next.js supplies a different immediate peer address.

Verify that rate limiting reads the intended client address through the existing forwarded headers.

Do not trust the entire VPC or Docker private-address ranges.

### 15.3 Frontend build environment

The frontend build expects:

- `NEXT_PUBLIC_API_URL=/api`
- `API_REWRITE_URL=http://127.0.0.1:8000`
- `BACKEND_API_URL=http://127.0.0.1:8000`
- `NEXT_PUBLIC_MAPBOX_TOKEN`
- `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`
- `NEXT_PUBLIC_POSTHOG_HOST`
- `APP_VERSION=<full-git-sha>`

Public Next.js variables are embedded into the client bundle during `next build`.

The deployment workflow must fetch the frontend-build secret before building the frontend image.

The workflow must mask retrieved values and must not echo them.

### 15.4 Frontend runtime environment

Inject:

- `NODE_ENV=production`
- `PORT=3000`
- `EVENT_FEED_REVALIDATION_SECRET`

Keep server-only backend addresses available at runtime if the final standalone build reads them during server startup.

Do not expose the revalidation secret through a `NEXT_PUBLIC_` variable.

## 16. Container changes

### 16.1 Frontend production build

Update `frontend/next.config.ts` to enable standalone output.

Use the existing API rewrite logic.

Add a deterministic build identifier derived from `APP_VERSION` if the installed Next.js version supports it without changing route behavior.

Do not add a second configuration file for AWS.

### 16.2 Frontend Dockerfile

Replace the current full `node_modules` runtime copy with a standard standalone multi-stage image.

The build stage:

1. Uses Node.js 22.
2. Installs dependencies with `npm ci`.
3. Receives the required build arguments.
4. Runs `npm run build`.

The runtime stage:

1. Uses a slim Node.js 22 image.
2. Creates a non-root application user.
3. Copies `.next/standalone`.
4. Copies `.next/static`.
5. Copies `public`.
6. Creates and owns the writable cache and temporary directories.
7. Starts `server.js`.

The Dockerfile must continue supporting ARM64.

### 16.3 Frontend health route

Add one minimal `GET /healthz` route.

The route returns a small JSON response and status 200.

The route must not call Supabase or the backend.

Backend health is already enforced by the backend container dependency and health check.

### 16.4 Backend Dockerfile

Keep Python 3.12.

Use a multi-stage build if it materially reduces the runtime image without complicating dependency installation.

Remove build tools from the final runtime stage.

Run as a non-root user.

Keep one Uvicorn worker initially.

Add a container-level health check or rely on the ECS task-definition health check, but do not define two different health commands.

Use the task-definition health check as the source of truth.

## 17. CloudWatch

### 17.1 Log groups

Create separate log groups:

- `/wat2do/production/frontend`
- `/wat2do/production/backend`
- `/wat2do/production/jobs`

Use a 30-day retention period.

Tag log groups consistently.

Do not log secret values, authorization headers, refresh cookies, Supabase service-role keys, or complete database URLs.

### 17.2 Basic alarms

Create alarms for:

- ECS service running task count below one.
- Application Load Balancer unhealthy host count above zero.
- Application Load Balancer target 5xx responses above a small threshold.
- Frontend container CPU above 85 percent for a sustained window.
- Task memory above 85 percent for a sustained window.
- EventBridge scheduled task invocation failures.

Create the alarms even if no notification endpoint is configured initially.

Expose an optional SNS topic ARN variable for later notification delivery.

Do not require an email-subscription confirmation to complete this project.

### 17.3 Dashboard

Create one small CloudWatch dashboard containing:

- ECS CPU.
- ECS memory.
- Running task count.
- Application Load Balancer request count.
- Target response time.
- HTTP 4xx and 5xx counts.
- Unhealthy target count.
- Scheduled-task failure count.

## 18. Scheduled and triggered jobs

### 18.1 Shared jobs task definition

Create one ARM64 Fargate jobs task definition using the backend image.

Initial sizing:

- CPU: 1024 units.
- Memory: 2048 MiB.

Use the same runtime secret and non-secret backend configuration as the service backend.

Send logs to `/wat2do/production/jobs`.

Do not run Uvicorn in the jobs task.

Every invocation overrides the container command.

### 18.2 Daily directory scrape

Replace `.github/workflows/daily-directory-scrape.yml` execution with EventBridge Scheduler.

Use the existing schedule unless implementation discovers that its documented time and cron expression disagree.

Run:

```text
python jobs/scrape_directories.py
```

Apply a maximum runtime and configure failed invocation handling.

### 18.3 Notification dispatcher

Replace `.github/workflows/daily-new-events-email.yml` execution with EventBridge Scheduler.

Run hourly at the same UTC minute as the current workflow.

Run:

```text
python jobs/send_notifications.py --only daily-new-events
```

Keep timezone eligibility and delivery idempotency in application code.

Do not create one schedule per school.

### 18.4 Recommendation computation

Replace `.github/workflows/nightly-recs.yml` execution with EventBridge Scheduler.

Run:

```text
python -m recommender.job
```

Keep the existing nightly schedule.

### 18.5 Single-user scrape

Keep the GitHub workflow only as an authenticated event and manual trigger.

Replace local Python installation and execution with `aws ecs run-task`.

Pass the username, recipient ID, and cutoff days as a command override.

Validate the username and recipient ID before constructing the ECS override JSON.

Wait for the ECS task to stop.

Fail the GitHub workflow when the container exit code is nonzero.

Link or print the CloudWatch log-stream name without printing secrets.

### 18.6 Nightly redeployment

Delete `.github/workflows/nightly-redeploy.yml`.

The main deployment workflow is the only application deployment path.

Do not replace the nightly redeployment schedule in AWS.

## 19. GitHub Actions

### 19.1 Pull-request checks

Preserve the existing backend checks:

- Dependency installation.
- Ruff formatting check.
- Ruff lint.
- Mypy.
- Pytest.

Preserve the existing frontend checks:

- Dependency installation.
- ESLint.
- i18n literal audit.
- TypeScript typecheck.
- Next.js production build.

Preserve the existing Waterloo Commons checks and deployment behavior unless the human separately places Waterloo Commons in this migration scope.

The primary wat2do AWS migration must not accidentally move or delete the Waterloo Commons deployment.

### 19.2 Terraform checks

Add a Terraform workflow triggered by changes under `infra/terraform/**`.

On pull requests, run:

- `terraform fmt -check -recursive`
- `terraform init -backend=false`
- `terraform validate`
- `tflint`

Run a production Terraform plan through GitHub OIDC when the foundation already exists.

Store the plan as a workflow artifact only when an apply job will consume that exact plan.

Do not print sensitive Terraform values.

### 19.3 Infrastructure apply

Apply foundation and production roots independently.

Serialize applies with GitHub Actions concurrency groups.

Run applies only from `main`.

Use the infrastructure OIDC role.

Do not run `terraform apply -auto-approve` from pull-request events.

This toy-project plan does not require a manual production approval gate.

### 19.4 Application image build

After application checks pass on `main`:

1. Authenticate with the deployment OIDC role.
2. Log in to ECR.
3. Set up QEMU.
4. Set up Docker Buildx.
5. Fetch and mask frontend build values.
6. Build the backend image for `linux/arm64`.
7. Build the frontend image for `linux/arm64`.
8. Tag both images with the full Git commit SHA.
9. Push both images to ECR.
10. Capture the resulting image digests.

Build both images for every production release so a task revision always represents one repository commit.

Do not deploy a frontend image from one commit with a backend image from another commit.

### 19.5 ECS deployment

After both pushes succeed:

1. Download the latest active task definition for the wat2do application family.
2. Replace the frontend image with the new frontend digest.
3. Replace the backend image with the new backend digest.
4. Register one new task-definition revision.
5. Update the ECS service to that exact revision.
6. Wait for ECS service stability.
7. Query the stopped task if deployment fails.
8. Surface the stopped reason and recent CloudWatch logs.

The ECS deployment circuit breaker handles service rollback.

Because the service uses stop-before-start, the deployment can briefly make the application unavailable.

### 19.6 ECR cleanup

Do not add image cleanup steps to GitHub Actions.

The Terraform-managed ECR lifecycle policies are the only image-retention implementation.

## 20. Direct DNS replacement

### 20.1 DNS inventory

Inventory existing Vercel DNS records before changing nameservers.

This inventory is required to preserve domain functions such as email, not to create a parallel application deployment.

Commit the non-secret DNS records to `foundation/route53.tf` or a clearly named adjacent file.

### 20.2 Nameserver change

Apply the foundation stack and obtain the Route 53 nameservers.

Change the domain registrar nameservers directly from Vercel DNS to Route 53.

Do not create a staged application subdomain.

Wait only for the DNS delegation required for ACM validation and resource creation.

### 20.3 AWS public records

After ACM validation and CloudFront creation, apply:

- `origin.wat2do.io` to the Application Load Balancer.
- `wat2do.io` to CloudFront.
- `www.wat2do.io` to CloudFront.

### 20.4 Provider removal

After direct production verification succeeds:

- Remove the Railway deployment job.
- Remove the Vercel frontend deployment job.
- Remove Railway project identifiers.
- Remove all Vercel project identifiers and deployment configuration.
- Remove `RAILWAY_TOKEN` from repository secrets.
- Remove all Vercel deployment credentials from GitHub repository secrets.
- Remove obsolete local Railway and Vercel variables from `.env.example` files.

Retire the standalone Waterloo Commons Vercel project when no AWS replacement is in scope.

## 21. Exact repository blast radius

### 21.1 New files

Expected new files:

- `docs/projects/aws-terraform-migration.md`
- `infra/terraform/foundation/*.tf`
- `infra/terraform/foundation/foundation.tfvars.example`
- `infra/terraform/foundation/.terraform.lock.hcl`
- `infra/terraform/production/*.tf`
- `infra/terraform/production/production.tfvars.example`
- `infra/terraform/production/.terraform.lock.hcl`
- `.github/workflows/terraform.yml`
- `frontend/src/app/healthz/route.ts`

### 21.2 Modified files

Expected modified files:

- `.github/workflows/ci-cd.yml`
- `.github/workflows/daily-directory-scrape.yml`
- `.github/workflows/daily-new-events-email.yml`
- `.github/workflows/nightly-recs.yml`
- `.github/workflows/process-single-user.yml`
- `frontend/next.config.ts`
- `frontend/Dockerfile`
- `frontend/.env.example`
- `backend/Dockerfile`
- `backend/.env.example`
- `.gitignore`
- `README.md`

`README.md` should document the AWS runtime and normal deployment path after the deployment exists.

### 21.3 Deleted files

Expected deletion:

- `.github/workflows/nightly-redeploy.yml`

Other workflow files should be deleted only when their behavior is fully represented by Terraform-managed schedules or a single ECS-trigger workflow.

### 21.4 Files expected to remain behaviorally unchanged

The following should not require functional changes:

- `frontend/src/app/api/revalidate-events/route.ts`
- `frontend/src/features/events/api/eventFeed.server.ts`
- `backend/services/event_feed_revalidation.py`
- `backend/main.py`
- `backend/core/config.py`
- Supabase migrations.
- Generated OpenAPI types.
- Frontend API clients.
- Authentication endpoints.
- Storage service implementation.

If implementation discovers that one of these files must change, report the reason and updated contract before editing it.

## 22. Implementation order

This order exists to satisfy technical dependencies.
It is not a staged migration or a parallel safety rollout.

### 22.1 Foundation

1. Add the Terraform directory structure.
2. Create the state bucket.
3. Migrate foundation state into S3.
4. Create Route 53, ECR, secret containers, OIDC, and deployment roles.
5. Populate the runtime and frontend-build secrets.
6. Change registrar nameservers to Route 53.

Done when:

- Terraform state is remote and locked.
- The hosted zone is authoritative.
- Both ECR repositories exist.
- GitHub can assume the deployment role.
- Secret containers have current values.

### 22.2 Container preparation

1. Add standalone Next.js output.
2. Add the frontend health route.
3. Harden and reduce the frontend image.
4. Harden and reduce the backend image.
5. Build both ARM64 images.
6. Push the first commit-SHA images to ECR.

Done when:

- Both containers build for ARM64.
- Both containers run locally.
- The frontend reaches the backend through loopback-compatible configuration.
- Both health checks pass.
- The frontend image contains no runtime development server.

### 22.3 Production infrastructure

1. Create networking.
2. Create security groups.
3. Create runtime IAM roles.
4. Create CloudWatch resources.
5. Create certificates.
6. Create the Application Load Balancer.
7. Create the task definition.
8. Create the ECS service.
9. Create CloudFront.
10. Create public application records.

Done when:

- One healthy ECS task is running.
- CloudFront serves `wat2do.io`.
- `/api/*` reaches the backend through the frontend.
- The backend has no public target or public IP.

### 22.4 Deployment automation

1. Replace Railway deployment with ECR and ECS deployment.
2. Replace Vercel primary-frontend deployment with the same ECS release job.
3. Add immutable image tags and digest capture.
4. Add task-definition rendering.
5. Add service-stability waiting.
6. Add failure diagnostics.
7. Delete nightly redeployment.

Done when:

- A push to `main` deploys both images to one ECS task revision.
- GitHub uses OIDC.
- No application deployment uses Railway or Vercel.
- No deployment uses `latest`.

### 22.5 Job migration

1. Add the jobs task definition.
2. Add EventBridge schedules.
3. Convert the single-user workflow to `ecs:RunTask`.
4. Disable and then delete duplicate GitHub-hosted job execution.

Done when:

- Each recurring job has exactly one scheduler.
- Job compute executes on Fargate.
- Job logs appear in CloudWatch.
- A failed task produces a failed invocation or workflow.

### 22.6 Final cleanup

1. Remove obsolete provider secrets and identifiers.
2. Remove obsolete environment examples.
3. Update deployment documentation.
4. Search the repository for Railway and primary-frontend Vercel deployment references.
5. Remove dead workflows and unused variables.

Done when:

- Supabase is the only retained core hosting dependency outside AWS.
- GitHub is used for source control and CI/CD orchestration, not recurring application compute.
- The repository has one obvious production deployment path.

## 23. Verification plan

### 23.1 Terraform verification

Run:

```text
terraform fmt -check -recursive
terraform init
terraform validate
tflint
terraform plan
```

Review the plan for:

- Unexpected resource replacement.
- Public ECS task IP assignment.
- Overly broad security-group ingress.
- Secret values.
- Unrestricted IAM resources.
- CloudFront HTML caching.
- Missing Route 53 records.

### 23.2 Container verification

Build both images for `linux/arm64`.

Run the images locally with the production-style loopback URLs.

Verify:

- Backend `/health` returns 200.
- Frontend `/healthz` returns 200.
- Frontend `/api` rewrites reach the backend.
- The frontend starts only after the backend is healthy in the ECS definition.
- The Next.js runtime can write its cache directory.
- Both containers run as non-root.

### 23.3 Repository checks

Run the complete required repository verification:

- Backend Ruff formatting.
- Backend Ruff lint.
- Backend Mypy.
- Backend Pytest.
- Frontend ESLint.
- Frontend i18n audit.
- Frontend TypeScript typecheck.
- Frontend production build.
- Waterloo Commons checks.
- Pitch-deck verification if required by `PUSH_TO_MAIN.md`.
- Any other checks required by `PUSH_TO_MAIN.md`.

### 23.4 Production application verification

Verify directly on `https://wat2do.io`:

1. The homepage returns 200.
2. A school event page renders.
3. Static JavaScript and CSS load through CloudFront.
4. `/_next/image` returns the requested variant.
5. A public `/api/events/` request reaches FastAPI.
6. Login succeeds.
7. The refresh cookie is set on the expected domain and path.
8. Token refresh succeeds through `/api/auth/refresh`.
9. Logout clears the refresh cookie.
10. Authenticated profile loading succeeds.
11. An image upload reaches Supabase Storage.
12. A backend event mutation succeeds.
13. The backend calls the frontend revalidation route.
14. The first post-invalidation school-page request is allowed to be stale.
15. A subsequent request contains the updated event data.
16. CloudFront does not continue serving old HTML.
17. Frontend and backend logs appear in separate CloudWatch log groups.

### 23.5 Scheduled job verification

Manually invoke each scheduled ECS task once:

- Directory scrape.
- Notification dispatcher in a mode that cannot send unintended duplicate mail.
- Recommendation computation.
- Single-user scrape with a known test input.

Verify:

- The task starts in a private subnet.
- The task obtains its secrets.
- The command exits successfully.
- Logs appear in the jobs log group.
- The task stops after completion.
- The scheduler records failures correctly.

## 24. Failure handling during implementation

This project does not build a parallel hosting fallback.

Implementation still needs clear failure diagnosis.

If a Fargate task fails to start, inspect:

- ECS stopped reason.
- ECR image architecture.
- Execution-role permissions.
- Secret ARN permissions.
- Container exit code.
- CloudWatch startup logs.
- Health-check command.

If the Application Load Balancer marks the task unhealthy, inspect:

- Frontend health route.
- Task security group.
- Target port.
- Backend dependency health.
- Health-check grace period.

If CloudFront returns an error, inspect:

- Origin certificate name.
- `origin.wat2do.io` resolution.
- CloudFront-to-ALB security-group allowance.
- Origin request policy.
- Allowed methods.

If ISR does not refresh, inspect:

- Shared revalidation-secret equality.
- Backend revalidation URL.
- Frontend route logs.
- School identifier normalization.
- CloudFront cache policy.
- Whether verification stopped after the expected first stale response.

## 25. Definition of done

The project is complete only when all of the following are true:

- Terraform owns the documented AWS resources.
- Terraform state is encrypted, versioned, remote, and locked.
- Route 53 is authoritative for `wat2do.io`.
- CloudFront serves the primary domain.
- The Application Load Balancer accepts origin traffic from CloudFront.
- One private Fargate task runs the frontend and backend.
- The frontend is the only public application ingress.
- The backend is reachable from the frontend over loopback.
- The backend can invalidate the frontend event-feed cache over loopback.
- On-demand ISR works with the existing application implementation.
- Supabase database, authentication, and storage continue working.
- GitHub uses OIDC for AWS deployment.
- Frontend and backend images are immutable and commit-addressed.
- ECR lifecycle policies own image cleanup.
- A push to `main` runs checks and deploys one coherent application revision.
- Recurring backend compute runs through EventBridge Scheduler and ECS.
- Single-user scrape compute runs on ECS.
- CloudWatch contains frontend, backend, and jobs logs.
- Basic service alarms exist.
- Railway deployment code and secrets are removed.
- Vercel deployment code, projects, and secrets are removed.
- Nightly redeployment is deleted.
- There is exactly one production deployment path.
- Tests, typecheck, lint, Terraform validation, container builds, and production verification pass.
