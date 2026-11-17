-- v3: human HP + scratch, zombie scream hotzones, bunker, regen, standings & leaderboard
alter table zr_players
  add column if not exists bunker_lat float8, add column if not exists bunker_lng float8,
  add column if not exists bunker_ready timestamptz, add column if not exists hp_acc float8 default 0,
  add column if not exists regen_at timestamptz, add column if not exists last_scratch timestamptz,
  add column if not exists last_scream timestamptz, add column if not exists human_since timestamptz,
  add column if not exists longest_human int default 0, add column if not exists turned_n int default 0;

create table if not exists zr_hotzones (
  id bigserial primary key, owner uuid references zr_players(id), lat float8, lng float8,
  radius float8 default 100, created timestamptz default now(), until timestamptz);
alter table zr_hotzones enable row level security;
create index if not exists zr_hotzones_until on zr_hotzones(until);

alter table zr_items add column if not exists rarity text default 'industrial';
update zr_items set rarity = case
  when t in ('rifle','carbine','plate','claymore','nvg','kevlar','rucksack','drone') then 'covert'
  when t in ('shotgun','bow','antiviral','moto','cryocase','stungun','hiking') then 'classified'
  when t in ('crowbar','ghillie','hardhat','radio','epipen','bearspray','scentspray','powerbank') then 'restricted'
  when t in ('bat','denim','bikehelmet','respirator','headlamp','maglite','pills','roadflare','fanny') then 'milspec'
  else 'industrial' end;

-- track survival streaks and turn counts
create or replace function zr_state_trg() returns trigger language plpgsql as $$
begin
  if new.state is distinct from old.state then
    if new.state = 'zombie' then
      new.longest_human := greatest(coalesce(old.longest_human, 0),
        extract(epoch from now() - coalesce(old.human_since, old.created_at))::int);
      new.turned_n := coalesce(old.turned_n, 0) + 1;
    elsif new.state = 'human' then
      new.human_since := now();
    end if;
  end if;
  return new;
end $$;
create or replace trigger zr_state before update of state on zr_players
  for each row execute function zr_state_trg();

create or replace function zr_in_bunker(p zr_players) returns boolean language sql stable as $$
  select p.state = 'human' and p.bunker_ready is not null and p.bunker_ready <= now() and p.lat is not null
     and zr_dist(p.lat, p.lng, p.bunker_lat, p.bunker_lng) <= 30
$$;

-- bite/scratch validity: adds bunker safe zone
create or replace function zr_bite_check(me zr_players, t zr_players) returns text
language plpgsql stable security definer set search_path to public as $$
declare d float8; grp int;
begin
  if me.state <> 'zombie' then return 'not_zombie'; end if;
  if me.down_until > now() then return 'down'; end if;
  if me.stunned_until > now() then return 'stunned'; end if;
  if me.blinded_until > now() then return 'blinded'; end if;
  if me.fix_at is null or me.fix_at < now() - interval '20 seconds' or me.acc > 35 then return 'weak_gps'; end if;
  if t.id is null or t.state <> 'human' or t.inf_left is not null then return 'not_target'; end if;
  if t.disguised_until > now() then return 'not_target'; end if;
  if zr_blocked(me.id, t.id) then return 'not_target'; end if;
  if t.last_seen < now() - interval '20 seconds' or t.fix_at < now() - interval '20 seconds' or t.acc > 35 then return 'target_gps'; end if;
  if t.was_sheltered then return 'sheltered'; end if;
  if zr_in_bunker(t) then return 'bunker'; end if;
  d := zr_dist(me.lat, me.lng, t.lat, t.lng);
  if d > (case when t.exposed_until > now() then 45.72 else 15.24 end) + 3 then return 'too_far'; end if;
  select count(*) into grp from zr_players g
  where g.state = 'human' and g.inf_left is null and g.lat is not null
    and g.last_seen > now() - interval '20 seconds' and not g.was_sheltered
    and zr_dist(g.lat, g.lng, t.lat, t.lng) <= 15.24;
  if grp >= 3 then return 'group'; end if;
  return null;
