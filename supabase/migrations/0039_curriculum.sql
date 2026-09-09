-- 0039: Activity-Based Curriculum (ABC) scaffold.
--
-- Structured multi-level teaching content: levels → lessons → activities, one
-- activity row per interactive step (explanation / capture / puzzle / mcq /
-- play). Students get a per-activity progress row. This is the DATA MODEL +
-- selector UI only; the five activity players are TODO (see
-- src/app/[role]/dashboard/[academyId]/curriculum/client.tsx).
--
-- Distinct from `courses`/`lessons` (0002): those are Coursera-style video/
-- reading courses and AI-extracted artifacts. ABC is the graded ladder a coach
-- walks a beginner up. Kept separate rather than overloading `lessons.content`
-- because the activity list needs its own ordering, progress, and RLS.
--
-- academy_id is denormalised onto every child table (same convention as
-- `lessons`, `puzzle_attempts`) so RLS policies stay join-free. The app sets it
-- on insert; the `with check` clause enforces it matches the caller's academy.

create table public.curriculum_levels (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id) on delete cascade,
  title       text not null,
  ordinal     int  not null default 0,
  description text,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
create index curriculum_levels_academy on public.curriculum_levels (academy_id, ordinal);

create table public.curriculum_lessons (
  id          uuid primary key default gen_random_uuid(),
  level_id    uuid not null references public.curriculum_levels(id) on delete cascade,
  academy_id  uuid not null references public.academies(id) on delete cascade,
  title       text not null,
  ordinal     int  not null default 0,
  objective   text,
  created_at  timestamptz not null default now()
);
create index curriculum_lessons_level on public.curriculum_lessons (level_id, ordinal);
create index curriculum_lessons_academy on public.curriculum_lessons (academy_id);

create table public.curriculum_activities (
  id          uuid primary key default gen_random_uuid(),
  lesson_id   uuid not null references public.curriculum_lessons(id) on delete cascade,
  academy_id  uuid not null references public.academies(id) on delete cascade,
  ordinal     int  not null default 0,
  kind        text not null check (kind in ('explanation','capture','puzzle','mcq','play')),
  title       text not null,
  prompt      text,               -- what the student is asked to do
  fen         text,               -- starting position (capture/puzzle/play)
  pgn         text,               -- solution / demo line (puzzle/explanation)
  answer      text,               -- expected move(s) or correct choice id (puzzle/mcq)
  choices     jsonb not null default '[]',   -- [{id, text}] for mcq
  meta        jsonb not null default '{}',   -- kind-specific extras (engine level, target square, ...)
  created_at  timestamptz not null default now()
);
create index curriculum_activities_lesson on public.curriculum_activities (lesson_id, ordinal);
create index curriculum_activities_academy on public.curriculum_activities (academy_id);

-- Per-student progress. `answer` above is readable by students on purpose:
-- ABC activities are SELF-PACED PRACTICE with immediate feedback, not a graded
-- exam. Anything that must be tamper-proof (rated games, scored quizzes) lives
-- elsewhere and is server-scored - see docs/enterprise_system_architecture.md §6.2.
create table public.curriculum_progress (
  student_id   uuid not null references public.profiles(id) on delete cascade,
  activity_id  uuid not null references public.curriculum_activities(id) on delete cascade,
  status       text not null default 'not_started'
               check (status in ('not_started','attempted','completed')),
  score        int,
  attempts     int  not null default 0,
  time_ms      int,
  updated_at   timestamptz not null default now(),
  primary key (student_id, activity_id)
);
create index curriculum_progress_student on public.curriculum_progress (student_id, updated_at desc);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.curriculum_levels     enable row level security;
alter table public.curriculum_lessons    enable row level security;
alter table public.curriculum_activities enable row level security;
alter table public.curriculum_progress   enable row level security;

-- Content: staff of the academy do everything; students of the academy read.
create policy curriculum_levels_staff on public.curriculum_levels for all
  using (academy_id = public.my_academy() and public.is_staff())
  with check (academy_id = public.my_academy() and public.is_staff());
create policy curriculum_levels_read on public.curriculum_levels for select
  using (academy_id = public.my_academy());

create policy curriculum_lessons_staff on public.curriculum_lessons for all
  using (academy_id = public.my_academy() and public.is_staff())
  with check (academy_id = public.my_academy() and public.is_staff());
create policy curriculum_lessons_read on public.curriculum_lessons for select
  using (academy_id = public.my_academy());

create policy curriculum_activities_staff on public.curriculum_activities for all
  using (academy_id = public.my_academy() and public.is_staff())
  with check (academy_id = public.my_academy() and public.is_staff());
create policy curriculum_activities_read on public.curriculum_activities for select
  using (academy_id = public.my_academy());

-- Progress: a student owns their rows; staff of the academy read them.
create policy curriculum_progress_own on public.curriculum_progress for all
  using (student_id = auth.uid())
  with check (student_id = auth.uid());
create policy curriculum_progress_staff_read on public.curriculum_progress for select
  using (exists (select 1 from public.curriculum_activities a
                 where a.id = activity_id
                   and a.academy_id = public.my_academy()
                   and public.is_staff()));

-- ponytail: no seed data. An empty ladder is a valid starting state, and seed
-- rows in a migration re-run on every environment. Coaches build levels from
-- the Curriculum page. Add a demo pack to seed_factory.sql if onboarding needs one.
