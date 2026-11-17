-- v4: email/password accounts, 18+ verification, chosen home perimeter, terms acceptance
alter table zr_players
  add column if not exists email text, add column if not exists pw_hash text,
  add column if not exists gender text, add column if not exists adult_verified_at timestamptz,
  add column if not exists name_changed_at timestamptz, add column if not exists home_set_at timestamptz,
  add column if not exists terms_ver text, add column if not exists terms_at timestamptz,
  add column if not exists login_fails int default 0, add column if not exists login_lock_until timestamptz,
  add column if not exists onboarded_at timestamptz;
create unique index if not exists zr_players_email_lower on zr_players (lower(email)) where email is not null;
create unique index if not exists zr_players_handle_lower on zr_players (lower(handle));

create or replace function zr_pw_ok(p text) returns boolean language sql immutable as $$
  select p is not null and length(p) between 8 and 128 and p ~ '[A-Z]' and p ~ '[0-9]' $$;
create or replace function zr_email_ok(e text) returns boolean language sql immutable as $$
  select e is not null and length(e) <= 254 and e ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' $$;
create or replace function zr_name_ok(n text) returns boolean language sql immutable as $$
  select n is not null and n ~ '^[A-Za-z0-9_]{3,16}$' $$;

-- live availability checks for the sign-up form and settings
create or replace function zr_check(p_kind text, p_value text, p_id uuid default null) returns json
language plpgsql stable security definer set search_path to public as $$
begin
  if p_kind = 'email' then
    if not zr_email_ok(trim(p_value)) then return json_build_object('valid', false); end if;
    return json_build_object('valid', true, 'available',
      not exists (select 1 from zr_players where lower(email) = lower(trim(p_value)) and id is distinct from p_id));
  elsif p_kind = 'name' then
    if not zr_name_ok(p_value) then return json_build_object('valid', false); end if;
    return json_build_object('valid', true, 'available',
      not exists (select 1 from zr_players where lower(handle) = lower(p_value) and id is distinct from p_id));
  end if;
  return json_build_object('valid', false);
end $$;

-- create an account, or attach a login to an existing anonymous player (claim)
create or replace function zr_register(p_email text, p_password text, p_handle text, p_dob date, p_gender text,
  p_home_lat float8, p_home_lng float8, p_terms_ver text, p_claim_id uuid default null, p_claim_secret text default null)
returns json language plpgsql security definer set search_path to public, extensions as $$
declare v_id uuid; v_secret text; v_season int; me zr_players; e text := lower(trim(p_email));
begin
  if not zr_email_ok(e) then return json_build_object('error', 'bad_email'); end if;
  if not zr_pw_ok(p_password) then return json_build_object('error', 'weak_password'); end if;
  if not zr_name_ok(p_handle) then return json_build_object('error', 'bad_handle'); end if;
  if p_dob is null or p_dob > current_date or p_dob < date '1900-01-01' then return json_build_object('error', 'bad_dob'); end if;
  if extract(year from age(current_date, p_dob)) < 18 then return json_build_object('error', 'under_18'); end if;
  if p_gender not in ('male', 'female') then return json_build_object('error', 'bad_gender'); end if;
  if p_home_lat is null or p_home_lng is null or abs(p_home_lat) > 90 or abs(p_home_lng) > 180 then return json_build_object('error', 'bad_home'); end if;
  if p_terms_ver is null then return json_build_object('error', 'terms'); end if;
  if p_claim_id is not null then
    me := zr_me(p_claim_id, p_claim_secret);
    if me.email is not null then return json_build_object('error', 'already_claimed'); end if;
  end if;
  if exists (select 1 from zr_players where lower(email) = e) then return json_build_object('error', 'email_taken'); end if;
  if exists (select 1 from zr_players where lower(handle) = lower(p_handle) and id is distinct from p_claim_id) then
    return json_build_object('error', 'handle_taken'); end if;
  if p_claim_id is not null then
    update zr_players set email = e, pw_hash = crypt(p_password, gen_salt('bf', 10)), handle = p_handle,
      birth_year = extract(year from p_dob)::int, adult_verified_at = now(), gender = p_gender,
      home_lat = p_home_lat, home_lng = p_home_lng, home_set_at = now(), terms_ver = p_terms_ver, terms_at = now(),
      onboarded_at = now()
    where id = p_claim_id;
    return json_build_object('id', p_claim_id, 'secret', p_claim_secret, 'handle', p_handle);
  end if;
  select id into v_season from zr_seasons where now() between starts_at and ends_at order by id desc limit 1;
  v_secret := encode(gen_random_bytes(24), 'hex');
  insert into zr_players(handle, birth_year, secret, season_id, email, pw_hash, gender, adult_verified_at,
    home_lat, home_lng, home_set_at, terms_ver, terms_at, onboarded_at, human_since)
  values (p_handle, extract(year from p_dob)::int, v_secret, v_season, e, crypt(p_password, gen_salt('bf', 10)), p_gender, now(),
    p_home_lat, p_home_lng, now(), p_terms_ver, now(), now(), now())
  returning id into v_id;
  return json_build_object('id', v_id, 'secret', v_secret, 'handle', p_handle);
