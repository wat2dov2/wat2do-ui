BEGIN;

DELETE FROM public.positions
WHERE ingestion_source = 'seed';

COMMIT;
