-- 0030: buy_unlock trusted the client-supplied p_cost with no catalogue
-- lookup, so any student could call it with p_cost=0 and get any cosmetic
-- for free. Move pricing server-side - there are only three flat per-kind
-- prices (see src/lib/avatar-parts.ts EXTRA_COST, src/lib/board-settings.ts
-- THEME_COST), so a case expression is enough; keep these three numbers in
-- sync with those files if either ever changes.
drop function if exists public.buy_unlock(text, jsonb, int);

create or replace function public.buy_unlock(p_kind text, p_item jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.profiles; owned jsonb; cost int;
begin
  cost := case p_kind
    when 'avatar_extras' then 20
    when 'avatar_hats'   then 20
    when 'board_themes'  then 30
    else null
  end;
  if cost is null then raise exception 'unknown unlock kind %', p_kind; end if;

  select * into me from public.profiles where id = auth.uid();
  if me.id is null then raise exception 'not authenticated'; end if;

  owned := coalesce(me.unlocks -> p_kind, '[]'::jsonb);
  if owned @> jsonb_build_array(p_item) then
    return me.unlocks;             -- already bought; charging twice would be theft
  end if;
  if me.coins < cost then
    raise exception 'not enough coins' using errcode = '22023';
  end if;

  -- The ledger is the source of truth; its trigger moves profiles.coins.
  insert into public.points_ledger (academy_id, student_id, points, coins, reason)
    values (me.academy_id, me.id, 0, -cost, 'shop');

  update public.profiles
     set unlocks = jsonb_set(coalesce(unlocks, '{}'::jsonb), array[p_kind],
                             owned || jsonb_build_array(p_item))
   where id = me.id
   returning unlocks into owned;
  return owned;
end $$;
revoke all on function public.buy_unlock(text, jsonb) from public, anon;
grant execute on function public.buy_unlock(text, jsonb) to authenticated;

notify pgrst, 'reload schema';