end $$;

-- cure: an infected human cured keeps at least 25 HP
create or replace function zr_cure(p_target uuid, p_actor uuid) returns text
language plpgsql security definer set search_path to public as $$
declare t zr_players; g jsonb := '{}'::jsonb;
begin
  select * into t from zr_players where id = p_target for update;
  if t.state = 'zombie' then
    if t.z_head is not null then g := g || jsonb_build_object('head', t.z_head || jsonb_build_object('id', substr(md5(random()::text), 1, 8))); end if;
    if t.z_armor is not null then g := g || jsonb_build_object('armor', t.z_armor || jsonb_build_object('id', substr(md5(random()::text), 1, 8))); end if;
    update zr_players set state = 'human', hp = 100, down_until = null, stunned_until = null, blinded_until = null,
      z_head = null, z_armor = null, gear = g, supplies = 100, bite_target = null, bite_started = null,
      infected_by = null, exposed_until = null where id = p_target;
  elsif t.inf_left is not null then
    update zr_players set inf_left = null, inf_tick = null, infected_at = null, infected_by = null,
      cryo_until = null, epi_until = null, hp = greatest(hp, 25) where id = p_target;
  else
    return 'not_infected';
  end if;
  insert into zr_events(kind, actor, target, info)
    values ('cured', p_actor, p_target, jsonb_build_object('was', case when t.state = 'zombie' then 'zombie' else 'infected' end));
  if t.infected_by is not null then
    insert into zr_events(kind, actor, target, info) values ('lost_victim', p_target, t.infected_by, '{}'::jsonb);
  end if;
  if p_actor <> p_target then update zr_players set cures = cures + 1, points = points + 10 where id = p_actor; end if;
  return 'cured';
end $$;

-- heartbeat wrapper: regen + bunker + hotzones + cooldowns
create or replace function zr_hb3(p_id uuid, p_secret text, p_lat float8, p_lng float8, p_acc float8, p_tz int,
  p_since timestamptz default null, p_speed float8 default null) returns json
language plpgsql security definer set search_path to public as $$
declare me zr_players; v jsonb; el float8; rate float8 := 0; inb boolean; night boolean; v_acc float8; addn int; hz jsonb; lh int;
begin
  v := zr_heartbeat(p_id, p_secret, p_lat, p_lng, p_acc, p_tz, p_since, p_speed)::jsonb;
  select * into me from zr_players where id = p_id;
  inb := zr_in_bunker(me);
  lh := zr_local_hour(coalesce(me.tz_offset, 0));
  night := lh >= 20 or lh < 6;
  if me.state = 'human' and inb then rate := 5;
  elsif me.state = 'zombie' and night and coalesce(me.down_until, now()) <= now() then rate := 1; end if;
  el := least(60, greatest(0, extract(epoch from now() - coalesce(me.regen_at, now()))));
  if rate > 0 and me.hp < 100 then
    v_acc := coalesce(me.hp_acc, 0) + rate * el / 60.0;
    addn := floor(v_acc)::int;
    update zr_players set hp = least(100, hp + addn),
      hp_acc = case when hp + addn >= 100 then 0 else v_acc - addn end, regen_at = now()
    where id = p_id returning * into me;
  else
    update zr_players set regen_at = now(), hp_acc = 0 where id = p_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'lat', h.lat, 'lng', h.lng, 'radius', h.radius,
           'mine', h.owner = p_id, 'handle', (select handle from zr_players where id = h.owner),
           'left', greatest(0, extract(epoch from h.until - now()))::int,
           'dist', round(zr_dist(me.lat, me.lng, h.lat, h.lng)))), '[]'::jsonb)
    into hz from zr_hotzones h
   where h.until > now() and me.lat is not null and zr_dist(me.lat, me.lng, h.lat, h.lng) <= 2000
     and not zr_blocked(p_id, h.owner);

  v := jsonb_set(v, '{hotzones}', hz);
  v := jsonb_set(v, '{me}', (v->'me') || jsonb_build_object(
    'hp', me.hp,
    'regen', case when me.hp < 100 then rate else 0 end,
    'night', night, 'in_bunker', inb,
    'bunker', case when me.bunker_lat is null then null else jsonb_build_object(
        'lat', me.bunker_lat, 'lng', me.bunker_lng,
        'ready', greatest(0, extract(epoch from me.bunker_ready - now()))::int,
        'dist', round(zr_dist(me.lat, me.lng, me.bunker_lat, me.bunker_lng))) end,
    'scratch_cd', greatest(0, 2.5 - extract(epoch from now() - coalesce(me.last_scratch, 'epoch'::timestamptz))),
    'scream_cd', greatest(0, 30 - extract(epoch from now() - coalesce(me.last_scream, 'epoch'::timestamptz))),
    'sc', me.points));
  return v::json;
