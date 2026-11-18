-- v5.1: Shadow Alleys, EMP fog, scent trails
alter table zr_tiles add column if not exists alleys boolean default false;
alter table zr_zones add column if not exists heading float8;
create table if not exists zr_trail (owner uuid not null, slot int not null, lat float8, lng float8, at timestamptz default now(), primary key (owner, slot));
alter table zr_trail enable row level security;
create index if not exists zr_trail_at on zr_trail(at);
create index if not exists zr_zones_kind on zr_zones(kind, until);

-- OSM seeding: loot caches (park/shop/road) + Shadow Alleys (service=alley near businesses)
create or replace function zr_seed(p_id uuid, p_secret text, p_tile text, p_pts jsonb) returns json
language plpgsql security definer set search_path to public as $$
declare me zr_players; parts text[]; la int; lo int; p jsonb; plat float8; plng float8; vn int := 0; an int := 0; k text; tier text;
  tl zr_tiles; do_c boolean := false; do_a boolean;
begin
  me := zr_me(p_id, p_secret);
  if p_tile !~ '^-?[0-9]+:-?[0-9]+$' then return json_build_object('error', 'bad_tile'); end if;
  parts := string_to_array(p_tile, ':'); la := parts[1]::int; lo := parts[2]::int;
  if me.lat is null or abs(floor(me.lat * 100) - la) > 2 or abs(floor(me.lng * 100) - lo) > 2 then return json_build_object('error', 'too_far'); end if;
  if jsonb_typeof(p_pts) <> 'array' or jsonb_array_length(p_pts) = 0 then return json_build_object('error', 'empty'); end if;
  select * into tl from zr_tiles where tile = p_tile for update;
  if tl.tile is null then
    insert into zr_tiles(tile) values (p_tile) on conflict (tile) do nothing;
    select * into tl from zr_tiles where tile = p_tile for update;
    do_c := true;
  else
    do_c := tl.n = 0 and tl.seeded_at < now() - interval '1 hour';
  end if;
  do_a := not coalesce(tl.alleys, false);
  if not do_c and not do_a then return json_build_object('result', 'already'); end if;
  if do_c then
    update zr_tiles set seeded_at = now() where tile = p_tile;
    for p in select value from jsonb_array_elements(p_pts) limit 400 loop
      exit when vn >= 14;
      plat := (p->>'lat')::float8; plng := (p->>'lng')::float8; k := p->>'k';
      continue when plat is null or plng is null or k is null or k not in ('park', 'shop', 'road');
      continue when floor(plat * 100) <> la or floor(plng * 100) <> lo;
      continue when exists (select 1 from zr_caches c where c.tile = p_tile and zr_dist(c.lat, c.lng, plat, plng) < 110);
      tier := case when random() < 0.08 then 'military' when k = 'shop' and random() < 0.35 then 'hunting'
                   when k = 'park' and random() < 0.2 then 'hunting' else 'common' end;
      insert into zr_caches(tile, lat, lng, kind, tier) values (p_tile, plat, plng, k, tier);
      vn := vn + 1;
    end loop;
    update zr_tiles set n = vn where tile = p_tile;
  end if;
  if do_a then
    for p in select value from jsonb_array_elements(p_pts) e where e.value->>'k' = 'alley' limit 200 loop
      exit when an >= 4;
      plat := (p->>'lat')::float8; plng := (p->>'lng')::float8;
      continue when plat is null or plng is null or floor(plat * 100) <> la or floor(plng * 100) <> lo;
      -- commercial alleys only: must sit within 120 m of a business
      continue when not exists (select 1 from jsonb_array_elements(p_pts) s where s.value->>'k' = 'shop'
                                and zr_dist((s.value->>'lat')::float8, (s.value->>'lng')::float8, plat, plng) <= 120);
      continue when exists (select 1 from zr_zones z where z.kind = 'shadow' and z.until > now() and abs(z.lat - plat) < 0.003 and abs(z.lng - plng) < 0.004
                            and zr_dist(z.lat, z.lng, plat, plng) < 150);
      insert into zr_zones(kind, lat, lng, r0, r1, until) values ('shadow', plat, plng, 30, 30, now() + interval '5 years');
      an := an + 1;
    end loop;
    update zr_tiles set alleys = true where tile = p_tile;
  end if;
  return json_build_object('result', 'seeded', 'n', vn, 'alleys', an);
end $$;

