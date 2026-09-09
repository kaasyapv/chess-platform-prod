-- 0035: the daily audit log becomes CEO-only, gains "left the class", and the
-- CEO gains a way to undo a penalty.
--
-- ── Who may read someone else's activity ────────────────────────────────────
-- 0023 opened activity_events to is_admin(), which is CEO *and* manager. The
-- owner's rule is now narrower: a per-second record of when a named person
-- logged in, how long they sat in a live class and when they walked out is the
-- CEO's alone. A manager keeps their own row (they are a subject of the log,
-- not a reader of it), exactly as penalties work since 0025.
drop policy if exists activity_read on public.activity_events;
create policy activity_read on public.activity_events for select
  using (academy_id = public.my_academy()
         and (profile_id = auth.uid() or public.my_role() = 'ceo'));

-- ── "Left the class" ────────────────────────────────────────────────────────
-- class_join recorded the arrival and class_end the coach ending the room, so
-- nothing ever recorded a person *leaving*. Without it "how much time did they
-- spend inside a live class" was unanswerable. class_leave carries the seconds
-- spent in the room, so the daily log can state both the moment and the span.
alter table public.activity_events drop constraint if exists activity_events_kind_check;
alter table public.activity_events add constraint activity_events_kind_check
  check (kind in (
    'login','logout','active','idle','class_start','class_join','class_leave',
    'class_end','whiteboard','pgn_upload','puzzle_solved','homework_submit',
    'report_view','page_view'));

/** Seconds a person spent inside live classrooms in a window. Mirrors
 *  active_seconds() (0023): security-definer so a report can total the time
 *  without the reader needing every underlying row. */
create or replace function public.class_seconds(p_profile uuid, p_from timestamptz, p_to timestamptz)
returns bigint language sql stable security definer as $$
  select coalesce(sum(seconds), 0)::bigint
  from public.activity_events
  where profile_id = p_profile
    and kind = 'class_leave'
    and created_at >= p_from and created_at < p_to
    and exists (select 1 from public.profiles p
                where p.id = p_profile and p.academy_id = public.my_academy());
$$;
revoke execute on function public.class_seconds(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.class_seconds(uuid, timestamptz, timestamptz) to authenticated;

-- ── Deleting a penalty ──────────────────────────────────────────────────────
-- Waiving a penalty (decide_penalty_appeal) is the outcome of an appeal and is
-- meant to stay on the record. A penalty typed against the wrong person, or
-- for the wrong amount, is not an outcome -- it is a mistake, and it should
-- leave no trace. Only the CEO applies penalties, so only the CEO removes one.
-- Guarded, like activity_read above: production applies these through the
-- SQL editor rather than the CLI (there is no supabase_migrations schema on
-- it), so a file that cannot be re-run is a file that fails the second time.
drop policy if exists penalties_ceo_delete on public.coach_penalties;
create policy penalties_ceo_delete on public.coach_penalties for delete
  using (academy_id = public.my_academy() and public.my_role() = 'ceo');
