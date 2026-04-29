# SCRIPTS_AUDIT.md

Static audit of every script in `backend/jobs/`, `backend/scripts/`, and
`backend/seeds/` against the post-PR live DB schema. **No script was
executed during this audit** — only `grep` / `cat` / `psql -c "select
column_name from information_schema.columns"`.

## Live events table (post-migration)

After the 7 migrations applied to the v2 Supabase project, the events
table has these 23 columns:

```
id, title, description, location, price, food, registration,
source_image_url, club_type, school, source_url, category,
organization, ig_handle, discord_handle, x_handle, tiktok_handle,
fb_handle, other_handle, display_handle, added_at, created_by, status
```

**Removed:** `dtstart_utc`, `dtend_utc` (now in `event_dates`).
**Type change:** `created_by` is `uuid` (was `text`).
**Added:** `status` (`'active'` / `'cancelled'`, default `'active'`).

## Per-script audit

For each script: does it reference any column that no longer exists,
or any type that's wrong post-migration?

| Script | DB touch | Schema fit | Notes |
|---|---|---|---|
| `jobs/scrape.py` | indirect (via `services.wat2do.pipeline`) | ✅ | Added in this PR; uses event_writer + event_date_service which are correct for the new schema |
| `jobs/compute_recommendations.py` | indirect (via `recommendation_service`) | ✅ | Service layer was updated in this PR to query `events_listing` view and dedup occurrences. Job just orchestrates. |
| `jobs/send_notifications.py` | indirect (via `notification_service`) | ✅ | Notification service was updated in this PR to read from `events_listing` and render `occurrences` diffs as bullets. |
| `seeds/events.py` | direct: `events.insert` + `event_dates.insert` | ✅ | Updated in Phase 8 commit `91a6dfe`. Pops `dtstart_utc`/`dtend_utc` from each seed dict and inserts a matching `event_dates` row after the events insert. `status` column gets the DB default `'active'`. |
| `seeds/clubs.py` | direct: `clubs.insert` | ✅ | Doesn't reference `created_by` so the text→uuid type change is irrelevant. |
| `seeds/users.py` | direct: `users.insert` | ✅ | Inserts test users with `email` + `supabase_auth_id` — both still exist as columns. |
| `seeds/run.py` | orchestrator only | ✅ | Just calls `users.seed()` → `events.seed()` → `clubs.seed()`. Production guard intact. |
| `scripts/delete_events.py` | direct: `events.select("id, title, organization")` + `events.delete()` | ✅ | Selected columns all survived Phase 8. CASCADE FK on `event_dates` handles the orphan-cleanup automatically. |
| `scripts/normalize_event_categories.py` | direct: `events.update({"category": ...})` | ✅ | `category` column unchanged. |
| `scripts/list_posters.py` | direct: `qr_codes.select("id, name, is_active")` | ✅ | Selected columns unchanged; doesn't read `qr_codes.created_by` so the text→uuid change is irrelevant here. |
| `scripts/run_evaluation.py` | indirect (via `recommender.evaluation`) | ✅ | Service layer wraps the schema. |
| `scripts/upload_seed_images.py` | none — uploads to Supabase Storage | ✅ | No DB touch. |
| `scripts/export_openapi.py` | none — boots FastAPI in-process and dumps OpenAPI | ✅ | No DB touch (well, importing the app does construct the supabase client, but no queries run). |
| `scripts/verify_qr_endpoints.sh` | none — curls public `GET /qr/{id}` redirect endpoint | ✅ | No DB touch directly; the QR admin lockdown from Phase 4 leaves this endpoint open for public scans. |

## Concrete grep results that drive the table above

### `dtstart_utc` / `dtend_utc` references

Only `seeds/events.py` mentions these — twice as input dict keys (the
seed literals) and twice as `payload.pop(...)` calls in the seed
function. The seed function pops both before the `events.insert(payload)`,
then inserts a matching `event_dates` row. Schema-correct.

```
seeds/events.py:42   (literal key in seed dict #1)
seeds/events.py:43   (literal key in seed dict #1)
seeds/events.py:57   (literal key in seed dict #2)
seeds/events.py:58   (literal key in seed dict #2)
seeds/events.py:73   (literal key in seed dict #3)
seeds/events.py:74   (literal key in seed dict #3)
seeds/events.py:93   (literal key in generated seed loop)
seeds/events.py:94   (literal key in generated seed loop)
seeds/events.py:125  (payload.pop("dtstart_utc", None))
seeds/events.py:126  (payload.pop("dtend_utc", None))
seeds/events.py:135  (key in event_dates insert payload)
seeds/events.py:136  (key in event_dates insert payload)
```

### `events.created_by` direct references

None. No script writes a value to this column directly, so the
text→uuid migration doesn't break anything in this layer.

### Direct `events` table writes

```
seeds/events.py:118   sb.table(EVENTS).select("id").eq("title", data["title"])
seeds/events.py:128   sb.table(EVENTS).insert(payload)
scripts/delete_events.py:26   sb.table(EVENTS).select("id, title, organization")
scripts/delete_events.py:31   sb.table(EVENTS).delete()
scripts/normalize_event_categories.py:63   sb.table(EVENTS).select(...)
scripts/normalize_event_categories.py:114  sb.table(EVENTS).update({"category": ...})
```

Every column referenced (`id`, `title`, `organization`, `category`)
exists post-migration. None reference the dropped columns.

## Caveats — things this audit doesn't cover

1. **Frontend code paths to the API.** The audit is backend scripts only.
   The frontend's submit-event flow still serializes `dtstart_utc` /
   `dtend_utc` at the top level (Phase 8 changed the API contract to
   `occurrences: [...]`). Submission via the FE will 422 until that's
   fixed. Tracked in `TODO.md` §0.

2. **Anything the user-supplied JSON in `event_submissions.event_data`
   carries.** That column is loose `jsonb` so the DB doesn't enforce
   shape; the EventCreate validator rejects pre-Phase-8 shapes at
   approval time.

3. **Workflow scripts** (the YAMLs in `.github/workflows/`). Those
   delegate to `jobs/scrape.py` (correct) and the existing
   `nightly-recs.yml` delegates to `jobs/compute_recommendations.py`
   (correct).

4. **Static analysis only.** None of these scripts were actually run
   against the live DB during this audit — that was an explicit
   constraint. To convert this audit into a runtime check, add a
   `pytest -m smoke` job that imports each script's `main()` with a
   dry-run flag and asserts no schema errors raise.

## Summary

All 14 scripts in `backend/jobs/`, `backend/scripts/`, and `backend/seeds/`
are schema-compatible with the post-PR live DB. The scripts that
directly write to the events table use only columns that survive Phase
8. Scripts that go through the service layer inherit the service-layer
fixes already in this PR.
