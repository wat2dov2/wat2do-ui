BEGIN;

-- Coordinates for each school's event map locations, found once with
-- OpenStreetMap's Nominatim and kept. A row without coordinates records a
-- lookup that found nothing; it is tried again after the control box's retry period.
CREATE TABLE IF NOT EXISTS public.map_locations (
    school_id integer NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    map_location varchar(500) NOT NULL,
    coordinates double precision[],
    looked_up_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (school_id, map_location),
    CONSTRAINT map_locations_coordinates_check CHECK (
        coordinates IS NULL OR (
            cardinality(coordinates) = 2
            AND coordinates[1] BETWEEN -180 AND 180
            AND coordinates[2] BETWEEN -90 AND 90
        )
    )
);

ALTER TABLE public.map_locations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.map_locations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.map_locations TO service_role;

-- Each event carries its map location's [longitude, latitude], so the feed
-- that lists it also places it on the map. Only the triggers below write it.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS map_coordinates double precision[];
CREATE INDEX IF NOT EXISTS events_school_map_location_idx
    ON public.events (school_id, map_location) WHERE map_location IS NOT NULL;

-- Whoever writes an event, its coordinates are its map location's.
CREATE OR REPLACE FUNCTION public.set_event_map_coordinates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    NEW.map_coordinates := (
        SELECT place.coordinates
        FROM public.map_locations AS place
        WHERE place.school_id = NEW.school_id AND place.map_location = NEW.map_location
    );
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.set_event_map_coordinates() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS set_event_map_coordinates ON public.events;
CREATE TRIGGER set_event_map_coordinates
    BEFORE INSERT OR UPDATE OF map_location, map_coordinates, school_id ON public.events
    FOR EACH ROW EXECUTE FUNCTION public.set_event_map_coordinates();

-- A newly located place reaches every event already at it.
CREATE OR REPLACE FUNCTION public.share_map_location_coordinates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.events
    SET map_coordinates = NEW.coordinates
    WHERE school_id = NEW.school_id
        AND map_location = NEW.map_location
        AND map_coordinates IS DISTINCT FROM NEW.coordinates;
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.share_map_location_coordinates() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS share_map_location_coordinates ON public.map_locations;
CREATE TRIGGER share_map_location_coordinates
    AFTER INSERT OR UPDATE ON public.map_locations
    FOR EACH ROW EXECUTE FUNCTION public.share_map_location_coordinates();

COMMIT;
