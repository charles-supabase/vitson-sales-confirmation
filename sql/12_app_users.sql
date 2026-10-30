-- =====================================================================
-- Run in: vitson-recipe -> SQL Editor.  Idempotent.  SAFE: only adds things, the app keeps working as before.
-- User access control, part 1: users, sessions and the login functions.
--
-- How it works
--   * The browser logs in through the Edge Function "app-login". The function reads the caller's IP address, and this file's
--     app_login() checks user + password. Super admins may sign in from anywhere, everybody else only from OFFICE_PUBLIC_IP.
--   * A successful login returns a random session token (only its SHA-256 hash is stored here). The app sends it with every
--     request in the header x-app-token; part 2 (13_lock_down.sql) makes every table policy require a valid token.
--   * Modules (the dashboard items): sales_confirmations, job_orders, recipe, tracking, deliveries.
--
-- After running this file set every password ONCE, e.g.:   select public.app_set_password('Mark', 'a-long-password');
-- (8 characters at least; the passwords are stored as bcrypt hashes, never as text.)
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- tables (nobody but the server-side functions can read them) ----------
create table if not exists public."tbl_app_user" (
  id             bigint generated always as identity primary key,
  username       text not null,
  display_name   text not null,
  is_super_admin boolean not null default false,
  modules        text[] not null default '{}',
  password_hash  text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);
create unique index if not exists uq_app_user_username on public."tbl_app_user" ((lower(username)));

create table if not exists public."tbl_app_session" (
  token_hash text primary key,
  user_id    bigint not null references public."tbl_app_user"(id) on delete cascade,
  ip         text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists ix_app_session_user on public."tbl_app_session"(user_id);

create table if not exists public."tbl_app_login_attempt" (
  id       bigint generated always as identity primary key,
  username text,
  ip       text,
  success  boolean not null,
  at       timestamptz not null default now()
);
create index if not exists ix_app_login_attempt on public."tbl_app_login_attempt"(lower(username), at);

alter table public."tbl_app_user" enable row level security;
alter table public."tbl_app_session" enable row level security;
alter table public."tbl_app_login_attempt" enable row level security;
revoke all on public."tbl_app_user", public."tbl_app_session", public."tbl_app_login_attempt" from anon, authenticated;

-- ---------- the people ----------
-- Charles, Susan: super admins (anywhere, every module).  Ana: every module.  Mark, Joyce, Arnel: every module except recipe.
-- Michelle: no module until you tell me what she may use (see the UPDATE at the bottom).
insert into public."tbl_app_user"(username, display_name, is_super_admin, modules) values
  ('Charles',  'Charles',  true,  '{sales_confirmations,job_orders,recipe,tracking,deliveries}'),
  ('Susan',    'Susan',    true,  '{sales_confirmations,job_orders,recipe,tracking,deliveries}'),
  ('Ana',      'Ana',      false, '{sales_confirmations,job_orders,recipe,tracking,deliveries}'),
  ('Mark',     'Mark',     false, '{sales_confirmations,job_orders,tracking,deliveries}'),
  ('Joyce',    'Joyce',    false, '{sales_confirmations,job_orders,tracking,deliveries}'),
  ('Arnel',    'Arnel',    false, '{sales_confirmations,job_orders,tracking,deliveries}'),
  ('Michelle', 'Michelle', false, '{}')
on conflict ((lower(username))) do nothing;

-- ---------- helpers ----------
create or replace function public.app_norm_ip(p text)
returns text language sql immutable as $$
  select nullif(regexp_replace(lower(btrim(coalesce(p, ''))), '^::ffff:', ''), '')
$$;

create or replace function public.app_user_json(u public."tbl_app_user")
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'id', u.id, 'username', u.username, 'display_name', u.display_name, 'is_super_admin', u.is_super_admin,
    'modules', case when u.is_super_admin
                    then to_jsonb(array['sales_confirmations','job_orders','recipe','tracking','deliveries'])
                    else to_jsonb(u.modules) end)
$$;

-- the session token the app sends in the x-app-token header
create or replace function public.app_token()
returns text language sql stable as $$
  select nullif(nullif(current_setting('request.headers', true), '')::json ->> 'x-app-token', '')
$$;

-- Does the caller hold a valid session (and, when a module is given, may the user use it)? Used by every table policy.
create or replace function public.app_can(p_module text default null)
returns boolean
language sql stable security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public."tbl_app_session" s
    join public."tbl_app_user" u on u.id = s.user_id
    where s.token_hash = encode(digest(coalesce(public.app_token(), ''), 'sha256'), 'hex')
      and s.expires_at > now()
      and u.is_active
      and (p_module is null or u.is_super_admin or p_module = any (u.modules))
  )
$$;

-- ---------- administration (run by you in the SQL Editor; not callable from the app) ----------
create or replace function public.app_set_password(p_username text, p_password text)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if length(coalesce(p_password, '')) < 8 then raise exception 'The password needs at least 8 characters.'; end if;
  update public."tbl_app_user" set password_hash = crypt(p_password, gen_salt('bf', 10)) where lower(username) = lower(btrim(p_username));
  if not found then raise exception 'No user named %.', p_username; end if;
  delete from public."tbl_app_session" where user_id = (select id from public."tbl_app_user" where lower(username) = lower(btrim(p_username)));
end $$;

-- ---------- login (called only by the Edge Function, with the service role) ----------
create or replace function public.app_login(p_username text, p_password text, p_ip text, p_office_ip text, p_hours int default 12)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  u public."tbl_app_user";
  fails int;
  tok text;
  ip text := public.app_norm_ip(p_ip);
  office text := public.app_norm_ip(p_office_ip);
