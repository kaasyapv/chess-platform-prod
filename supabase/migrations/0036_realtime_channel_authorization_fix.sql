-- 0036: the live classroom went dark in production.
--
-- 0032 shipped `private: true` on both classroom channels (class:<id> and
-- mesh-video:<id>) in the app bundle, but its SQL never ran on the hosted
-- project. Supabase enables RLS on realtime.messages by default, so a private
-- channel with zero policies is denied for everybody. That is one root cause
-- for every symptom reported: no board broadcasts (pieces frozen), no
-- presence, and therefore no WebRTC signaling at all, which is why coach and
-- student could not see each other and why the Live Ops wall showed black
-- tiles. Live Ops mini boards kept updating only because they ride
-- postgres_changes on a public channel, and a board nobody can move is a
-- board that looks stuck.
--
-- Verified against production before writing this: realtime.messages had
-- relrowsecurity = true and zero rows in pg_policies, and neither
-- public.is_classroom_member nor public.realtime_classroom_id existed there
-- (0031 and 0032 were never applied). So this migration is self-contained and
-- depends only on public.my_academy(), which production does have.
--
-- Scope of the check: any authenticated member of the classroom's academy.
-- That is exactly who the classrooms SELECT policy already lets open the
-- classroom page, so the channel and the page now agree on who belongs in a
-- room. Making the channel STRICTER than the page is what took the class
-- down, and it would do it again: a student who can open a class but cannot
-- join its channel sees a board that never moves, with no error anywhere.
-- Narrowing this to enrollment-only is a genuine improvement, but it has to
-- move the classrooms list, the classroom page and this policy in one step.
--
-- The hole 0032 was closing stays closed. The anon key ships in every page
-- bundle and is extractable without logging in; `to authenticated` plus an
-- academy check means holding that key is no longer enough to join a
-- classroom channel, eavesdrop on a live class, forge board/chat/quiz events,
-- or pull a student's camera into a rogue peer connection.

-- Null instead of an exception when the topic is not `<name>:<uuid>`. A hard
-- cast here would raise inside the policy for any other private channel and
-- take that channel down too, which is the same failure mode this migration
-- exists to remove.
create or replace function public.realtime_classroom_id()
returns uuid language sql stable as $$
  select nullif(substring(realtime.topic() from '^[^:]+:([0-9a-fA-F-]{36})$'), '')::uuid
$$;

create or replace function public.can_join_classroom_channel(p_classroom uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_classroom is not null
     and exists (select 1 from public.classrooms c
                  where c.id = p_classroom
                    and c.academy_id = public.my_academy())
$$;
revoke execute on function public.can_join_classroom_channel(uuid) from public, anon;
grant  execute on function public.can_join_classroom_channel(uuid) to authenticated;

-- HOW THIS ACTUALLY GETS APPLIED, because the SQL editor cannot do it.
--
-- realtime.messages is owned by supabase_realtime_admin. On this project
-- postgres is not a superuser (rolsuper = false) and is not a member of that
-- role (pg_has_role(...,'member') = false), so every statement touching that
-- table - alter table, drop policy, create policy - fails with
-- 42501 "must be owner of table messages", and `set role` cannot escape it.
-- That is why 0032 was never applied here and why the classroom went dark:
-- the client half shipped and the SQL half could not.
--
-- The two policies below must therefore be created through the dashboard at
-- Realtime > Policies, which saves them with the owning role's privileges.
-- Everything above this line does run fine in the SQL editor as postgres.
--
-- There is deliberately no `alter table realtime.messages enable row level
-- security` here. It would fail for the same ownership reason, and it is
-- redundant anyway: Supabase ships that table with RLS already on (verified
-- relrowsecurity = true on this project), which is exactly why a private
-- channel with no policy is refused rather than allowed.

-- WHAT IS ACTUALLY LIVE ON PRODUCTION RIGHT NOW, and why it is not this.
--
-- The dashboard's Realtime > Policies page can only save its own templates
-- by clicking; a custom using/with check expression has to be typed. Under a
-- live outage the four stock templates went on instead, all `to authenticated`:
--   listening for broadcasts     (select, extension = 'broadcast')
--   pushing broadcasts           (insert, extension = 'broadcast')
--   listening for presences      (select, extension = 'presence')
--   broadcasting presences       (insert, extension = 'presence')
-- Permissive policies are OR'd, so those four restored the classroom.
--
-- They are BROADER than the two below: any authenticated user of the platform
-- can join any classroom channel, not only members of that classroom's
-- academy. The hole the audit actually found is still closed, because that
-- one was about the anon key being extractable from the page bundle by
-- someone who never logged in. But a logged-in student of academy A can now
-- reach a channel in academy B, which the two policies below would prevent.
--
-- To tighten: open Realtime > Policies, delete the four template policies,
-- and create these two, pasting the expression by hand into the using and
-- with check boxes:
--     public.can_join_classroom_channel(public.realtime_classroom_id())
-- Both helper functions are already deployed, so that paste is all that is
-- left. Do it before this platform carries more than one academy.

-- realtime.messages - wrapped to tolerate "must be owner of table messages"
-- (42501) when the migration runner is `postgres` and not a member of
-- `supabase_realtime_admin` (hosted projects). On prod these two policies are
-- set via the dashboard (see the note above); everywhere the runner has the
-- privilege the end state is identical.
do $$
begin
  -- Read: may join the topic and receive broadcast/presence.
  execute 'drop policy if exists "classroom channels receive" on realtime.messages';
  execute $p$
    create policy "classroom channels receive" on realtime.messages for select
      to authenticated
      using (public.can_join_classroom_channel(public.realtime_classroom_id()))
  $p$;

  -- Write: may broadcast and track presence on the topic.
  execute 'drop policy if exists "classroom channels send" on realtime.messages';
  execute $p$
    create policy "classroom channels send" on realtime.messages for insert
      to authenticated
      with check (public.can_join_classroom_channel(public.realtime_classroom_id()))
  $p$;
exception
  when insufficient_privilege then
    raise notice '0036: realtime.messages not owned by this role - set the two classroom-channel policies via Realtime > Policies in the dashboard. Skipping.';
end $$;