-- world events: supply crates, radiation, CDC labs + drifting EMP fog
create or replace function zr_events_tick() returns void
language plpgsql security definer set search_path to public as $$
declare r record; c record;
begin
  update zr_zones set lat = lat + 70 * cos(heading) / 111320.0, lng = lng + 70 * sin(heading) / (111320.0 * cos(radians(lat))),
    heading = heading + (random() - 0.5) * 0.5
  where kind = 'emp' and until > now();
  for r in select id, lat, lng from zr_players where not is_npc and lat is not null and last_seen > now() - interval '10 minutes' loop
    if not exists (select 1 from zr_supply s where s.announced > now() - interval '90 minutes' and zr_dist(s.lat, s.lng, r.lat, r.lng) <= 3000) then
      select * into c from zr_caches k where abs(k.lat - r.lat) < 0.02 and abs(k.lng - r.lng) < 0.025
        and zr_dist(k.lat, k.lng, r.lat, r.lng) between 300 and 1500 order by random() limit 1;
      if found then insert into zr_supply(lat, lng, lands_at, until) values (c.lat, c.lng, now() + interval '10 minutes', now() + interval '40 minutes'); end if;
    end if;
    if random() < 0.35 and not exists (select 1 from zr_zones z where z.kind = 'radiation' and z.until > now() and zr_dist(z.lat, z.lng, r.lat, r.lng) <= 3000) then
      select * into c from zr_caches k where k.kind = 'park' and abs(k.lat - r.lat) < 0.02 and abs(k.lng - r.lng) < 0.025
        and zr_dist(k.lat, k.lng, r.lat, r.lng) between 300 and 1500 order by random() limit 1;
      if found then insert into zr_zones(kind, lat, lng, r0, r1, until) values ('radiation', c.lat, c.lng, 50, 160, now() + interval '45 minutes'); end if;
    end if;
    if not exists (select 1 from zr_zones z where z.kind = 'cdc' and z.until > now() and zr_dist(z.lat, z.lng, r.lat, r.lng) <= 3000) then
      select * into c from zr_caches k where k.kind = 'shop' and abs(k.lat - r.lat) < 0.025 and abs(k.lng - r.lng) < 0.03
        and zr_dist(k.lat, k.lng, r.lat, r.lng) between 400 and 2000 order by random() limit 1;
      if found then insert into zr_zones(kind, lat, lng, r0, r1, until) values ('cdc', c.lat, c.lng, 35, 35, now() + interval '2 hours'); end if;
    end if;
    if random() < 0.25 and not exists (select 1 from zr_zones z where z.kind = 'emp' and z.until > now() and zr_dist(z.lat, z.lng, r.lat, r.lng) <= 3000) then
      select * into c from zr_caches k where abs(k.lat - r.lat) < 0.02 and abs(k.lng - r.lng) < 0.025
        and zr_dist(k.lat, k.lng, r.lat, r.lng) between 300 and 1200 order by random() limit 1;
      if found then insert into zr_zones(kind, lat, lng, r0, r1, until, heading)
        values ('emp', c.lat, c.lng, 120, 320, now() + interval '30 minutes', random() * 2 * pi()); end if;
    end if;
  end loop;
end $$;

-- heartbeat v6 = v5 + shadow alleys, EMP fog, scent trails, alley seeding
create or replace function zr_hb6(p_id uuid, p_secret text, p_lat float8, p_lng float8, p_acc float8, p_tz int,
  p_since timestamptz default null, p_speed float8 default null) returns json
language plpgsql security definer set search_path to public as $$
declare r jsonb; me zr_players; mv record; dla float8; dln float8; lamp boolean; nvg boolean; emp boolean := false; shadow boolean := false;
  rad float8; v_others jsonb; v_zones jsonb; v_trails jsonb := '[]'; v_seed jsonb; ci int; cj int; v_slot int;
