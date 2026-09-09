-- 0025: penalties become CEO-only, and the calendar gains tasks and meetings.
--
-- ── Penalties ───────────────────────────────────────────────────────────────
-- 0018 gave managers read access "for oversight", and 0024 narrowed that to
-- managers holding can_view_billing. The rule is now simpler and stricter:
-- penalties are the CEO's business alone. A manager is no longer an observer
-- of other people's discipline, but they can be subject to one themselves --
-- they see their own row, and appeal_penalty() already keys off coach_id =
-- auth.uid(), so appealing works for them with no change.
drop policy if exists penalties_read on public.coach_penalties;
create policy penalties_read on public.coach_penalties for select
  using (academy_id = public.my_academy()
         and (coach_id = auth.uid() or public.my_role() = 'ceo'));

comment on column public.coach_penalties.coach_id is
  'The person penalised. Named coach_id historically, but a manager can be penalised too -- the CEO picks from coaches and managers alike.';

-- ── Calendar tasks ──────────────────────────────────────────────────────────
-- A plain personal to-do with a time on it. Deliberately not shared, not
-- assignable, and not a project tracker: the ask is "the CEO can put a task on
-- their calendar at a specific time", and anything more is a second product.
create table public.calendar_tasks (
  id               uuid primary key default gen_random_uuid(),
  academy_id       uuid not null references public.academies(id),
  owner_id         uuid not null references public.profiles(id) on delete cascade,
  title            text not null check (length(trim(title)) > 0),
  notes            text,
  due_at           timestamptz not null,
  duration_minutes integer not null default 0 check (duration_minutes between 0 and 1440),
  status           text not null default 'open' check (status in ('open', 'done')),
  created_at       timestamptz not null default now()
);
create index calendar_tasks_owner_time on public.calendar_tasks (owner_id, due_at);
alter table public.calendar_tasks enable row level security;

-- Your tasks are yours. Nobody reads them, including the CEO.
create policy calendar_tasks_own on public.calendar_tasks for all
  using (owner_id = auth.uid() and academy_id = public.my_academy())
  with check (owner_id = auth.uid() and academy_id = public.my_academy());

-- ── Meetings ────────────────────────────────────────────────────────────────
-- Internal staff meetings: the CEO (or a manager) picks a time and some staff,
-- and it lands on everyone's calendar. The room is either this platform's own
-- video mesh -- which needs no provisioning, the meeting id IS the room key --
-- or a pasted Zoom/Meet URL for when the academy would rather use theirs.
create table public.meetings (
  id               uuid primary key default gen_random_uuid(),
  academy_id       uuid not null references public.academies(id),
  organizer_id     uuid not null references public.profiles(id),
  title            text not null check (length(trim(title)) > 0),
  agenda           text,
  starts_at        timestamptz not null,
  duration_minutes integer not null default 30 check (duration_minutes between 5 and 480),
  location_kind    text not null default 'internal' check (location_kind in ('internal', 'external')),
  -- Only meaningful for 'external'. Constrained so a typo can't become a
  -- javascript: link rendered as an anchor on someone else's calendar.
  external_url     text check (external_url is null or external_url ~* '^https://'),
  status           text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  created_at       timestamptz not null default now(),
  -- An external meeting without a link is just a time with no room.
  constraint meetings_external_needs_url
    check (location_kind <> 'external' or external_url is not null)
);
create index meetings_academy_time on public.meetings (academy_id, starts_at);

create table public.meeting_attendees (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  primary key (meeting_id, profile_id)
);
create index meeting_attendees_profile on public.meeting_attendees (profile_id);

alter table public.meetings enable row level security;
alter table public.meeting_attendees enable row level security;

/** Am I in this meeting, either as organiser or invitee? Security-definer so
 *  the meetings policy can consult the attendee list without that list's own
 *  policy having to be readable first -- otherwise the two tables' policies
 *  reference each other and every read recurses. */
create or replace function public.in_meeting(p_meeting uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.meetings m
     where m.id = p_meeting
       and (m.organizer_id = auth.uid()
            or exists (select 1 from public.meeting_attendees a
                        where a.meeting_id = m.id and a.profile_id = auth.uid()))
  );
$$;
revoke execute on function public.in_meeting(uuid) from public, anon;
grant execute on function public.in_meeting(uuid) to authenticated;

-- Read what you are actually part of -- a meeting is not academy-wide notice.
create policy meetings_read on public.meetings for select
  using (academy_id = public.my_academy() and public.in_meeting(id));

-- Only the CEO and managers convene meetings, and only in their own name.
create policy meetings_organize on public.meetings for insert
  with check (academy_id = public.my_academy()
              and organizer_id = auth.uid()
              and public.my_role() in ('ceo', 'manager'));

-- Reschedule or cancel your own.
create policy meetings_manage on public.meetings for update
  using (academy_id = public.my_academy() and organizer_id = auth.uid())
  with check (academy_id = public.my_academy() and organizer_id = auth.uid());
create policy meetings_delete on public.meetings for delete
  using (academy_id = public.my_academy() and organizer_id = auth.uid());

create policy meeting_attendees_read on public.meeting_attendees for select
  using (public.in_meeting(meeting_id));
-- The invite list is the organiser's to set.
create policy meeting_attendees_write on public.meeting_attendees for all
  using (exists (select 1 from public.meetings m
                  where m.id = meeting_id and m.organizer_id = auth.uid()))
  with check (exists (select 1 from public.meetings m
                       where m.id = meeting_id and m.organizer_id = auth.uid()));

-- ── Calendar view ───────────────────────────────────────────────────────────
-- Tasks and meetings join the same aggregate the calendar already reads, so
-- they appear on every attendee's calendar without the client learning about
-- two more tables. RLS on the underlying tables does the scoping: the view is
-- security_invoker, so you only ever see your own tasks and your own meetings.
create or replace view public.calendar_events
with (security_invoker = true) as
  select id, academy_id, 'class' as kind, title, scheduled_at as starts_at,
         duration_minutes, status from public.classrooms
  union all
  select id, academy_id, 'homework', title, due_at, 0, status
    from public.homework_assignments where due_at is not null
  union all
  select id, academy_id, 'tournament', title, starts_at, 0, status
    from public.tournaments where starts_at is not null
  union all
  select id, academy_id, 'simul', title, starts_at, 0, status
    from public.simuls where starts_at is not null
  union all
  select id, academy_id, 'booking', 'Coaching session', starts_at,
         duration_minutes, status from public.bookings
  union all
  select id, academy_id, 'task', title, due_at, duration_minutes, status
    from public.calendar_tasks
  union all
  select id, academy_id, 'meeting', title, starts_at, duration_minutes, status
    from public.meetings;
