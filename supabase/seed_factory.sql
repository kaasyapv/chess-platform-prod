-- Demo data FACTORY - generates the bulk dataset that makes the platform look
-- like a real operating academy rather than a prototype with three rows.
--
-- Runs after seed.sql (see config.toml [db.seed].sql_paths), building on the
-- academy + fixed logins that file creates. Generated, not hand-listed: counts
-- are set by the constants at the top, and every row is derived so the data
-- stays internally consistent (a class's students are its batch's students,
-- attendance only exists for classes that happened, invoices only for
-- enrolled students, and so on).
--
-- All generated users share one bcrypt hash of 'chesspass123' - hashing 350
-- passwords individually costs ~40s for zero demo value.
--
-- Idempotent: bails out if the factory has already run.

do $factory$
declare
  ACADEMY   constant uuid := '11111111-1111-1111-1111-111111111111';
  CEO_ID    constant uuid := '22222222-2222-2222-2222-222222222222';
  N_COACHES constant int  := 24;
  N_STUDENTS constant int := 320;
  N_MANAGERS constant int := 5;
  N_LIVE    constant int  := 56;   -- exercises Live Ops + the 50-60 class scale target
  pwd       text;
  first_names text[] := array['Aarav','Vivaan','Aditya','Vihaan','Arjun','Sai','Reyansh','Ayaan','Krishna','Ishaan',
                              'Ananya','Diya','Aadhya','Saanvi','Pari','Anika','Navya','Myra','Sara','Ira',
                              'Rohan','Kabir','Dhruv','Neel','Yash','Tanvi','Meera','Kiara','Riya','Zara',
                              'Advait','Rudra','Shaurya','Atharv','Kanav','Nitya','Prisha','Ridhi','Vanya','Aisha'];
  last_names  text[] := array['Sharma','Verma','Iyer','Nair','Rao','Reddy','Kulkarni','Joshi','Mehta','Shah',
                              'Patel','Gupta','Singh','Bose','Chatterjee','Menon','Pillai','Desai','Bhat','Kapoor'];
  topics text[] := array['Opening Principles','Rook Endgames','Tactics: Forks','Tactics: Pins','Pawn Structures',
                         'The Italian Game','Sicilian Defence','Queen''s Gambit','Middlegame Plans','King Safety',
                         'Zugzwang','Back-rank Mates','Knight Outposts','Bishop Pairs','Prophylaxis','Calculation Drills'];
