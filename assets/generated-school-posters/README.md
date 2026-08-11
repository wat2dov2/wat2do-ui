# Generated School Posters

This directory is the canonical home for school marketing posters derived from the Wat2Do database.
Each generation writes one stable directory per school and database-owned semester range:

```text
<school>/<semester-start>-to-<semester-end>/
  poster-data.json
  observed-clubs.png
  found-events.png
  semester-recap.png
```

`poster-data.json` is the exact prop object used by the React poster components.
The PNG files can always be regenerated from that manifest by the frontend renderer.

## Generate from the configured database

Run from `backend/` so the backend `.env` supplies the Supabase service credentials and frontend origin:

```bash
.venv/bin/python scripts/generate_school_posters.py --school columbia
.venv/bin/python scripts/generate_school_posters.py --all-schools
```

The generator is read-only.
Before treating an output as production-derived, confirm that `backend/.env` points at the production Supabase project and that the checkout matches the deployed schema.

## Data rules

- The club claim counts distinct observed organizer identities, using organization IDs when present and event handles for legacy catalog rows.
- The all-time event claim counts non-cancelled logical events.
- The recap uses the school's database semester dates when they belong to the active Winter, Spring, or Fall season.
- If the school row has already advanced to a later season, the recap uses the active four-month season instead.
- Recap event, club, food, and award counts use distinct logical events with an occurrence in that range.
- The heatmap and busiest date count actual occurrences in the school timezone.
- Food mentions come from structured `events.food` values.
- Announcement awards compare `events.added_at` with the first in-term occurrence.
- Stable sort keys resolve every tie, so the same manifest always renders the same posters.
