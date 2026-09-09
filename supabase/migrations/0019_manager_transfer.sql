-- 0019: manager "Transfer Account" (client requirement #5).
--
-- remove_academy_member already hands off coach_id on students/batches/
-- classrooms, but a departing MANAGER's leads and permission title/flags
-- were left behind - leads.assigned_to kept pointing at the deleted/
-- deactivated account, and manager_permissions (title, capability flags)
-- was just lost. Extending the one existing transition function rather
-- than writing a parallel "transfer" RPC that would duplicate its delete/
-- deactivate/handoff logic. lead_events.actor_id is left alone on purpose
-- - it's a historical audit trail of who actually did what, not a live
-- assignment, so rewriting it would falsify the log.

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

  -- Manager-specific handoff: CRM ownership + permission title/flags.
  if tgt.role = 'manager' and replacement is not null then
    update public.leads set assigned_to = replacement, updated_at = now()
     where assigned_to = target and academy_id = public.my_academy();
    update public.manager_permissions set
      title = coalesce((select title from public.manager_permissions where profile_id = target), title),
      can_manage_leads     = (select can_manage_leads     from public.manager_permissions where profile_id = target),
      can_view_billing     = (select can_view_billing     from public.manager_permissions where profile_id = target),
      can_schedule_classes = (select can_schedule_classes from public.manager_permissions where profile_id = target),
      can_manage_students  = (select can_manage_students  from public.manager_permissions where profile_id = target),
      can_view_reports     = (select can_view_reports     from public.manager_permissions where profile_id = target),
      can_run_demos        = (select can_run_demos        from public.manager_permissions where profile_id = target),
      updated_at = now()
    where profile_id = replacement
      and exists (select 1 from public.manager_permissions where profile_id = target);
  elsif tgt.role = 'manager' and replacement is null then
    -- Plain removal, no successor: leads fall back to unassigned rather than
    -- staying pointed at an account that's about to disappear.
    update public.leads set assigned_to = null, updated_at = now()
     where assigned_to = target and academy_id = public.my_academy();
  end if;

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
