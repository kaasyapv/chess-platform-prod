-- 0017: Trial/demo isolation.
--
-- Client requirement: a trial/demo must get real-time sync without exposing
-- real academy data. Today a demo student is a normal 'student' profile in
-- the real tenant, so it inherits the same academy-wide RLS as every real
-- student - e.g. homeworks/client.tsx pulls up to 100 full PGN texts with
-- only `academy_id = my_academy()` guarding it, and classroom_messages is
-- readable for any classroom in the academy, not just the demo's own room.
--
-- Fix: mark demo profiles/invites, and scope every tenant-wide read policy
-- to exclude them, replacing it with read access to exactly their one demo
-- classroom (+its messages). Same pattern used once via is_demo_user(),
-- not re-derived per table.

alter table public.invites   add column demo_classroom_id uuid references public.classrooms(id) on delete set null;
alter table public.profiles  add column is_demo boolean not null default false;
alter table public.profiles  add column demo_classroom_id uuid references public.classrooms(id) on delete set null;

create or replace function public.is_demo_user()
returns boolean language sql stable security definer as $$
  select coalesce((select is_demo from public.profiles where id = auth.uid()), false);
$$;
revoke execute on function public.is_demo_user() from public, anon;
grant execute on function public.is_demo_user() to authenticated;

-- Propagate demo flag from invite to profile on claim.
create or replace function public.claim_invite_code(p_code text, p_display_name text default null)
returns public.profiles language plpgsql security definer as $$
declare inv public.invites; prof public.profiles;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'profile already exists';
  end if;
  select * into inv from public.invites
   where code = trim(p_code) and claimed_by is null
   for update;
  if inv.id is null then
    raise exception 'Invalid or already-claimed invite code';
  end if;
  insert into public.profiles (id, academy_id, role, display_name, username, is_demo, demo_classroom_id)
    values (auth.uid(), inv.academy_id, inv.role,
            coalesce(nullif(trim(p_display_name), ''), inv.display_name), inv.username,
            inv.demo_classroom_id is not null, inv.demo_classroom_id)
    returning * into prof;
  update public.invites set claimed_by = auth.uid() where id = inv.id;
  return prof;
end $$;

-- Lock demo profiles out of the blanket tenant-wide read grant on every
-- content table it previously covered (library, courses, other classrooms…).
do $$
declare t text;
begin
  foreach t in array array[
    'batches','classroom_series','classrooms','pgn_folders','pgns','courses',
    'lessons','tournaments','simuls','announcements'
  ] loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format(
      'create policy %I_read on public.%I for select using (academy_id = public.my_academy() and not public.is_demo_user())',
      t, t);
  end loop;
end $$;

-- Demo profiles get read access to exactly their own demo classroom, nothing else.
create policy classrooms_demo_read on public.classrooms for select
  using (public.is_demo_user() and id = (select demo_classroom_id from public.profiles where id = auth.uid()));

-- classroom_messages was scoped to "any classroom in my academy" for every
-- role (not just staff) - narrow it for demo users to their own classroom.
drop policy if exists class_msg_read on public.classroom_messages;
create policy class_msg_read on public.classroom_messages for select
  using (exists (select 1 from public.classrooms c where c.id = classroom_id
                 and c.academy_id = public.my_academy())
         and (not public.is_demo_user()
              or classroom_id = (select demo_classroom_id from public.profiles where id = auth.uid())));

drop policy if exists class_msg_insert on public.classroom_messages;
create policy class_msg_insert on public.classroom_messages for insert
  with check (sender_id = auth.uid() and exists
    (select 1 from public.classrooms c where c.id = classroom_id
     and c.academy_id = public.my_academy())
    and (not public.is_demo_user()
         or classroom_id = (select demo_classroom_id from public.profiles where id = auth.uid())));