end $$;

-- sign in; 5 wrong passwords locks the account for 15 minutes
create or replace function zr_login(p_email text, p_password text) returns json
language plpgsql security definer set search_path to public, extensions as $$
declare me zr_players;
begin
  select * into me from zr_players where lower(email) = lower(trim(p_email));
  if not found then
    perform crypt(coalesce(p_password, ''), gen_salt('bf', 10));
    return json_build_object('error', 'bad_login');
  end if;
  if me.login_lock_until > now() then
    return json_build_object('error', 'locked', 'secs', ceil(extract(epoch from me.login_lock_until - now())));
  end if;
  if me.pw_hash is null or crypt(coalesce(p_password, ''), me.pw_hash) <> me.pw_hash then
    update zr_players set login_fails = coalesce(login_fails, 0) + 1,
      login_lock_until = case when coalesce(login_fails, 0) + 1 >= 5 then now() + interval '15 minutes' else login_lock_until end
    where id = me.id;
    update zr_players set login_fails = 0 where id = me.id and login_fails >= 5;
    return json_build_object('error', 'bad_login');
  end if;
  update zr_players set login_fails = 0, login_lock_until = null where id = me.id;
  return json_build_object('id', me.id, 'secret', me.secret, 'handle', me.handle, 'email', me.email,
    'gender', me.gender, 'home', me.home_lat is not null, 'terms_ver', me.terms_ver, 'terms_at', me.terms_at);
end $$;

create or replace function zr_account(p_id uuid, p_secret text) returns json
language plpgsql security definer set search_path to public as $$
declare me zr_players;
begin
  me := zr_me(p_id, p_secret);
  return json_build_object('email', me.email, 'handle', me.handle, 'gender', me.gender,
    'home', me.home_lat is not null, 'home_set_at', me.home_set_at, 'name_changed_at', me.name_changed_at,
    'terms_ver', me.terms_ver, 'terms_at', me.terms_at, 'onboarded', me.onboarded_at is not null);
end $$;

create or replace function zr_set_name(p_id uuid, p_secret text, p_name text) returns json
language plpgsql security definer set search_path to public as $$
declare me zr_players;
begin
  me := zr_me(p_id, p_secret);
  if not zr_name_ok(p_name) then return json_build_object('error', 'bad_handle'); end if;
  if lower(p_name) = lower(me.handle) and p_name = me.handle then return json_build_object('error', 'same_name'); end if;
  if me.name_changed_at > now() - interval '7 days' then
    return json_build_object('error', 'name_cooldown', 'secs', ceil(extract(epoch from me.name_changed_at + interval '7 days' - now())));
  end if;
  if exists (select 1 from zr_players where lower(handle) = lower(p_name) and id <> p_id) then return json_build_object('error', 'handle_taken'); end if;
  update zr_players set handle = p_name, name_changed_at = now() where id = p_id;
  return json_build_object('result', 'ok', 'handle', p_name);
