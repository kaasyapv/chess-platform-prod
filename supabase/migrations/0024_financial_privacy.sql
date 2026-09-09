-- 0024: money is CEO-only unless the CEO says otherwise.
--
-- The Full Report already refuses to send a manager any financial figures -
-- that decision is made on the server, so the numbers never reach their
-- browser (see people/[userId]/page.tsx). But the report was the only thing
-- enforcing it: every financial table still granted read access to
-- `my_role() in ('ceo','manager')`, so a manager holding the anon key and
-- their own session could query invoices, subscriptions and penalty amounts
-- straight from the browser console and read the whole academy's finances.
-- Hiding a number in the UI while the database hands it out on request is not
-- privacy.
--
-- So the row filter becomes the permission that already exists for exactly
-- this: can_view_billing. my_perm() returns true unconditionally for the CEO,
-- and manager_permissions.can_view_billing defaults to false, so the effect is
-- "CEO only" out of the box with a per-manager grant available in the CEO's
-- staff management screen. No new flag, no new table, and the students' own
-- rows are untouched.

-- ── Invoices ────────────────────────────────────────────────────────────────
drop policy if exists invoices_own on public.invoices;
create policy invoices_own on public.invoices for select
  using (student_id = auth.uid()
         or (academy_id = public.my_academy() and public.my_perm('can_view_billing')));

drop policy if exists invoices_admin on public.invoices;
create policy invoices_admin on public.invoices for all
  using (academy_id = public.my_academy() and public.my_perm('can_view_billing'))
  with check (academy_id = public.my_academy() and public.my_perm('can_view_billing'));

-- ── Subscriptions ───────────────────────────────────────────────────────────
drop policy if exists subscriptions_own on public.subscriptions;
create policy subscriptions_own on public.subscriptions for select
  using (student_id = auth.uid()
         or (academy_id = public.my_academy() and public.my_perm('can_view_billing')));

drop policy if exists subscriptions_admin on public.subscriptions;
create policy subscriptions_admin on public.subscriptions for all
  using (academy_id = public.my_academy() and public.my_perm('can_view_billing'))
  with check (academy_id = public.my_academy() and public.my_perm('can_view_billing'));

-- ── Billing customers / event log ───────────────────────────────────────────
drop policy if exists billing_customers_own on public.billing_customers;
create policy billing_customers_own on public.billing_customers for select
  using (profile_id = auth.uid()
         or (academy_id = public.my_academy() and public.my_perm('can_view_billing')));

drop policy if exists billing_customers_admin on public.billing_customers;
create policy billing_customers_admin on public.billing_customers for all
  using (academy_id = public.my_academy() and public.my_perm('can_view_billing'))
  with check (academy_id = public.my_academy() and public.my_perm('can_view_billing'));

drop policy if exists billing_events_read on public.billing_events;
create policy billing_events_read on public.billing_events for select
  using (academy_id = public.my_academy() and public.my_perm('can_view_billing'));

-- ── Coach penalties ─────────────────────────────────────────────────────────
-- A penalty row carries `amount` - a deduction from coach pay, which is
-- salary data. Postgres RLS filters rows, not columns, so there is no way to
-- hand a manager the reason while withholding the figure; the row goes or it
-- doesn't. Managers only ever *read* this table (issuing and waiving are
-- CEO-only, 0018), so gating it on the same billing permission costs them no
-- workflow. A coach still always sees their own penalties.
drop policy if exists penalties_read on public.coach_penalties;
create policy penalties_read on public.coach_penalties for select
  using (academy_id = public.my_academy()
         and (coach_id = auth.uid() or public.my_perm('can_view_billing')));

comment on column public.coach_penalties.amount is
  'Salary deduction. Readable only by the coach it belongs to and by anyone with can_view_billing (always the CEO) - see 0024_financial_privacy.sql.';
