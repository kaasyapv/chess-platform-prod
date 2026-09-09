-- 0006: Enterprise OS - manager permissions, leads CRM, demo sessions,
-- live-ops board state, webhook ingestion tokens, GST-ready billing columns.
-- Design: docs/ARCHITECTURE_V2.md

-- ── Manager permissions (boolean flags; title is display-only) ──────────────
create table public.manager_permissions (
  profile_id           uuid primary key references public.profiles(id) on delete cascade,
  academy_id           uuid not null references public.academies(id),
  title                text not null default 'Manager',
  can_manage_leads     boolean not null default false,
  can_view_billing     boolean not null default false,
  can_schedule_classes boolean not null default false,
  can_manage_students  boolean not null default false,
  can_view_reports     boolean not null default false,
  can_run_demos        boolean not null default false,
  updated_at           timestamptz not null default now()
);
alter table public.manager_permissions enable row level security;
create policy mgr_perms_read on public.manager_permissions for select
  using (academy_id = public.my_academy());
create policy mgr_perms_ceo_write on public.manager_permissions for all
  using (academy_id = public.my_academy() and public.my_role() = 'ceo')
  with check (academy_id = public.my_academy() and public.my_role() = 'ceo');
create trigger audit_mgr_perms after insert or update or delete on public.manager_permissions
  for each row execute function public.audit();

-- CEO always true; manager → flag lookup; coach/student → false.
create or replace function public.my_perm(flag text)
returns boolean language plpgsql stable security definer as $$
declare m public.manager_permissions;
begin
  if public.my_role() = 'ceo' then return true; end if;
  if public.my_role() <> 'manager' then return false; end if;
  select * into m from public.manager_permissions where profile_id = auth.uid();
  if m.profile_id is null then return false; end if;
  return case flag
    when 'can_manage_leads'     then m.can_manage_leads
    when 'can_view_billing'     then m.can_view_billing
    when 'can_schedule_classes' then m.can_schedule_classes
    when 'can_manage_students'  then m.can_manage_students
    when 'can_view_reports'     then m.can_view_reports
    when 'can_run_demos'        then m.can_run_demos
    else false end;
end $$;

-- ── Leads CRM ────────────────────────────────────────────────────────────────
create table public.leads (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id),
  name        text not null,
  contact     jsonb not null default '{}',      -- {email, phone, whatsapp}
  source      text not null default 'manual',
  status      text not null default 'new'
              check (status in ('new','qualified','assigned','demo','trial','enrolled','lost')),
  assigned_to uuid references public.profiles(id),
  student_id  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index leads_academy_status on public.leads (academy_id, status);
alter table public.leads enable row level security;
-- CEO / can_manage_leads: all academy leads. Any manager: leads assigned to them.
create policy leads_access on public.leads for all
  using (academy_id = public.my_academy()
         and (public.my_perm('can_manage_leads') or assigned_to = auth.uid()))
  with check (academy_id = public.my_academy()
         and (public.my_perm('can_manage_leads') or assigned_to = auth.uid()));
create trigger audit_leads after insert or update or delete on public.leads
  for each row execute function public.audit();

create table public.lead_events (
  id         bigint generated always as identity primary key,
  lead_id    uuid not null references public.leads(id) on delete cascade,
  academy_id uuid not null references public.academies(id),
  kind       text not null check (kind in ('note','status','assignment','webhook','demo')),
  actor_id   uuid references public.profiles(id),
  body       text,
  meta       jsonb,
  created_at timestamptz not null default now()
);
create index lead_events_lead on public.lead_events (lead_id, created_at);
alter table public.lead_events enable row level security;
create policy lead_events_access on public.lead_events for select
  using (exists (select 1 from public.leads l where l.id = lead_id));  -- ride leads RLS
create policy lead_events_insert on public.lead_events for insert
  with check (academy_id = public.my_academy()
              and exists (select 1 from public.leads l where l.id = lead_id));

-- ── Demo sessions (transactional sandbox) ────────────────────────────────────
create table public.demo_sessions (
  id           uuid primary key default gen_random_uuid(),
  academy_id   uuid not null references public.academies(id),
  lead_id      uuid not null references public.leads(id) on delete cascade,
  coach_id     uuid not null references public.profiles(id),
  classroom_id uuid references public.classrooms(id) on delete set null,
  invite_id    uuid references public.invites(id) on delete set null,
  status       text not null default 'scheduled'
               check (status in ('scheduled','converted','expired')),
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now()
);
alter table public.demo_sessions enable row level security;
create policy demos_access on public.demo_sessions for all
  using (academy_id = public.my_academy() and public.my_perm('can_run_demos'))
  with check (academy_id = public.my_academy() and public.my_perm('can_run_demos'));

-- Expire lapsed demos: delete unclaimed invites, cancel classrooms, remove
-- claimed-but-unconverted temp profiles, return leads to 'qualified'.
-- Run by staff (own academy) or pg_cron (all):
--   select cron.schedule('expire-demos','*/30 * * * *',$$select public.expire_demo_sessions()$$);
create or replace function public.expire_demo_sessions()
returns integer language plpgsql security definer as $$
declare n integer := 0; d public.demo_sessions;
begin
  if auth.uid() is not null and not public.my_perm('can_run_demos') then
    raise exception 'not allowed';
  end if;
  for d in
    select * from public.demo_sessions
     where status = 'scheduled' and expires_at <= now()
       and (auth.uid() is null or academy_id = public.my_academy())
  loop
    delete from public.profiles p using public.invites i
      where i.id = d.invite_id and p.id = i.claimed_by;      -- temp sandbox account
    delete from public.invites where id = d.invite_id;
    update public.classrooms set status = 'cancelled'
      where id = d.classroom_id and status in ('scheduled','delayed');
    update public.demo_sessions set status = 'expired' where id = d.id;
    update public.leads set status = 'qualified', updated_at = now()
      where id = d.lead_id and status = 'demo';
    insert into public.lead_events (lead_id, academy_id, kind, body)
      values (d.lead_id, d.academy_id, 'demo', 'Demo expired unconverted - sandbox cleaned up');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.expire_demo_sessions() from public, anon;
grant execute on function public.expire_demo_sessions() to authenticated;

-- ── Live-ops board state (single postgres_changes listener reads this) ──────
alter table public.classrooms add column live_fen text;
alter table public.classrooms add column live_updated_at timestamptz;
alter publication supabase_realtime add table public.classrooms;

-- ── Webhook ingestion token (CEO-only visibility) + GST foundations ─────────
-- Separate table: academies is readable by every member, secrets must not be.
create table public.academy_secrets (
  academy_id    uuid primary key references public.academies(id) on delete cascade,
  webhook_token text not null default encode(gen_random_bytes(16), 'hex'),
  created_at    timestamptz not null default now()
);
alter table public.academy_secrets enable row level security;
create policy academy_secrets_ceo on public.academy_secrets for all
  using (academy_id = public.my_academy() and public.my_role() = 'ceo')
  with check (academy_id = public.my_academy() and public.my_role() = 'ceo');
insert into public.academy_secrets (academy_id)
  select id from public.academies on conflict do nothing;

create or replace function public.ensure_academy_secret()
returns trigger language plpgsql security definer as $$
begin
  insert into public.academy_secrets (academy_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger academy_secret_on_create after insert on public.academies
  for each row execute function public.ensure_academy_secret();

alter table public.academies add column gstin text;
alter table public.invoices add column gstin text;
alter table public.invoices add column tax_rate numeric(5,2);
alter table public.invoices add column tax_inr numeric(10,2);
