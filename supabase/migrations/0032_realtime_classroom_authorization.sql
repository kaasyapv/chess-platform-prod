-- 0032: live classroom broadcast (chat/board/quiz/whiteboard) and mesh-video
-- WebRTC signaling ran on public Supabase Realtime channels with no
-- authorization at all (flagged by the channel code's own comment: "move to
-- Realtime authorization policies before opening to real students"). The
-- public anon key ships in every page's JS bundle and is extractable without
-- logging in, so anyone who knew a classroom id could join `class:<uuid>` or
-- `mesh-video:<uuid>` to eavesdrop on a live class, inject forged chat/board/
-- quiz/whiteboard events, or (on mesh-video) pull a real student's audio/
-- video into a rogue WebRTC connection via a forged signaling offer.
--
-- Supabase Realtime Authorization gates channel access with RLS on
-- realtime.messages, keyed by realtime.topic() - the channel name the client
-- is subscribing to. This restricts both channels to the same membership
-- check classroom_messages uses (0031_classroom_membership_scope.sql).
--
-- This ONLY takes effect for channels created with `config: { private: true
-- }` - a non-private channel is never authorized against these policies at
-- all, so the client changes in use-classroom-channel.ts and
-- mesh-video-room.tsx (setting private:true) are required, not optional.
--
-- OWNERSHIP NOTE (2026-09): `realtime.messages` is owned by
-- `supabase_realtime_admin`. On a hosted project `postgres` is not a member of
-- that role, so `alter table` / `create policy` on it raise 42501 "must be
-- owner of table messages" - which is why this migration originally aborted on
-- `supabase start` / `db push` / CI and had to be hand-applied via the
-- dashboard (see 0036). The realtime.messages block below is now wrapped so a
-- lack of ownership is a NOTICE, not a fatal error: RLS on that table is
-- Supabase-default-on, and 0036 (re)creates these two policies through the
-- dashboard path on prod. Everywhere the migration runner *does* have the
-- privilege (fully local stacks, self-hosted) the end state is unchanged.

-- public schema - postgres owns this, runs normally.
create or replace function public.realtime_classroom_id()
returns uuid language sql stable as $$
  select nullif(split_part(realtime.topic(), ':', 2), '')::uuid
$$;

-- realtime.messages - tolerate "must be owner" (42501 / insufficient_privilege).
do $$
begin
  execute 'alter table realtime.messages enable row level security';

  execute 'drop policy if exists "classroom channels receive" on realtime.messages';
  execute $p$
    create policy "classroom channels receive" on realtime.messages for select
      to authenticated
      using (public.is_classroom_member(public.realtime_classroom_id()))
  $p$;

  execute 'drop policy if exists "classroom channels send" on realtime.messages';
  execute $p$
    create policy "classroom channels send" on realtime.messages for insert
      to authenticated
      with check (public.is_classroom_member(public.realtime_classroom_id()))
  $p$;
exception
  when insufficient_privilege then
    raise notice '0032: realtime.messages not owned by this role - RLS/policies must be set via the dashboard (see 0036). Skipping.';
end $$;
