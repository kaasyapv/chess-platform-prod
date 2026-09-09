-- 0008: QA-audit fixes (docs/PRODUCT_AUDIT.md)
--
-- FIX 1 - invite signup was broken end-to-end:
--   a) invites RLS is staff-only, so a brand-new authed user could never read
--      the invite row → every code reported "invalid".
--   b) the claim_invite BEFORE-INSERT trigger set invites.claimed_by = new.id
--      before the profile row existed → invites_claimed_by_fkey violation.
-- Replaced by one atomic security-definer RPC. Invites stay unreadable to
-- non-staff (codes can't be enumerated); the code itself is the credential.

drop trigger if exists claim_invite on public.profiles;

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
  insert into public.profiles (id, academy_id, role, display_name, username)
    values (auth.uid(), inv.academy_id, inv.role,
            coalesce(nullif(trim(p_display_name), ''), inv.display_name), inv.username)
    returning * into prof;
  update public.invites set claimed_by = auth.uid() where id = inv.id;
  return prof;
end $$;
revoke execute on function public.claim_invite_code(text, text) from public, anon;
grant execute on function public.claim_invite_code(text, text) to authenticated;

-- FIX 1b - manager_permissions was readable by every academy member, exposing
-- the org's capability matrix (titles + flags) to students/coaches. Restrict
-- reads to staff; the my_perm() helper is security-definer so gating flows
-- still work for everyone.
drop policy if exists mgr_perms_read on public.manager_permissions;
create policy mgr_perms_read on public.manager_permissions for select
  using (academy_id = public.my_academy() and public.is_staff());

-- FIX 2 - expire_demo_sessions could abort wholesale: deleting the temp
-- profile violates invites_claimed_by_fkey (and any activity FKs the sandbox
-- accumulated). Null the claim first, and isolate each demo in its own
-- exception scope so one stubborn sandbox can't block the rest.
create or replace function public.expire_demo_sessions()
returns integer language plpgsql security definer as $$
declare n integer := 0; d public.demo_sessions; temp_id uuid;
begin
  if auth.uid() is not null and not public.my_perm('can_run_demos') then
    raise exception 'not allowed';
  end if;
  for d in
    select * from public.demo_sessions
     where status = 'scheduled' and expires_at <= now()
       and (auth.uid() is null or academy_id = public.my_academy())
  loop
    begin
      select claimed_by into temp_id from public.invites where id = d.invite_id;
      update public.invites set claimed_by = null where id = d.invite_id;
      if temp_id is not null then
        delete from public.profiles where id = temp_id;
      end if;
      delete from public.invites where id = d.invite_id;
      update public.classrooms set status = 'cancelled'
        where id = d.classroom_id and status in ('scheduled','delayed');
      update public.demo_sessions set status = 'expired' where id = d.id;
      update public.leads set status = 'qualified', updated_at = now()
        where id = d.lead_id and status = 'demo';
      insert into public.lead_events (lead_id, academy_id, kind, body)
        values (d.lead_id, d.academy_id, 'demo', 'Demo expired unconverted - sandbox cleaned up');
      n := n + 1;
    exception when others then
      -- sandbox has FK-protected activity: mark expired, keep the account
      update public.demo_sessions set status = 'expired' where id = d.id;
      insert into public.lead_events (lead_id, academy_id, kind, body)
        values (d.lead_id, d.academy_id, 'demo',
                'Demo expired - temp account retained (has activity): ' || sqlerrm);
    end;
  end loop;
  return n;
end $$;
