-- 0038: per-tenant login branding.
--
-- The login page renders before anyone is authenticated, so it cannot read
-- `academies` under RLS (my_academy() is null pre-auth). Branding is fetched
-- server-side with the service role, selecting ONLY these three columns
-- (src/lib/branding.ts) - nothing here is sensitive.
--
-- `academies.slug` already exists (0001, not null unique). A CEO populates the
-- rest by hand for now:
--   update public.academies
--      set logo_url = 'https://<cdn>/panama-logo.png',
--          brand_primary = '#0F766E',
--          brand_name = 'Panama Chess 4 Kids'
--    where slug = 'panama';
-- A logo-upload + colour-picker admin UI is a separate feature.

alter table public.academies add column if not exists logo_url      text;
alter table public.academies add column if not exists brand_primary text;  -- hex, e.g. '#372fc3'
alter table public.academies add column if not exists brand_name    text;  -- display name; falls back to name

-- brand_primary must look like a hex colour if set (defence against a stray
-- value ending up inlined into a style attribute).
alter table public.academies drop constraint if exists academies_brand_primary_hex;
alter table public.academies add constraint academies_brand_primary_hex
  check (brand_primary is null or brand_primary ~ '^#[0-9a-fA-F]{6}$');