begin
  r := zr_hb5(p_id, p_secret, p_lat, p_lng, p_acc, p_tz, p_since, p_speed)::jsonb;
  select * into me from zr_players where id = p_id;
  if me.lat is null then return (r || '{"trails":[]}'::jsonb)::json; end if;
  select * into mv from zr_vpos(me); dla := mv.vlat - me.lat; dln := mv.vlng - me.lng;
  v_others := coalesce(r->'others', '[]'::jsonb);
  lamp := me.state = 'human' and coalesce(me.headlamp_on, false) and me.gear->'head'->>'t' = 'headlamp' and coalesce((me.gear->'head'->>'b')::float8, 0) > 0;
  nvg := me.state = 'human' and coalesce(me.nvg_on, false) and me.gear->'head'->>'t' = 'nvg' and coalesce((me.gear->'head'->>'b')::float8, 0) > 0;
  emp := exists (select 1 from zr_zones z where z.kind = 'emp' and z.until > now() and abs(z.lat - me.lat) < 0.01 and zr_dist(me.lat, me.lng, z.lat, z.lng) <= zr_zone_r(z));
  shadow := exists (select 1 from zr_zones z where z.kind = 'shadow' and z.until > now() and abs(z.lat - me.lat) < 0.001 and zr_dist(me.lat, me.lng, z.lat, z.lng) <= z.r0);

  if me.state = 'human' then
    rad := (case when lamp or me.boost_until > now() then 200 else 100 end) * 0.25;
    select coalesce(jsonb_agg(o), '[]'::jsonb) into v_others from jsonb_array_elements(v_others) o
    where (o->>'state') <> 'zombie' or not (
      (not lamp
        and exists (select 1 from zr_players q join zr_zones z on z.kind = 'shadow' and z.until > now()
                    and abs(z.lat - q.lat) < 0.001 and abs(z.lng - q.lng) < 0.0012 and zr_dist(q.lat, q.lng, z.lat, z.lng) <= z.r0
                    where q.id = (o->>'id')::uuid)
        and not exists (select 1 from zr_mines f where f.owner = p_id and f.kind = 'flare' and f.until > now()
                    and zr_dist(f.lat - dla, f.lng - dln, (o->>'lat')::float8, (o->>'lng')::float8) <= 20))
      or (emp and not nvg and (o->>'dist')::float8 > rad));
    if emp and not nvg then
      select coalesce(jsonb_agg(case when o->>'state' = 'zombie' then o || '{"close":false}'::jsonb else o end), '[]'::jsonb) into v_others
        from jsonb_array_elements(v_others) o;
    end if;
    -- bleeding: infected, or attacked in the last 2 minutes -> leave a scent trail (scent-blocker hides it)
    if coalesce(me.paused_until, now()) <= now() and not coalesce(me.was_sheltered, false) and coalesce(me.disguised_until, now()) <= now()
       and (me.inf_left is not null or exists (select 1 from zr_events e where e.target = p_id and e.kind in ('bite_warning', 'interrupted')
                                               and e.at > now() - interval '2 minutes')) then
      v_slot := (floor(extract(epoch from now()) / 12))::int % 10;
      insert into zr_trail(owner, slot, lat, lng, at) values (p_id, v_slot, mv.vlat, mv.vlng, now())
        on conflict (owner, slot) do update set lat = excluded.lat, lng = excluded.lng, at = excluded.at;
    end if;
  else
    select coalesce(jsonb_agg(jsonb_build_object('id', t.owner, 'pts', t.pts)), '[]'::jsonb) into v_trails from (
      select tr.owner, jsonb_agg(jsonb_build_array(tr.lat - dla, tr.lng - dln, extract(epoch from now() - tr.at)::int) order by tr.at) as pts
      from zr_trail tr
      where tr.at > now() - interval '2 minutes' and tr.owner <> p_id and abs(tr.lat - mv.vlat) < 0.005 and abs(tr.lng - mv.vlng) < 0.006
        and zr_dist(tr.lat, tr.lng, mv.vlat, mv.vlng) <= 400 and not zr_blocked(p_id, tr.owner)
      group by tr.owner) t;
  end if;

  select coalesce(jsonb_agg(z), '[]'::jsonb) into v_zones from jsonb_array_elements(coalesce(r->'zones', '[]'::jsonb)) z
    where z->>'kind' <> 'shadow' or (z->>'dist')::float8 <= 700;
  ci := floor(me.lat * 100); cj := floor(me.lng * 100);
  select coalesce(jsonb_agg(tk), '[]'::jsonb) into v_seed from (
    select (ci + a) || ':' || (cj + b) as tk from generate_series(-1, 1) a cross join generate_series(-1, 1) b
    where not exists (select 1 from zr_tiles t where t.tile = (ci + a) || ':' || (cj + b) and coalesce(t.alleys, false)
                      and (t.n > 0 or t.seeded_at > now() - interval '1 hour'))
    order by abs(a) + abs(b) limit 2) s;
  r := jsonb_set(r, '{me}', (r->'me') || jsonb_build_object('in_emp', emp and me.state = 'human', 'emp_nvg', nvg, 'in_shadow', shadow));
  return (r || jsonb_build_object('others', v_others, 'zones', v_zones, 'trails', v_trails, 'seed', v_seed))::json;
