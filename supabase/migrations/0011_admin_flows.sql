-- 0011_admin_flows.sql - CEO member-removal flow.
--
-- Profiles have no DELETE policy, so the UI's old direct delete silently
-- removed nothing. Removal also has to hand a leaving coach's students,
-- batches and scheduled classes to someone first - one security-definer RPC
-- owns the whole transition so it cannot be done halfway.

create or replace function public.remove_academy_member(target uuid, replacement uuid default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  tgt  public.profiles;
  repl public.profiles;
begin
  select * into tgt from public.profiles where id = target;
  if tgt.id is null or tgt.academy_id <> public.my_academy() then
    raise exception 'member not found in your academy';
  end if;
  if public.my_role() <> 'ceo' then
    raise exception 'only the CEO can remove members';
  end if;
  if target = auth.uid() then
    raise exception 'you cannot remove yourself';
  end if;
  if tgt.role = 'ceo' then
    raise exception 'transfer ownership before removing a CEO';
  end if;

  if replacement is not null then
    select * into repl from public.profiles
     where id = replacement and academy_id = public.my_academy()
       and role in ('coach','manager') and status = 'active' and id <> target;
    if repl.id is null then
      raise exception 'replacement must be an active coach or manager in your academy';
    end if;
  end if;

  -- Hand off the teaching load before the account goes anywhere.
  update public.profiles set coach_id = replacement
   where coach_id = target and academy_id = public.my_academy();
  update public.batches set coach_id = replacement where coach_id = target;
  if replacement is not null then
    update public.classrooms set coach_id = replacement
     where coach_id = target and status in ('scheduled','delayed');
  else
    update public.classrooms set status = 'cancelled'
     where coach_id = target and status in ('scheduled','delayed');
  end if;
  update public.classrooms set status = 'completed', ended_at = now()
   where coach_id = target and status = 'live';

  -- Free the invite they claimed so the row can go.
  update public.invites set claimed_by = null where claimed_by = target;

  -- Hard delete when their history allows it; otherwise deactivate - records
  -- of taught classes, payments and homework stay intact either way.
  begin
    delete from public.profiles where id = target;
    return 'deleted';
  exception when foreign_key_violation then
    update public.profiles set status = 'inactive', coach_id = null where id = target;
    return 'deactivated';
  end;
end;
$$;

revoke all on function public.remove_academy_member(uuid, uuid) from public;
grant execute on function public.remove_academy_member(uuid, uuid) to authenticated;

-- Batches change hands when coaches do.
-- (No new policy needed: batches already carry a staff-write policy from 0002.)
