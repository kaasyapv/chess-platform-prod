-- 0016: TeleCRM RBAC - CEO has master access by default; a manager sees
-- nothing on /telecrm until the CEO grants specific modules (Academy →
-- Coaches → Permissions, same UI as the existing can_manage_leads etc. flags).
-- Also carries Path A's integration secrets (API key + webhook URL) on
-- academy_secrets, next to the webhook_token that table already holds.

alter table public.manager_permissions add column can_use_whatsapp   boolean not null default false;
alter table public.manager_permissions add column can_view_call_logs boolean not null default false;

-- Re-declare my_perm() with the two new flags - the flag list in 0006 is a
-- closed case statement, not a table lookup, so it has to be redefined
-- whole rather than patched. can_manage_leads already covers Drip Campaigns
-- and Distribution (0014_telecrm.sql reuses it), no new flag needed there.
create or replace function public.my_perm(flag text)
returns boolean language plpgsql stable security definer as $$
declare m public.manager_permissions;
begin
  if public.my_role() = 'ceo' then return true; end if;
  if public.my_role() <> 'manager' then return false; end if;
  select * into m from public.manager_permissions where profile_id = auth.uid();
  if m.profile_id is null then return false; end if;
  return case flag
    when 'can_manage_leads'     then m.can_manage_leads
    when 'can_view_billing'     then m.can_view_billing
    when 'can_schedule_classes' then m.can_schedule_classes
    when 'can_manage_students'  then m.can_manage_students
    when 'can_view_reports'     then m.can_view_reports
    when 'can_run_demos'        then m.can_run_demos
    when 'can_use_whatsapp'     then m.can_use_whatsapp
    when 'can_view_call_logs'   then m.can_view_call_logs
    else false end;
end $$;

alter table public.academy_secrets add column telecrm_api_key text;
alter table public.academy_secrets add column telecrm_webhook_url text;

-- Widen whatsapp_messages/call_logs RLS: a manager granted the specific
-- module flag gets full academy-wide access to it (that's the point of
-- granting the module), not just rows tied to their own assigned leads.
drop policy whatsapp_messages_access on public.whatsapp_messages;
create policy whatsapp_messages_access on public.whatsapp_messages for all
  using (academy_id = public.my_academy()
         and (public.my_perm('can_manage_leads') or public.my_perm('can_use_whatsapp')
              or exists (select 1 from public.leads l where l.id = lead_id and l.assigned_to = auth.uid())))
  with check (academy_id = public.my_academy()
         and (public.my_perm('can_manage_leads') or public.my_perm('can_use_whatsapp')
              or exists (select 1 from public.leads l where l.id = lead_id and l.assigned_to = auth.uid())));

drop policy call_logs_access on public.call_logs;
create policy call_logs_access on public.call_logs for all
  using (academy_id = public.my_academy()
         and (public.my_perm('can_manage_leads') or public.my_perm('can_view_call_logs') or agent_id = auth.uid()))
  with check (academy_id = public.my_academy()
         and (public.my_perm('can_manage_leads') or public.my_perm('can_view_call_logs') or agent_id = auth.uid()));
