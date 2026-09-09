-- 0043: per-student quiz responses.
--
-- 0037 made quiz scoring server-authoritative but persists only the aggregate:
-- a `quizzes` row (fen / answer / points) and, once, a batch of points_ledger
-- rows via score_quiz(). The individual answers - what each student actually
-- played, how fast, and whether it was right - live only as ephemeral
-- `quiz_answer` / `quiz_result` broadcast events and in the coach's browser
-- memory. When the class ends they're gone: no per-student review, no history,
-- no "you answered Nf3 in 4.2s" on the report card.
--
-- This table is that record. It does NOT change scoring - score_quiz() still
-- writes points_ledger from the coach's verdicts. It's an additive audit trail
-- the post-class review and report cards read.
--
--   * The student's own client inserts one row per quiz (id = the quiz's id),
--     carrying { san, ms }. `is_correct` is filled by the same authority as
--     today: the student may write it null; the coach/service updates it from
--     the quiz_result verdict. A student cannot mark their own answer correct.
--   * Students read only their own rows; staff of the academy read all.
--   * Self-contained membership check (mirrors 0037's note): the hand-migrated
--     production project may not have is_classroom_member() (0031) or the 0032
--     realtime helpers, so this checks the classroom's academy + the caller's
--     enrolment / batch inline. my_academy() / is_staff() are 0001.

create table public.classroom_responses (
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  quiz_id      text not null references public.quizzes(id)    on delete cascade,
  user_id      uuid not null references public.profiles(id),
  academy_id   uuid not null references public.academies(id),
  san          text,                                   -- the move the student played (SAN)
  ms           int,                                    -- time from quiz start to submit
  is_correct   boolean,                                -- null until the coach's verdict lands
  tries        int  not null default 1,
  created_at   timestamptz not null default now(),
  primary key (classroom_id, quiz_id, user_id)         -- one answer per student per quiz
);
create index classroom_responses_quiz on public.classroom_responses(quiz_id);

alter table public.classroom_responses enable row level security;

-- Insert: the student writing their own row, in their own academy, for a class
-- they're actually in (enrolled, or in its batch). Staff may also insert (a
-- coach recording an in-person answer). is_correct is NOT constrained here -
-- see the update policy.
create policy classroom_responses_insert on public.classroom_responses for insert
  with check (
    user_id = auth.uid()
    and academy_id = public.my_academy()
    and exists (
      select 1 from public.classrooms c
       where c.id = classroom_id
         and c.academy_id = public.my_academy()
         and (
           public.is_staff()
           or exists (select 1 from public.classroom_enrollments e
                       where e.classroom_id = c.id and e.student_id = auth.uid())
           or (c.batch_id is not null and exists (
                 select 1 from public.batch_members bm
                  where bm.batch_id = c.batch_id and bm.student_id = auth.uid()))
         )
    )
  );

-- Update: staff of the academy only - this is how the verdict (is_correct)
-- gets written. A student cannot update their row (so cannot flip is_correct
-- or rewrite san after the fact).
create policy classroom_responses_update on public.classroom_responses for update
  using (academy_id = public.my_academy() and public.is_staff())
  with check (academy_id = public.my_academy() and public.is_staff());

-- Select: own rows for a student, all academy rows for staff.
create policy classroom_responses_select on public.classroom_responses for select
  using (
    user_id = auth.uid()
    or (academy_id = public.my_academy() and public.is_staff())
  );

-- No delete policy: responses are immutable history from the client.

notify pgrst, 'reload schema';