begin
  delete from public."tbl_app_login_attempt" where at < now() - interval '2 days';
  delete from public."tbl_app_session" where expires_at < now();

  -- 5 wrong passwords for the same user within 15 minutes lock that user for the rest of the 15 minutes
  select count(*) into fails from public."tbl_app_login_attempt"
   where lower(username) = lower(btrim(p_username)) and not success and at > now() - interval '15 minutes';
  if fails >= 5 then return jsonb_build_object('ok', false, 'code', 'locked'); end if;

  select * into u from public."tbl_app_user" where lower(username) = lower(btrim(p_username)) and is_active;
  if not found or u.password_hash is null or u.password_hash <> crypt(coalesce(p_password, ''), u.password_hash) then
    insert into public."tbl_app_login_attempt"(username, ip, success) values (btrim(p_username), ip, false);
    return jsonb_build_object('ok', false, 'code', 'bad_credentials');
  end if;

  -- the password is right: now the office rule (only super admins may sign in from outside)
  if not u.is_super_admin and (office is null or ip is distinct from office) then
    return jsonb_build_object('ok', false, 'code', 'outside_office');
  end if;

  tok := encode(gen_random_bytes(32), 'hex');
  insert into public."tbl_app_session"(token_hash, user_id, ip, expires_at)
  values (encode(digest(tok, 'sha256'), 'hex'), u.id, ip, now() + make_interval(hours => p_hours));
  insert into public."tbl_app_login_attempt"(username, ip, success) values (u.username, ip, true);
  delete from public."tbl_app_login_attempt" where lower(username) = lower(u.username) and not success;

  return jsonb_build_object('ok', true, 'token', tok, 'expires_at', now() + make_interval(hours => p_hours), 'user', public.app_user_json(u));
end $$;

-- Is this token still good, for this IP? (called by the Edge Function when the app opens and every few minutes)
create or replace function public.app_verify(p_token text, p_ip text, p_office_ip text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  s public."tbl_app_session";
  u public."tbl_app_user";
  ip text := public.app_norm_ip(p_ip);
  office text := public.app_norm_ip(p_office_ip);
begin
  select * into s from public."tbl_app_session"
   where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and expires_at > now();
  if not found then return jsonb_build_object('ok', false, 'code', 'expired'); end if;
  select * into u from public."tbl_app_user" where id = s.user_id and is_active;
  if not found then
    delete from public."tbl_app_session" where token_hash = s.token_hash;
    return jsonb_build_object('ok', false, 'code', 'expired');
  end if;
  if not u.is_super_admin and (office is null or ip is distinct from office) then
    delete from public."tbl_app_session" where token_hash = s.token_hash; -- left the office: the session ends
    return jsonb_build_object('ok', false, 'code', 'outside_office');
  end if;
  return jsonb_build_object('ok', true, 'user', public.app_user_json(u));
end $$;

-- ---------- called by the signed-in app itself ----------
create or replace function public.app_logout()
returns void
language sql security definer
set search_path = public, extensions
as $$
  delete from public."tbl_app_session" where token_hash = encode(digest(coalesce(public.app_token(), ''), 'sha256'), 'hex')
$$;

create or replace function public.app_change_password(p_old text, p_new text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  s public."tbl_app_session";
  u public."tbl_app_user";
begin
  select * into s from public."tbl_app_session"
   where token_hash = encode(digest(coalesce(public.app_token(), ''), 'sha256'), 'hex') and expires_at > now();
  if not found then return jsonb_build_object('ok', false, 'code', 'expired'); end if;
  select * into u from public."tbl_app_user" where id = s.user_id and is_active;
  if not found or u.password_hash is null or u.password_hash <> crypt(coalesce(p_old, ''), u.password_hash) then
    return jsonb_build_object('ok', false, 'code', 'bad_credentials');
  end if;
  if length(coalesce(p_new, '')) < 8 then return jsonb_build_object('ok', false, 'code', 'too_short'); end if;
  update public."tbl_app_user" set password_hash = crypt(p_new, gen_salt('bf', 10)) where id = u.id;
  delete from public."tbl_app_session" where user_id = u.id and token_hash <> s.token_hash; -- other devices sign in again
  return jsonb_build_object('ok', true);
end $$;

-- ---------- who may call what ----------
revoke execute on function public.app_set_password(text, text) from public, anon, authenticated;
revoke execute on function public.app_login(text, text, text, text, int) from public, anon, authenticated;
revoke execute on function public.app_verify(text, text, text) from public, anon, authenticated;
grant  execute on function public.app_login(text, text, text, text, int) to service_role;
grant  execute on function public.app_verify(text, text, text) to service_role;
grant  execute on function public.app_can(text) to anon, authenticated;
grant  execute on function public.app_logout() to anon, authenticated;
grant  execute on function public.app_change_password(text, text) to anon, authenticated;

-- =====================================================================
-- To DO after this file (one line per person, run them here, then keep the passwords out of chat and files):
--   select public.app_set_password('Charles',  '...');   select public.app_set_password('Susan', '...');
--   select public.app_set_password('Ana',      '...');   select public.app_set_password('Mark',  '...');
--   select public.app_set_password('Joyce',    '...');   select public.app_set_password('Arnel', '...');
--   select public.app_set_password('Michelle', '...');
-- Give Michelle modules when you know them, for example:
--   update public."tbl_app_user" set modules = '{sales_confirmations,job_orders,tracking,deliveries}' where username = 'Michelle';
-- Switch someone off:  update public."tbl_app_user" set is_active = false where username = 'Mark';
-- =====================================================================
