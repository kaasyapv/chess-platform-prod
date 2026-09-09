-- 0018: Coach absence/penalty system (client requirement #4).
-- CEO applies penalties (dropdown reason + custom "other"); they show up in
-- finances via a query, not baked into finance.ts's synthetic revenue math
-- (there's no payouts table yet - see that file's own comment). Coach can
-- appeal; only CEO decides. Manager has read access for oversight but no
-- write path at all - the spec is explicit that managers escalate to the
-- CEO out-of-band (WhatsApp etc.), not through the app.

create table public.coach_penalties (
  id                 uuid primary key default gen_random_uuid(),
  academy_id         uuid not null references public.academies(id),
  coach_id           uuid not null references public.profiles(id),
  category           text not null check (category in (
    'late','misbehavior','no_recording','no_report','no_show',
    'unprofessional_conduct','policy_violation','other'
  )),
  custom_reason      text,
  amount             numeric(10,2) not null default 0 check (amount >= 0),
  applied_by         uuid not null references public.profiles(id),
  status             text not null default 'active' check (status in ('active','appealed','waived')),
  appeal_reason      text,
  appeal_decided_by  uuid references public.profiles(id),
  appeal_decided_at  timestamptz,
  created_at         timestamptz not null default now()
);
alter table public.coach_penalties enable row level security;

create policy penalties_ceo_write on public.coach_penalties for insert
  with check (academy_id = public.my_academy() and public.my_role() = 'ceo' and applied_by = auth.uid());
create policy penalties_read on public.coach_penalties for select
  using (academy_id = public.my_academy()
         and (public.my_role() in ('ceo','manager') or coach_id = auth.uid()));

create or replace function public.appeal_penalty(p_id uuid, p_reason text)
returns public.coach_penalties language plpgsql security definer as $$
declare row public.coach_penalties;
begin
  if trim(coalesce(p_reason, '')) = '' then raise exception 'appeal reason required'; end if;
  select * into row from public.coach_penalties where id = p_id and coach_id = auth.uid() for update;
  if row.id is null then raise exception 'penalty not found'; end if;
  if row.status <> 'active' then raise exception 'already %', row.status; end if;
  update public.coach_penalties set status = 'appealed', appeal_reason = trim(p_reason)
    where id = p_id returning * into row;
  return row;
end $$;
revoke execute on function public.appeal_penalty(uuid, text) from public, anon;
grant execute on function public.appeal_penalty(uuid, text) to authenticated;

-- approve = penalty removed (status 'waived'); decline = penalty stands ('active').
create or replace function public.decide_penalty_appeal(p_id uuid, p_approve boolean)
returns public.coach_penalties language plpgsql security definer as $$
declare row public.coach_penalties;
begin
  if public.my_role() <> 'ceo' then raise exception 'CEO only'; end if;
  select * into row from public.coach_penalties
    where id = p_id and academy_id = public.my_academy() and status = 'appealed' for update;
  if row.id is null then raise exception 'no pending appeal found'; end if;
  update public.coach_penalties set
    status = case when p_approve then 'waived' else 'active' end,
    appeal_decided_by = auth.uid(), appeal_decided_at = now()
  where id = p_id returning * into row;
  return row;
end $$;
revoke execute on function public.decide_penalty_appeal(uuid, boolean) from public, anon;
grant execute on function public.decide_penalty_appeal(uuid, boolean) to authenticated;

create index coach_penalties_academy_idx on public.coach_penalties(academy_id);
create index coach_penalties_coach_idx on public.coach_penalties(coach_id);
