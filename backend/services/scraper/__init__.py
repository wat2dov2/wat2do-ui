"""wat2do scraping pipeline.

Public surface: ``run_pipeline`` in ``pipeline.py`` orchestrates
filter -> upload -> extract -> reconcile -> save for one prefetched
handle. The job entrypoint at ``backend/jobs/scrape.py`` fetches posts
via public embeds (exact URLs) or Apify (manual usernames), then calls it.

Module-level imports here are intentionally empty: the pipeline pulls
in ``apify_client`` and other heavy deps that we don't want to import
just because a test touches a sibling module (e.g. ``dedup.py``).
"""