begin
  if exists (select 1 from public.profiles where username like 'ca_gen%') then
    raise notice 'factory already ran - skipping';
    return;
  end if;

  pwd := crypt('chesspass123', gen_salt('bf'));

  -- ── People ────────────────────────────────────────────────────────────────
  create temp table gen_people(id uuid, role public.user_role, name text, username text, email text, idx int) on commit drop;

  insert into gen_people(id, role, name, username, email, idx)
  select gen_random_uuid(), 'coach',
         first_names[1 + (i * 7) % array_length(first_names,1)] || ' ' || last_names[1 + (i * 3) % array_length(last_names,1)],
         'ca_gencoach' || lpad(i::text, 3, '0'),
         'gencoach' || lpad(i::text, 3, '0') || '@chessacademy.test', i
  from generate_series(1, N_COACHES) i;

  insert into gen_people(id, role, name, username, email, idx)
  select gen_random_uuid(), 'manager',
         first_names[1 + (i * 11) % array_length(first_names,1)] || ' ' || last_names[1 + (i * 5) % array_length(last_names,1)],
         'ca_genmgr' || lpad(i::text, 3, '0'),
         'genmgr' || lpad(i::text, 3, '0') || '@chessacademy.test', i
  from generate_series(1, N_MANAGERS) i;

  insert into gen_people(id, role, name, username, email, idx)
  select gen_random_uuid(), 'student',
         first_names[1 + (i * 13) % array_length(first_names,1)] || ' ' || last_names[1 + (i * 17) % array_length(last_names,1)],
         'ca_genstu' || lpad(i::text, 4, '0'),
         'genstu' || lpad(i::text, 4, '0') || '@chessacademy.test', i
  from generate_series(1, N_STUDENTS) i;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change,
                          email_change_token_new, email_change_token_current)
  select '00000000-0000-0000-0000-000000000000', p.id, 'authenticated', 'authenticated',
         p.email, pwd, now(), '{"provider":"email","providers":["email"]}', '{}',
         now() - (p.idx || ' days')::interval, now(), '', '', '', '', ''
  from gen_people p;

  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), p.id, p.id::text, 'email',
         jsonb_build_object('sub', p.id::text, 'email', p.email, 'email_verified', true),
         now(), now(), now()
  from gen_people p;

  -- Students spread across coaches; ~8% inactive so filters//status pills have
  -- something real to show.
  insert into public.profiles (id, academy_id, role, display_name, username, coach_id, status, points, coins, created_at)
  select p.id, ACADEMY, p.role, p.name, p.username,
         case when p.role = 'student'
              then (select c.id from gen_people c where c.role='coach' and c.idx = 1 + (p.idx % N_COACHES))
              else null end,
         case when p.role = 'student' and p.idx % 13 = 0 then 'inactive' else 'active' end,
         case when p.role = 'student' then (p.idx * 37) % 900 else 0 end,
         case when p.role = 'student' then (p.idx * 17) % 400 else 0 end,
         now() - ((p.idx % 300) || ' days')::interval
  from gen_people p;

  -- Managers get differentiated portfolios rather than identical permissions.
  insert into public.manager_permissions (profile_id, academy_id, title, can_manage_leads, can_view_billing,
                                          can_schedule_classes, can_manage_students, can_view_reports, can_run_demos)
  select p.id, ACADEMY,
         (array['Finance Manager','HR Manager','Class Coordinator Manager','Operations Manager','Admissions Manager'])[p.idx],
         p.idx in (1,5), p.idx in (1,4), p.idx in (3,4), p.idx in (2,3,5), true, p.idx in (3,5)
  from gen_people p where p.role='manager';

  -- ── Batches (one per coach, sold as 24/48/96-class packages) ───────────────
  create temp table gen_batches(id uuid, coach_id uuid, idx int) on commit drop;
  insert into gen_batches(id, coach_id, idx)
  select gen_random_uuid(), c.id, c.idx from gen_people c where c.role='coach';

  insert into public.batches (id, academy_id, name, coach_id, category, total_classes, created_at)
  select b.id, ACADEMY,
         (array['Beginners','Improvers','Intermediate','Advanced','Masters'])[1 + (b.idx % 5)] || ' ' || chr(64 + b.idx),
         b.coach_id,
         (array['group','individual','buddy'])[1 + (b.idx % 3)],
         (array[24,48,96])[1 + (b.idx % 3)],
         now() - ((b.idx * 5) || ' days')::interval
  from gen_batches b;

  insert into public.batch_members (batch_id, student_id)
  select gb.id, p.id
  from gen_people p
  join gen_batches gb on gb.idx = 1 + (p.idx % N_COACHES)
  where p.role='student'
  on conflict do nothing;

  -- ── Curriculum ────────────────────────────────────────────────────────────
  create temp table gen_courses(id uuid, title text, idx int) on commit drop;
  insert into gen_courses(id, title, idx)
  select gen_random_uuid(), topics[i], i from generate_series(1, array_length(topics,1)) i;

  insert into public.courses (id, academy_id, title, description, status, created_by, created_at)
  select c.id, ACADEMY, c.title, c.title || ' - structured syllabus for club-level players.',
         case when c.idx % 8 = 0 then 'draft' else 'active' end, CEO_ID, now() - ((c.idx * 9) || ' days')::interval
  from gen_courses c;

  -- ── Classes: completed history, live now, upcoming, cancelled ─────────────
  create temp table gen_classes(id uuid, batch_idx int, status text, sched timestamptz, course_id uuid, n int) on commit drop;

  -- 120 completed (the history dashboards read from)
  insert into gen_classes
  select gen_random_uuid(), 1 + (i % N_COACHES), 'completed',
         now() - ((i % 90) + 1 || ' days')::interval - ((i % 6) || ' hours')::interval,
         (select id from gen_courses where idx = 1 + (i % 16)), i
  from generate_series(1, 120) i;

  -- live now
  insert into gen_classes
  select gen_random_uuid(), 1 + (i % N_COACHES), 'live',
         now() - ((i % 45) + 5 || ' minutes')::interval,
         (select id from gen_courses where idx = 1 + (i % 16)), i
  from generate_series(1, N_LIVE) i;

  -- upcoming
  insert into gen_classes
  select gen_random_uuid(), 1 + (i % N_COACHES), 'scheduled',
         now() + ((i % 21) + 1 || ' days')::interval + ((i % 8) || ' hours')::interval,
         (select id from gen_courses where idx = 1 + (i % 16)), i
  from generate_series(1, 64) i;

  -- cancelled
  insert into gen_classes
  select gen_random_uuid(), 1 + (i % N_COACHES), 'cancelled',
         now() - ((i % 30) || ' days')::interval,
         (select id from gen_courses where idx = 1 + (i % 16)), i
  from generate_series(1, 14) i;

  insert into public.classrooms (id, academy_id, title, coach_id, batch_id, course_id, scheduled_at,
                                 duration_minutes, status, started_at, ended_at, live_fen, live_updated_at, topic, created_at)
  select gc.id, ACADEMY,
         'Class ' || gc.n || ' - ' || co.title,
         gb.coach_id, gb.id, gc.course_id, gc.sched, 60, gc.status,
         case when gc.status in ('live','completed') then gc.sched end,
         case when gc.status = 'completed' then gc.sched + interval '60 minutes' end,
         /* No board position and no update stamp for seeded live classes.
          *
          * This used to deal six canned FENs round-robin so the Live Ops wall
          * "isn't 56 identical starting boards" -- but nothing was feeding
          * them, so the wall showed six positions on rotation that never
          * moved, and a manager reading it saw fiction presented as the live
          * state of the academy. A board is written by a coach actually moving
          * pieces or it is not written at all; the wall now labels an unfed
          * board as such instead of dressing it up. */
         null,
         null,
         co.title,
         gc.sched - interval '10 days'
  from gen_classes gc
  join gen_batches gb on gb.idx = gc.batch_idx
  join gen_courses co on co.id = gc.course_id;

  -- Enrolments mirror batch membership (a class's students are its batch's students)
  insert into public.classroom_enrollments (classroom_id, student_id)
  select c.id, bm.student_id
  from public.classrooms c
  join public.batch_members bm on bm.batch_id = c.batch_id
  join gen_classes gc on gc.id = c.id
  on conflict do nothing;

  -- ── Attendance for classes that actually happened ─────────────────────────
  insert into public.attendance_records (academy_id, student_id, batch_id, on_date, status, marked_by)
  select distinct on (bm.student_id, c.scheduled_at::date)
         ACADEMY, bm.student_id, c.batch_id, c.scheduled_at::date,
         case (bm.student_id::text || c.id::text) when '' then 'present'
           else (array['present','present','present','present','late','absent','excused'])[1 + (abs(hashtext(bm.student_id::text || c.id::text)) % 7)] end,
         c.coach_id
  from public.classrooms c
  join gen_classes gc on gc.id = c.id and gc.status = 'completed'
  join public.batch_members bm on bm.batch_id = c.batch_id;

  -- ── Money: invoices per student per month, some due/void, subscriptions ────
  insert into public.invoices (academy_id, student_id, amount_inr, description, status, due_at, paid_at, created_at)
  select ACADEMY, p.id,
         (array[3500,4500,6000,7500])[1 + (p.idx % 4)],
         'Monthly coaching - ' || to_char(now() - (m || ' months')::interval, 'Mon YYYY'),
         'paid',
         now() - (m || ' months')::interval - interval '5 days',
         now() - (m || ' months')::interval,
         now() - (m || ' months')::interval - interval '10 days'
  from gen_people p
  cross join generate_series(0, 7) m
  where p.role='student' and p.idx % 13 <> 0        -- inactive students stopped paying
    and (p.idx + m) % 11 <> 0;                       -- a few gaps, so revenue isn't a flat line

  insert into public.invoices (academy_id, student_id, amount_inr, description, status, due_at, created_at)
  select ACADEMY, p.id, (array[3500,4500,6000,7500])[1 + (p.idx % 4)],
         'Monthly coaching - ' || to_char(now(), 'Mon YYYY'), 'due',
         now() + interval '6 days', now() - interval '3 days'
  from gen_people p where p.role='student' and p.idx % 7 = 0;

  insert into public.subscriptions (academy_id, student_id, plan, amount_inr, billing_interval, status, current_period_end, created_at)
  select ACADEMY, p.id,
         (array['Group Monthly','Individual Monthly','Buddy Quarterly'])[1 + (p.idx % 3)],
         (array[3500,4500,6000])[1 + (p.idx % 3)],
         (array['monthly','monthly','quarterly'])[1 + (p.idx % 3)],
         case when p.idx % 17 = 0 then 'past_due' else 'active' end,
         now() + ((p.idx % 28) || ' days')::interval,
         now() - ((p.idx % 200) || ' days')::interval
  from gen_people p where p.role='student' and p.idx % 3 <> 0;

  -- ── Coach penalties across the roster, mixed states ───────────────────────
  insert into public.coach_penalties (academy_id, coach_id, category, custom_reason, amount, applied_by, status, appeal_reason, created_at)
  select ACADEMY, c.id,
         (array['late','misbehavior','no_recording','no_report','no_show','unprofessional_conduct','policy_violation','other'])[1 + (c.idx % 8)],
         case when (c.idx % 8) = 7 then 'Left class 10 minutes early without informing the coordinator' end,
         (array[200,300,500,750,1000])[1 + (c.idx % 5)],
         CEO_ID,
         (array['active','active','appealed','waived'])[1 + ((c.idx / 2) % 4)],
         case when ((c.idx / 2) % 4) in (2, 3) then 'Traffic delay on the expressway - informed the coordinator in advance.' end,
         now() - ((c.idx * 3) || ' days')::interval
  from gen_people c where c.role='coach' and c.idx % 2 = 0;

  -- ── Engagement: points, homework, notifications, announcements ─────────────
  insert into public.points_ledger (academy_id, student_id, points, coins, reason, created_at)
  select ACADEMY, p.id, (array[10,20,30,50])[1 + ((p.idx + k) % 4)], (array[5,10,15])[1 + ((p.idx + k) % 3)],
         (array['Puzzle streak','Homework completed','Class participation','Tournament finish','Coach bonus'])[1 + ((p.idx + k) % 5)],
         now() - (((p.idx + k) % 60) || ' days')::interval
  from gen_people p cross join generate_series(1,3) k
  where p.role='student' and p.idx % 2 = 0;

  create temp table gen_hw(id uuid, batch_idx int, n int) on commit drop;
  insert into gen_hw select gen_random_uuid(), 1 + (i % N_COACHES), i from generate_series(1, 40) i;

  insert into public.homework_assignments (id, academy_id, title, content, batch_id, due_at, status, created_by, created_at)
  select h.id, ACADEMY, 'Homework ' || h.n || ' - ' || co.title,
         jsonb_build_object('instructions', 'Solve the attached positions and submit your lines.'),
         gb.id,
         now() + ((h.n % 14) - 7 || ' days')::interval,
         case when h.n % 5 = 0 then 'completed' when h.n % 7 = 0 then 'overdue' else 'active' end,
         gb.coach_id, now() - ((h.n % 30) || ' days')::interval
  from gen_hw h
  join gen_batches gb on gb.idx = h.batch_idx
  join gen_courses co on co.idx = 1 + (h.n % 16);

  insert into public.homework_submissions (assignment_id, student_id, answers, status, score, submitted_at, reviewed_at)
  select ha.id, bm.student_id,
         jsonb_build_object('lines', array['1. e4 e5 2. Nf3', '1... Nc6 2. Bb5']),
         case when (abs(hashtext(ha.id::text || bm.student_id::text)) % 3) = 0 then 'reviewed' else 'submitted' end,
         case when (abs(hashtext(ha.id::text || bm.student_id::text)) % 3) = 0 then 60 + (abs(hashtext(bm.student_id::text)) % 41) end,
         now() - ((abs(hashtext(ha.id::text)) % 20) || ' days')::interval,
         case when (abs(hashtext(ha.id::text || bm.student_id::text)) % 3) = 0 then now() - interval '2 days' end
  from public.homework_assignments ha
  join gen_hw h on h.id = ha.id
  join public.batch_members bm on bm.batch_id = ha.batch_id
  where (abs(hashtext(ha.id::text || bm.student_id::text)) % 5) < 3;   -- ~60% submission rate

  insert into public.announcements (academy_id, title, body, created_by, created_at)
  select ACADEMY, v.title, v.body, CEO_ID, now() - ((v.d) || ' days')::interval
  from (values
    ('Winter Championship registrations open', 'Entries close Friday. Speak to your coach to confirm your section.', 2),
    ('New Rook Endgames curriculum live', 'All Intermediate batches move to the new syllabus from next week.', 9),
    ('Holiday schedule', 'No classes on the 26th. Make-up classes will be scheduled by your coordinator.', 16),
    ('Coach development workshop', 'Mandatory session for all coaches on Saturday 4pm.', 24)
  ) as v(title, body, d);

  insert into public.notifications (academy_id, user_id, title, body, href, read_at, created_at)
  select ACADEMY, p.id,
         (array['Class reminder','Homework due','Payment received','New announcement'])[1 + (p.idx % 4)],
         (array['Your next class starts in an hour.','Submit before midnight.','Thanks - receipt in your billing page.','Check the notice board.'])[1 + (p.idx % 4)],
         null,
         case when p.idx % 3 = 0 then now() - interval '1 day' end,
         now() - ((p.idx % 14) || ' days')::interval
  from gen_people p where p.role in ('student','coach') and p.idx % 4 = 0;

  -- ── Events & scheduling surfaces ──────────────────────────────────────────
  insert into public.tournaments (academy_id, title, kind, status, starts_at, time_control, created_by, created_at)
  select ACADEMY, v.t, v.k, v.s, now() + (v.d || ' days')::interval, v.tc, CEO_ID, now() - interval '20 days'
  from (values
    ('Winter Rapid Championship','swiss','upcoming', 12, '15+10'),
    ('Junior Blitz Cup','arena','upcoming', 5, '3+2'),
    ('Academy Classical Open','round-robin','completed', -30, '90+30'),
    ('Weekend Arena','arena','completed', -12, '5+0')
  ) as v(t,k,s,d,tc);

  insert into public.simuls (academy_id, title, host_id, status, starts_at, created_at)
  select ACADEMY, 'Simul with ' || c.name, c.id,
         case when c.idx % 2 = 0 then 'upcoming' else 'completed' end,
         now() + ((c.idx * 3 - 15) || ' days')::interval, now() - interval '25 days'
  from gen_people c where c.role='coach' and c.idx <= 4;

  insert into public.availability_rules (academy_id, coach_id, weekday, start_time, end_time, slot_minutes)
  select ACADEMY, c.id, wd, time '16:00', time '20:00', 60
  from gen_people c cross join generate_series(1,5) wd
  where c.role='coach' and c.idx % 3 = 0;

  insert into public.bookings (academy_id, coach_id, student_id, starts_at, duration_minutes, status, created_at)
  select ACADEMY, pr.coach_id, pr.id,
         now() + ((p.idx % 10) + 1 || ' days')::interval, 60,
         (array['booked','booked','completed','cancelled'])[1 + (p.idx % 4)],
         now() - interval '3 days'
  from gen_people p
  join public.profiles pr on pr.id = p.id
  where p.role='student' and pr.coach_id is not null and p.idx % 9 = 0;

  insert into public.leaves (academy_id, profile_id, starts_on, ends_on, reason, status, reviewed_by, created_at)
  select ACADEMY, c.id, (now() + ((c.idx * 2) || ' days')::interval)::date,
         (now() + ((c.idx * 2 + 2) || ' days')::interval)::date,
         (array['Family function','Medical','Travel','Personal'])[1 + (c.idx % 4)],
         (array['pending','approved','rejected'])[1 + (c.idx % 3)],
         case when c.idx % 3 <> 0 then CEO_ID end,
         now() - ((c.idx) || ' days')::interval
  from gen_people c where c.role='coach' and c.idx % 4 = 0;

  raise notice 'factory complete';
