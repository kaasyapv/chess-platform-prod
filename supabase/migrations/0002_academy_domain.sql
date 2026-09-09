-- 0002_academy_domain.sql - batches, classrooms, PGN library, homework,
-- courses/lessons, tournaments, simuls, attendance, self-booking, points,
-- games/analyses, announcements/notifications, billing. All RLS, all tenant-scoped.

-- ── Batches ─────────────────────────────────────────────────────────────────
create table public.batches (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id),
  name       text not null,
  coach_id   uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.batch_members (
  batch_id   uuid references public.batches(id) on delete cascade,
  student_id uuid references public.profiles(id) on delete cascade,
  primary key (batch_id, student_id)
);

-- ── Classrooms (sessions + series) ──────────────────────────────────────────
create table public.classroom_series (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id),
  title      text not null,
  coach_id   uuid not null references public.profiles(id),
  batch_id   uuid references public.batches(id),
  created_at timestamptz not null default now()
);
create table public.classrooms (
  id           uuid primary key default gen_random_uuid(),
  academy_id   uuid not null references public.academies(id),
  series_id    uuid references public.classroom_series(id) on delete set null,
  title        text not null,
  coach_id     uuid not null references public.profiles(id),
  batch_id     uuid references public.batches(id),
  course_id    uuid,                              -- fk added after courses
  scheduled_at timestamptz not null,
  duration_minutes int not null default 60,
  status       text not null default 'scheduled'
               check (status in ('scheduled','live','delayed','completed','cancelled')),
  started_at   timestamptz,
  ended_at     timestamptz,
  jitsi_room   text not null default encode(gen_random_bytes(9), 'hex'),
  notes        text,
  created_at   timestamptz not null default now()
);
create table public.classroom_enrollments (
  classroom_id uuid references public.classrooms(id) on delete cascade,
  student_id   uuid references public.profiles(id) on delete cascade,
  primary key (classroom_id, student_id)
);
create table public.classroom_messages (
  id           bigint generated always as identity primary key,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  sender_id    uuid not null references public.profiles(id),
  text         text not null,
  created_at   timestamptz not null default now()
);

-- ── PGN library ─────────────────────────────────────────────────────────────
create table public.pgn_folders (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id),
  parent_id  uuid references public.pgn_folders(id) on delete cascade,
  name       text not null,
  position   int not null default 0,
  created_at timestamptz not null default now()
);
create table public.pgns (
  id           uuid primary key default gen_random_uuid(),
  academy_id   uuid not null references public.academies(id),
  folder_id    uuid references public.pgn_folders(id) on delete set null,
  title        text not null,
  position     int not null default 0,
  content      text not null,
  metadata     jsonb not null default '{}',
  created_by   uuid references public.profiles(id),
  search_vector tsvector generated always as
    (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,''))) stored,
  created_at   timestamptz not null default now()
);
create index pgns_search on public.pgns using gin(search_vector);

-- ── Courses & lessons (incl. Knowledge Engine artifacts) ────────────────────
create table public.courses (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id),
  title       text not null,
  description text,
  tags        text[] not null default '{}',
  status      text not null default 'draft' check (status in ('draft','active','archived')),
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
alter table public.classrooms
  add constraint classrooms_course_fk foreign key (course_id) references public.courses(id) on delete set null;

create table public.lessons (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id),
  course_id   uuid references public.courses(id) on delete set null,
  kind        text not null check (kind in ('lesson','quiz','flashcards')),
  title       text not null,
  -- content: { steps: [{fen, moves, task, explanation}...] } | quiz questions | cards
  content     jsonb not null default '{}',
  tags        text[] not null default '{}',
  source_job_id uuid,                              -- extraction job, if AI-built
  position    int not null default 0,
  status      text not null default 'active' check (status in ('draft','active','archived')),
  created_by  uuid references public.profiles(id),
  search_vector tsvector generated always as
    (to_tsvector('english', coalesce(title,'') || ' ' || (content ->> 'text_summary'))) stored,
  created_at  timestamptz not null default now()
);
create index lessons_search on public.lessons using gin(search_vector);

create table public.lesson_progress (
  lesson_id   uuid references public.lessons(id) on delete cascade,
  student_id  uuid references public.profiles(id) on delete cascade,
  completed_steps int not null default 0,
  total_steps int not null default 0,
  hints_used  int not null default 0,
  score       int,
  completed_at timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (lesson_id, student_id)
);

