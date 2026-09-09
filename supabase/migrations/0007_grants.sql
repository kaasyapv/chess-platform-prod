-- 0007: Table grants. Newer Supabase stacks ship hardened default privileges
-- (no DML for api roles on new tables); RLS is our real gate - policies are
-- deny-by-default on every table (verified by scripts/verify-rls.sql) - so
-- restore the classic grants RLS is designed to sit on top of.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public
  to authenticated, service_role;
-- anon: read-only; only tables with an explicit public policy (student_reports)
-- actually return rows - everything else has no anon-matching policy.
grant select on all tables in schema public to anon;

grant usage, select on all sequences in schema public to authenticated, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public grant select on tables to anon;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;
