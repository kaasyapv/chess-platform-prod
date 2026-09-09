-- RLS verification - run after migrations (Supabase SQL editor, or:
--   npm run db:verify-rls   with DATABASE_URL set).
-- Fails loudly if any public table is missing row-level security or has no
-- policies, then prints the full policy inventory for eyeball review.

do $$
declare bad text;
begin
  select string_agg(tablename, ', ') into bad
    from pg_tables
   where schemaname = 'public' and not rowsecurity;
  if bad is not null then
    raise exception 'RLS DISABLED on: %', bad;
  end if;

  -- audit_log/billing_events are insert-only via security-definer functions,
  -- but still carry a read policy - so every table must have >= 1 policy.
  select string_agg(t.tablename, ', ') into bad
    from pg_tables t
   where t.schemaname = 'public'
     and not exists (select 1 from pg_policies p
                      where p.schemaname = 'public' and p.tablename = t.tablename);
  if bad is not null then
    raise exception 'NO POLICIES on: %', bad;
  end if;

  /* Financial privacy (0024): salary and revenue are CEO-only unless the CEO
   * grants can_view_billing. The failure mode this catches is a future policy
   * quietly reverting to `my_role() in ('ceo','manager')`, which would hand
   * every manager the academy's finances again while the UI still claims the
   * figures are CEO-only. Every non-self clause on a money table must go
   * through my_perm('can_view_billing'). */
  select string_agg(tablename || '.' || policyname, ', ') into bad
    from pg_policies
   where schemaname = 'public'
     and tablename in ('invoices', 'subscriptions', 'billing_customers',
                       'billing_events', 'coach_penalties')
     and coalesce(qual, '') || coalesce(with_check, '') like '%manager%';
  if bad is not null then
    raise exception 'FINANCIAL LEAK - manager role referenced directly on: %', bad;
  end if;

  raise notice 'RLS OK: all public tables secured with policies; finances gated on can_view_billing';
end $$;

select tablename, policyname, cmd, roles
  from pg_policies
 where schemaname = 'public'
 order by tablename, policyname;
