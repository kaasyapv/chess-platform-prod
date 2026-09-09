-- 0014: TeleCRM native clone (Path B) - docs/telecrm-architecture.md §3.
-- Greenfield: whatsapp_messages, call_logs, lead_distribution_rules,
-- drip_campaigns/drip_enrollments. Rides the existing leads/lead_events RLS
-- idiom (my_academy() + my_perm('can_manage_leads') or row ownership).

-- ── WhatsApp thread per lead ─────────────────────────────────────────────────
create table public.whatsapp_messages (
  id              uuid primary key default gen_random_uuid(),
  academy_id      uuid not null references public.academies(id),
  lead_id         uuid not null references public.leads(id) on delete cascade,
  direction       text not null check (direction in ('in','out')),
  body            text not null,
  template_name   text,
  status          text not null default 'sent' check (status in ('queued','sent','delivered','read','failed')),
  provider_msg_id text,
  created_at      timestamptz not null default now()
);
create index whatsapp_messages_lead on public.whatsapp_messages (lead_id, created_at);
alter table public.whatsapp_messages enable row level security;
create policy whatsapp_messages_access on public.whatsapp_messages for all
  using (academy_id = public.my_academy()
         and exists (select 1 from public.leads l where l.id = lead_id
                      and (public.my_perm('can_manage_leads') or l.assigned_to = auth.uid())))
  with check (academy_id = public.my_academy()
         and exists (select 1 from public.leads l where l.id = lead_id
                      and (public.my_perm('can_manage_leads') or l.assigned_to = auth.uid())));
alter publication supabase_realtime add table public.whatsapp_messages;

-- ── Call logs - client-side tel: dialer, this table is the record after the
--    fact (telecrm-architecture.md §3.3: no in-browser dialer) ──────────────
create table public.call_logs (
  id               uuid primary key default gen_random_uuid(),
  academy_id       uuid not null references public.academies(id),
  lead_id          uuid not null references public.leads(id) on delete cascade,
  agent_id         uuid not null references public.profiles(id),
  direction        text not null check (direction in ('in','out')),
  duration_seconds integer not null default 0,
  outcome          text not null default 'no_answer'
                   check (outcome in ('connected','no_answer','voicemail','busy','wrong_number')),
  recording_url    text,
  started_at       timestamptz not null default now()
);
create index call_logs_lead on public.call_logs (lead_id, started_at);
create index call_logs_academy on public.call_logs (academy_id, started_at);
alter table public.call_logs enable row level security;
create policy call_logs_access on public.call_logs for all
  using (academy_id = public.my_academy()
         and (public.my_perm('can_manage_leads') or agent_id = auth.uid()))
  with check (academy_id = public.my_academy()
         and (public.my_perm('can_manage_leads') or agent_id = auth.uid()));

-- ── Lead distribution rules - weighted round-robin config. The pick itself
--    is computed client-side (src/lib/telecrm.ts, unit-tested); this table is
--    just the weights, read from the TeleCRM dashboard's Distribution tab. ──
create table public.lead_distribution_rules (
  id             uuid primary key default gen_random_uuid(),
  academy_id     uuid not null references public.academies(id),
  agent_id       uuid not null references public.profiles(id),
  weight_percent integer not null check (weight_percent between 1 and 100),
  active         boolean not null default true,
  unique (academy_id, agent_id)
);
alter table public.lead_distribution_rules enable row level security;
create policy lead_distribution_rules_read on public.lead_distribution_rules for select
  using (academy_id = public.my_academy());
create policy lead_distribution_rules_write on public.lead_distribution_rules for insert
  with check (academy_id = public.my_academy() and public.my_perm('can_manage_leads'));
create policy lead_distribution_rules_update on public.lead_distribution_rules for update
  using (academy_id = public.my_academy() and public.my_perm('can_manage_leads'))
  with check (academy_id = public.my_academy() and public.my_perm('can_manage_leads'));
create policy lead_distribution_rules_delete on public.lead_distribution_rules for delete
  using (academy_id = public.my_academy() and public.my_perm('can_manage_leads'));

-- ── Drip campaigns - steps kept as jsonb (one row per campaign, not a child
--    table) since nothing here needs per-step querying yet. ─────────────────
create table public.drip_campaigns (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id),
  name       text not null,
  steps      jsonb not null default '[]', -- [{ "delay_hours": 24, "template_name": "..." }, ...]
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.drip_campaigns enable row level security;
create policy drip_campaigns_access on public.drip_campaigns for all
  using (academy_id = public.my_academy() and public.my_perm('can_manage_leads'))
  with check (academy_id = public.my_academy() and public.my_perm('can_manage_leads'));

create table public.drip_enrollments (
  id            uuid primary key default gen_random_uuid(),
  academy_id    uuid not null references public.academies(id),
  campaign_id   uuid not null references public.drip_campaigns(id) on delete cascade,
  lead_id       uuid not null references public.leads(id) on delete cascade,
  status        text not null default 'active' check (status in ('active','paused','completed')),
  current_step  integer not null default 0,
  next_send_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (campaign_id, lead_id)
);
create index drip_enrollments_campaign on public.drip_enrollments (campaign_id, status);
alter table public.drip_enrollments enable row level security;
create policy drip_enrollments_access on public.drip_enrollments for all
  using (academy_id = public.my_academy() and public.my_perm('can_manage_leads'))
  with check (academy_id = public.my_academy() and public.my_perm('can_manage_leads'));

-- ponytail: advance_drip_enrollments() cron function from the architecture
-- doc (§3.2) is intentionally not built - nothing drives message *sending*
-- yet (no WhatsApp Cloud API credentials), so an automatic step-advancer
-- would just flip statuses with nothing to show for it. Add it alongside the
-- real send integration.
