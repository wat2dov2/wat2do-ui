-- The feature backlog Opus keeps from the competitor complaints.
--
-- Each daily report adds new features or updates existing ones, so a feature
-- gathers every complaint that has asked for it over time. Opus scores each
-- one from 1 to 5 on five dimensions: demand (how many people ask), pain (how
-- much it hurts them), fit (how well it suits wat2do), edge (how much it sets
-- wat2do apart) and ease (how little work it is). Admins only read these.

BEGIN;

CREATE TABLE IF NOT EXISTS public.competitor_pain_point_features (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(key) <= 80),
    title text NOT NULL CHECK (length(btrim(title)) > 0),
    problem text NOT NULL CHECK (length(btrim(problem)) > 0),
    change text NOT NULL CHECK (length(btrim(change)) > 0),
    "where" jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof("where") = 'array'),
    audience text NOT NULL CHECK (audience IN ('organizer', 'attendee', 'both')),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'built')),
    demand smallint NOT NULL CHECK (demand BETWEEN 1 AND 5),
    pain smallint NOT NULL CHECK (pain BETWEEN 1 AND 5),
    fit smallint NOT NULL CHECK (fit BETWEEN 1 AND 5),
    edge smallint NOT NULL CHECK (edge BETWEEN 1 AND 5),
    ease smallint NOT NULL CHECK (ease BETWEEN 1 AND 5),
    score smallint GENERATED ALWAYS AS (demand + pain + fit + edge + ease) STORED,
    rationale text NOT NULL DEFAULT '',
    competitors jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(competitors) = 'array'),
    complaint_urls jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(complaint_urls) = 'array'),
    report_count integer NOT NULL DEFAULT 1 CHECK (report_count >= 1),
    first_seen date NOT NULL,
    last_seen date NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.competitor_pain_point_features ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

COMMIT;