-- ── Homework ────────────────────────────────────────────────────────────────
create table public.homework_templates (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id),
  title      text not null,
  content    jsonb not null default '{}',         -- positions/PGNs/instructions
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.homework_assignments (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id),
  template_id uuid references public.homework_templates(id) on delete set null,
  title      text not null,
  content    jsonb not null default '{}',
  batch_id   uuid references public.batches(id),
  due_at     timestamptz,
  status     text not null default 'draft'
             check (status in ('draft','active','completed','overdue','archived')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.homework_submissions (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.homework_assignments(id) on delete cascade,
  student_id    uuid not null references public.profiles(id),
  answers       jsonb not null default '{}',
  status        text not null default 'submitted'
                check (status in ('submitted','reviewed','returned')),
  review_note   text,
  score         int,
  submitted_at  timestamptz not null default now(),
  reviewed_at   timestamptz,
  unique (assignment_id, student_id)
);

-- ── Tournaments & simuls ────────────────────────────────────────────────────
create table public.tournaments (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id),
  title      text not null,
  kind       text not null default 'swiss' check (kind in ('swiss','round-robin','knockout','arena')),
  status     text not null default 'upcoming' check (status in ('upcoming','running','completed','cancelled')),
  starts_at  timestamptz,
  time_control text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.tournament_players (
  tournament_id uuid references public.tournaments(id) on delete cascade,
  student_id    uuid references public.profiles(id) on delete cascade,
  score         numeric not null default 0,
  primary key (tournament_id, student_id)
);
create table public.simuls (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id),
  title      text not null,
  host_id    uuid not null references public.profiles(id),
  status     text not null default 'upcoming' check (status in ('upcoming','running','completed','cancelled')),
  starts_at  timestamptz,
  created_at timestamptz not null default now()
);
create table public.simul_players (
  simul_id   uuid references public.simuls(id) on delete cascade,
  student_id uuid references public.profiles(id) on delete cascade,
  result     text,
  primary key (simul_id, student_id)
);

-- ── Attendance ──────────────────────────────────────────────────────────────
create table public.attendance_records (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id),
  student_id uuid not null references public.profiles(id),
  batch_id   uuid references public.batches(id),
  on_date    date not null,
  status     text not null check (status in ('present','absent','late','excused')),
  marked_by  uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (student_id, on_date)
);
-- Future-date guard (observed: "Cannot view attendance for future dates")
create or replace function public.no_future_attendance()
returns trigger language plpgsql as $$
begin
  if new.on_date > current_date then
    raise exception 'Cannot mark attendance for future dates';
  end if;
  return new;
end $$;
create trigger attendance_no_future before insert or update on public.attendance_records
  for each row execute function public.no_future_attendance();

-- ── Self-booking ────────────────────────────────────────────────────────────
create table public.availability_rules (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id),
  coach_id   uuid not null references public.profiles(id),
  weekday    int not null check (weekday between 0 and 6),
  start_time time not null,
  end_time   time not null,
  slot_minutes int not null default 60,
  created_at timestamptz not null default now()
);
create table public.bookings (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id),
  coach_id   uuid not null references public.profiles(id),
  student_id uuid not null references public.profiles(id),
  starts_at  timestamptz not null,
  duration_minutes int not null default 60,
  status     text not null default 'booked' check (status in ('booked','cancelled','completed')),
  created_at timestamptz not null default now()
);

-- ── Points / leaderboard ────────────────────────────────────────────────────
create table public.points_ledger (
  id         bigint generated always as identity primary key,
  academy_id uuid not null references public.academies(id),
  student_id uuid not null references public.profiles(id),
  points     int not null default 0,
  coins      int not null default 0,
  reason     text not null,
  created_at timestamptz not null default now()
);
create index points_ledger_student on public.points_ledger(academy_id, student_id, created_at);

-- Keep profiles.points/coins in sync
create or replace function public.apply_points()
returns trigger language plpgsql security definer as $$
begin
  update public.profiles
     set points = points + new.points, coins = coins + new.coins
   where id = new.student_id;
  return new;
end $$;
create trigger points_apply after insert on public.points_ledger
  for each row execute function public.apply_points();

