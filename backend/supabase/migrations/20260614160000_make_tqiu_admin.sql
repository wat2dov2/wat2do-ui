-- Make tqiu@uwaterloo.ca admin

UPDATE public.users
SET role = 'admin'
WHERE email = 'tqiu@uwaterloo.ca';
