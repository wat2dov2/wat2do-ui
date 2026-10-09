BEGIN;

-- Reviewed continuing openings update their existing identity, never a new row.
-- The caller must supply the complete untouched table select(*) baseline.
CREATE OR REPLACE FUNCTION public.update_reviewed_position(
    p_position_id bigint,
    p_expected_position jsonb,
    p_position_patch jsonb
)
RETURNS SETOF public.positions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET timezone = 'UTC'
AS $$
DECLARE
    v_proposed public.positions;
BEGIN
    IF p_position_id IS NULL OR p_position_id <= 0
       OR jsonb_typeof(p_expected_position) IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_expected_position -> 'id') IS DISTINCT FROM 'number'
       OR p_expected_position -> 'id' IS DISTINCT FROM to_jsonb(p_position_id)
       OR jsonb_typeof(p_position_patch) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
            MESSAGE = 'Reviewed position update requires a matching baseline and role patch';
    END IF;

    IF p_position_patch = '{}'::jsonb
       OR EXISTS (
           SELECT 1 FROM jsonb_object_keys(p_position_patch) AS field(name)
           WHERE name NOT IN (
               'description', 'position_type', 'requirements', 'commitment',
               'compensation', 'is_paid', 'location', 'contact_email',
               'deadline_date', 'deadline_at'
           )
       ) THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
            MESSAGE = 'Reviewed position update requires a matching baseline and role patch';
    END IF;

    IF EXISTS (
        SELECT 1 FROM jsonb_each(p_position_patch) AS field(name, value)
        WHERE (name IN ('description', 'position_type') AND jsonb_typeof(value) <> 'string')
           OR (name IN ('commitment', 'compensation', 'location', 'contact_email',
                        'deadline_date', 'deadline_at')
               AND jsonb_typeof(value) NOT IN ('string', 'null'))
           OR (name = 'is_paid' AND jsonb_typeof(value) NOT IN ('boolean', 'null'))
           OR (name = 'requirements' AND jsonb_typeof(value) <> 'array')
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
            MESSAGE = 'Reviewed position update has invalid role fields';
    END IF;

    BEGIN
        v_proposed := jsonb_populate_record(
            NULL::public.positions, p_expected_position || p_position_patch
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
            MESSAGE = 'Reviewed position update has invalid role fields';
    END;

    IF v_proposed.description IS NULL OR length(btrim(v_proposed.description)) NOT BETWEEN 1 AND 4000
       OR v_proposed.position_type IS NULL
       OR v_proposed.position_type NOT IN ('executive', 'committee', 'volunteer', 'staff', 'internship', 'general')
       OR jsonb_typeof(v_proposed.requirements) IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_proposed.requirements) > 12
       OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_proposed.requirements) AS requirement(value)
           WHERE jsonb_typeof(value) <> 'string'
              OR length(btrim(value #>> '{}')) NOT BETWEEN 1 AND 300
       )
       OR length(v_proposed.commitment) > 1000 OR length(v_proposed.compensation) > 1000
       OR length(v_proposed.location) > 1000 OR length(v_proposed.contact_email) > 320
       OR (v_proposed.deadline_at IS NOT NULL AND v_proposed.deadline_date IS NULL) THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
            MESSAGE = 'Reviewed position update has invalid role fields';
    END IF;

    RETURN QUERY
    UPDATE public.positions AS current_position
    SET description = v_proposed.description,
        position_type = v_proposed.position_type,
        requirements = v_proposed.requirements,
        commitment = v_proposed.commitment,
        compensation = v_proposed.compensation,
        is_paid = v_proposed.is_paid,
        location = v_proposed.location,
        contact_email = v_proposed.contact_email,
        deadline_date = v_proposed.deadline_date,
        deadline_at = v_proposed.deadline_at,
        updated_at = GREATEST(clock_timestamp(), current_position.updated_at + interval '1 microsecond')
    WHERE current_position.id = p_position_id
      AND to_jsonb(current_position) = p_expected_position
      AND EXISTS (
          SELECT 1 FROM jsonb_object_keys(p_position_patch) AS field(name)
          WHERE to_jsonb(current_position) -> name IS DISTINCT FROM to_jsonb(v_proposed) -> name
      )
    RETURNING current_position.*;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
            MESSAGE = 'Reviewed position baseline changed or update made no changes';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_reviewed_position(bigint, jsonb, jsonb)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_reviewed_position(bigint, jsonb, jsonb)
    TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