end $$;
grant execute on function zr_hb6(uuid, text, float8, float8, float8, int, timestamptz, float8) to anon, authenticated;

-- World tab: hide permanent Shadow Alleys from events
create or replace function zr_world(p_id uuid, p_secret text) returns json
language plpgsql security definer set search_path to public as $$
declare me zr_players; v json; s0 timestamptz;
begin
  me := zr_me(p_id, p_secret);
  select starts_at into s0 from zr_seasons where id = me.season_id;
  select json_build_object(
    'round', (select json_build_object('n', r.n, 'starts_at', r.starts_at, 'ends_at', r.ends_at) from zr_rounds r
              where now() >= r.starts_at and now() < r.ends_at order by r.id desc limit 1),
    'season', (select json_build_object('name', s.name, 'ends_at', s.ends_at) from zr_seasons s where s.id = me.season_id),
    'bunker_lock', greatest(0, extract(epoch from coalesce(me.bunker_lock_until, now()) - now()))::int,
    'crates', (select coalesce(json_agg(json_build_object('id', 'd:' || s.id, 'lat', s.lat, 'lng', s.lng,
               'lands', greatest(0, extract(epoch from s.lands_at - now()))::int, 'left', greatest(0, extract(epoch from s.until - now()))::int,
               'dist', round(zr_dist(me.lat, me.lng, s.lat, s.lng)), 'dir', zr_dir(me.lat, me.lng, s.lat, s.lng)) order by s.lands_at), '[]'::json)
              from zr_supply s where s.until > now() and me.lat is not null and zr_dist(me.lat, me.lng, s.lat, s.lng) <= 5000),
    'zones', (select coalesce(json_agg(json_build_object('kind', z.kind, 'lat', z.lat, 'lng', z.lng, 'r', round(zr_zone_r(z)),
               'left', greatest(0, extract(epoch from z.until - now()))::int, 'dist', round(zr_dist(me.lat, me.lng, z.lat, z.lng)),
               'dir', zr_dir(me.lat, me.lng, z.lat, z.lng))), '[]'::json)
              from zr_zones z where z.until > now() and z.kind <> 'shadow' and me.lat is not null and zr_dist(me.lat, me.lng, z.lat, z.lng) <= 5000),
    'feed', (select coalesce(json_agg(f), '[]'::json) from (
               select pg.kind, zr_dir(me.lat, me.lng, pg.lat, pg.lng) as dir, round(zr_dist(me.lat, me.lng, pg.lat, pg.lng)) as dist,
                 extract(epoch from now() - pg.at)::int as ago
               from zr_pings pg where pg.at > now() - interval '20 minutes' and pg.radius >= 150 and me.lat is not null
                 and zr_dist(me.lat, me.lng, pg.lat, pg.lng) <= 4000 order by pg.at desc limit 5) f),
    'humans', (select count(*) from zr_players q where q.state = 'human' and zr_present(q) and me.lat is not null
               and abs(q.lat - me.lat) < 0.05 and abs(q.lng - me.lng) < 0.06),
    'zombies', (select count(*) from zr_players q where q.state = 'zombie' and zr_present(q) and me.lat is not null
               and abs(q.lat - me.lat) < 0.05 and abs(q.lng - me.lng) < 0.06),
    'surv', (select coalesce(json_agg(x), '[]'::json) from (select handle, extract(epoch from now() - coalesce(human_since, created_at))::int as v
               from zr_players where not is_npc and state = 'human' and season_id = me.season_id and last_seen > now() - interval '7 days'
               order by 2 desc limit 3) x),
    'kills', (select coalesce(json_agg(x), '[]'::json) from (select p.handle, count(*) as v from zr_events e join zr_players p on p.id = e.actor
               where e.kind = 'killed' and e.at >= coalesce(s0, now() - interval '84 days') and not p.is_npc
               group by p.handle order by 2 desc limit 3) x),
    'alpha', (select coalesce(json_agg(x), '[]'::json) from (select handle, infections as v from zr_players
               where not is_npc and season_id = me.season_id and infections > 0 order by infections desc limit 3) x)
  ) into v;
  return v;
end $$;