end $$;

-- zombie scratch: quick melee, armor absorbs first; 0 HP = infected
create or replace function zr_scratch(p_id uuid, p_secret text, p_target uuid) returns json
language plpgsql security definer set search_path to public as $$
declare me zr_players; t zr_players; why text; dmg constant int := 15; rem int; g jsonb; k text; d int; ab int;
  broke text[] := '{}'; infected boolean := false;
begin
  me := zr_me(p_id, p_secret);
  perform zr_tick_world();
  select * into me from zr_players where id = p_id;
  if me.last_scratch > now() - interval '2.3 seconds' then return json_build_object('error', 'cooldown'); end if;
  select * into t from zr_players where id = p_target for update;
  why := zr_bite_check(me, t);
  if why is not null then return json_build_object('error', why); end if;
  update zr_players set last_scratch = now() where id = p_id;
  g := coalesce(t.gear, '{}'::jsonb); rem := dmg;
  foreach k in array array['armor', 'head'] loop
    if rem > 0 and zr_live(g->k) and (g->k->>'d') is not null then
      d := (g->k->>'d')::int; ab := least(d, rem); rem := rem - ab;
      g := jsonb_set(g, array[k], (g->k) || jsonb_build_object('d', d - ab));
      if d - ab <= 0 then broke := broke || (g->k->>'t'); end if;
    end if;
  end loop;
  update zr_players set gear = g, hp = greatest(0, hp - rem) where id = t.id returning * into t;
  perform zr_ping(me.lat, me.lng, 30, 20, p_id, 'scratch');
  if t.hp <= 0 then
    update zr_players set inf_left = 300, inf_tick = now(), infected_at = now(), infected_by = p_id where id = t.id;
    update zr_players set points = points + 10, infections = infections + 1 where id = p_id;
    if me.infected_by is not null then
      update zr_players set points = points + 5 where id = me.infected_by;
      insert into zr_events(kind, actor, target, info) values ('bloodline', t.id, me.infected_by, jsonb_build_object('via', me.handle));
    end if;
    insert into zr_events(kind, actor, target, info) values ('bitten', p_id, t.id, jsonb_build_object('scratch', true));
    infected := true;
  else
    insert into zr_events(kind, actor, target, info)
      values ('scratched', p_id, t.id, jsonb_build_object('dmg', dmg, 'hp', t.hp, 'absorbed', dmg - rem, 'broke', to_jsonb(broke)));
  end if;
  return json_build_object('result', case when infected then 'infected' else 'hit' end, 'handle', t.handle,
    'hp', t.hp, 'absorbed', dmg - rem, 'broke', broke);
end $$;

