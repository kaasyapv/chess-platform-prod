-- Seed: demo accounts + sample data for manual QA.
-- Applied automatically by `npx supabase start` / `npx supabase db reset`
-- (local stack). For a HOSTED project, paste into the SQL editor instead.
--
--   Admin (CEO): admin@chessacademy.test   / chesspass123
--   Manager:     manager@chessacademy.test / chesspass123  (Class Manager)
--   Coach:       coach@chessacademy.test   / chesspass123
--   Coach 2:     coach2@chessacademy.test  / chesspass123
--   Student:     student@chessacademy.test / chesspass123
--   Student 2:   student2@chessacademy.test / chesspass123
--   Student 3:   student3@chessacademy.test / chesspass123

-- Fixed ids so re-seeding is deterministic
-- academy  11111111-1111-1111-1111-111111111111
-- admin    22222222-2222-2222-2222-222222222222
-- coach    33333333-3333-3333-3333-333333333333
-- student  44444444-4444-4444-4444-444444444444

-- ── Auth users (GoTrue: bcrypt password + email identity) ───────────────────
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at,
                        -- GoTrue scans these as strings; NULL breaks token grants
                        confirmation_token, recovery_token,
                        email_change, email_change_token_new, email_change_token_current)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       u.email, crypt('chesspass123', gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}', '{}', now(), now(),
       '', '', '', '', ''
from (values
  ('22222222-2222-2222-2222-222222222222'::uuid, 'admin@chessacademy.test'),
  ('33333333-3333-3333-3333-333333333333'::uuid, 'coach@chessacademy.test'),
  ('44444444-4444-4444-4444-444444444444'::uuid, 'student@chessacademy.test'),
  ('88888888-8888-8888-8888-888888888888'::uuid, 'manager@chessacademy.test')
) as u(id, email)
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, provider, identity_data,
                             last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       now(), now(), now()
from auth.users u
where u.email like '%@chessacademy.test'
on conflict do nothing;

-- ── Academy + profiles ───────────────────────────────────────────────────────
insert into public.academies (id, name, slug)
values ('11111111-1111-1111-1111-111111111111', 'Demo Chess Academy', 'demo-chess-academy')
on conflict (id) do nothing;

insert into public.profiles (id, academy_id, role, display_name, username, coach_id)
values
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'ceo', 'Demo Admin', 'ca_admin01', null),
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'coach', 'Demo Coach', 'ca_coach01', null),
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 'student', 'Demo Student', 'ca_student01',
   '33333333-3333-3333-3333-333333333333'),  -- assigned to Demo Coach
  ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111', 'manager', 'Demo Manager', 'ca_manager01', null)
on conflict (id) do nothing;

-- Manager permissions: Class Manager who also owns the lead pipeline
insert into public.manager_permissions
  (profile_id, academy_id, title, can_manage_leads, can_schedule_classes, can_run_demos, can_view_reports)
values ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111',
        'Class Manager', true, true, true, true)
on conflict (profile_id) do nothing;

-- Sample CRM pipeline
insert into public.leads (academy_id, name, contact, source, status, assigned_to)
select '11111111-1111-1111-1111-111111111111', v.name, v.contact::jsonb, v.source, v.status,
       '88888888-8888-8888-8888-888888888888'
from (values
  ('Asha Rao',    '{"email":"asha@example.com","phone":"+911234500001"}', 'meta_ads',    'new'),
  ('Vikram Shah', '{"email":"vikram@example.com"}',                       'google_form', 'qualified'),
  ('Meera Nair',  '{"phone":"+911234500003"}',                            'whatsapp',    'trial')
) as v(name, contact, source, status)
where not exists (select 1 from public.leads);

-- ── Batch with the student, coached by Demo Coach ───────────────────────────
insert into public.batches (id, academy_id, name, coach_id)
values ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111',
        'Beginners A', '33333333-3333-3333-3333-333333333333')
on conflict (id) do nothing;

