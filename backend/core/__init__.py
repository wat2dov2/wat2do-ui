"""Shared backend configuration, loaded before anything reads a time zone.

Time zones come only from the pinned ``tzdata`` package, never the host's
zoneinfo, which can be older than current law: British Columbia, Alberta and
Manitoba stopped falling back on 2026-11-01, and a Mac or container with an
older database still prints their winter times an hour off. Rust bundles its
own current database for the same reason (``rust/src/time_zones.rs``).
"""

import zoneinfo

zoneinfo.reset_tzpath(to=())
