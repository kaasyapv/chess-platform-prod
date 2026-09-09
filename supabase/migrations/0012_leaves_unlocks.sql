-- 0012_leaves_unlocks.sql - leave requests + cosmetic unlocks.
--
-- Leaves: anyone requests time off; CEO/manager approve or reject. Approving a
-- coach's leave hands the range's classes over through the UI (reassign flow).
-- Unlocks: coins (awarded by coaches into points_ledger.coins) buy avatar
-- extras and board themes; what a student owns lives on their profile.

create table public.leaves (
  id          uuid primary key default gen_random_uuid(),
  academy_id  uuid not null references public.academies(id),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  starts_on   date not null,
  ends_on     date not null,
  reason      text,
  status      text not null default 'pending'
              check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  check (ends_on >= starts_on)
);

alter table public.leaves enable row level security;

create policy leaves_own_insert on public.leaves for insert
  with check (profile_id = auth.uid() and academy_id = public.my_academy());
create policy leaves_read on public.leaves for select
  using (academy_id = public.my_academy()
         and (profile_id = auth.uid() or public.my_role() in ('ceo','manager')));
create policy leaves_review on public.leaves for update
  using (academy_id = public.my_academy() and public.my_role() in ('ceo','manager'));
create policy leaves_own_delete on public.leaves for delete
  using (profile_id = auth.uid() and status = 'pending');

create index leaves_academy_status on public.leaves (academy_id, status);

-- What a profile has unlocked with coins: {"avatar_extras":[4], "board_themes":["rose"]}
alter table public.profiles add column if not exists unlocks jsonb not null default '{}';