-- zombie scream: 10-minute hotzone, heard 300 m by zombies, alerts humans within 400 m
create or replace function zr_scream(p_id uuid, p_secret text) returns json
language plpgsql security definer set search_path to public as $$
declare me zr_players;
begin
  me := zr_me(p_id, p_secret);
  if me.state <> 'zombie' then return json_build_object('error', 'not_zombie'); end if;
  if me.down_until > now() then return json_build_object('error', 'down'); end if;
  if me.stunned_until > now() then return json_build_object('error', 'stunned'); end if;
  if me.fix_at is null or me.fix_at < now() - interval '20 seconds' or me.acc > 35 then return json_build_object('error', 'weak_gps'); end if;
  if me.last_scream > now() - interval '29 seconds' then
    return json_build_object('error', 'cooldown', 'left', ceil(30 - extract(epoch from now() - me.last_scream)));
  end if;
  update zr_hotzones set until = now() where owner = p_id and until > now();
  insert into zr_hotzones(owner, lat, lng, radius, until) values (p_id, me.lat, me.lng, 100, now() + interval '10 minutes');
  update zr_players set last_scream = now() where id = p_id;
  perform zr_ping(me.lat, me.lng, 300, 30, p_id, 'scream');
  insert into zr_events(kind, actor, target, info)
  select 'scream_near', p_id, q.id, jsonb_build_object('dist', round(zr_dist(q.lat, q.lng, me.lat, me.lng)))
  from zr_players q
  where q.id <> p_id and q.lat is not null and q.last_seen > now() - interval '20 seconds' and not q.was_sheltered
    and zr_dist(q.lat, q.lng, me.lat, me.lng) <= 400 and not zr_blocked(p_id, q.id);
  return json_build_object('result', 'scream', 'secs', 600);
end $$;

-- bunker: set / rebuild / abandon. One per player, 10-minute build.
create or replace function zr_bunker(p_id uuid, p_secret text, p_action text) returns json
language plpgsql security definer set search_path to public as $$
declare me zr_players;
begin
  me := zr_me(p_id, p_secret);
  if p_action = 'abandon' then
    update zr_players set bunker_lat = null, bunker_lng = null, bunker_ready = null where id = p_id;
    return json_build_object('result', 'abandoned');
  end if;
  if p_action not in ('set', 'rebuild') then return json_build_object('error', 'bad_action'); end if;
  if me.state <> 'human' then return json_build_object('error', 'zombies_cant'); end if;
  if me.inf_left is not null then return json_build_object('error', 'infected'); end if;
  if me.exposed_until > now() then return json_build_object('error', 'exposed'); end if;
  if me.fix_at is null or me.fix_at < now() - interval '20 seconds' or me.acc > 35 then return json_build_object('error', 'weak_gps'); end if;
  if me.bunker_lat is not null and p_action = 'set' then return json_build_object('error', 'have_bunker'); end if;
  update zr_players set bunker_lat = me.lat, bunker_lng = me.lng, bunker_ready = now() + interval '10 minutes' where id = p_id;
  return json_build_object('result', 'building', 'secs', 600);
end $$;

create or replace function zr_standings(p_id uuid, p_secret text) returns json
language plpgsql security definer set search_path to public as $$
declare me zr_players; v json; bl int;
begin
  me := zr_me(p_id, p_secret);
  select count(*) into bl from zr_events where kind = 'bloodline' and target = p_id;
  select json_build_object(
    'sc', me.points,
    'rank', (select count(*) + 1 from zr_players q where q.season_id = me.season_id and q.points > me.points
              and me.lat is not null and q.lat is not null and zr_dist(q.lat, q.lng, me.lat, me.lng) <= 5000),
    'sector_n', (select count(*) from zr_players q where q.season_id = me.season_id
              and me.lat is not null and q.lat is not null and zr_dist(q.lat, q.lng, me.lat, me.lng) <= 5000),
    'horde', me.infections + bl, 'infected', me.infections, 'cures', me.cures,
    'total_horde', me.infections + bl,
    'longest', greatest(coalesce(me.longest_human, 0),
       case when me.state = 'human' then extract(epoch from now() - coalesce(me.human_since, me.created_at))::int else 0 end),
    'seasons', greatest(1, (select count(*) from zr_seasons s where s.ends_at >= me.created_at and s.starts_at <= now())),
    'kills', (select count(*) from zr_events where kind = 'killed' and actor = p_id),
    'deaths', coalesce(me.turned_n, 0) + (select count(*) from zr_events where kind = 'killed' and target = p_id),
    'season', (select json_build_object('name', name, 'ends_at', ends_at) from zr_seasons where id = me.season_id)
  ) into v;
  return v;