insert into public.batch_members (batch_id, student_id)
values ('55555555-5555-5555-5555-555555555555', '44444444-4444-4444-4444-444444444444')
on conflict do nothing;

-- ── Sample PGN library content ───────────────────────────────────────────────
insert into public.pgn_folders (id, academy_id, name)
values ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111',
        'Openings')
on conflict (id) do nothing;

insert into public.pgns (academy_id, folder_id, title, content, created_by)
select '11111111-1111-1111-1111-111111111111', '66666666-6666-6666-6666-666666666666',
       'Italian Game - model game',
       E'[Event "Model Game"]\n[White "Coach"]\n[Black "Student"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d4 exd4 6. cxd4 Bb4+ 7. Nc3 Nxe4 8. O-O Bxc3 9. d5 1-0',
       '33333333-3333-3333-3333-333333333333'
where not exists (select 1 from public.pgns where title = 'Italian Game - model game');

-- ── A classroom scheduled a few days out. 3 days rather than 1 hour, so it
--    still reads as "upcoming" on the demo coach's dashboard even if the demo
--    happens a while after the machine was seeded, rather than sliding into
--    the past (and quietly dropping off any "upcoming" view) within the hour.
insert into public.classrooms (id, academy_id, title, coach_id, batch_id, scheduled_at, duration_minutes)
values ('77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111',
        'Opening Principles - Live Demo', '33333333-3333-3333-3333-333333333333',
        '55555555-5555-5555-5555-555555555555', now() + interval '3 days', 60)
on conflict (id) do nothing;

-- ── Three classes running now, so the Manager's Live Ops wall shows several
--    concurrent boards with live positions, and the demo coach's own
--    dashboard reads as active rather than relying on the single
--    "scheduled_at = seed time + 1 hour" class above, which goes stale (and
--    quietly drops off any "upcoming" view) the moment real time catches up
--    to it. 'live' classes don't decay the same way - they read as active
--    for as long as the demo needs them to ─────────────────────────────────
insert into public.classrooms
  (id, academy_id, title, coach_id, batch_id, scheduled_at, duration_minutes,
   status, started_at, live_fen, live_updated_at)
values
  ('77777777-7777-7777-7777-777777777001', '11111111-1111-1111-1111-111111111111',
   'Italian Game - Live', '33333333-3333-3333-3333-333333333333',
   '55555555-5555-5555-5555-555555555555', now() - interval '20 minutes', 60,
   'live', now() - interval '20 minutes',
   'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3', now()),
  ('77777777-7777-7777-7777-777777777002', '11111111-1111-1111-1111-111111111111',
   'Endgame Technique - Live', '33333333-3333-3333-3333-333333333333',
   '55555555-5555-5555-5555-555555555555', now() - interval '10 minutes', 60,
   'live', now() - interval '10 minutes',
   '8/8/4k3/8/8/4K3/4P3/8 w - - 0 1', now()),
  ('77777777-7777-7777-7777-777777777003', '11111111-1111-1111-1111-111111111111',
   'Tactics Sharpening - Live', '33333333-3333-3333-3333-333333333333',
   '55555555-5555-5555-5555-555555555555', now() - interval '5 minutes', 60,
   'live', now() - interval '5 minutes',
   'r2qk2r/ppp2ppp/2n1bn2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w kq - 6 8', now())
on conflict (id) do nothing;

-- ══════════════════════════════════════════════════════════════════════════
-- Below: broader demo data so every module the client spec touches (CEO,
-- managers, coaches, students, classes, curriculum, finances, penalties,
-- TeleCRM) shows something real instead of an empty state, and the CEO
-- Excel export (item 13) has actual invoices/subscriptions to report on
-- instead of falling back to synthetic numbers.
-- ══════════════════════════════════════════════════════════════════════════

-- One more coach + two more students, for a less single-actor-looking demo.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at,
                        confirmation_token, recovery_token,
                        email_change, email_change_token_new, email_change_token_current)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       u.email, crypt('chesspass123', gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}', '{}', now(), now(),
       '', '', '', '', ''
