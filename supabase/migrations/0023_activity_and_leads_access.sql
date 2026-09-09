-- 0023: genuine activity tracking, and Leads as an explicitly granted permission.
--
-- ── Activity ────────────────────────────────────────────────────────────────
-- "Active hours" has to mean time actually spent working or learning, not the
-- gap between login and logout - a tab left open overnight is not an eight-hour
-- shift. So the client emits a heartbeat only while the person is genuinely
-- interacting, and each heartbeat carries the window it accounts for. Summing
-- those windows is the active total; feature events (started a class, opened
-- the whiteboard) sit in the same stream so a CEO can read the session back as
-- a timeline rather than a number they have to trust.

create table public.activity_events (
  id           bigint generated always as identity primary key,
  academy_id   uuid not null references public.academies(id),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  kind         text not null check (kind in (
                 'login','logout','active','idle','class_start','class_join','class_end',
                 'whiteboard','pgn_upload','puzzle_solved','homework_submit','report_view','page_view')),
  classroom_id uuid references public.classrooms(id) on delete set null,
  detail       text,
  -- Seconds this row accounts for: the heartbeat window for 'active', the
  -- measured gap for 'idle'. Null for instantaneous events.
  seconds      integer check (seconds is null or seconds between 0 and 7200),
  created_at   timestamptz not null default now()
);

create index activity_profile_time on public.activity_events (profile_id, created_at desc);
create index activity_academy_time on public.activity_events (academy_id, created_at desc);

alter table public.activity_events enable row level security;

-- You may only write your own activity - nobody can forge someone else's hours.
create policy activity_self_insert on public.activity_events for insert
  with check (profile_id = auth.uid() and academy_id = public.my_academy());
-- You can see your own; CEO and managers can see the academy's (that's the
-- point - verifying genuine work/learning time).
create policy activity_read on public.activity_events for select
  using (academy_id = public.my_academy()
         and (profile_id = auth.uid() or public.is_admin()));

/** Genuine active seconds in a window: the sum of heartbeat windows, which by
 *  construction excludes idle time. Security-definer so a report can total a
 *  coach's hours without handing the reader every underlying row. */
create or replace function public.active_seconds(p_profile uuid, p_from timestamptz, p_to timestamptz)
returns bigint language sql stable security definer as $$
  select coalesce(sum(seconds), 0)::bigint
  from public.activity_events
  where profile_id = p_profile
    and kind = 'active'
    and created_at >= p_from and created_at < p_to
    and exists (select 1 from public.profiles p
                where p.id = p_profile and p.academy_id = public.my_academy());
$$;
revoke execute on function public.active_seconds(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.active_seconds(uuid, timestamptz, timestamptz) to authenticated;

-- ── Leads access ────────────────────────────────────────────────────────────
-- Previously any manager could read leads assigned to them, so Leads was
-- effectively on by default for managers. It is now strictly opt-in: the CEO
-- grants can_manage_leads per manager, and a manager without it sees nothing,
-- assigned or otherwise.
drop policy if exists leads_access on public.leads;
create policy leads_access on public.leads for select
  using (academy_id = public.my_academy() and public.my_perm('can_manage_leads'));

drop policy if exists leads_write on public.leads;
create policy leads_write on public.leads for all
  using (academy_id = public.my_academy() and public.my_perm('can_manage_leads'))
  with check (academy_id = public.my_academy() and public.my_perm('can_manage_leads'));

drop policy if exists lead_events_access on public.lead_events;
create policy lead_events_access on public.lead_events for select
  using (academy_id = public.my_academy() and public.my_perm('can_manage_leads'));

drop policy if exists lead_events_insert on public.lead_events;
create policy lead_events_insert on public.lead_events for insert
  with check (academy_id = public.my_academy() and public.my_perm('can_manage_leads')
              and exists (select 1 from public.leads l where l.id = lead_id));

-- New managers start without it; the CEO turns it on deliberately.
alter table public.manager_permissions alter column can_manage_leads set default false;

comment on table public.activity_events is
  'Genuine activity stream. "active" rows are heartbeats emitted only while the user is interacting, each carrying the seconds it accounts for - sum them for real active time, never login-to-logout.';
