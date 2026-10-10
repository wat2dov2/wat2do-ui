"""wat2do scraping pipeline.

Public surface: ``process_post`` in ``pipeline.py`` orchestrates
upload -> extract -> reconcile -> save for one captured Instagram post or
official directory page. The local ingestion processor
(``services/ingestion/processor.py``) calls it for each queued capture.

Module-level imports here are intentionally empty: the pipeline pulls
in storage, model, and database deps that we don't want to import
just because a test touches a sibling module (e.g. ``dedup.py``).
"""