-- ── Games (Play Area) & analyses ────────────────────────────────────────────
create table public.games (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id),
  player_id  uuid not null references public.profiles(id),
  opponent   text not null default 'computer',     -- 'computer' | profile id later (PvP)
  player_color text not null check (player_color in ('white','black')),
  engine_level int,
  time_control text,
  pgn        text not null default '',
  result     text,                                  -- '1-0','0-1','1/2-1/2'
  created_at timestamptz not null default now()
);
create table public.analyses (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id),
  owner_id    uuid not null references public.profiles(id),
  title       text not null default 'Analysis',
  description text,
  pgn         text not null default '',
  annotations jsonb not null default '{}',          -- arrows/highlights per ply
  share_slug  text unique default encode(gen_random_bytes(6), 'hex'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── Announcements & notifications ───────────────────────────────────────────
create table public.announcements (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id),
  title      text not null,
  body       text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.notifications (
  id         bigint generated always as identity primary key,
  academy_id uuid not null references public.academies(id),
  user_id    uuid not null references public.profiles(id),
  title      text not null,
  body       text,
  href       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

-- ── Billing ─────────────────────────────────────────────────────────────────
create table public.invoices (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id),
  student_id uuid not null references public.profiles(id),
  amount_inr numeric(10,2) not null,
  description text not null,
  status     text not null default 'due' check (status in ('due','paid','void')),
  due_at     timestamptz,
  paid_at    timestamptz,
  created_at timestamptz not null default now()
);

-- ── Calendar (aggregating view - Class/Homework/Tournament/Simul) ───────────
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
         duration_minutes, status from public.bookings;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Pattern: tenant isolation on academy_id; staff (ceo/manager/coach) write;
-- students read what concerns them.

do $$
declare t text;
begin
  foreach t in array array[
    'batches','batch_members','classroom_series','classrooms','classroom_enrollments',
    'classroom_messages','pgn_folders','pgns','courses','lessons','lesson_progress',
    'homework_templates','homework_assignments','homework_submissions',
    'tournaments','tournament_players','simuls','simul_players','attendance_records',
    'availability_rules','bookings','points_ledger','games','analyses',
    'announcements','notifications','invoices'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Tenant-wide read for tables every role may list
do $$
declare t text;
begin
  foreach t in array array[
    'batches','classroom_series','classrooms','pgn_folders','pgns','courses',
    'lessons','tournaments','simuls','announcements'
  ] loop
    execute format(
      'create policy %I_read on public.%I for select using (academy_id = public.my_academy())',
      t, t);
    execute format(
      'create policy %I_staff_write on public.%I for all using (academy_id = public.my_academy() and public.is_staff()) with check (academy_id = public.my_academy() and public.is_staff())',
      t, t);
  end loop;
end $$;

-- Membership tables (no academy_id column - scope via parent)
create policy batch_members_read on public.batch_members for select
  using (exists (select 1 from public.batches b where b.id = batch_id and b.academy_id = public.my_academy()));
create policy batch_members_write on public.batch_members for all
  using (public.is_staff() and exists (select 1 from public.batches b where b.id = batch_id and b.academy_id = public.my_academy()));

create policy enroll_read on public.classroom_enrollments for select
  using (student_id = auth.uid()
    or exists (select 1 from public.classrooms c where c.id = classroom_id
               and c.academy_id = public.my_academy() and public.is_staff()));
create policy enroll_write on public.classroom_enrollments for all
  using (public.is_staff() and exists (select 1 from public.classrooms c
         where c.id = classroom_id and c.academy_id = public.my_academy()));

create policy class_msg_read on public.classroom_messages for select
  using (exists (select 1 from public.classrooms c where c.id = classroom_id
                 and c.academy_id = public.my_academy()));
create policy class_msg_insert on public.classroom_messages for insert
  with check (sender_id = auth.uid() and exists
    (select 1 from public.classrooms c where c.id = classroom_id
     and c.academy_id = public.my_academy()));

create policy tplayers_read on public.tournament_players for select
  using (exists (select 1 from public.tournaments t where t.id = tournament_id
                 and t.academy_id = public.my_academy()));
create policy tplayers_write on public.tournament_players for all
  using (public.is_staff() and exists (select 1 from public.tournaments t
         where t.id = tournament_id and t.academy_id = public.my_academy()));
create policy splayers_read on public.simul_players for select
  using (exists (select 1 from public.simuls s where s.id = simul_id
                 and s.academy_id = public.my_academy()));
create policy splayers_write on public.simul_players for all
  using (public.is_staff() and exists (select 1 from public.simuls s
         where s.id = simul_id and s.academy_id = public.my_academy()));

-- Homework: staff manage; students read active assignments + own submissions
create policy hw_templates_staff on public.homework_templates for all
  using (academy_id = public.my_academy() and public.is_staff());
create policy hw_assign_staff on public.homework_assignments for all
  using (academy_id = public.my_academy() and public.is_staff());
create policy hw_assign_student_read on public.homework_assignments for select
  using (academy_id = public.my_academy() and status in ('active','completed','overdue'));
create policy hw_sub_own on public.homework_submissions for select
  using (student_id = auth.uid()
    or exists (select 1 from public.homework_assignments a where a.id = assignment_id
               and a.academy_id = public.my_academy() and public.is_staff()));
create policy hw_sub_insert on public.homework_submissions for insert
  with check (student_id = auth.uid());
create policy hw_sub_review on public.homework_submissions for update
  using (exists (select 1 from public.homework_assignments a where a.id = assignment_id
                 and a.academy_id = public.my_academy() and public.is_staff())
         or student_id = auth.uid());

-- Attendance: staff write; students read own
create policy attendance_staff on public.attendance_records for all
  using (academy_id = public.my_academy() and public.is_staff());
create policy attendance_own on public.attendance_records for select
  using (student_id = auth.uid());

-- Self-booking: RBAC-gated - only coaches manage their own rules (mirrors the
-- observed permission denial for non-owners)
create policy avail_own on public.availability_rules for all
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid() and academy_id = public.my_academy());
create policy avail_read on public.availability_rules for select
  using (academy_id = public.my_academy());
create policy bookings_involved on public.bookings for select
  using (academy_id = public.my_academy()
         and (student_id = auth.uid() or coach_id = auth.uid() or public.my_role() in ('ceo','manager')));
create policy bookings_student_insert on public.bookings for insert
  with check (student_id = auth.uid() and academy_id = public.my_academy());
create policy bookings_update on public.bookings for update
  using (student_id = auth.uid() or coach_id = auth.uid());

-- Points: everyone reads academy ledger (leaderboard); staff award
create policy points_read on public.points_ledger for select
  using (academy_id = public.my_academy());
create policy points_award on public.points_ledger for insert
  with check (academy_id = public.my_academy() and public.is_staff());

-- Lesson progress: student owns; staff read
create policy progress_own on public.lesson_progress for all
  using (student_id = auth.uid()) with check (student_id = auth.uid());
create policy progress_staff_read on public.lesson_progress for select
  using (exists (select 1 from public.lessons l where l.id = lesson_id
                 and l.academy_id = public.my_academy() and public.is_staff()));

-- Games/analyses: owner + academy staff
create policy games_own on public.games for all
  using (player_id = auth.uid()) with check (player_id = auth.uid() and academy_id = public.my_academy());
create policy games_staff_read on public.games for select
  using (academy_id = public.my_academy() and public.is_staff());
create policy analyses_own on public.analyses for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid() and academy_id = public.my_academy());
create policy analyses_academy_read on public.analyses for select
  using (academy_id = public.my_academy());

-- Notifications: own only
create policy notif_own on public.notifications for select using (user_id = auth.uid());
create policy notif_own_update on public.notifications for update using (user_id = auth.uid());
create policy notif_staff_insert on public.notifications for insert
  with check (academy_id = public.my_academy() and public.is_staff());

-- Invoices: student sees own; ceo/manager manage
create policy invoices_own on public.invoices for select
  using (student_id = auth.uid()
         or (academy_id = public.my_academy() and public.my_role() in ('ceo','manager')));
create policy invoices_admin on public.invoices for all
  using (academy_id = public.my_academy() and public.my_role() in ('ceo','manager'));

-- Audit the sensitive domains
create trigger audit_classrooms after insert or update or delete on public.classrooms
  for each row execute function public.audit();
create trigger audit_invoices after insert or update or delete on public.invoices
  for each row execute function public.audit();
create trigger audit_homework after insert or update or delete on public.homework_assignments
  for each row execute function public.audit();
create trigger audit_points after insert on public.points_ledger
  for each row execute function public.audit();
