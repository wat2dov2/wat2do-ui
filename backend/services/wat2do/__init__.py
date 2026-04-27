"""wat2do scraping pipeline.

Ports v1's Apify-based Instagram scraper to v2's FastAPI + Supabase
stack. Public surface: ``run_pipeline`` in ``pipeline.py`` orchestrates
the four-stage flow (filter -> upload -> extract -> save). The job
entrypoint at ``backend/jobs/scrape.py`` shells out to it.

Module-level imports here are intentionally empty: the pipeline pulls
in ``apify_client`` and other heavy deps that we don't want to import
just because a test touches a sibling module (e.g. ``dedup.py``).
"""
