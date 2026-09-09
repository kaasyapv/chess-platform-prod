-- 0040_must_change_password.sql - force a password reset on first login.
-- Set true when an account is created with a known/temporary password (e.g. a
-- coach seeded by staff). requireProfile() and "/" send the user to
-- /account/change-password until they clear it via supabase.auth.updateUser.
alter table public.profiles
  add column if not exists must_change_password boolean not null default false;
