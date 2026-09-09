-- 0037: server-authoritative in-class quiz scoring.
--
-- The audit (enterprise_system_architecture.md §6.2, risk R2) found the live
-- classroom quiz trusted the student's browser twice:
--
--   1. QuizEvent.answer - the solution SAN - was in the `quiz` broadcast
--      payload, readable by any student in devtools.
--   2. QuizAnswer.correct was computed on the student's machine and sent over
--      the wire; the coach's browser then wrote points_ledger straight from
--      that self-reported flag, with a client-supplied points amount.
--
-- So a tampered client could read the answer, claim `correct: true, ms: 1`,
-- and mint `ended.points` into its own ledger row. 0029's RLS on points_ledger
-- only blocks cross-academy / non-student targets - it never validated the
-- verdict or the amount.
--
-- Fix, matching the "students send {san, ms} intents; the authoritative write
-- goes through an RPC" design in the architecture doc:
--
--   * The quiz (including its answer, points, negative) is persisted to a
--     `quizzes` row when the coach launches it. Only staff of the academy can
--     read that row - the answer never goes on the wire again.
--   * Students broadcast only { san, ms }. The coach's client scores each
--     answer with chess.js against its own private copy of the solution
--     (unchanged trust: the coach is the teacher and could always award
--     arbitrary points - a student now cannot).
--   * Banking points goes through score_quiz(), which: checks the caller is
--     staff of the quiz's academy, refuses to score a quiz twice, only pays
--     real active students of that academy, and uses the STORED points /
--     negative values, not anything the client sends.

create table public.quizzes (
  id           text primary key,                       -- client id: "<classroom>-<epoch>"
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  academy_id   uuid not null references public.academies(id),
  fen          text not null,
  answer       text not null default '',               -- '' = manual review, no auto-score
  points       int  not null default 10,
  negative     int  not null default 0,
  seconds      int  not null default 60,
  created_by   uuid not null references public.profiles(id),
  created_at   timestamptz not null default now(),
  scored_at    timestamptz                             -- non-null once score_quiz has run (idempotency)
);
create index quizzes_classroom on public.quizzes(classroom_id, created_at desc);

alter table public.quizzes enable row level security;

-- Insert: a staff member (coach launching it, or a manager/ceo standing in) of
-- the classroom's own academy. Self-contained - checks the classroom's academy
-- directly rather than leaning on is_classroom_member() (0031), which the
-- hand-migrated production project may not have. my_academy()/is_staff() are
-- 0001 and always present.
create policy quizzes_insert on public.quizzes for insert
  with check (
    created_by = auth.uid()
    and public.is_staff()
    and academy_id = public.my_academy()
    and exists (
      select 1 from public.classrooms c
       where c.id = classroom_id and c.academy_id = public.my_academy()
    )
  );

-- Select: staff only. Students never read this table - they receive fen /
-- points / seconds over the realtime channel and the answer stays here.
create policy quizzes_select on public.quizzes for select
  using (academy_id = public.my_academy() and public.is_staff());

-- No update/delete policy: the row is immutable from the client. score_quiz
-- (security definer) is the only thing that writes scored_at.

-- ── score_quiz ────────────────────────────────────────────────────────────
-- p_results: jsonb array of { "student_id": uuid, "correct": bool, "ms": int }
-- Returns the number of ledger rows written.
create or replace function public.score_quiz(p_quiz_id text, p_results jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  q       public.quizzes;
  r       jsonb;
  n       int := 0;
  sid     uuid;
  ok      boolean;
begin
  select * into q from public.quizzes where id = p_quiz_id;
  if q.id is null then raise exception 'quiz not found'; end if;

  -- Caller must be staff of this quiz's academy. (auth.uid() is null only for
  -- the service role, which we don't use here - a coach session calls this.)
  if auth.uid() is null
     or not public.is_staff()
     or q.academy_id <> public.my_academy() then
    raise exception 'not allowed';
  end if;

  if q.scored_at is not null then raise exception 'quiz already scored'; end if;

  for r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    sid := (r->>'student_id')::uuid;
    ok  := coalesce((r->>'correct')::boolean, false);

    -- Only pay a real, active student of this academy. Silently skip anything
    -- else (a stale roster entry, a spoofed id).
    if not exists (
      select 1 from public.profiles p
       where p.id = sid and p.academy_id = q.academy_id
         and p.role = 'student' and p.status = 'active'
    ) then
      continue;
    end if;

    insert into public.points_ledger (academy_id, student_id, points, reason)
    values (q.academy_id, sid,
            case when ok then q.points else -q.negative end,
            'quiz');
    n := n + 1;
  end loop;

  update public.quizzes set scored_at = now() where id = q.id;
  return n;
end $$;

revoke execute on function public.score_quiz(text, jsonb) from public, anon;
grant  execute on function public.score_quiz(text, jsonb) to authenticated;

notify pgrst, 'reload schema';
