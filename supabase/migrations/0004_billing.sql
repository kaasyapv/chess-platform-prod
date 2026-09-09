-- 0004: Provider-agnostic billing - customers, subscriptions, event log.
-- Gateway integration is pluggable (src/lib/billing); "mock" works end-to-end
-- with no external account. Real providers reuse these same tables.

-- ── Provider customer mapping ───────────────────────────────────────────────
create table public.billing_customers (
  id           uuid primary key default gen_random_uuid(),
  academy_id   uuid not null references public.academies(id),
  profile_id   uuid not null references public.profiles(id),
  provider     text not null,
  provider_ref text not null,
  created_at   timestamptz not null default now(),
  unique (profile_id, provider)
);
alter table public.billing_customers enable row level security;
create policy billing_customers_own on public.billing_customers for select
  using (profile_id = auth.uid()
         or (academy_id = public.my_academy() and public.my_role() in ('ceo','manager')));
create policy billing_customers_admin on public.billing_customers for all
  using (academy_id = public.my_academy() and public.my_role() in ('ceo','manager'));

-- ── Subscriptions (recurring plans; invoices are generated per period) ──────
create table public.subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  academy_id         uuid not null references public.academies(id),
  student_id         uuid not null references public.profiles(id),
  plan               text not null,
  amount_inr         numeric(10,2) not null,
  billing_interval   text not null default 'monthly'
                     check (billing_interval in ('monthly','quarterly','yearly')),
  status             text not null default 'active'
                     check (status in ('active','past_due','canceled')),
  provider           text not null default 'mock',
  provider_ref       text,
  current_period_end timestamptz not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
create policy subscriptions_own on public.subscriptions for select
  using (student_id = auth.uid()
         or (academy_id = public.my_academy() and public.my_role() in ('ceo','manager')));
create policy subscriptions_admin on public.subscriptions for all
  using (academy_id = public.my_academy() and public.my_role() in ('ceo','manager'));
create trigger audit_subscriptions after insert or update or delete on public.subscriptions
  for each row execute function public.audit();

-- ── Normalized billing event log (webhooks + mock payments) ─────────────────
create table public.billing_events (
  id              bigint generated always as identity primary key,
  academy_id      uuid,
  provider        text not null,
  event_type      text not null,
  invoice_id      uuid references public.invoices(id),
  subscription_id uuid references public.subscriptions(id),
  payload         jsonb,
  created_at      timestamptz not null default now()
);
alter table public.billing_events enable row level security;
create policy billing_events_read on public.billing_events for select
  using (academy_id = public.my_academy() and public.my_role() in ('ceo','manager'));
-- inserts happen via security-definer functions / service-role webhooks only

-- ── Payment settlement (security definer: payer or academy admin) ───────────
create or replace function public.record_invoice_payment(p_invoice uuid, p_provider text, p_ref text)
returns void language plpgsql security definer as $$
declare inv public.invoices;
begin
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null then raise exception 'invoice not found'; end if;
  if not (inv.student_id = auth.uid()
          or (inv.academy_id = public.my_academy() and public.my_role() in ('ceo','manager'))) then
    raise exception 'not allowed';
  end if;
  if inv.status <> 'due' then raise exception 'invoice is not due'; end if;
  update public.invoices set status = 'paid', paid_at = now() where id = p_invoice;
  insert into public.billing_events (academy_id, provider, event_type, invoice_id, payload)
    values (inv.academy_id, p_provider, 'payment.succeeded', p_invoice,
            jsonb_build_object('ref', p_ref, 'amount_inr', inv.amount_inr));
end $$;

-- ── Renewals: generate the next invoice for every lapsed active subscription.
-- Run manually from the billing UI, or schedule in Supabase:
--   select cron.schedule('renewals', '0 2 * * *', $$select public.renew_due_subscriptions()$$);
create or replace function public.renew_due_subscriptions()
returns integer language plpgsql security definer as $$
declare n integer := 0; sub public.subscriptions;
begin
  -- Called by an admin (scoped to their academy) or by pg_cron (no auth.uid(),
  -- processes every academy). Execute is revoked from anon below.
  if auth.uid() is not null and not (public.my_role() in ('ceo','manager')) then
    raise exception 'not allowed';
  end if;
  for sub in
    select * from public.subscriptions
     where status = 'active' and current_period_end <= now()
       and (auth.uid() is null or academy_id = public.my_academy())
  loop
    insert into public.invoices (academy_id, student_id, amount_inr, description, due_at)
      values (sub.academy_id, sub.student_id, sub.amount_inr,
              sub.plan || ' (' || sub.billing_interval || ' renewal)',
              sub.current_period_end + interval '7 days');
    update public.subscriptions
       set current_period_end = current_period_end +
             case billing_interval when 'monthly' then interval '1 month'
                                   when 'quarterly' then interval '3 months'
                                   else interval '1 year' end,
           updated_at = now()
     where id = sub.id;
    insert into public.billing_events (academy_id, provider, event_type, subscription_id, payload)
      values (sub.academy_id, sub.provider, 'subscription.renewed', sub.id,
              jsonb_build_object('plan', sub.plan));
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.record_invoice_payment(uuid, text, text) from public, anon;
grant execute on function public.record_invoice_payment(uuid, text, text) to authenticated;
revoke execute on function public.renew_due_subscriptions() from public, anon;
grant execute on function public.renew_due_subscriptions() to authenticated;

