-- Filter and paginate admin lists before hydrating their related records.
CREATE OR REPLACE VIEW public.admin_list_entries WITH (security_invoker = true) AS
SELECT 'events'::text AS resource, e.id::text AS id, s.slug AS school,
       NULL::text AS status, e.category::text AS category,
       concat_ws(' ', e.title, e.club) AS search_text, d.starts_at AS sort_at
FROM public.events e
JOIN (SELECT event_id, min(dtstart_utc) AS starts_at FROM public.event_dates GROUP BY event_id) d ON d.event_id = e.id
JOIN public.schools s ON s.id = e.school_id
UNION ALL
SELECT 'reports', r.id::text, s.slug, r.status::text, NULL,
       concat_ws(' ', e.title, r.reason, r.event_id), r.reported_at
FROM public.reported_events r
LEFT JOIN public.events e ON e.id = r.event_id
LEFT JOIN public.schools s ON s.id = e.school_id
UNION ALL
SELECT 'submissions', es.id::text, s.slug, es.status::text, NULL,
       concat_ws(' ', es.event_data->>'title', c.club_name, u.email), es.submitted_at
FROM public.event_submissions es
LEFT JOIN public.schools s ON s.id = es.school_id
LEFT JOIN public.clubs c ON c.id::text = es.event_data->>'club_id'
LEFT JOIN public.users u ON u.id = es.user_id
UNION ALL
SELECT 'claims', cc.id::text, s.slug, cc.status::text, NULL,
       concat_ws(' ', c.club_name, u.full_name, u.email, cc.executive_role), cc.created_at
FROM public.club_claims cc
LEFT JOIN public.clubs c ON c.id = cc.club_id
LEFT JOIN public.schools s ON s.id = c.school_id
LEFT JOIN public.users u ON u.id = cc.user_id
UNION ALL
SELECT 'clubSubmissions', c.id::text, s.slug, c.status::text, NULL,
       concat_ws(' ', c.club_name, u.email), NULL::timestamptz
FROM public.clubs c
LEFT JOIN public.schools s ON s.id = c.school_id
LEFT JOIN public.users u ON u.id = c.created_by;

REVOKE ALL ON public.admin_list_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_list_entries TO service_role;
