-- Seed a production-visible UTSC Eats organization and one upcoming event so
-- the UTSC event card can exercise the SCSU organization-type logo.

BEGIN;

DO $$
DECLARE
  v_organization_id integer;
  v_event_id integer;
  v_starts_at timestamp with time zone;
BEGIN
  SELECT organization.id
    INTO v_organization_id
    FROM public.organizations AS organization
   WHERE organization.school = 'utsc'
     AND lower(trim(both '@' from trim(organization.ig))) = 'utscfood'
   ORDER BY organization.id
   LIMIT 1;

  IF v_organization_id IS NULL THEN
    INSERT INTO public.organizations (
      organization_name,
      categories,
      organization_page,
      ig,
      discord,
      organization_type,
      logo_url,
      school
    )
    VALUES (
      'UTSC Eats Campus Group',
      '["Games & Recreation"]'::jsonb,
      'https://sop.utoronto.ca/group/utsc-eats/',
      'utscfood',
      NULL,
      'scsu',
      NULL,
      'utsc'
    )
    RETURNING id INTO v_organization_id;
  ELSE
    UPDATE public.organizations
       SET organization_name = 'UTSC Eats Campus Group',
           categories = '["Games & Recreation"]'::jsonb,
           organization_page = 'https://sop.utoronto.ca/group/utsc-eats/',
           ig = 'utscfood',
           organization_type = 'scsu',
           school = 'utsc'
     WHERE id = v_organization_id;
  END IF;

  SELECT event.id
    INTO v_event_id
    FROM public.events AS event
   WHERE event.source_url =
     'https://wat2do.io/mock-events/utscfood-scsu-logo-preview'
   ORDER BY event.id
   LIMIT 1;

  IF v_event_id IS NULL THEN
    INSERT INTO public.events (
      title,
      description,
      location,
      price,
      food,
      registration,
      source_image_url,
      source_url,
      category,
      organization,
      school,
      ig_handle,
      organization_id
    )
    VALUES (
      'UTSC Eats SCSU Logo Preview',
      'Mock event for verifying the UTSC Eats organization and SCSU logo on the UTSC event feed.',
      'Student Centre',
      0,
      NULL,
      false,
      NULL,
      'https://wat2do.io/mock-events/utscfood-scsu-logo-preview',
      'Games & Recreation',
      'UTSC Eats Campus Group',
      'utsc',
      'utscfood',
      v_organization_id
    )
    RETURNING id INTO v_event_id;
  ELSE
    UPDATE public.events
       SET organization = 'UTSC Eats Campus Group',
           school = 'utsc',
           ig_handle = 'utscfood',
           organization_id = v_organization_id
     WHERE id = v_event_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.event_dates AS event_date
     WHERE event_date.event_id = v_event_id
       AND event_date.dtstart_utc > now()
  ) THEN
    v_starts_at := (
      date_trunc('day', now() AT TIME ZONE 'America/Toronto')
      + interval '14 days 18 hours'
    ) AT TIME ZONE 'America/Toronto';

    INSERT INTO public.event_dates (
      event_id,
      dtstart_utc,
      dtend_utc,
      tz
    )
    VALUES (
      v_event_id,
      v_starts_at,
      v_starts_at + interval '2 hours',
      'America/Toronto'
    );
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
