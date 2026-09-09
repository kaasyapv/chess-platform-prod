-- Demo-data backfill for the hosted project.
--
-- The hosted database was seeded from seed.sql before it carried homework for
-- "Beginners A" or a coin balance for the demo student, and seed_factory.sql
-- was never run against it - so on production homework_assignments,
-- homework_submissions and points_ledger were all empty. This is exactly the
-- block appended to supabase/seed.sql in the audit commit, lifted out so it
-- can be pasted into the SQL editor on a database that already has the rest
-- of the seed.
--
-- Requires 0027_audit_hardening.sql first (homework_assignments.student_id).
-- Idempotent: every statement is guarded, so running it twice changes nothing.

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
