-- 0027: pre-demo audit. Five holes found by reading every policy end to end.
--
-- The common thread in four of them: an UPDATE policy written with only a
-- USING clause. Postgres then reuses USING as the WITH CHECK, so a predicate
-- that was meant to say "this row is yours" ends up also saying "and you may
-- turn it into anything that is still yours". On `profiles` that is the whole
-- authorisation model, because the row it guards is the one my_role() reads.

-- ── 1. Privilege escalation on profiles (critical) ──────────────────────────
-- profiles_update_self was `using (id = auth.uid())` with no WITH CHECK, so
-- any signed-in student could run
--     update profiles set role = 'ceo' where id = <their own id>
-- straight from the browser console with the public anon key, and from there
-- read the academy's invoices, subscriptions and coach salaries - my_perm()
-- returns true unconditionally for a CEO, so 0024's financial privacy fell
-- with it. The same omission on profiles_staff_update let a manager mint a
-- second CEO or move a member into another tenant.
--
-- RLS filters rows, not columns, so the row filter cannot express "you may
-- edit yourself but not your rank". Postgres has a native mechanism that can:
-- column-level UPDATE privileges. Revoke the blanket grant 0007 handed out and
-- grant back only the columns a browser has any business writing. role,
-- academy_id, invite_code, points and coins are then unwritable through
-- PostgREST by construction, whatever the policy says.
--
-- The security-definer functions that legitimately move those columns
-- (apply_points on the points ledger, remove_academy_member, claim_invite,
-- bootstrap_academy) run as the owner, not as `authenticated`, so none of
-- them are affected.
revoke update on public.profiles from authenticated, anon;
grant update (display_name, username, status, tags, board_settings, coach_id, avatar)
  on public.profiles to authenticated;

-- Belt and braces at the row level too, so the intent is visible in
-- pg_policies and a future `grant update on profiles` cannot silently
-- reopen the tenant boundary.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid() and academy_id = public.my_academy());

drop policy if exists profiles_staff_update on public.profiles;
create policy profiles_staff_update on public.profiles for update
  using (academy_id = public.my_academy() and public.my_role() in ('ceo','manager'))
  with check (academy_id = public.my_academy() and public.my_role() in ('ceo','manager'));

-- ── 2. Parent report links were an open table (high) ────────────────────────
-- student_reports_public_read was `using (true)`, and 0007 grants anon SELECT
-- on every table, so the unguessable slug was not actually the credential:
--     curl "$SUPABASE_URL/rest/v1/student_reports?select=*" -H "apikey: <anon>"
-- returned every report snapshot of every academy - child names, attendance,
-- scores - to anyone holding the publishable key, which ships in the browser
-- bundle by design. A slug is only a credential when you must present it.
--
-- So presenting it becomes the only way in: the table goes back to
-- member-only, and anonymous parents read through a function that takes the
-- slug as an argument and can therefore never be asked for "all rows".
drop policy if exists student_reports_public_read on public.student_reports;
create policy student_reports_member_read on public.student_reports for select
  using (student_id = auth.uid()
         or (academy_id = public.my_academy() and public.is_staff()));

