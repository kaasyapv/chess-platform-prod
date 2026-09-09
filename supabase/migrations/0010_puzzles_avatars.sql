-- 0010: Puzzles engine (10k+ Lichess CC0 puzzles) + kid-friendly avatars.

-- ── Puzzles: global content, seeded from the Lichess open puzzle DB (CC0) ────
-- Loaded by scripts/seed-puzzles.mjs from src/data/puzzles.json.
create table public.puzzles (
  id         text primary key,               -- Lichess puzzle id
  fen        text not null,
  moves      text not null,                  -- space-separated UCI solution line
  rating     int  not null default 0,
  popularity int  not null default 0,
  plays      int  not null default 0,
  themes     text not null default ''
);
create index puzzles_rating on public.puzzles (rating);
create index puzzles_themes on public.puzzles using gin (to_tsvector('simple', themes));
alter table public.puzzles enable row level security;
-- Global catalog: any signed-in user may read; nobody writes via the API
-- (seed uses the service role, which bypasses RLS).
create policy puzzles_read on public.puzzles for select to authenticated using (true);

-- Optional per-student progress (kept light; drives streaks/marketing counts)
create table public.puzzle_attempts (
  id         uuid primary key default gen_random_uuid(),
  academy_id uuid not null references public.academies(id),
  student_id uuid not null references public.profiles(id),
  puzzle_id  text not null references public.puzzles(id),
  solved     boolean not null,
  created_at timestamptz not null default now()
);
create index puzzle_attempts_student on public.puzzle_attempts (student_id, created_at desc);
alter table public.puzzle_attempts enable row level security;
create policy puzzle_attempts_own on public.puzzle_attempts for all
  using (student_id = auth.uid()
         or (academy_id = public.my_academy() and public.is_staff()))
  with check (student_id = auth.uid() and academy_id = public.my_academy());

-- ── Avatars: kid-friendly identity (ChessKid-style) ─────────────────────────
-- Stores an avatar key resolved to an in-repo SVG (src/lib/avatars.tsx).
alter table public.profiles add column avatar text;
