-- 0013_help_requests.sql - "Call Manager" live-ops escalation.
-- A coach or student in a live class flags it for help; CEO/manager see it
-- surface on /live-ops in real time and claim it. Claim is a plain
-- conditional UPDATE (status='open' -> 'claimed') - Postgres row-level
-- atomicity is the lock, no advisory locks or separate lock table needed.

create table public.help_requests (
  id             uuid primary key default gen_random_uuid(),
  academy_id     uuid not null references public.academies(id),
  classroom_id   uuid not null references public.classrooms(id),
  requested_by   uuid not null references public.profiles(id),
  requested_role public.user_role not null check (requested_role in ('coach','student')),
  status         text not null default 'open' check (status in ('open','claimed','resolved')),
  claimed_by     uuid references public.profiles(id),
  claimed_at     timestamptz,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now()
);

-- One open request per classroom at a time: the trigger button is a no-op
-- (unique-violation, ignored client-side) while one is already open, so a
-- panicked coach mashing the button never spams the queue.
create unique index help_requests_one_open_per_classroom
  on public.help_requests (classroom_id) where (status = 'open');
create index help_requests_academy_status on public.help_requests (academy_id, status);

alter table public.help_requests enable row level security;

-- Requester (coach/student in the class) can raise + read their own academy's rows.
create policy help_requests_select on public.help_requests for select
  using (academy_id = public.my_academy());
create policy help_requests_insert on public.help_requests for insert
  with check (academy_id = public.my_academy() and requested_by = auth.uid());

-- Claim/resolve is staff-only (ceo/manager); the WHERE status='open' guard
-- that makes claiming race-safe lives in the application query, not here -
-- RLS only needs to gate *who* may update, the conditional update supplies
-- the concurrency guarantee.
create policy help_requests_staff_update on public.help_requests for update
  using (academy_id = public.my_academy() and public.my_role() in ('ceo','manager'));

alter publication supabase_realtime add table public.help_requests;
