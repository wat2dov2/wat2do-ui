BEGIN;

-- Official school event directories crawled by the local ingestion scraper.
CREATE TABLE IF NOT EXISTS public.directory_sources (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id integer NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    url varchar(2048) NOT NULL UNIQUE CHECK (url ~ '^https://'),
    default_club text NOT NULL CHECK (length(btrim(default_club)) > 0),
    default_club_ig varchar(64),
    source_format text NOT NULL CHECK (source_format IN ('html', 'ical', 'json')),
    event_url_patterns text[] NOT NULL CHECK (cardinality(event_url_patterns) > 0),
    event_url_exclude_patterns text[] NOT NULL DEFAULT '{}',
    json_url_fields text[] NOT NULL DEFAULT '{url}',
    next_page_selector text,
    content_selector text,
    image_selector text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS directory_sources_school_idx ON public.directory_sources (school_id, id);
ALTER TABLE public.directory_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.directory_sources FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.directory_sources TO service_role;

INSERT INTO public.directory_sources (
    school_id, name, url, default_club, default_club_ig, source_format, event_url_patterns,
    event_url_exclude_patterns, json_url_fields, next_page_selector, content_selector, image_selector
)
SELECT
    s.id, v.name, v.url, v.default_club, v.default_club_ig, v.source_format, v.event_url_patterns,
    v.event_url_exclude_patterns, v.json_url_fields, v.next_page_selector, v.content_selector,
    v.image_selector
FROM (VALUES
    ('uwaterloo', 'WUSA Events', 'https://wusa.ca/events/', 'Waterloo Undergraduate Student Association', 'yourwusa', 'html', ARRAY['/event/']::text[], ARRAY[]::text[], ARRAY['url']::text[], 'a.tribe-events-c-nav__next', '.tribe-events-single-event-description, .tribe-events-calendar-single, .entry-content', '.tribe-events-event-image img, .entry-content img'),
    ('utsg', 'U of T Student Club Portal Events', 'https://sop.utoronto.ca/events/', 'University of Toronto Students'' Union', 'uoftsu', 'html', ARRAY['sop.utoronto.ca/event/']::text[], ARRAY[]::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('utsc', 'SCSU Events', 'https://www.scsu.ca/events/', 'Scarborough Campus Students'' Union', 'scsuuoft', 'html', ARRAY['scsu.ca/events/']::text[], ARRAY['format=ical']::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('utm', 'UTMSU Events', 'https://utmsu.ca/events/', 'University of Toronto Mississauga Students'' Union', 'myutmsu', 'html', ARRAY['utmsu.ca/event/', 'utmsu.ca/events/']::text[], ARRAY[]::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('mcgill', 'SSMU Events', 'https://ssmu.ca/events/', 'Students'' Society of McGill University', 'ssmuaeum', 'html', ARRAY['ssmu.ca/event/', 'ssmu.ca/events/']::text[], ARRAY['/category/', '/list', '/month', '/today']::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('mcmaster', 'McMaster Events', 'https://news.mcmaster.ca/events/', 'McMaster Students Union', 'msu_mcmaster', 'html', ARRAY['news.mcmaster.ca/events/']::text[], ARRAY[]::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('uwo', 'Western USC Events', 'https://westernusc.ca/events/', 'University Students'' Council', 'westernusc', 'html', ARRAY['westernusc.ca/event/', 'bouncelife.com/events/']::text[], ARRAY[]::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('queensu', 'Queen''s AMS Events', 'https://www.myams.org/events/', 'Alma Mater Society of Queen''s University', 'queens_ams', 'html', ARRAY['myams.org/event/']::text[], ARRAY[]::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('carleton', 'CUSA Events', 'https://www.cusaonline.ca/events/', 'Carleton University Students'' Association', 'cusaonline', 'html', ARRAY['cusaonline.ca/event/', 'cusaonline.ca/events/']::text[], ARRAY[]::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('brocku', 'BUSU Events', 'https://www.brockbusu.ca/whats-on/', 'Brock University Students'' Union', 'brockbusu', 'html', ARRAY['brockbusu.ca/ents/event/']::text[], ARRAY[]::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('wlu', 'Laurier Events', 'https://events.wlu.ca/_data/current-live.json', 'Wilfrid Laurier University Students'' Union', 'yourstudentsunion', 'json', ARRAY['events.wlu.ca/20']::text[], ARRAY[]::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('yorku', 'York University Events', 'https://events.yorku.ca/wp-json/wp/v2/mec-events?per_page=50', 'York Federation of Students', 'yfslocal68', 'json', ARRAY['events.yorku.ca/events/']::text[], ARRAY[]::text[], ARRAY['link']::text[], NULL, NULL, NULL),
    ('tmu', 'Toronto Metropolitan University Events', 'https://www.torontomu.ca/news-events/events/', 'Toronto Met Students'' Union', 'yourtmsu', 'html', ARRAY['torontomu.ca/news-events/events/', 'torontomu.ca/sustainability/news-events/events/']::text[], ARRAY[]::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('ottawa', 'uOttawa Events', 'https://www.uottawa.ca/campus-life/events-all/all', 'University of Ottawa Students'' Union', 'seuo_uosu', 'html', ARRAY['uottawa.ca/campus-life/events-all/']::text[], ARRAY[]::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('ocadu', 'OCAD U Events', 'https://www.ocadu.ca/api/events', 'OCAD Student Union', 'ocadsu', 'json', ARRAY['ocadu.ca/events-and-exhibitions/']::text[], ARRAY[]::text[], ARRAY['view_node']::text[], NULL, NULL, NULL),
    ('ualberta', 'University of Alberta Students'' Union Events', 'https://www.su.ualberta.ca/events/', 'University of Alberta Students'' Union', 'uasuualberta', 'html', ARRAY['su.ualberta.ca/events/']::text[], ARRAY[]::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('ulaval', 'CADEUL Events', 'https://cadeul.com/evenements/', 'CADEUL', 'cadeul_', 'html', ARRAY['cadeul.com/evenement/', 'cadeul.com/evenements/']::text[], ARRAY[]::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('mun', 'MUNSU Events', 'https://munsu.ca/events/', 'Memorial University of Newfoundland Students'' Union', 'munsu35', 'html', ARRAY['munsu.ca/events/']::text[], ARRAY['format=ical']::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('sfu', 'SFU Events', 'https://events.sfu.ca/live/json/events', 'Simon Fraser Student Society', 'sfss_sfu', 'json', ARRAY['events.sfu.ca/event/']::text[], ARRAY[]::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('udem', 'FAÉCUM Events', 'https://www.faecum.qc.ca/activites', 'FAÉCUM', 'faecum', 'html', ARRAY['faecum.qc.ca/activite/']::text[], ARRAY[]::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('umanitoba', 'UMSU Events', 'https://umsu.ca/events/', 'University of Manitoba Students'' Union', 'myumsu', 'html', ARRAY['umsu.ca/event/', 'umsu.ca/events/']::text[], ARRAY['/category/', '/list', '/month', '/today']::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('concordia', 'Concordia Events', 'https://www.concordia.ca/events.html', 'Concordia Student Union', 'csumtl', 'html', ARRAY['concordia.ca/cuevents/']::text[], ARRAY['academic-dates.html', 'submit-an-event.html', 'university-holidays.html']::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('dalhousie', 'Dalhousie Student Union Events', 'https://www.dsu.ca/event-calendar', 'Dalhousie Student Union', 'dalstudentunion', 'html', ARRAY['dsu.ca/event/', 'dsu.ca/agm']::text[], ARRAY[]::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('guelph', 'University of Guelph Events', 'https://news.uoguelph.ca/wp-json/tribe/events/v1/events?per_page=50', 'Central Student Association', 'csaguelph', 'json', ARRAY['news.uoguelph.ca/event/']::text[], ARRAY[]::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('ucalgary', 'UCalgary Students'' Union Events', 'https://su.ucalgary.ca/calendar/', 'Students'' Union, UCalgary', 'suuofc', 'html', ARRAY['su.ucalgary.ca/calendar/']::text[], ARRAY['?ical=1', '/feed/', '/list', '/month', '/today']::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('usask', 'USSU Events', 'https://ussu.ca/events/', 'University of Saskatchewan Students'' Union', 'ussuexec', 'html', ARRAY['ussu.ca/event/', 'ussu.ca/events/']::text[], ARRAY['/category/', '/list', '/month', '/today']::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('uwindsor', 'UWSA Events', 'https://www.uwsa.ca/events/', 'University of Windsor Students'' Alliance', 'uwsa4u', 'html', ARRAY['uwsa.ca/event/', 'uwsa.ca/events/']::text[], ARRAY[]::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('uqam', 'UQAM Events', 'https://evenements.uqam.ca/', 'Unknown host', NULL, 'html', ARRAY['evenements.uqam.ca/evenements/']::text[], ARRAY[]::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('ontariotech', 'Ontario Tech Student Union Events', 'https://www.otsu.ca/latest/events', 'Ontario Tech Student Union', 'ot_studentunion', 'html', ARRAY['otsu.ca/latest/events/']::text[], ARRAY[]::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('cornell', 'Cornell CampusGroups Events', 'https://cornell.campusgroups.com/ical/cornell/ical_cornell.ics', 'Cornell University Student Assembly', 'cornell_studentassembly', 'ical', ARRAY['cornell.campusgroups.com/rsvp']::text[], ARRAY[]::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('nyu', 'NYU Events', 'https://events.nyu.edu/live/json/events', 'NYU Student Government Assembly', 'nyustudentgov', 'json', ARRAY['events.nyu.edu/event/']::text[], ARRAY[]::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('upenn', 'Penn Clubs Events', 'https://pennclubs.com/events/', 'Undergraduate Assembly (UA)', 'pennua', 'html', ARRAY['pennclubs.com/events/']::text[], ARRAY[]::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('columbia', 'Columbia LionHub Events', 'https://lionhub.columbia.edu/ical/columbia/ical_columbia.ics', 'Columbia College Student Council', 'yourccsc', 'ical', ARRAY['lionhub.columbia.edu/rsvp']::text[], ARRAY[]::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('mit', 'MIT Events', 'https://calendar.mit.edu/', 'MIT Undergraduate Association', 'mitundergrad', 'html', ARRAY['calendar.mit.edu/event/']::text[], ARRAY['/confirm']::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('ubc', 'UBC AMS Events', 'https://www.ams.ubc.ca/events/', 'Alma Mater Society of UBC', 'ams_ubc', 'html', ARRAY['ams.ubc.ca/event/', 'ams.ubc.ca/events/']::text[], ARRAY['/category/', '/list', '/month', '/today']::text[], ARRAY['url']::text[], NULL, NULL, NULL),
    ('berkeley', 'UC Berkeley Events', 'https://events.berkeley.edu/live/json/events', 'Associated Students of the University of California', 'theasuc', 'json', ARRAY['events.berkeley.edu/', 'homecoming.berkeley.edu/event/', 'journalism.berkeley.edu/event/', 'ischool.berkeley.edu/events/2026/', 'ischool.berkeley.edu/events/2027/', 'berkeley.libcal.com/event/', 'www.law.berkeley.edu/event/']::text[], ARRAY[]::text[], ARRAY['url']::text[], NULL, NULL, NULL)
) AS v(
    school, name, url, default_club, default_club_ig, source_format, event_url_patterns,
    event_url_exclude_patterns, json_url_fields, next_page_selector, content_selector, image_selector
)
JOIN public.schools s ON s.slug = v.school
ON CONFLICT (url) DO NOTHING;

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_ingestion_source_check;
ALTER TABLE public.events ADD CONSTRAINT events_ingestion_source_check
    CHECK (ingestion_source IN ('manual', 'submission', 'instagram_scraper', 'directory', 'seed'));
ALTER TABLE public.positions DROP CONSTRAINT IF EXISTS positions_ingestion_source_valid;
ALTER TABLE public.positions ADD CONSTRAINT positions_ingestion_source_valid
    CHECK (ingestion_source IN ('manual', 'instagram_scraper', 'directory', 'seed'));

-- Mark events previously imported from the retired directories.json sources.
UPDATE public.events e
SET ingestion_source = 'directory'
FROM (VALUES
    ('uwaterloo', 'wusa.ca', '/event/'),
    ('utsg', 'sop.utoronto.ca', '/event/'),
    ('utsc', 'scsu.ca', '/events/'),
    ('utm', 'utmsu.ca', '/event/'),
    ('utm', 'utmsu.ca', '/events/'),
    ('mcgill', 'ssmu.ca', '/event/'),
    ('mcgill', 'ssmu.ca', '/events/'),
    ('mcmaster', 'news.mcmaster.ca', '/events/'),
    ('uwo', 'westernusc.ca', '/event/'),
    ('uwo', 'bouncelife.com', '/events/'),
    ('queensu', 'myams.org', '/event/'),
    ('carleton', 'cusaonline.ca', '/event/'),
    ('carleton', 'cusaonline.ca', '/events/'),
    ('brocku', 'brockbusu.ca', '/ents/event/'),
    ('wlu', 'events.wlu.ca', '/20'),
    ('yorku', 'events.yorku.ca', '/events/'),
    ('tmu', 'torontomu.ca', '/news-events/events/'),
    ('tmu', 'torontomu.ca', '/sustainability/news-events/events/'),
    ('ottawa', 'uottawa.ca', '/campus-life/events-all/'),
    ('ocadu', 'ocadu.ca', '/events-and-exhibitions/'),
    ('ualberta', 'su.ualberta.ca', '/events/'),
    ('ulaval', 'cadeul.com', '/evenement/'),
    ('ulaval', 'cadeul.com', '/evenements/'),
    ('mun', 'munsu.ca', '/events/'),
    ('sfu', 'events.sfu.ca', '/event/'),
    ('udem', 'faecum.qc.ca', '/activite/'),
    ('umanitoba', 'umsu.ca', '/event/'),
    ('umanitoba', 'umsu.ca', '/events/'),
    ('concordia', 'concordia.ca', '/cuevents/'),
    ('dalhousie', 'dsu.ca', '/event/'),
    ('dalhousie', 'dsu.ca', '/agm'),
    ('guelph', 'news.uoguelph.ca', '/event/'),
    ('ucalgary', 'su.ucalgary.ca', '/calendar/'),
    ('usask', 'ussu.ca', '/event/'),
    ('usask', 'ussu.ca', '/events/'),
    ('uwindsor', 'uwsa.ca', '/event/'),
    ('uwindsor', 'uwsa.ca', '/events/'),
    ('uqam', 'evenements.uqam.ca', '/evenements/'),
    ('ontariotech', 'otsu.ca', '/latest/events/'),
    ('cornell', 'cornell.campusgroups.com', '/rsvp'),
    ('nyu', 'events.nyu.edu', '/event/'),
    ('upenn', 'pennclubs.com', '/events/'),
    ('columbia', 'lionhub.columbia.edu', '/rsvp'),
    ('mit', 'calendar.mit.edu', '/event/'),
    ('ubc', 'ams.ubc.ca', '/event/'),
    ('ubc', 'ams.ubc.ca', '/events/'),
    ('berkeley', 'events.berkeley.edu', '/'),
    ('berkeley', 'homecoming.berkeley.edu', '/event/'),
    ('berkeley', 'journalism.berkeley.edu', '/event/'),
    ('berkeley', 'ischool.berkeley.edu', '/events/2026/'),
    ('berkeley', 'ischool.berkeley.edu', '/events/2027/'),
    ('berkeley', 'berkeley.libcal.com', '/event/'),
    ('berkeley', 'law.berkeley.edu', '/event/')
) AS p(school, host, path)
JOIN public.schools s ON s.slug = p.school
WHERE e.school_id = s.id
  AND e.ingestion_source = 'instagram_scraper'
  AND regexp_replace(lower(substring(e.source_url FROM '^https?://([^/?#]+)')), '^www\.', '') = p.host
  AND position(p.path IN coalesce(substring(e.source_url FROM '^https?://[^/?#]+([^?#]*)'), '')) > 0;

-- Ingestion keeps no run tracing.
DROP TABLE IF EXISTS public.workflow_runs;

COMMIT;
