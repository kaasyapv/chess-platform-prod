-- 0001_tenancy.sql - academies (tenants), profiles, roles, invites, audit log.
-- Multi-tenant model: every domain row carries academy_id; RLS scopes all
-- access to the caller's academy via my_academy()/my_role() helpers.

create type public.user_role as enum ('ceo', 'manager', 'coach', 'student');

create table public.academies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  academy_id     uuid not null references public.academies(id),
  role           public.user_role not null,
  display_name   text not null,
  username       text unique,                    -- auto 'cbpm_'-style for students
  status         text not null default 'active' check (status in ('invited','active','inactive')),
  tags           text[] not null default '{}',
  invite_code    text,
  board_settings jsonb not null default '{}',    -- theme/pieces/lastMove/legalMoves/sounds/premove/autoQueen
  points         int not null default 0,
  coins          int not null default 0,
  created_at     timestamptz not null default now()
);

-- ── RLS helpers ─────────────────────────────────────────────────────────────
create or replace function public.my_academy()
returns uuid language sql stable security definer as
$$ select academy_id from public.profiles where id = auth.uid() $$;

create or replace function public.my_role()
returns public.user_role language sql stable security definer as
$$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.is_staff()
returns boolean language sql stable security definer as
$$ select public.my_role() in ('ceo','manager','coach') $$;

-- ── Invites (onboarding without service_role) ───────────────────────────────
-- Staff create an invite → user signs up with code → self-inserts profile
-- carrying the code → trigger claims invite and stamps academy/role.
create table public.invites (
  id           uuid primary key default gen_random_uuid(),
  academy_id   uuid not null references public.academies(id),
  role         public.user_role not null,
  display_name text not null,
  username     text,
  code         text not null unique default encode(gen_random_bytes(6), 'hex'),
  created_by   uuid not null references public.profiles(id),
  claimed_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);

alter table public.academies enable row level security;
alter table public.profiles  enable row level security;
alter table public.invites   enable row level security;

create policy academies_select on public.academies for select
  using (id = public.my_academy());

create policy profiles_select on public.profiles for select
  using (academy_id = public.my_academy());
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid());
create policy profiles_staff_update on public.profiles for update
  using (academy_id = public.my_academy() and public.my_role() in ('ceo','manager'));
create policy profiles_self_insert on public.profiles for insert
  with check (
    id = auth.uid()
    and exists (select 1 from public.invites i
                where i.code = invite_code and i.claimed_by is null
                  and i.academy_id = profiles.academy_id and i.role = profiles.role)
  );

create policy invites_staff on public.invites for all
  using (academy_id = public.my_academy() and public.is_staff())
  with check (academy_id = public.my_academy() and public.is_staff() and created_by = auth.uid());

create or replace function public.claim_invite()
returns trigger language plpgsql security definer as $$
begin
  update public.invites set claimed_by = new.id
   where code = new.invite_code and claimed_by is null;
  if not found then
    raise exception 'Invalid or already-claimed invite code';
  end if;
  return new;
end $$;

create trigger claim_invite before insert on public.profiles
  for each row when (new.invite_code is not null)
  execute function public.claim_invite();

-- Bootstrap: signing up with no invite code creates a fresh academy + CEO.
create or replace function public.bootstrap_academy(academy_name text, ceo_name text)
returns uuid language plpgsql security definer as $$
declare aid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'profile already exists';
  end if;
  insert into public.academies (name, slug)
    values (academy_name, lower(regexp_replace(academy_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(gen_random_uuid()::text, 1, 4))
    returning id into aid;
  insert into public.profiles (id, academy_id, role, display_name)
    values (auth.uid(), aid, 'ceo', ceo_name);
  return aid;
end $$;

-- ── Audit log (pillar 9) ────────────────────────────────────────────────────
create table public.audit_log (
  id         bigint generated always as identity primary key,
  academy_id uuid,
  actor_id   uuid,
  table_name text not null,
  action     text not null,
  row_id     text,
  detail     jsonb,
  created_at timestamptz not null default now()
);
alter table public.audit_log enable row level security;
create policy audit_read on public.audit_log for select
  using (academy_id = public.my_academy() and public.my_role() in ('ceo','manager'));
-- inserts happen from the security-definer trigger only (no insert policy)

create or replace function public.audit()
returns trigger language plpgsql security definer as $$
declare rid text; aid uuid;
begin
  if tg_op = 'DELETE' then
    rid := (to_jsonb(old) ->> 'id');
    aid := coalesce((to_jsonb(old) ->> 'academy_id')::uuid, public.my_academy());
    insert into public.audit_log (academy_id, actor_id, table_name, action, row_id, detail)
      values (aid, auth.uid(), tg_table_name, tg_op, rid, to_jsonb(old));
    return old;
  else
    rid := (to_jsonb(new) ->> 'id');
    aid := coalesce((to_jsonb(new) ->> 'academy_id')::uuid, public.my_academy());
    insert into public.audit_log (academy_id, actor_id, table_name, action, row_id,
      detail) values (aid, auth.uid(), tg_table_name, tg_op, rid,
      case when tg_op = 'UPDATE' then jsonb_build_object('new', to_jsonb(new)) else to_jsonb(new) end);
    return new;
  end if;
end $$;

create trigger audit_profiles after insert or update or delete on public.profiles
  for each row execute function public.audit();
