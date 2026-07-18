insert into public.commons_submissions (
  id,
  source,
  status,
  submitted_at,
  updated_at,
  reviewed_at,
  submitter_email,
  event,
  cover_image_path,
  cover_image_name,
  badge_color,
  post
)
values (
  '00000000-0000-0000-0000-000000000001',
  'seed',
  'approved',
  '2026-07-15T05:00:00.000Z',
  '2026-07-15T05:00:00.000Z',
  '2026-07-15T05:00:00.000Z',
  null,
  jsonb_build_object(
    'title', 'Canvas Designathon',
    'hosts', 'UW Blueprint',
    'date', 'Sun, Nov 16',
    'time', '9:00 AM - 6:30 PM',
    'location', 'Accelerator Centre',
    'description', 'Build for a cause, meet the team, and compete for prizes over a day of making.',
    'registrationUrl', ''
  ),
  null,
  null,
  '#b9f543',
  jsonb_build_object(
    'title', E'Canvas\nDesignathon',
    'hostOrg', 'UW Blueprint',
    'badge', 'MAKE',
    'pills', jsonb_build_array('REG. REQUIRED', 'CASH PRIZES', 'FREE BOBA'),
    'venue', 'Accelerator Centre',
    'dateLine', 'SUN, NOV 16',
    'timeLine', '9:00 AM - 6:30 PM',
    'caption', E'CANVAS DESIGNATHON - hosted by UW Blueprint\n\n🗓️ Sun, Nov 16 @ 9:00 AM - 6:30 PM\n📍 Accelerator Centre\n\nBuild for a cause at UW Blueprint''s Canvas Designathon. Bring your ideas, meet the team, and compete for prizes over a day of making.\n\nRSVP + more events on wat2do.ca'
  )
)
on conflict (id) do nothing;
