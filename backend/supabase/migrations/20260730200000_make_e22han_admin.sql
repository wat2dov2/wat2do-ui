-- Make e22han@uwaterloo.ca admin

UPDATE public.users
SET role = 'admin'
WHERE email = 'e22han@uwaterloo.ca';
