-- Migration: bring storage buckets + RLS policies into the migration system
-- Created: 2026-04-17
--
-- Fixes audit finding D15: storage bucket creation and storage.objects
-- RLS policies live in scripts/setup_storage.sql and are NOT applied
-- by scripts/migrate.py.  A fresh Supabase project that runs
-- `migrate.py apply` ends up without buckets / policies, and uploads
-- fail silently (or worse, succeed against default-public policies
-- the team did not intend).
--
-- This migration is the verbatim content of scripts/setup_storage.sql
-- brought under the migration runner so every schema-affecting SQL
-- change is reproducible via `migrate.py apply`.
--
-- IMPORTANT: file_size_limit values must stay in sync with
--   MAX_IMAGE_SIZE_BYTES (5242880) and MAX_AVATAR_SIZE_BYTES (2097152)
-- defined in core/constants.py.  If those constants change, add a
-- follow-up migration that ALTERs the buckets.
--
-- All statements are idempotent (ON CONFLICT / EXCEPTION guards) so
-- this migration is safe to apply against existing Supabase projects.

-- Buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('event-images', 'event-images', true, 5242880, ARRAY['image/jpeg','image/png','image/webp','image/gif']),
  ('avatars', 'avatars', true, 2097152, ARRAY['image/jpeg','image/png','image/webp']),
  ('club-logos', 'club-logos', true, 2097152, ARRAY['image/jpeg','image/png','image/webp','image/svg+xml']),
  ('qr-assets', 'qr-assets', true, 5242880, ARRAY['image/jpeg','image/png','image/webp','image/svg+xml'])
ON CONFLICT (id) DO NOTHING;

-- RLS policies: authenticated uploads
DO $$ BEGIN
  CREATE POLICY "auth_insert_event_images" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'event-images');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "auth_insert_avatars" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "auth_insert_club_logos" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'club-logos');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "auth_insert_qr_assets" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'qr-assets');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS policies: public reads
DO $$ BEGIN
  CREATE POLICY "public_select_event_images" ON storage.objects FOR SELECT TO public USING (bucket_id = 'event-images');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "public_select_avatars" ON storage.objects FOR SELECT TO public USING (bucket_id = 'avatars');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "public_select_club_logos" ON storage.objects FOR SELECT TO public USING (bucket_id = 'club-logos');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "public_select_qr_assets" ON storage.objects FOR SELECT TO public USING (bucket_id = 'qr-assets');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS policies: authenticated deletes
DO $$ BEGIN
  CREATE POLICY "auth_delete_event_images" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'event-images');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "auth_delete_avatars" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'avatars');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "auth_delete_club_logos" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'club-logos');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "auth_delete_qr_assets" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'qr-assets');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS policies: authenticated updates (overwrite)
DO $$ BEGIN
  CREATE POLICY "auth_update_event_images" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'event-images');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "auth_update_avatars" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'avatars');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "auth_update_club_logos" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'club-logos');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "auth_update_qr_assets" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'qr-assets');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
