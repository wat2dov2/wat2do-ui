"""wat2do scraping pipeline.

Public surface: ``process_post`` in ``pipeline.py`` orchestrates
upload -> extract -> reconcile -> save for one captured Instagram post or
official directory page. It is vestigial: the Rust ingestion processor runs a
Haiku agent instead, and nothing calls it.

Module-level imports here are intentionally empty: the pipeline pulls
in storage, model, and database deps that we don't want to import
just because a test touches a sibling module (e.g. ``dedup.py``).
"""