end $$;

create or replace function zr_set_email(p_id uuid, p_secret text, p_email text, p_password text) returns json
language plpgsql security definer set search_path to public, extensions as $$
declare me zr_players; e text := lower(trim(p_email));
begin
  me := zr_me(p_id, p_secret);
  if me.pw_hash is null or crypt(coalesce(p_password, ''), me.pw_hash) <> me.pw_hash then return json_build_object('error', 'bad_password'); end if;
  if not zr_email_ok(e) then return json_build_object('error', 'bad_email'); end if;
  if exists (select 1 from zr_players where lower(email) = e and id <> p_id) then return json_build_object('error', 'email_taken'); end if;
  update zr_players set email = e where id = p_id;
  return json_build_object('result', 'ok', 'email', e);
end $$;

create or replace function zr_set_password(p_id uuid, p_secret text, p_old text, p_new text) returns json
language plpgsql security definer set search_path to public, extensions as $$
declare me zr_players;
begin
  me := zr_me(p_id, p_secret);
  if me.pw_hash is null or crypt(coalesce(p_old, ''), me.pw_hash) <> me.pw_hash then return json_build_object('error', 'bad_password'); end if;
  if not zr_pw_ok(p_new) then return json_build_object('error', 'weak_password'); end if;
  update zr_players set pw_hash = crypt(p_new, gen_salt('bf', 10)) where id = p_id;
  return json_build_object('result', 'ok');
end $$;

-- home stealth perimeter from a chosen point; 24-hour relocation cooldown after the first one
create or replace function zr_set_home2(p_id uuid, p_secret text, p_lat float8, p_lng float8) returns json
language plpgsql security definer set search_path to public as $$
declare me zr_players;
begin
  me := zr_me(p_id, p_secret);
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then return json_build_object('error', 'bad_home'); end if;
  if me.home_lat is not null and me.home_set_at > now() - interval '24 hours' then
    return json_build_object('error', 'home_cooldown', 'secs', ceil(extract(epoch from me.home_set_at + interval '24 hours' - now())));
  end if;
  update zr_players set home_lat = p_lat, home_lng = p_lng, home_set_at = now() where id = p_id;
  return json_build_object('result', 'ok');
end $$;

create or replace function zr_accept_terms(p_id uuid, p_secret text, p_ver text) returns json
language plpgsql security definer set search_path to public as $$
begin
  perform zr_me(p_id, p_secret);
  update zr_players set terms_ver = p_ver, terms_at = now() where id = p_id;
  return json_build_object('result', 'ok');
end $$;

-- anonymous joins are retired: everyone signs up with an account now
create or replace function zr_join(p_handle text, p_birth_year integer) returns json
language plpgsql security definer set search_path to public as $$
begin
  return json_build_object('error', 'update_app');
end $$;

grant execute on function zr_check(text, text, uuid) to anon, authenticated;
grant execute on function zr_register(text, text, text, date, text, float8, float8, text, uuid, text) to anon, authenticated;
grant execute on function zr_login(text, text) to anon, authenticated;
grant execute on function zr_account(uuid, text) to anon, authenticated;
grant execute on function zr_set_name(uuid, text, text) to anon, authenticated;
grant execute on function zr_set_email(uuid, text, text, text) to anon, authenticated;
grant execute on function zr_set_password(uuid, text, text, text) to anon, authenticated;
grant execute on function zr_set_home2(uuid, text, float8, float8) to anon, authenticated;
grant execute on function zr_accept_terms(uuid, text, text) to anon, authenticated;
