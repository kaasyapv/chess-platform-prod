-- 0034: bookings had no server-side collision check - the "is this slot
-- open" logic was pure client-side filtering, and a direct insert (bypassing
-- that UI check entirely) could double-book the same coach into two
-- overlapping sessions, or even the exact same slot twice, with no error.
-- An exclusion constraint makes the database itself the source of truth:
-- no two 'booked' rows for the same coach may have overlapping time ranges,
-- regardless of which code path inserts them.
create extension if not exists btree_gist;

/* The span of a booking, as one immutable expression.
 *
 * This exists because the constraint below could not be written inline. An
 * index expression must be IMMUTABLE, and `timestamptz + interval` is only
 * STABLE -- an interval carrying months or days lands on a different instant
 * depending on the session time zone. A minutes-only interval does not: a
 * timestamptz is an absolute instant and adding N minutes to it is the same
 * instant everywhere, so the marking is honest rather than a workaround.
 *
 * Written as a real function rather than an inline cast because the original
 * form, `(duration_minutes || ' minutes')::interval`, was rejected outright --
 * which means this migration aborted and the constraint was never in force
 * anywhere it was run. */
create or replace function public.booking_span(starts_at timestamptz, minutes integer)
returns tstzrange language sql immutable as $$
  select tstzrange(starts_at, starts_at + (minutes * interval '1 minute'), '[)');
$$;

alter table public.bookings
  drop constraint if exists bookings_no_coach_overlap;

alter table public.bookings
  add constraint bookings_no_coach_overlap
  exclude using gist (
    coach_id with =,
    public.booking_span(starts_at, duration_minutes) with &&
  )
  where (status = 'booked');
