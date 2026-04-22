-- Migration: add FK on scraped_events.event_id and tighten source length
-- Created: 2026-04-16
--
-- Problem (audit M9): scraped_events.event_id has no FK to events(id),
-- allowing orphaned rows if an event is deleted or a typo'd event_id is
-- written.  The ``source`` column is also an unconstrained VARCHAR(255)
-- — schema-layer tightening (max_length, character allowlist) is done
-- in ``schemas/scraped_event.py`` so the DB stays backwards compatible
-- with whatever historical sources are already stored.
--
-- Design decisions:
--   * ON DELETE SET NULL for scraped_events.event_id: the scraped
--     metadata is still useful for audit / reprocessing even if the
--     normalised event is later deleted, and the existing column
--     definition already allows NULL (no NOT NULL to drop).
--   * Orphans are cleared before adding the FK so ADD CONSTRAINT does
--     not fail on existing data.  This is consistent with the earlier
--     migration 20260409031953 which adopted the same approach.

-- Clean up orphaned rows (non-null event_id pointing at a row that no
-- longer exists).  Fix-up sets the column to NULL rather than deleting
-- the scraped row so moderator history is preserved.
UPDATE scraped_events
   SET event_id = NULL
 WHERE event_id IS NOT NULL
   AND event_id NOT IN (SELECT id FROM events);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_scraped_events_event_id'
    ) THEN
        ALTER TABLE scraped_events
            ADD CONSTRAINT fk_scraped_events_event_id
            FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Helpful compound index for admin queries that filter by source and
-- then order by scraped_at (the list endpoint's default ordering).
CREATE INDEX IF NOT EXISTS ix_scraped_events_source_scraped_at
    ON scraped_events (source, scraped_at DESC);
