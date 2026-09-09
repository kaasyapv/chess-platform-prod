-- 0021: coaches teach, they don't administrate.
--
-- Every write policy on class/roster tables used is_staff(), which includes
-- coach - so a coach could create classes, mint student invites and rewrite
-- batch rosters by calling PostgREST directly, no matter what the UI showed.
-- Requirement: those are Admin/Manager/CEO operations.
--
-- The line to hold: a coach must LOSE class administration but KEEP the
-- ability to run the class they're assigned to. Conducting a class writes to
-- the same classrooms row (status live/completed, started_at/ended_at,
-- live_fen, notes, topic, syllabus), so an outright "no writes for coach"
-- policy would break teaching. Instead: coaches may UPDATE only their own
-- assigned class, and a trigger rejects the columns that constitute
-- *scheduling* (when, who teaches, which batch) - RLS is row-level, so the
-- column-level half has to be a trigger.

create or replace function public.is_admin()
returns boolean language sql stable security definer as $$
  select public.my_role() in ('ceo','manager');
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ── Classrooms ──────────────────────────────────────────────────────────────
drop policy if exists classrooms_staff_write on public.classrooms;

create policy classrooms_admin_write on public.classrooms for all
  using (academy_id = public.my_academy() and public.is_admin())
  with check (academy_id = public.my_academy() and public.is_admin());

-- Assigned coach: conduct only. No INSERT policy for coaches anywhere, so
-- creating a class is impossible for them regardless of payload.
create policy classrooms_coach_conduct on public.classrooms for update
  using (academy_id = public.my_academy() and coach_id = auth.uid() and public.my_role() = 'coach')
  with check (academy_id = public.my_academy() and coach_id = auth.uid() and public.my_role() = 'coach');

create or replace function public.guard_coach_class_scheduling()
returns trigger language plpgsql security definer as $$
begin
  if public.my_role() <> 'coach' then return new; end if;
  if new.scheduled_at is distinct from old.scheduled_at
     or new.coach_id is distinct from old.coach_id
     or new.batch_id is distinct from old.batch_id
     or new.duration_minutes is distinct from old.duration_minutes
     or new.academy_id is distinct from old.academy_id then
    raise exception 'coaches cannot reschedule or reassign a class'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_coach_scheduling on public.classrooms;
create trigger guard_coach_scheduling
  before update on public.classrooms
  for each row execute function public.guard_coach_class_scheduling();

-- ── Student intake: invites are how students are added ──────────────────────
drop policy if exists invites_staff on public.invites;
create policy invites_admin on public.invites for all
  using (academy_id = public.my_academy() and public.is_admin())
  with check (academy_id = public.my_academy() and public.is_admin() and created_by = auth.uid());

-- ── Rosters ─────────────────────────────────────────────────────────────────
drop policy if exists batches_staff_write on public.batches;
create policy batches_admin_write on public.batches for all
  using (academy_id = public.my_academy() and public.is_admin())
  with check (academy_id = public.my_academy() and public.is_admin());

drop policy if exists batch_members_write on public.batch_members;
create policy batch_members_admin_write on public.batch_members for all
  using (public.is_admin() and exists (
    select 1 from public.batches b where b.id = batch_id and b.academy_id = public.my_academy()))
  with check (public.is_admin() and exists (
    select 1 from public.batches b where b.id = batch_id and b.academy_id = public.my_academy()));

-- Enrolment changes are roster changes too.
drop policy if exists enroll_write on public.classroom_enrollments;
create policy enroll_write on public.classroom_enrollments for all
  using (public.is_admin() and exists (select 1 from public.classrooms c
         where c.id = classroom_id and c.academy_id = public.my_academy()))
  with check (public.is_admin() and exists (select 1 from public.classrooms c
         where c.id = classroom_id and c.academy_id = public.my_academy()));

-- Teaching surfaces a coach must keep full write access to (unchanged by the
-- above, listed here so the intent is explicit): classroom_messages, pgns,
-- pgn_folders, homework_*, attendance_records, points_ledger, quizzes.