from (values
  ('99999999-9999-9999-9999-999999999001'::uuid, 'coach2@chessacademy.test'),
  ('99999999-9999-9999-9999-999999999002'::uuid, 'student2@chessacademy.test'),
  ('99999999-9999-9999-9999-999999999003'::uuid, 'student3@chessacademy.test')
) as u(id, email)
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, provider, identity_data,
                             last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       now(), now(), now()
from auth.users u
where u.email in ('coach2@chessacademy.test', 'student2@chessacademy.test', 'student3@chessacademy.test')
on conflict do nothing;

insert into public.profiles (id, academy_id, role, display_name, username, coach_id)
values
  ('99999999-9999-9999-9999-999999999001', '11111111-1111-1111-1111-111111111111', 'coach', 'Priya Kulkarni', 'ca_coach02', null),
  ('99999999-9999-9999-9999-999999999002', '11111111-1111-1111-1111-111111111111', 'student', 'Rohan Iyer', 'ca_student02', '33333333-3333-3333-3333-333333333333'),
  ('99999999-9999-9999-9999-999999999003', '11111111-1111-1111-1111-111111111111', 'student', 'Ananya Verma', 'ca_student03', '99999999-9999-9999-9999-999999999001')
on conflict (id) do nothing;

update public.batches
   set category = 'group', total_classes = 24
 where id = '55555555-5555-5555-5555-555555555555';

insert into public.batch_members (batch_id, student_id)
values ('55555555-5555-5555-5555-555555555555', '99999999-9999-9999-9999-999999999002')
on conflict do nothing;

