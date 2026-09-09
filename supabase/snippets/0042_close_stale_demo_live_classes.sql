-- Close the stale "Demo Coach" LIVE classes for the final demo.
--
-- seed.sql deliberately seeds three classrooms as status='live' (ids
-- ...7001 / 7002 / 7003) so the Live Ops wall shows concurrent boards. On a
-- long-lived demo DB they never get ended, so they sit forever in every
-- staff member's "Current" tab (Ashvita's included). This forces them to
-- 'completed' so they drop into the "Completed" tab instead.
--
-- Scoped to the seeded Demo Coach + still-live only, so it touches exactly
-- those rows and nothing a real coach is actually running. Idempotent.

update public.classrooms
   set status   = 'completed',
       ended_at = coalesce(ended_at, now())
 where coach_id = '33333333-3333-3333-3333-333333333333'  -- Demo Coach (seed.sql)
   and status   = 'live';

-- verify: expect 0 rows
select id, title, status from public.classrooms
 where coach_id = '33333333-3333-3333-3333-333333333333' and status = 'live';
