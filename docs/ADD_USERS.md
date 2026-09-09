# Adding a user by hand (prod)

Prod has no service_role admin UI wired up, so staff accounts are created
directly in the Supabase **SQL Editor**, same shape as `supabase/seed.sql`.
Real passwords are **never committed** - fill them in the editor only.

## 1. Pick the academy

```sql
select id, name, slug from public.academies order by created_at;
```

## 2. Create the account

Fill `:email`, `:pw`, `:name`, `:role` (`coach` | `student` | `manager`),
`:academy_id`, and `:force_reset` (`true` to send them to
`/account/change-password` on first login, else `false`).

```sql
with new_user as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change,
    email_change_token_new, email_change_token_current
  ) values (
    '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
    'authenticated', :'email', crypt(:'pw', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(),
    '', '', '', '', ''
  ) returning id, email
)
insert into auth.identities (
  id, user_id, provider_id, provider, identity_data,
  last_sign_in_at, created_at, updated_at
)
select gen_random_uuid(), id, id::text, 'email',
       jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
       now(), now(), now()
from new_user;

insert into public.profiles (id, academy_id, role, display_name, username, must_change_password)
select id, :'academy_id', :'role', :'name', :'username', :force_reset
from auth.users where email = :'email';
```

## 3. (student only) assign a coach

```sql
update public.profiles
   set coach_id = (select id from public.profiles
                    where display_name = :'coach_name' and role = 'coach'
                      and academy_id = :'academy_id')
 where display_name = :'name' and academy_id = :'academy_id';
```

## 4. Verify

```sql
select p.display_name, p.role, p.must_change_password, u.email, c.display_name as coach
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.profiles c on c.id = p.coach_id
 where p.created_at > now() - interval '10 minutes';
```

The user then signs in at `/login` (host resolves the tenant, or
`/login?slug=<academy-slug>`). If `must_change_password` was `true` they land
on `/account/change-password` and can't reach the dashboard until they set one.
