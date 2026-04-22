-- Migration: status_category_checks
-- Created: 2026-04-16
--
-- Fixes audit findings D3 and D4.
--
-- D3: event_submissions.status, reported_events.status, and
--     event_promotions.package are unconstrained VARCHAR — any string is
--     persisted.  The only validation lives in Pydantic schemas, so any
--     direct DB write (scripts, seeds, future code paths) can produce
--     rows whose status later fails Pydantic validation on read and 500s
--     the admin UI.
--
-- D4: events.category has no CHECK constraint and drift is demonstrably
--     real (see scripts/normalize_event_categories.py).  The canonical
--     set of 22 event categories lives in core/constants.py
--     (EVENT_CATEGORIES).
--
-- This migration:
--   1. Normalizes any drifted values in the affected columns before
--      adding the CHECK constraints (otherwise ADD CONSTRAINT would fail
--      on existing bad data).
--   2. Adds CHECK constraints matching the application-level Literal
--      types.
--
-- Idempotent: each constraint add is guarded by pg_constraint lookup.

-- =========================================================================
-- 1. event_submissions.status  IN ('pending','approved','rejected')
-- =========================================================================

UPDATE event_submissions
SET status = 'pending'
WHERE status IS NULL
   OR status NOT IN ('pending', 'approved', 'rejected');

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_event_submissions_status_valid'
    ) THEN
        ALTER TABLE event_submissions
            ADD CONSTRAINT chk_event_submissions_status_valid
            CHECK (status IN ('pending', 'approved', 'rejected'));
    END IF;
END $$;

-- =========================================================================
-- 2. reported_events.status  IN ('pending','resolved','dismissed')
-- =========================================================================

UPDATE reported_events
SET status = 'pending'
WHERE status IS NULL
   OR status NOT IN ('pending', 'resolved', 'dismissed');

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_reported_events_status_valid'
    ) THEN
        ALTER TABLE reported_events
            ADD CONSTRAINT chk_reported_events_status_valid
            CHECK (status IN ('pending', 'resolved', 'dismissed'));
    END IF;
END $$;

-- =========================================================================
-- 3. event_promotions.package IN ('featured','email','combo')
-- =========================================================================
-- The canonical set lives in core.constants.PROMOTION_PACKAGES (keys).
-- Using a CHECK with those names prevents arbitrary strings from
-- entering the table via direct INSERT or via a mistyped RPC call.

UPDATE event_promotions
SET package = 'featured'
WHERE package IS NULL
   OR package NOT IN ('featured', 'email', 'combo');

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_event_promotions_package_valid'
    ) THEN
        ALTER TABLE event_promotions
            ADD CONSTRAINT chk_event_promotions_package_valid
            CHECK (package IN ('featured', 'email', 'combo'));
    END IF;
END $$;

-- =========================================================================
-- 4. events.category IN (22 canonical values) OR NULL
-- =========================================================================
-- Mirror of core.constants.EVENT_CATEGORIES.  Keep NULL allowed for
-- legacy rows predating category tagging (the application treats NULL
-- as "uncategorized").

-- 4a. Normalize drifted values so the CHECK does not fail on existing
--     data.  Unknown categories are mapped to 'Academics' (same default
--     used by scripts/normalize_event_categories.py).  Callers should
--     still run that script after this migration to pick up the more
--     nuanced CATEGORY_NORMALIZE_MAP mappings — but the CHECK
--     guarantees no *new* bad values can land from this point on.
UPDATE events
SET category = 'Academics'
WHERE category IS NOT NULL
  AND category NOT IN (
      'Academics','Studying','Career','Networking','Games','Partying',
      'Athletics','Art','Dance','Culture','Religion','Advocacy',
      'Technology','Design','Entrepreneurship','Health','Wellness',
      'Mental Health','Music','Sports','Food','Volunteering'
  );

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_events_category_valid'
    ) THEN
        ALTER TABLE events
            ADD CONSTRAINT chk_events_category_valid
            CHECK (
                category IS NULL
                OR category IN (
                    'Academics','Studying','Career','Networking','Games','Partying',
                    'Athletics','Art','Dance','Culture','Religion','Advocacy',
                    'Technology','Design','Entrepreneurship','Health','Wellness',
                    'Mental Health','Music','Sports','Food','Volunteering'
                )
            );
    END IF;
END $$;