-- ── Curriculum + numbered classes ("Class N - Title", client req #10) ───────
insert into public.courses (id, academy_id, title, description, status, created_by)
values ('cc111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
        'Rook Endgames Mastery', 'A structured path through the rook endgames every club player needs.',
        'active', '22222222-2222-2222-2222-222222222222')
on conflict (id) do nothing;

insert into public.classrooms (id, academy_id, title, coach_id, batch_id, course_id, scheduled_at, duration_minutes, status)
values
  ('dd111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   'Class 1 - Rook Endgames Mastery', '33333333-3333-3333-3333-333333333333',
   '55555555-5555-5555-5555-555555555555', 'cc111111-1111-1111-1111-111111111111',
   now() - interval '7 days', 60, 'completed'),
  ('dd111111-1111-1111-1111-111111111112', '11111111-1111-1111-1111-111111111111',
   'Class 2 - Rook Endgames Mastery', '99999999-9999-9999-9999-999999999001',
   '55555555-5555-5555-5555-555555555555', 'cc111111-1111-1111-1111-111111111111',
   now() + interval '2 days', 60, 'scheduled')
on conflict (id) do nothing;

-- ── Invoices: a real spread of paid months (feeds Revenue chart + Excel
--    export with actual numbers instead of the synthetic demo fallback) ────
insert into public.invoices (academy_id, student_id, amount_inr, description, status, due_at, paid_at)
select '11111111-1111-1111-1111-111111111111', v.student_id, v.amount, v.description, 'paid',
       v.paid_at - interval '5 days', v.paid_at
from (values
  ('44444444-4444-4444-4444-444444444444'::uuid, 4500, 'Monthly coaching - Beginners A', now() - interval '5 months'),
  ('44444444-4444-4444-4444-444444444444'::uuid, 4500, 'Monthly coaching - Beginners A', now() - interval '4 months'),
  ('99999999-9999-9999-9999-999999999002'::uuid, 4500, 'Monthly coaching - Beginners A', now() - interval '3 months'),
  ('44444444-4444-4444-4444-444444444444'::uuid, 4500, 'Monthly coaching - Beginners A', now() - interval '2 months'),
  ('99999999-9999-9999-9999-999999999003'::uuid, 6000, 'Rook Endgames Mastery - course fee', now() - interval '1 months'),
  ('99999999-9999-9999-9999-999999999002'::uuid, 4500, 'Monthly coaching - Beginners A', now() - interval '10 days')
) as v(student_id, amount, description, paid_at)
where not exists (select 1 from public.invoices where description = v.description and student_id = v.student_id and status = 'paid');

insert into public.invoices (academy_id, student_id, amount_inr, description, status, due_at)
select '11111111-1111-1111-1111-111111111111', '99999999-9999-9999-9999-999999999003',
       4500, 'Monthly coaching - due', 'due', now() + interval '5 days'
where not exists (select 1 from public.invoices where description = 'Monthly coaching - due');

insert into public.subscriptions (academy_id, student_id, plan, amount_inr, billing_interval, status, current_period_end)
select '11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444',
       'Beginners A - Monthly', 4500, 'monthly', 'active', now() + interval '20 days'
where not exists (select 1 from public.subscriptions);

-- ── Coach penalties (client req #4) - one active, one under appeal ──────────
insert into public.coach_penalties (academy_id, coach_id, category, amount, applied_by, status)
select '11111111-1111-1111-1111-111111111111', '99999999-9999-9999-9999-999999999001',
       'late', 500, '22222222-2222-2222-2222-222222222222', 'active'
where not exists (select 1 from public.coach_penalties where coach_id = '99999999-9999-9999-9999-999999999001');

insert into public.coach_penalties (academy_id, coach_id, category, amount, applied_by, status, appeal_reason)
select '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333',
       'no_report', 300, '22222222-2222-2222-2222-222222222222', 'appealed',
       'Report was submitted on time - attaching timestamp screenshot to CEO over WhatsApp'
where not exists (select 1 from public.coach_penalties where coach_id = '33333333-3333-3333-3333-333333333333');

-- ── TeleCRM-sourced lead (client req #3) ─────────────────────────────────────
insert into public.leads (academy_id, name, contact, source, status, assigned_to)
select '11111111-1111-1111-1111-111111111111', 'Kabir Malhotra',
       '{"phone":"+911234500099"}'::jsonb, 'telecrm', 'new', '88888888-8888-8888-8888-888888888888'
where not exists (select 1 from public.leads where name = 'Kabir Malhotra');

insert into public.lead_events (lead_id, academy_id, kind, body, meta)
select l.id, '11111111-1111-1111-1111-111111111111', 'webhook',
       'TeleCRM stage: Hot Lead', '{"telecrm_lead_id": "tcrm_demo_001", "telecrm_stage": "Hot Lead"}'::jsonb
from public.leads l
where l.name = 'Kabir Malhotra'
  and not exists (select 1 from public.lead_events where lead_id = l.id);

-- ── Homework for the demo batch ─────────────────────────────────────────────
-- The generated academy (seed_factory.sql) spreads its 40 assignments across
-- its own generated batches, so "Beginners A" - the batch the demo student is
-- actually in - had none of its own. Until 0027 tightened the read policy the
-- Homework tab still looked full, because a student could read every
-- assignment in the academy including other batches'. Scoped correctly, that
-- tab was empty for the one account the demo signs in as. Real rows for the
-- real batch, covering each state the walkthrough shows: one to solve, one
-- already submitted and awaiting review, one reviewed with a score, and one
-- aimed at a single student by name.
insert into public.homework_assignments
  (id, academy_id, template_id, title, content, batch_id, student_id, due_at, status, created_by, created_at)
values
  ('ee111111-1111-1111-1111-111111111101', '11111111-1111-1111-1111-111111111111', null,
   'Back-rank mates - find the finish',
   jsonb_build_object(
     'instructions', 'White to play and mate. Play the first move of the mating line on each board.',
     'positions', jsonb_build_array(
       '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
       '3r2k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1'),
     'attempts', 2, 'points', 20),
   '55555555-5555-5555-5555-555555555555', null,
   now() + interval '3 days', 'active', '33333333-3333-3333-3333-333333333333', now() - interval '1 day'),

  ('ee111111-1111-1111-1111-111111111102', '11111111-1111-1111-1111-111111111111', null,
   'Italian Game - the critical break',
   jsonb_build_object(
     'instructions', 'From the model game in the PGN library: play the move that opens the centre.',
     'positions', jsonb_build_array('r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2P2N2/PP1P1PPP/RNBQK2R w KQkq - 0 5'),
     'attempts', 1, 'time_limit_minutes', 10, 'points', 15),
   '55555555-5555-5555-5555-555555555555', null,
   now() + interval '6 days', 'active', '33333333-3333-3333-3333-333333333333', now() - interval '4 days'),

  ('ee111111-1111-1111-1111-111111111103', '11111111-1111-1111-1111-111111111111', null,
   'Rook endgame - the Lucena position',
   jsonb_build_object(
     'instructions', 'Build the bridge. Play the winning first move.',
     'positions', jsonb_build_array('1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1'),
     'attempts', 3, 'points', 25),
   '55555555-5555-5555-5555-555555555555', null,
   now() - interval '2 days', 'completed', '33333333-3333-3333-3333-333333333333', now() - interval '9 days'),

  -- Aimed at one named student (student_id, added in 0027) rather than a batch.
  ('ee111111-1111-1111-1111-111111111104', '11111111-1111-1111-1111-111111111111', null,
   'Personal drill - knight forks',
   jsonb_build_object(
     'instructions', 'Set for you after last class. Find the fork in each position.',
     'positions', jsonb_build_array('r2q1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 1'),
     'attempts', 2, 'points', 10),
   null, '44444444-4444-4444-4444-444444444444',
   now() + interval '2 days', 'active', '33333333-3333-3333-3333-333333333333', now() - interval '6 hours')
on conflict (id) do nothing;

-- One submitted (sits in the coach's review queue) and one already reviewed,
-- so the student sees a score and the Review Queue is not empty on open.
insert into public.homework_submissions
  (assignment_id, student_id, answers, status, review_note, score, submitted_at, reviewed_at)
values
  ('ee111111-1111-1111-1111-111111111103', '44444444-4444-4444-4444-444444444444',
   jsonb_build_object('text', 'Rc1-c4 builds the bridge, then Kb8-c7 and the rook shields on the fourth rank.',
                      'moves', jsonb_build_array(jsonb_build_object('fen', '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1', 'san', 'Rc4')),
                      'attempts', 1, 'took_seconds', 240),
   'reviewed', 'Correct - and you named the follow-up. Well done.', 23,
   now() - interval '3 days', now() - interval '2 days'),

  ('ee111111-1111-1111-1111-111111111102', '99999999-9999-9999-9999-999999999002',
   jsonb_build_object('text', 'The break is d4.',
                      'moves', jsonb_build_array(jsonb_build_object(
                        'fen', 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2P2N2/PP1P1PPP/RNBQK2R w KQkq - 0 5', 'san', 'd4')),
                      'attempts', 1, 'took_seconds', 95),
   'submitted', null, null, now() - interval '5 hours', null)
on conflict (assignment_id, student_id) do nothing;

-- ── Coins for the demo student ──────────────────────────────────────────────
-- The avatar shop on /profile is priced in coins and the demo student had a
-- zero balance, so every item read "You need N coins, ask your coach!" and
-- nothing in that screen could be shown working. Awarded through the ledger,
-- not by writing profiles.coins directly: the apply_points trigger is what
-- moves the balance, and since 0027 that column is not client-writable at all.
insert into public.points_ledger (academy_id, student_id, points, coins, reason, created_at)
select '11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444',
       v.points, v.coins, v.reason, now() - (v.d || ' days')::interval
from (values
  (30, 15, 'Puzzle streak - 7 days', 12),
  (20, 10, 'Homework: Rook endgame - the Lucena position', 2),
  (25, 20, 'Class participation', 5),
  (40, 25, 'Tournament finish - 3rd', 8)
) as v(points, coins, reason, d)
where not exists (
  select 1 from public.points_ledger
   where student_id = '44444444-4444-4444-4444-444444444444' and reason like 'Puzzle streak%');
