-- 0044: recurring-batch schedule (ERP model — reference "Batch" shape).
--
-- The reference platforms let an admin define a batch's weekly cadence once
-- (days + start/end time + how the recurrence ends), and the system
-- materialises the individual `classrooms` rows from it. Today a batch has no
-- schedule at all - every class is hand-created via classroom_series /
-- classrooms.
--
-- All columns nullable & additive: batches that predate this (or aren't sold as
-- a fixed weekly slot) keep working untouched. No RLS change - batches are
-- already admin-only (0021: classrooms_admin_write pattern; batch policies
-- became is_admin()-gated there).
--
-- The materialiser (a pg_cron job or an Inngest function that reads active
-- recurring batches and inserts classrooms ~7 days ahead) is deliberately NOT
-- in this migration - that's a scheduled-worker decision, and
-- enterprise_system_architecture.md §7 is the place that sanctions pg_cron /
-- Inngest. This migration is the data model only.

alter table public.batches add column is_recurring boolean not null default false;
alter table public.batches add column recurrence_frequency text
  check (recurrence_frequency in ('daily', 'weekly', 'monthly'));
-- ISO weekday names, lowercase: ['monday','wednesday',...]. Only meaningful for
-- recurrence_frequency = 'weekly'.
alter table public.batches add column recurrence_days text[] not null default '{}';
alter table public.batches add column schedule_start_time time;
alter table public.batches add column schedule_end_time time;
alter table public.batches add column recurrence_end_type text
  check (recurrence_end_type in ('indefinite', 'count', 'date'));
alter table public.batches add column recurrence_count int
  check (recurrence_count is null or recurrence_count > 0);
alter table public.batches add column recurrence_end_date date;
-- IANA zone, e.g. 'Asia/Kolkata' - the batch's clock, so a slot lands at the
-- right wall-clock time regardless of where the materialiser runs.
alter table public.batches add column timezone text;
-- How far the materialiser has generated classrooms for this batch, so a
-- re-run is idempotent (only insert slots after this).
alter table public.batches add column materialised_until date;

-- A recurring batch must carry enough to actually schedule from.
alter table public.batches add constraint batches_recurrence_complete check (
  not is_recurring
  or (recurrence_frequency is not null
      and schedule_start_time is not null
      and schedule_end_time is not null
      and recurrence_end_type is not null
      and (recurrence_end_type <> 'count' or recurrence_count is not null)
      and (recurrence_end_type <> 'date'  or recurrence_end_date is not null))
);

notify pgrst, 'reload schema';
