-- Migration: add CHECK constraints to ab_test_events.variant and event_type
-- Created: 2026-04-16
--
-- Problem (audit M3): ab_test_events has no CHECK constraints on
-- ``variant`` or ``event_type``, so a typo ("clik" instead of "click")
-- is silently accepted — but get_ab_test_ctr() only counts the exact
-- strings 'impression' and 'click', so the typo drops out of the CTR
-- numerator and corrupts the experiment result.
--
-- Fix: enforce the valid labels at the data layer.  ABTestService only
-- inserts canonical values (AB_EVENT_IMPRESSION / AB_EVENT_CLICK and
-- AB_VARIANT_CONTROL / AB_VARIANT_TREATMENT), so existing rows already
-- satisfy the constraint — no data cleanup needed.
--
-- Note on rate limiting for /recommendations/ (M3 rider):
-- The audit also recommends a per-user rate limit on the recommendations
-- endpoint to prevent bot-driven impression inflation.  That router is
-- owned by the recommender agent, so this migration does not touch it;
-- see the coordination note in the PR body.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_ab_test_events_variant'
    ) THEN
        ALTER TABLE ab_test_events
            ADD CONSTRAINT chk_ab_test_events_variant
            CHECK (variant IN ('control', 'treatment'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_ab_test_events_event_type'
    ) THEN
        ALTER TABLE ab_test_events
            ADD CONSTRAINT chk_ab_test_events_event_type
            CHECK (event_type IN ('impression', 'click'));
    END IF;
END $$;
