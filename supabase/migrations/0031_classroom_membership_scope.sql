-- 0031: classroom_messages read/insert only checked that the classroom's
-- academy matched the caller's academy - the same "tenant-wide, not
-- membership-wide" gap fixed for LiveKit tokens in the app layer
-- (src/app/api/livekit/token/route.ts). Any academy member could read or
-- post into the chat of a class they aren't enrolled in or assigned to.
-- Staff keep full academy-wide access (they already have it via LiveKit and
-- the schedule views); students must be enrolled or a member of the class's
-- batch, matching the same membership check the token route now applies.
-- Self-contained (checks the classroom's academy itself) so it stays correct
-- if reused elsewhere - is_staff() alone only proves the caller's own role,
-- not that this classroom is in their academy.
create or replace function public.is_classroom_member(p_classroom uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.classrooms c
     where c.id = p_classroom
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
$$;
revoke execute on function public.is_classroom_member(uuid) from public, anon;
grant execute on function public.is_classroom_member(uuid) to authenticated;

drop policy if exists class_msg_read on public.classroom_messages;
create policy class_msg_read on public.classroom_messages for select
  using (public.is_classroom_member(classroom_id));

drop policy if exists class_msg_insert on public.classroom_messages;
create policy class_msg_insert on public.classroom_messages for insert
  with check (sender_id = auth.uid() and public.is_classroom_member(classroom_id));

notify pgrst, 'reload schema';
