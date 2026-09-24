BEGIN;

ALTER TABLE public.schools
    ADD COLUMN IF NOT EXISTS url_with_semester_dates text;

WITH school_calendar_data (
    slug,
    url_with_semester_dates,
    semester_start,
    semester_end
) AS (
    VALUES
        (
            'uwaterloo',
            'https://uwaterloo.ca/important-dates/undergraduate',
            '2026-09-09'::date,
            '2026-12-22'::date
        ),
        (
            'utsg',
            'https://www.artsci.utoronto.ca/current/dates-deadlines/academic-dates',
            '2026-09-08'::date,
            '2026-12-22'::date
        ),
        (
            'utsc',
            'https://www.utsc.utoronto.ca/registrar/important-dates-overview',
            '2026-09-08'::date,
            '2026-12-22'::date
        ),
        (
            'utm',
            'https://www.utm.utoronto.ca/registrar/dates',
            '2026-09-08'::date,
            '2026-12-22'::date
        ),
        (
            'mcgill',
            'https://www.mcgill.ca/importantdates/key-dates',
            '2026-08-31'::date,
            '2026-12-22'::date
        ),
        (
            'mcmaster',
            'https://registrar.mcmaster.ca/dates-and-deadlines/',
            '2026-09-08'::date,
            '2026-12-23'::date
        ),
        (
            'uwo',
            'https://registrar.uwo.ca/resources/important_dates_and_deadlines.html',
            '2026-09-09'::date,
            '2026-12-22'::date
        ),
        (
            'queensu',
            'https://www.queensu.ca/registrar/key-dates',
            '2026-09-08'::date,
            '2026-12-23'::date
        ),
        (
            'carleton',
            'https://calendar.carleton.ca/academicyear/',
            '2026-09-09'::date,
            '2026-12-23'::date
        ),
        (
            'brock',
            'https://brocku.ca/important-dates/academic-term/',
            '2026-09-09'::date,
            '2026-12-23'::date
        ),
        (
            'wlu',
            'https://students.wlu.ca/academics/support-and-advising/calendars-and-petitions/important-dates-and-deadlines.html',
            '2026-09-10'::date,
            '2026-12-23'::date
        ),
        (
            'yorku',
            'https://registrar.yorku.ca/enrol/dates/2026-2027/fall-winter',
            '2026-09-09'::date,
            '2026-12-23'::date
        ),
        (
            'tmu',
            'https://www.torontomu.ca/calendar/2026-2027/dates/',
            '2026-09-08'::date,
            '2026-12-20'::date
        ),
        (
            'ottawa',
            'https://www.uottawa.ca/study/important-academic-dates-deadlines',
            '2026-09-09'::date,
            '2026-12-22'::date
        ),
        (
            'ocadu',
            'https://www.ocadu.ca/student-services/office-registrar/dates-and-deadlines',
            '2026-09-09'::date,
            '2026-12-20'::date
        ),
        (
            'ualberta',
            'https://calendar.ualberta.ca/content.php?catoid=69&navoid=20884',
            '2026-09-01'::date,
            '2026-12-22'::date
        ),
        (
            'ulaval',
            'https://www.ulaval.ca/etudes',
            '2026-08-31'::date,
            '2026-12-20'::date
        ),
        (
            'mun',
            'https://www.mun.ca/university-calendar/diary-of-important-dates/',
            '2026-09-09'::date,
            '2026-12-18'::date
        ),
        (
            'sfu',
            'https://www.sfu.ca/students/deadlines/fall/',
            '2026-09-09'::date,
            '2026-12-20'::date
        ),
        (
            'udem',
            'https://registraire.umontreal.ca/fr/dates-importantes/calendriers-universitaires/',
            '2026-09-01'::date,
            '2026-12-23'::date
        ),
        (
            'umanitoba',
            'https://umanitoba.ca/registrar/important-dates-deadlines',
            '2026-09-09'::date,
            '2026-12-23'::date
        ),
        (
            'concordia',
            'https://www.concordia.ca/students/registration/term-dates-deadlines.html',
            '2026-09-08'::date,
            '2026-12-22'::date
        ),
        (
            'dalhousie',
            'https://academiccalendar.dal.ca/Catalog/ViewCatalog.aspx?catalogid=141&chapterid=-1&loaduseredits=False&pageid=viewcatalog&topicgroupid=42705',
            '2026-09-08'::date,
            '2026-12-20'::date
        ),
        (
            'guelph',
            'https://calendar.uoguelph.ca/undergraduate-calendar/schedule-dates/fall-semester/',
            '2026-09-10'::date,
            '2026-12-22'::date
        ),
        (
            'ucalgary',
            'https://www.ucalgary.ca/registrar/dates',
            '2026-09-01'::date,
            '2026-12-18'::date
        ),
        (
            'usask',
            'https://students.usask.ca/academic-calendar/',
            '2026-09-02'::date,
            '2026-12-23'::date
        ),
        (
            'uwindsor',
            'https://www.uwindsor.ca/registrar/events-listing',
            '2026-09-10'::date,
            '2026-12-22'::date
        ),
        (
            'uqam',
            'https://etudier.uqam.ca/calendriers',
            '2026-09-08'::date,
            '2026-12-23'::date
        ),
        (
            'ontariotech',
            'https://registrar.ontariotechu.ca/academic-schedule/ug-academic-schedule.php',
            '2026-09-08'::date,
            '2026-12-19'::date
        ),
        (
            'cornell',
            'https://registrar.cornell.edu/calendars-exams/academic-calendar/2026-2027',
            '2026-08-24'::date,
            '2026-12-19'::date
        ),
        (
            'nyu',
            'https://bulletins.nyu.edu/nyu/academic-calendar/',
            '2026-09-02'::date,
            '2026-12-22'::date
        ),
        (
            'upenn',
            'https://almanac.upenn.edu/penn-academic-calendar',
            '2026-08-25'::date,
            '2026-12-17'::date
        ),
        (
            'columbia',
            'https://bulletin.columbia.edu/columbia-college/academic-calendar/',
            '2026-09-08'::date,
            '2026-12-23'::date
        ),
        (
            'mit',
            'https://registrar.mit.edu/calendar/current-key-dates',
            '2026-09-09'::date,
            '2026-12-18'::date
        ),
        (
            'ubc',
            'https://vancouver.calendar.ubc.ca/dates-and-deadlines',
            '2026-09-08'::date,
            '2026-12-22'::date
        ),
        (
            'berkeley',
            'https://registrar.berkeley.edu/calendars/academic-calendar/',
            '2026-08-26'::date,
            '2026-12-18'::date
        )
)
UPDATE public.schools AS school
SET
    url_with_semester_dates = calendar.url_with_semester_dates,
    semester_start = calendar.semester_start,
    semester_end = calendar.semester_end
FROM school_calendar_data AS calendar
WHERE school.slug = calendar.slug;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.schools
        WHERE url_with_semester_dates IS NULL
            OR semester_start IS NULL
            OR semester_end IS NULL
    ) THEN
        RAISE EXCEPTION 'Every school must have an academic calendar and semester dates';
    END IF;
END
$$;

ALTER TABLE public.schools
    ALTER COLUMN url_with_semester_dates SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'schools_semester_dates_url_check'
    ) THEN
        ALTER TABLE public.schools
            ADD CONSTRAINT schools_semester_dates_url_check
            CHECK (url_with_semester_dates ~ '^https://');
    END IF;
END
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
