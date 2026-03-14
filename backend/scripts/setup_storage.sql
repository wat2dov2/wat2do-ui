-- Supabase Storage Setup
-- Creates buckets and RLS policies for file uploads

-- Create storage buckets
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
