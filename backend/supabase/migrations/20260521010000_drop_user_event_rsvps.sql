-- Migration: drop_user_event_rsvps
-- Created: 2026-05-21
--
-- RSVP never graduated into a user-facing frontend feature. Remove the
-- backend-only table so the schema matches the simplified event product.
--
-- Destructive: drops existing RSVP rows. Safe to re-run.

BEGIN;

DROP TABLE IF EXISTS public.user_event_rsvps;

COMMIT;
