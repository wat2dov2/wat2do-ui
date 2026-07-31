-- Restore automate_logs table to store live Android Automate and Python scrape job outputs
CREATE TABLE public.automate_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    event text NOT NULL,
    sender_id text,
    school text,
    ig_account text,
    post_url text,
    payload jsonb
);

-- Enable RLS
ALTER TABLE public.automate_logs ENABLE ROW LEVEL SECURITY;

-- Allow insert from authenticated service roles / admin webhooks (using service_role)
CREATE POLICY "Enable insert for service_role only" ON public.automate_logs
    FOR INSERT
    TO service_role
    WITH CHECK (true);

-- Allow select for admins only
CREATE POLICY "Enable read access for admins only" ON public.automate_logs
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.users u 
            WHERE u.supabase_auth_id = auth.uid()::text AND u.role = 'admin'
        )
    );

-- Enable Replica Identity for Realtime subscriptions
ALTER TABLE public.automate_logs REPLICA IDENTITY FULL;

-- Add table to the publication if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.automate_logs;
  END IF;
END
$$;

-- Set up pg_cron to prune logs older than 7 days
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'prune_automate_logs',
  '0 0 * * *',
  $$ DELETE FROM public.automate_logs WHERE created_at < NOW() - INTERVAL '7 days'; $$
);
