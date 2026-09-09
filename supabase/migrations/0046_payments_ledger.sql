-- 0046: payments hardening + coach settlement model (ERP: "Integrated Payments").
--
-- Two gaps the reference platforms cover and this one doesn't:
--
-- 1. Webhook idempotency. `billing_events` is an append-only log - a provider
--    that redelivers `payment.captured` (they all do, on any 5xx / timeout)
--    gets processed twice: two `billing_events` rows, and record_invoice_payment
--    can double-apply. `webhook_deliveries` is a dedup gate keyed by
--    (provider, event_id): the settle path claims the id first and no-ops if
--    it's already there.
--
-- 2. Coach payouts. finance.ts splits revenue by hardcoded rates
--    (COACH_SHARE / GATEWAY_FEE_RATE / PLATFORM_FEE_RATE) because "the platform
--    has no payouts table yet". `payouts` records the actual per-coach
--    settlement for a period so earnings stop being a guess.
--
-- Both additive. RLS mirrors the existing money tables: CEO-only reads
-- (0024 narrowed invoices/subscriptions/billing_events to CEO or
-- can_view_billing); writes are service-role / security-definer only, never
-- from a user session.

-- ── webhook_deliveries ────────────────────────────────────────────────────
create table public.webhook_deliveries (
  provider    text not null,                       -- 'razorpay' | 'stripe' | 'mock'
  event_id    text not null,                       -- the provider's own delivery/event id
  event_type  text,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);
alter table public.webhook_deliveries enable row level security;
-- No policy for `authenticated` at all: only the service role (bypasses RLS)
-- touches this, from the webhook route. A user session can neither read nor
-- write it.

-- ── payouts ───────────────────────────────────────────────────────────────
create table public.payouts (
  id              uuid primary key default gen_random_uuid(),
  academy_id      uuid not null references public.academies(id),
  coach_id        uuid not null references public.profiles(id),
  period_start    date not null,
  period_end      date not null,
  gross_inr       numeric(12,2) not null default 0,   -- revenue attributed to this coach in the period
  coach_share_inr numeric(12,2) not null default 0,   -- what the coach is owed
  status          text not null default 'pending'
                  check (status in ('pending', 'approved', 'paid', 'void')),
  paid_at         timestamptz,
  note            text,
  created_at      timestamptz not null default now(),
  unique (academy_id, coach_id, period_start, period_end)
);
create index payouts_coach on public.payouts(coach_id, period_start desc);

alter table public.payouts enable row level security;

-- A coach sees their own settled payouts; CEO (or can_view_billing) sees all in
-- the academy. Same shape as invoices_own (0024).
create policy payouts_read on public.payouts for select
  using (
    coach_id = auth.uid()
    or (academy_id = public.my_academy()
        and (public.my_role() = 'ceo' or public.my_perm('can_view_billing')))
  );
-- No insert/update/delete policy: payouts are computed and written by a
-- settlement job under the service role, never from a session.

notify pgrst, 'reload schema';
