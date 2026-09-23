-- Keep Carleton's red primary and use white for its secondary brand color.
UPDATE public.schools
SET secondary_color = '#FFFFFF'
WHERE slug = 'carleton';
