-- 0029: points_award only checked the ledger row's own academy_id and that
-- the caller is staff - it never verified that student_id (the profile the
-- apply_points trigger actually mutates) is a real student in that same
-- academy. Any coach could insert a row naming ANY profile id - a teammate,
-- the CEO, or a user in a different academy entirely - and mint or drain
-- arbitrary points/coins on it. Require the target to be a student who is
-- actually a member of the caller's own academy.
drop policy if exists points_award on public.points_ledger;
create policy points_award on public.points_ledger for insert
  with check (
    academy_id = public.my_academy() and public.is_staff()
    and exists (
      select 1 from public.profiles p
       where p.id = student_id
         and p.academy_id = public.my_academy()
         and p.role = 'student'
    )
  );

notify pgrst, 'reload schema';
