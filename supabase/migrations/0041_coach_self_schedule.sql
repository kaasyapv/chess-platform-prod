-- 0041: a coach may schedule 1:1 classes for their own assigned students.
--
-- 0021 made all class scheduling admin-only (coaches teach, they don't
-- administrate). Product now wants an assigned coach to book their own student
-- at a custom time. Kept deliberately narrow so the 0021 threat model still
-- holds for everything else:
--   * the coach can only create a class they themselves teach (coach_id = self)
--   * with NO batch  -- batch/group scheduling stays admin-only
--   * and can only enrol a student whose profiles.coach_id points back at them
-- Admin (ceo/manager) keeps full control via the unchanged classrooms_admin_write.

create or replace function public.is_my_student(p_student uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.profiles s
    where s.id = p_student
      and s.coach_id = auth.uid()
      and s.academy_id = public.my_academy()
      and s.role = 'student'
  );
$$;
revoke execute on function public.is_my_student(uuid) from public, anon;
grant execute on function public.is_my_student(uuid) to authenticated;

-- Coach may create their own 1:1 class (no INSERT policy existed for coaches).
create policy classrooms_coach_schedule on public.classrooms for insert
  with check (
    academy_id = public.my_academy()
    and public.my_role() = 'coach'
    and coach_id = auth.uid()
    and batch_id is null
  );

-- Coach may enrol one of their own students into a class they teach.
drop policy if exists enroll_write on public.classroom_enrollments;
create policy enroll_write on public.classroom_enrollments for all
  using (
    exists (select 1 from public.classrooms c
            where c.id = classroom_id and c.academy_id = public.my_academy()
              and (public.is_admin()
                   or (public.my_role() = 'coach' and c.coach_id = auth.uid())))
  )
  with check (
    exists (select 1 from public.classrooms c
            where c.id = classroom_id and c.academy_id = public.my_academy()
              and (public.is_admin()
                   or (public.my_role() = 'coach' and c.coach_id = auth.uid())))
    and (public.is_admin() or public.is_my_student(student_id))
  );

-- 0021's guard blocked a coach from touching scheduled_at on UPDATE, which also
-- stopped them rescheduling their own 1:1 class. Narrow it to reassignment only
-- (who teaches / which batch / which academy); the row-level policies already
-- confine a coach to classes where coach_id = auth.uid().
create or replace function public.guard_coach_class_scheduling()
returns trigger language plpgsql security definer as $$
begin
  if public.my_role() <> 'coach' then return new; end if;
  if new.coach_id is distinct from old.coach_id
     or new.batch_id is distinct from old.batch_id
     or new.academy_id is distinct from old.academy_id then
    raise exception 'coaches cannot reassign a class'
      using errcode = '42501';
  end if;
  return new;
end $$;