end $$;

create or replace function zr_board2(p_id uuid, p_secret text, p_filter text default 'all') returns json
language plpgsql security definer set search_path to public as $$
declare me zr_players; v json;
begin
  me := zr_me(p_id, p_secret);
  select json_build_object(
    'rows', (select coalesce(json_agg(x), '[]'::json) from (
       select row_number() over (order by q.points desc, q.infections desc, q.cures desc) as rank,
         (q.id = p_id) as me, q.handle,
         case when q.state = 'zombie' then 'zombie' else 'human' end as faction,
         q.points, q.infections, q.cures,
         case when q.state = 'human' then extract(epoch from now() - coalesce(q.human_since, q.created_at))::int
              else coalesce(q.longest_human, 0) end as surv
       from zr_players q
       where q.season_id = me.season_id and q.last_seen > now() - interval '30 days'
         and (p_filter = 'all' or (p_filter = 'humans' and q.state = 'human') or (p_filter = 'zombies' and q.state = 'zombie'))
         and (q.id = p_id or not zr_blocked(p_id, q.id))
       order by q.points desc, q.infections desc, q.cures desc limit 25) x),
    'humans', (select count(*) from zr_players where season_id = me.season_id and state = 'human' and inf_left is null
               and last_seen > now() - interval '7 days'),
    'zombies_n', (select count(*) from zr_players where season_id = me.season_id and (state = 'zombie' or inf_left is not null)
               and last_seen > now() - interval '7 days')
  ) into v;
  return v;
end $$;

grant execute on function zr_hb3(uuid, text, float8, float8, float8, int, timestamptz, float8) to anon, authenticated;
grant execute on function zr_scratch(uuid, text, uuid) to anon, authenticated;
grant execute on function zr_scream(uuid, text) to anon, authenticated;
grant execute on function zr_bunker(uuid, text, text) to anon, authenticated;
grant execute on function zr_standings(uuid, text) to anon, authenticated;
grant execute on function zr_board2(uuid, text, text) to anon, authenticated;
update zr_players set human_since = coalesce(human_since, created_at) where state = 'human';

-- zombie: shred or drop remnant headgear/armor
create or replace function zr_shed(p_id uuid, p_secret text, p_slot text, p_drop boolean default false) returns json
language plpgsql security definer set search_path to public as $$
declare me zr_players; it jsonb;
begin
  me := zr_me(p_id, p_secret);
  if me.state <> 'zombie' then return json_build_object('error', 'not_zombie'); end if;
  if p_slot = 'head' then it := me.z_head; elsif p_slot = 'armor' then it := me.z_armor; else return json_build_object('error', 'bad_action'); end if;
  if it is null then return json_build_object('error', 'empty'); end if;
  if p_drop and me.lat is not null then
    perform zr_drop_bag(me.lat, me.lng, jsonb_build_array(it || jsonb_build_object('id', substr(md5(random()::text), 1, 8))), null);
  end if;
  if p_slot = 'head' then update zr_players set z_head = null where id = p_id;
  else update zr_players set z_armor = null where id = p_id; end if;
  return json_build_object('result', case when p_drop then 'dropped' else 'shredded' end);
end $$;
grant execute on function zr_shed(uuid, text, text, boolean) to anon, authenticated;
