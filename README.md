# Wat2Do 

<p align="center">
  <img src="frontend/public/wat2do-logo.svg" alt="Wat2Do Logo" width="180"/>
</p>

<p align="center">
  <a href="https://wat2do.io" target="_blank">
    <img src="https://img.shields.io/badge/Live%20Site-wat2do.io-blue?style=flat-square" alt="Live Site"/>
  </a>
  <a href="https://github.com/tonyqiu123/wat2do-ui/actions">
    <img src="https://img.shields.io/github/actions/workflow/status/tonyqiu123/wat2do-ui/ci-cd.yml?branch=main&style=flat-square" alt="GitHub Actions Status"/>
  </a>
</p>

<a href="https://wat2do.io" target="_blank">Wat2Do</a> is a web app to help you discover club events at the University of
Waterloo, scraped directly from Instagram by capturing all student club events within 10 minutes!

## ✨ Features

- **Browse, search, and filter events:** See upcoming and past events from campus clubs
- **Club directory:** Explore all clubs with links to their website/Instagram
- **Email newsletter:** Subscribe to get the latest events in your inbox, once daily

## 🚀 Environment Setup

### Database
```bash
docker compose up --build
```

### Backend
<!-- (expose PRODUCTION=1 in /backend/.env for supabase db, else defaults to local postgres db) -->
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py makemigrations
python manage.py migrate
# PRODUCTION=1 python manage.py migrate
python scripts/populate-local-db-with-prod-data.py 
python manage.py fix_sequences
python manage.py runserver 8000
```

### Frontend
```bash
cd frontend
npm install 
npm run dev
```

## Feature control boxes

Non-secret feature and algorithm tuning lives in one file per feature under [`backend/controlbox`](backend/controlbox).
These files are the single editable sources for event discovery and ISR, frontend cache policy, recommendations, morning-email selection, authentication lifetimes, organization invitations, notification defaults, credits and promotions, interaction behavior and abuse bounds, API rate limits, scraper behavior, email delivery, AI output size, admin pagination, public attendee previews, and Instagram publishing accounts.
The backend validates the complete directory at startup, rejects missing or unknown feature files, and rejects invalid values or conflicting limits, while the frontend imports only the feature files it needs at build time.
Environment-specific credentials, infrastructure sizing, database constraints, and UI constants intentionally stay with their owning systems.
Changes take effect after rebuilding the applications or restarting a scheduled Python job.

## Operating playbooks

- [`docs/seo_playbook.md`](docs/seo_playbook.md) is the maintained source of truth for SEO rules, page-quality gates, prioritization, measurement, and implementation TODOs.

## Production deployment

Wat2Do runs as one private AWS ECS Fargate task in `ca-central-1`.
The task contains the Next.js frontend on port 3000 and the FastAPI backend on port 8000.
CloudFront is the public edge, an Application Load Balancer is the HTTPS origin, and Supabase remains the database, authentication, and object-storage provider.
The encrypted Terraform state bucket and DynamoDB lock table remain in `us-west-2`; they do not affect Canadian application traffic.

Terraform is split into `infra/terraform/foundation` and `infra/terraform/production`.
Foundation creates the encrypted, versioned S3 state bucket, Route 53 zone, ECR repositories, secret containers, and GitHub OIDC roles.
Production creates the VPC, private Fargate workload, CloudFront, certificates, logging, and alarms.

The first foundation apply intentionally starts with local state because the state bucket does not yet exist.
Temporarily move `infra/terraform/foundation/backend.tf` outside that directory for this one local apply, then restore it before state migration.
After it creates the bucket, immediately migrate state to S3 using the `foundation/terraform.tfstate` key and the `wat2do-terraform-state-lock` DynamoDB lock table.
Populate the two Secrets Manager secret values from protected local files, not from Terraform variables or committed `.tfvars` files.
Before switching registrar nameservers, inventory every current Vercel DNS record and add all non-application records to `foundation.tfvars`.

The first ARM64 frontend and backend images must be pushed to ECR by digest before the initial production apply.
Once production exists, pushes to `main` use GitHub OIDC to build both images, tag them with the full commit SHA, register one ECS task-definition revision, and update the service.
Scheduled directory scraping, notifications, and recommendation compute run on GitHub-hosted runners.
The single-user scrape workflow remains an authenticated GitHub trigger but runs its compute in ECS.

## 🤝 Support

If you have questions or feedback, please reach out at <a href="https://wat2do.io/contact" target="_blank">wat2do.io/contact</a> or add a <a href="https://github.com/tonyqiu123/wat2do-ui/issues" target="_blank">GitHub issue</a>.

Enjoy discovering events!

## 💙 Funding

Wat2Do is proudly funded by the <a href="https://wusa.ca/about/your-money/funding/" target="_blank">**Student Life Endowment Fund (SLEF)**</a> of the Waterloo Undergraduate Student Association (WUSA).

<img src="frontend/public/SLEF Logo_Color Logo Name.png" alt="SLEF Logo" width="300"/>
