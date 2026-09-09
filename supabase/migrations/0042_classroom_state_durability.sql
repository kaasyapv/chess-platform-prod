-- 0042: durable classroom board snapshot (late-joiner + reconnect recovery).
--
-- The live classroom syncs over a Supabase Realtime *broadcast* channel
-- (`class:<id>`), which is fire-and-forget. Recovery for a student who joins
-- late or drops their websocket is the coach's own browser noticing the roster
-- grew and re-broadcasting the full snapshot (classroom-client.tsx, the
-- roster-growth effect). If the coach's tab is backgrounded, asleep or closed,
-- a late joiner sees a frozen starting position with no error.
--
-- This adds a second, DURABLE copy of the same snapshot the coach already
-- broadcasts. The coach's client mirrors it into `classrooms.live_state` on the
-- same debounce and in the same UPDATE as the existing `live_fen` write
-- (0006); any client hydrates from that column on mount and after a reconnect.
-- A live broadcast still always wins - the column is only the floor.
--
-- Purely additive:
--   * two nullable columns, no default, no backfill.
--   * NO new RLS policy. `classrooms` SELECT is already academy-scoped (0031's
--     is_classroom_member / 0036's can_join_classroom_channel gate the realtime
--     channel; the row read here is the same academy-wide SELECT that already
--     lets a member open the classroom page). The coach WRITE rides the
--     existing row-level `classrooms_coach_conduct` policy (0021) - that policy
--     is row-level, not column-level, and the 0041 scheduling trigger only
--     blocks coach_id / batch_id / academy_id, so writing live_state is allowed
--     exactly like live_fen is today.
--   * `classrooms` is already in the `supabase_realtime` publication (0006);
--     nothing here needs realtime, the client reads live_state with a plain
--     SELECT, so no publication change.
--
-- This is plain `alter table ... add column` DDL and applies cleanly from the
-- Supabase SQL editor (PENDING_MIGRATIONS.md: plain DML/DDL still goes
-- through; only `create policy` / `security definer` need a human). After
-- applying, run `npm run db:verify-rls` and add a row to PENDING_MIGRATIONS.md.

alter table public.classrooms
  add column if not exists live_state    jsonb,
  add column if not exists live_state_at timestamptz;

comment on column public.classrooms.live_state is
  'Durable copy of the live classroom broadcast snapshot (subset of SyncState: '
  'fen, startFen, history, lastMove, locked, sides, coords, gamify, quizActive, '
  'free, simulActive, icons, annotations). Written by the assigned coach''s '
  'client alongside live_fen; read by every member on join/reconnect for '
  'late-joiner recovery. Never contains unrevealed moves or quiz solutions.';
comment on column public.classrooms.live_state_at is
  'When live_state was last written. Clients ignore a snapshot older than a '
  'plausible class session (see SNAPSHOT_MAX_AGE_MS in src/lib/classroom-sync.ts).';