end
$factory$;

-- ══════════════════════════════════════════════════════════════════════════
-- Demo data for the reporting/permissions/avatar features.
-- Idempotent like the rest: guarded on its own marker.
-- ══════════════════════════════════════════════════════════════════════════
do $extra$
declare
  ACADEMY constant uuid := '11111111-1111-1111-1111-111111111111';
  styles  text[] := array['adventurerNeutral','notionists','thumbs','bottts','funEmoji','lorelei','micah','pixelArt'];
  seeds   text[] := array['swift-rook','brave-knight','calm-bishop','bright-pawn','clever-queen',
                          'bold-king','quiet-castle','keen-gambit','royal-check','lucky-mate'];
begin
  if exists (select 1 from public.activity_events limit 1) then
    raise notice 'activity/demo extras already seeded - skipping';
    return;
  end if;

  -- ── Customised avatars ────────────────────────────────────────────────────
  -- Most demo users get a chosen DiceBear avatar; a few are left null so the
  -- generated-from-id fallback is visible too.
  update public.profiles p
     set avatar = 'dicebear:' || styles[1 + (abs(hashtext(p.id::text)) % array_length(styles,1))]
                  || ':' || seeds[1 + (abs(hashtext(p.username)) % array_length(seeds,1))]
   where p.academy_id = ACADEMY
     and p.avatar is null
     and abs(hashtext(p.id::text)) % 5 <> 0;   -- ~20% keep the generated fallback

  -- ── Leads access: an explicit mix ─────────────────────────────────────────
  -- Some managers granted, most not, so the permission is visibly doing work.
  update public.manager_permissions set can_manage_leads = false where academy_id = ACADEMY;
  update public.manager_permissions mp
     set can_manage_leads = true
   where mp.profile_id in (
     select profile_id from public.manager_permissions
      where academy_id = ACADEMY order by profile_id limit 2);

  -- ── Billing access: the same shape, for the financial-privacy rules ───────
  -- can_view_billing is what now decides whether a manager can see any money
  -- at all (0024). Leave most managers without it so a Full Report opened by a
  -- manager visibly withholds salary, and grant one so the exception is
  -- demonstrable too.
  update public.manager_permissions set can_view_billing = false where academy_id = ACADEMY;
  update public.manager_permissions mp
     set can_view_billing = true
   where mp.profile_id = (
     select profile_id from public.manager_permissions
      where academy_id = ACADEMY order by profile_id limit 1);

  -- ── Genuine activity: 21 days of sessions for coaches and students ────────
  -- 'active' rows are one-minute heartbeats, so a day's total is however many
  -- of them that day holds - the same shape the live tracker produces.
  insert into public.activity_events (academy_id, profile_id, kind, seconds, detail, created_at)
  select ACADEMY, p.id, 'login', null, null,
         (now()::date - d) + time '09:00' + ((abs(hashtext(p.id::text || d::text)) % 90) || ' minutes')::interval
  from public.profiles p
  cross join generate_series(0, 20) d
  where p.academy_id = ACADEMY and p.role in ('coach','student')
    and (abs(hashtext(p.id::text || d::text)) % 10) < 7;   -- ~70% of days active

  -- Heartbeats: 20-95 minutes of genuine activity per active day.
  insert into public.activity_events (academy_id, profile_id, kind, seconds, created_at)
  select ACADEMY, s.id, 'active', 60,
         s.day_start + ((m * 60) || ' seconds')::interval
  from (
    select p.id, p.role,
           (now()::date - d) + time '09:00' + ((abs(hashtext(p.id::text || d::text)) % 90) || ' minutes')::interval as day_start,
           20 + (abs(hashtext(p.id::text || d::text)) % 75) as minutes
    from public.profiles p
    cross join generate_series(0, 20) d
    where p.academy_id = ACADEMY and p.role in ('coach','student')
      and (abs(hashtext(p.id::text || d::text)) % 10) < 7
  ) s
  cross join lateral generate_series(0, s.minutes) m;

  -- Feature events, so the audit log reads as a story rather than a wall of "active".
  insert into public.activity_events (academy_id, profile_id, kind, classroom_id, detail, created_at)
  select ACADEMY, c.coach_id, 'class_start', c.id, c.title, c.scheduled_at
  from public.classrooms c
  where c.academy_id = ACADEMY and c.status = 'completed';

  insert into public.activity_events (academy_id, profile_id, kind, classroom_id, detail, created_at)
  select ACADEMY, c.coach_id, 'class_end', c.id, c.title, c.scheduled_at + interval '60 minutes'
  from public.classrooms c
  where c.academy_id = ACADEMY and c.status = 'completed';

  insert into public.activity_events (academy_id, profile_id, kind, classroom_id, detail, created_at)
  select ACADEMY, c.coach_id, 'whiteboard', c.id, 'Explained the position', c.scheduled_at + interval '12 minutes'
  from public.classrooms c
  where c.academy_id = ACADEMY and c.status = 'completed'
    and abs(hashtext(c.id::text)) % 3 = 0;

  insert into public.activity_events (academy_id, profile_id, kind, classroom_id, detail, created_at)
  select ACADEMY, bm.student_id, 'class_join', c.id, c.title, c.scheduled_at + interval '2 minutes'
  from public.classrooms c
  join public.batch_members bm on bm.batch_id = c.batch_id
  where c.academy_id = ACADEMY and c.status = 'completed'
    and abs(hashtext(c.id::text || bm.student_id::text)) % 4 < 3;   -- ~75% turned up

  -- Idle stretches, so "genuine active time" is visibly not wall-clock time.
  insert into public.activity_events (academy_id, profile_id, kind, seconds, detail, created_at)
  select ACADEMY, p.id, 'idle', 300 + (abs(hashtext(p.id::text || d::text)) % 1500), 'Away from keyboard',
         (now()::date - d) + time '11:30'
  from public.profiles p
  cross join generate_series(0, 20) d
  where p.academy_id = ACADEMY and p.role in ('coach','student')
    and (abs(hashtext(p.id::text || d::text)) % 10) < 3;

  -- ── Payment history: a term's worth of taught sessions ────────────────────
  -- The coach statement is derived, not stored: completed classes x the flat
  -- session rate, less penalties (lib/finance.ts). So "demo payment data"
  -- means real teaching history, and the five generated classes per coach made
  -- for a statement barely worth opening. This backfills twelve weeks of
  -- twice-weekly classes per coach, reusing their own batch and course so the
  -- rows are consistent with everything else the academy knows.
  insert into public.classrooms (academy_id, title, coach_id, batch_id, course_id,
                                 scheduled_at, duration_minutes, status, started_at, ended_at, topic)
  select ACADEMY,
         'Session ' || w || ' - ' || co.title,
         b.coach_id, b.id, co.id,
         (now()::date - (w * 3))::timestamptz + time '17:00',
         60, 'completed',
         (now()::date - (w * 3))::timestamptz + time '17:00',
         (now()::date - (w * 3))::timestamptz + time '18:00',
         co.title
  from public.batches b
  -- A batch has no course of its own; take the one its existing classes use so
  -- the backfilled sessions belong to the same syllabus the batch is studying.
  join lateral (
    select c.course_id from public.classrooms c
     where c.batch_id = b.id and c.course_id is not null limit 1
  ) bc on true
  join public.courses co on co.id = bc.course_id
  cross join generate_series(1, 24) w
  where b.academy_id = ACADEMY and b.coach_id is not null;

  -- A couple of managers carry a penalty too, so the "managers can receive and
  -- appeal, but never police others" path has something to show. One is left
  -- active (appealable), one already appealed and awaiting the CEO.
  insert into public.coach_penalties (academy_id, coach_id, category, custom_reason,
                                      amount, applied_by, status, appeal_reason, created_at)
  select ACADEMY, m.profile_id,
         case when rn = 1 then 'no_report' else 'late' end,
         null,
         case when rn = 1 then 500 else 250 end,
         (select id from public.profiles where role = 'ceo' and academy_id = ACADEMY limit 1),
         case when rn = 1 then 'active' else 'appealed' end,
         case when rn = 2 then 'The review call overran; I filed the report the same evening.' end,
         now() - ((rn * 6) || ' days')::interval
  from (
    select profile_id, row_number() over (order by profile_id) as rn
    from public.manager_permissions where academy_id = ACADEMY
  ) m
  where m.rn <= 2;

  raise notice 'activity + avatar + leads-access + payment-history demo data seeded';
end
$extra$;
