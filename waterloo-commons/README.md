# Waterloo Commons Events

Waterloo Commons is a standalone event submission, curation, feed, and post-generation application.
Its source and Supabase migrations remain in this repository, but it has no active production hosting deployment.

## Run locally

1. Use Node.js 22.x.
2. Run `npm ci`.
3. Start the isolated local Supabase stack with `supabase start --experimental`.
4. Rebuild it from the checked-in migration with `supabase db reset`.
5. Copy `API_URL`, `PUBLISHABLE_KEY`, and `SECRET_KEY` from `supabase status -o env` into `.env.local` as `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY`.
6. Add the remaining values from `.env.example`.
7. Run `npm run dev` and open `http://localhost:3002`.

Never commit `.env.local` or production secrets.

## Routes

- `/` is the public event submission form.
- `/feed` is the authenticated curator feed.
- `/admin/review` is the authenticated curator review queue.
- `/admin/studio` is the authenticated free-form post studio.
- `/auth/login` is the unlisted curator entry point.
- `/api/maintenance/submissions` is the authenticated maintenance endpoint.

## Verification

Run `npm run lint`, `npm run type-check`, and `npm test` before changing this application.
Run `npm run build` with inert environment values when verifying a release candidate.

Any future production deployment must define one explicit hosting target, HTTPS origin, authenticated scheduled-maintenance mechanism, and secrets-management path before the service is made public again.
