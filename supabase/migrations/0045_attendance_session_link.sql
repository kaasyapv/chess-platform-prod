-- 0045: link attendance to a specific live class (ERP model).
--
-- attendance_records is keyed (student_id, on_date) - one mark per student per
-- DAY, with only an optional batch_id. So "did this student attend THIS live
-- session" has no home, and neither does auto-marking from presence /
-- activity_events class-time (the reference computes per-student minutes at
-- session end and lets the coach override).
--
-- Additive: classroom_id is nullable. The day-level unique is replaced by two
-- partial uniques so BOTH kinds of row coexist:
--   * classroom_id IS NULL  -> at most one manual day mark per student per date
--     (exactly the old behaviour, for the Attendance page's batch/date grid)
--   * classroom_id IS NOT NULL -> at most one mark per student per live class
--
-- If prod already has two rows for one student+date (it shouldn't - the old
-- constraint forbade it), the first index create will fail loudly; dedupe then
-- re-run. RLS is unchanged (attendance_staff / attendance_own from 0002).

alter table public.attendance_records
  add column classroom_id uuid references public.classrooms(id) on delete set null;

create index attendance_records_classroom on public.attendance_records(classroom_id)
  where classroom_id is not null;

alter table public.attendance_records drop constraint attendance_records_student_id_on_date_key;

create unique index attendance_day_mark
  on public.attendance_records (student_id, on_date)
  where classroom_id is null;

create unique index attendance_session_mark
  on public.attendance_records (student_id, classroom_id)
  where classroom_id is not null;

notify pgrst, 'reload schema';