create or replace function public.shared_student_report(p_slug text)
returns table (snapshot jsonb, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.snapshot, r.created_at
    from public.student_reports r
   where r.slug = p_slug
$$;
revoke all on function public.shared_student_report(text) from public;
grant execute on function public.shared_student_report(text) to anon, authenticated;

-- ── 3. Students could grade their own homework (medium) ─────────────────────
-- hw_sub_review's USING ends in `or student_id = auth.uid()` so a student can
-- update their own submission - which they must, to re-attempt it. With no
-- WITH CHECK that same policy also let them write `score`, `review_note` and
-- `status = 'reviewed'`. Columns again, so again a trigger rather than a
-- policy, in the shape 0021 already uses for coach scheduling.
create or replace function public.guard_homework_grading()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_staff() then return new; end if;
  if new.score       is distinct from old.score
     or new.review_note   is distinct from old.review_note
     or new.reviewed_at   is distinct from old.reviewed_at
     or new.student_id    is distinct from old.student_id
     or new.assignment_id is distinct from old.assignment_id
     or (new.status is distinct from old.status and new.status <> 'submitted') then
    raise exception 'only staff can grade homework' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists guard_homework_grading on public.homework_submissions;
create trigger guard_homework_grading
  before update on public.homework_submissions
  for each row execute function public.guard_homework_grading();

-- ── 4. Homework: one named student, and only your own class ─────────────────
-- The table could only ever be aimed at a batch or at the whole academy;
-- "set this one position for Anaya" had nowhere to go. A nullable student_id
-- next to the existing batch_id covers it without a second table: student_id
-- set means one person, batch_id set means that class, neither means everyone.
alter table public.homework_assignments
  add column if not exists student_id uuid references public.profiles(id) on delete cascade;
create index if not exists idx_hw_assign_student on public.homework_assignments (student_id);
comment on column public.homework_assignments.student_id is
  'Assign to one student. Null = the batch in batch_id, or the whole academy when that is null too.';

-- Students could also read every assignment in the academy, including other
-- batches'. Scope it: mine by name, else my classes, else academy-wide.
-- Deliberately no clause on homework_submissions - that table's own policy
-- selects from homework_assignments, and the pair would recurse.
drop policy if exists hw_assign_student_read on public.homework_assignments;
create policy hw_assign_student_read on public.homework_assignments for select
  using (academy_id = public.my_academy()
         and status in ('active','completed','overdue')
         and (student_id = auth.uid()
              or (student_id is null
                  and (batch_id is null
                       or exists (select 1 from public.batch_members m
                                   where m.batch_id = homework_assignments.batch_id
                                     and m.student_id = auth.uid())))));

-- ── 5. Bookings could be rewritten across the tenant line (low) ─────────────
drop policy if exists bookings_update on public.bookings;
create policy bookings_update on public.bookings for update
  using (student_id = auth.uid() or coach_id = auth.uid())
  with check (academy_id = public.my_academy()
              and (student_id = auth.uid() or coach_id = auth.uid()));

-- ── 6. The coin shop never charged anyone ───────────────────────────────────
-- profile-client's buy() wrote `unlocks` straight to the profile and then
-- inserted the -cost row into points_ledger, whose insert policy is
-- staff-only. The insert failed for every student, the error was never read,
-- and the balance only went down in local component state - so cosmetics were
-- free and the deduction vanished on reload. One transaction that either
-- charges and unlocks or does neither, and `unlocks` is no longer in the
-- column grant above, so this is the only way to earn one.
--
-- ponytail: price comes from the caller. The catalogue lives in
-- lib/avatar-parts.ts and duplicating it here would mean two lists to keep in
-- step; move it into a table if cosmetics ever cost real money.
create or replace function public.buy_unlock(p_kind text, p_item jsonb, p_cost int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.profiles; owned jsonb;
begin
  if p_kind not in ('avatar_extras','avatar_hats','board_themes') then
    raise exception 'unknown unlock kind %', p_kind;
  end if;
  if p_cost is null or p_cost < 0 then
    raise exception 'cost must be zero or more';
  end if;

  select * into me from public.profiles where id = auth.uid();
  if me.id is null then raise exception 'not authenticated'; end if;

  owned := coalesce(me.unlocks -> p_kind, '[]'::jsonb);
  if owned @> jsonb_build_array(p_item) then
    return me.unlocks;             -- already bought; charging twice would be theft
  end if;
  if me.coins < p_cost then
    raise exception 'not enough coins' using errcode = '22023';
  end if;

  -- The ledger is the source of truth; its trigger moves profiles.coins.
  insert into public.points_ledger (academy_id, student_id, points, coins, reason)
    values (me.academy_id, me.id, 0, -p_cost, 'shop');

  update public.profiles
     set unlocks = jsonb_set(coalesce(unlocks, '{}'::jsonb), array[p_kind],
                             owned || jsonb_build_array(p_item))
   where id = me.id
   returning unlocks into owned;
  return owned;
end $$;
revoke all on function public.buy_unlock(text, jsonb, int) from public, anon;
grant execute on function public.buy_unlock(text, jsonb, int) to authenticated;

notify pgrst, 'reload schema';
