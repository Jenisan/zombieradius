-- v5 part C: world ticks, NPCs, rounds & seasons, supply crates, hazard zones, OSM loot seeding, heartbeat v5, world intel
create or replace function zr_claim(p_k text, p_secs float8) returns boolean
language plpgsql security definer set search_path to public as $$
declare n int;
begin
  insert into zr_world_state(k, v) values (p_k, now()) on conflict (k) do update set v = now()
    where zr_world_state.v < now() - make_interval(secs => p_secs);
  get diagnostics n = row_count;
  return n > 0;
end $$;

create or replace function zr_spawn_npc(p_kind text, p_lat float8, p_lng float8) returns uuid
language plpgsql security definer set search_path to public, extensions as $$
declare v_id uuid; nm text; s int;
begin
  nm := (case when p_kind = 'zombie' then (array['Shambler','Walker','Crawler','Lurker','Rotter','Biter'])[1 + floor(random() * 6)::int]
              else (array['Drifter','Scavenger','Straggler','Runner','Wanderer','Hiker'])[1 + floor(random() * 6)::int] end)
        || '-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 5));
  select id into s from zr_seasons where now() between starts_at and ends_at order by id desc limit 1;
  select id into v_id from zr_players where is_npc and not npc_active limit 1 for update skip locked;
  if v_id is null then
    insert into zr_players(handle, birth_year, secret, season_id, is_npc) values (nm, 1990, encode(gen_random_bytes(16), 'hex'), s, true) returning id into v_id;
  else
    update zr_players set handle = nm where id = v_id;
  end if;
  update zr_players set npc_active = true, state = p_kind, hp = 100, lat = p_lat, lng = p_lng, acc = 5, fix_at = now(), last_seen = now(),
    npc_seen_at = now(), npc_heading = random() * 2 * pi(), inf_left = null, inf_tick = null, infected_at = null,
    inf_pct = case when p_kind = 'zombie' then 100 else 0 end, inf_pct_at = now(),
    down_until = null, stunned_until = null, blinded_until = null, bite_target = null, bite_started = null, bite_lock_until = null,
    shriek_lock_until = null, gear = '{}'::jsonb, pack = '[]'::jsonb, bag = 'none', z_head = null, z_armor = null, was_sheltered = false,
    pz_checked = true, speed = 1, disguised_until = null, paused_until = null, infections = 0, cures = 0, points = 0,
    season_id = coalesce(s, season_id), off_b = 0, off_d = 0
  where id = v_id;
  return v_id;
end $$;

create or replace function zr_spawn_near(p_lat float8, p_lng float8, p_nh int, p_nz int, p_min float8, p_max float8) returns void
language plpgsql security definer set search_path to public as $$
declare i int; b float8; d float8; o record;
begin
  for i in 1 .. (p_nh + p_nz) loop
    b := random() * 2 * pi(); d := p_min + random() * (p_max - p_min);
    select * into o from zr_shift(p_lat, p_lng, d * sin(b), d * cos(b));
    perform zr_spawn_npc(case when i <= p_nh then 'human' else 'zombie' end, o.olat, o.olng);
  end loop;
end $$;

create or replace function zr_spawn_start() returns void
language plpgsql security definer set search_path to public as $$
declare r record;
begin
  for r in select lat, lng from zr_players where not is_npc and lat is not null and last_seen > now() - interval '7 days' loop
    if not exists (select 1 from zr_players n where n.is_npc and n.npc_active and n.state = 'zombie' and zr_dist(n.lat, n.lng, r.lat, r.lng) <= 1500) then
      perform zr_spawn_near(r.lat, r.lng, 0, 1 + floor(random() * 2)::int, 500, 2400);
    end if;
  end loop;
end $$;

-- NPC brains: zombies chase the nearest visible human and bite; human NPCs wander and flee
create or replace function zr_npc_tick() returns void
language plpgsql security definer set search_path to public as $$
declare z zr_players; t zr_players; nz record; dt float8 := 4; why text; hd float8; step float8; o record;
begin
  update zr_players n set npc_seen_at = now() where n.is_npc and n.npc_active and exists (
    select 1 from zr_players p where not p.is_npc and p.last_seen > now() - interval '2 minutes' and p.lat is not null
      and zr_dist(p.lat, p.lng, n.lat, n.lng) <= 3000);
  update zr_players set npc_active = false, last_seen = '2000-01-01', bite_target = null where is_npc and npc_active and npc_seen_at < now() - interval '20 minutes';
  update zr_players set last_seen = now(), fix_at = now(), acc = 5 where is_npc and npc_active;

  for z in select * from zr_players where is_npc and npc_active and state = 'zombie'
             and coalesce(down_until, now()) <= now() and coalesce(stunned_until, now()) <= now() loop
    if z.bite_target is not null then
      if z.bite_started <= now() - make_interval(secs => coalesce(z.bite_secs, 5)) then
        select * into t from zr_players where id = z.bite_target;
        why := zr_bite_check(z, t);
        update zr_players set bite_target = null, bite_started = null where id = z.id;
        if why is null then
          if t.is_npc then perform zr_turn(t.id);
          else
            update zr_players set inf_left = 300, inf_tick = now(), infected_at = now(), infected_by = z.id, last_encounter = now() where id = t.id;
            insert into zr_events(kind, actor, target, info) values ('bitten', z.id, t.id, '{"npc":true}'::jsonb);
          end if;
        end if;
      end if;
      continue;
    end if;
    select q.id, v.vlat, v.vlng, zr_dist(z.lat, z.lng, v.vlat, v.vlng) as d into nz
      from zr_players q cross join lateral zr_vpos(q) v
     where q.state = 'human' and q.inf_left is null and zr_present(q) and coalesce(q.disguised_until, now()) <= now()
       and zr_dist(z.lat, z.lng, q.lat, q.lng) <= 1300
     order by 4 limit 1;
    if found then
      if nz.d <= 18 and coalesce(z.bite_lock_until, now()) <= now() and coalesce(z.blinded_until, now()) <= now() then
        select * into t from zr_players where id = nz.id;
        if zr_bite_check(z, t) is null then
          update zr_players set bite_target = t.id, bite_started = now(), bite_secs = zr_bite_time(t) where id = z.id;
          update zr_players set self_lock_until = null, self_lock_what = null, chan_kind = null, last_encounter = now() where id = t.id;
          insert into zr_events(kind, actor, target, info) values ('bite_warning', z.id, t.id, jsonb_build_object('secs', zr_bite_time(t), 'npc', true));
          continue;
        end if;
      end if;
      hd := atan2((nz.vlng - z.lng) * cos(radians(z.lat)), nz.vlat - z.lat);
      step := least(1.4 * dt, greatest(0, nz.d - 8));
    else
      hd := coalesce(z.npc_heading, 0) + (random() - 0.5) * 0.8; step := 0.6 * dt;
    end if;
    select * into o from zr_shift(z.lat, z.lng, step * sin(hd), step * cos(hd));
    update zr_players set lat = o.olat, lng = o.olng, npc_heading = hd, speed = step / dt where id = z.id;
  end loop;

  for z in select * from zr_players where is_npc and npc_active and state = 'human' and inf_left is null loop
    select zr_dist(z.lat, z.lng, v.vlat, v.vlng) as d, v.vlat, v.vlng into nz
      from zr_players q cross join lateral zr_vpos(q) v
     where q.state = 'zombie' and zr_present(q) and coalesce(q.down_until, now()) <= now() and zr_dist(z.lat, z.lng, q.lat, q.lng) <= 250
     order by 1 limit 1;
    if found and nz.d <= 120 then
      hd := atan2((nz.vlng - z.lng) * cos(radians(z.lat)), nz.vlat - z.lat) + pi(); step := 1.8 * dt;
    else
      hd := coalesce(z.npc_heading, 0) + (random() - 0.5) * 0.6; step := 0.7 * dt;
    end if;
    select * into o from zr_shift(z.lat, z.lng, step * sin(hd), step * cos(hd));
    update zr_players set lat = o.olat, lng = o.olng, npc_heading = hd, speed = step / dt where id = z.id;
  end loop;
end $$;

-- passive infection: +15% a day for every human, online or not; 100% turns you
create or replace function zr_meter_tick() returns void
language plpgsql security definer set search_path to public as $$
declare r record;
begin
  update zr_players set inf_pct = least(100, coalesce(inf_pct, 0) + 15 * extract(epoch from now() - coalesce(inf_pct_at, now())) / 86400.0), inf_pct_at = now()
   where state = 'human' and not is_npc;
  for r in select id from zr_players where state = 'human' and not is_npc and inf_pct >= 100 loop
    perform zr_turn(r.id);
    insert into zr_events(kind, target, info) values ('meter_turned', r.id, '{}'::jsonb);
  end loop;
end $$;

-- round reset (and full wipe at season end)
create or replace function zr_round_reset(p_round int, p_start timestamptz, p_wipe boolean, p_season int) returns void
language plpgsql security definer set search_path to public as $$
begin
  update zr_players set xp = coalesce(xp, 0) + greatest(points, 0), points = 0 where not is_npc;
  if p_wipe then
    update zr_players set gear = '{}'::jsonb, pack = '[]'::jsonb, bag = 'none', bunker_lat = null, bunker_lng = null, bunker_ready = null,
      bunker_hp = null, bunker_items = '[]'::jsonb, bunker_vlat = null, bunker_vlng = null, season_id = p_season where not is_npc;
  else
    update zr_players p set bunker_items = (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(zr_carried(p)) e limit 50) x),
      gear = '{}'::jsonb, pack = '[]'::jsonb, bag = 'none'
     where not p.is_npc and p.state = 'human' and p.bunker_lat is not null;
    update zr_players set bunker_items = '[]'::jsonb where not is_npc and state = 'zombie' and bunker_lat is not null;
  end if;
  update zr_players set state = 'human', inf_left = null, inf_tick = null, infected_at = null, infected_by = null, inf_pct = 0, inf_pct_at = now(),
    hp = 100, down_until = null, stunned_until = null, blinded_until = null, z_head = null, z_armor = null, bite_target = null, bite_started = null,
    bite_lock_until = null, shriek_lock_until = null, self_lock_until = null, chan_kind = null, exposed_until = null, eq_ready = '{}'::jsonb,
    bunker_lock_until = p_start + interval '6 hours', off_b = random() * 2 * pi(), off_d = 50 + random() * 50, round_id = p_round,
    headlamp_on = false, nvg_on = false
  where not is_npc;
  update zr_players set npc_active = false, last_seen = '2000-01-01', bite_target = null where is_npc;
  update zr_bags set until = now() where until > now();
  update zr_mines set until = now() where until > now();
  update zr_hotzones set until = now() where until > now();
  update zr_supply set until = now() where until > now();
  insert into zr_events(kind, target, info)
    select 'new_round', id, jsonb_build_object('round', p_round, 'wipe', p_wipe) from zr_players where not is_npc and last_seen > now() - interval '30 days';
  perform zr_spawn_start();
end $$;

create or replace function zr_round_tick() returns void
language plpgsql security definer set search_path to public as $$
declare r zr_rounds; nx zr_rounds; ns int;
begin
  for r in select * from zr_rounds where ends_at <= now() and processed_at is null order by id for update skip locked loop
    update zr_rounds set processed_at = now() where id = r.id;
    if r.n < 12 then
      select * into nx from zr_rounds where season_id = r.season_id and n = r.n + 1;
      perform zr_round_reset(nx.id, nx.starts_at, false, r.season_id);
    else
      ns := coalesce((select max(id) from zr_seasons), 0) + 1;
      insert into zr_seasons(id, name, starts_at, ends_at) values (ns, 'Season ' || ns, r.ends_at, r.ends_at + interval '84 days');
      insert into zr_rounds(season_id, n, starts_at, ends_at)
        select ns, g, r.ends_at + (g - 1) * interval '7 days', r.ends_at + g * interval '7 days' from generate_series(1, 12) g;
      select * into nx from zr_rounds where season_id = ns and n = 1;
      perform zr_round_reset(nx.id, nx.starts_at, true, ns);
    end if;
  end loop;
end $$;

-- supply crates and hazard zones appear near active players, always at OSM-seeded public spots
create or replace function zr_events_tick() returns void
language plpgsql security definer set search_path to public as $$
declare r record; c record;
begin
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
  end loop;
end $$;

create or replace function zr_tick_world() returns void
language plpgsql security definer set search_path to public as $$
declare r record;
begin
  update zr_players set hp = 100, down_until = null where down_until is not null and down_until < now();
  for r in select id from zr_players where inf_left is not null
           and (is_npc or last_seen is null or last_seen < now() - interval '20 seconds')
           and coalesce(inf_tick, now() - interval '1 hour') < now() - interval '5 seconds' loop
    perform zr_tick_inf(r.id, false);
  end loop;
  if zr_claim('npc', 3.5) then perform zr_npc_tick(); end if;
  if zr_claim('meter', 60) then perform zr_meter_tick(); end if;
  if zr_claim('rounds', 30) then perform zr_round_tick(); end if;
  if zr_claim('events', 120) then perform zr_events_tick(); end if;
end $$;

-- clients send public candidate spots (parks, shops, footways, minor roads) found in OpenStreetMap for a 0.01-degree tile
create or replace function zr_seed(p_id uuid, p_secret text, p_tile text, p_pts jsonb) returns json
language plpgsql security definer set search_path to public as $$
declare me zr_players; parts text[]; la int; lo int; p jsonb; plat float8; plng float8; vn int := 0; k text; tier text; cnt int;
begin
  me := zr_me(p_id, p_secret);
  if p_tile !~ '^-?[0-9]+:-?[0-9]+$' then return json_build_object('error', 'bad_tile'); end if;
  parts := string_to_array(p_tile, ':'); la := parts[1]::int; lo := parts[2]::int;
  if me.lat is null or abs(floor(me.lat * 100) - la) > 2 or abs(floor(me.lng * 100) - lo) > 2 then return json_build_object('error', 'too_far'); end if;
  if jsonb_typeof(p_pts) <> 'array' or jsonb_array_length(p_pts) = 0 then return json_build_object('error', 'empty'); end if;
  insert into zr_tiles(tile) values (p_tile)
    on conflict (tile) do update set seeded_at = now() where zr_tiles.n = 0 and zr_tiles.seeded_at < now() - interval '1 hour';
  get diagnostics cnt = row_count;
  if cnt = 0 then return json_build_object('result', 'already'); end if;
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
  return json_build_object('result', 'seeded', 'n', vn);
end $$;

-- heartbeat v5
create or replace function zr_hb5(p_id uuid, p_secret text, p_lat float8, p_lng float8, p_acc float8, p_tz int,
  p_since timestamptz default null, p_speed float8 default null) returns json
language plpgsql security definer set search_path to public as $$
declare
  me zr_players; secs float8; v float8; el float8; hd jsonb; mine record; boom jsonb; lh int; night boolean; rate float8 := 0;
  v_acc float8; addn int; zv record; radar float8; nvg_ok boolean; lamp_ok boolean; ghost float8; zd float8 := 0;
  inrad boolean := false; incdc boolean := false; resp boolean; enc boolean := false; near_b boolean := false; ci int; cj int;
  v_others json := '[]'; v_ripples json := '[]'; v_caches json := '[]'; v_bags json := '[]'; v_mines json := '[]'; v_reveals json := '[]';
  v_beacons json := '[]'; v_hz json := '[]'; v_bunkers json := '[]'; v_crates json := '[]'; v_zones json := '[]'; v_seed json := '[]';
  v_events json; v_season json; v_round json; v_bb json; v_bunker json; mvp record; dla float8 := 0; dln float8 := 0; me1 jsonb; me2 jsonb;
begin
  me := zr_me(p_id, p_secret);
  perform zr_tick_world();
  select * into me from zr_players where id = p_id;

  if p_lat is not null and p_lng is not null then
    secs := extract(epoch from now() - coalesce(me.fix_at, now() - interval '1 hour'));
    if me.lat is null or secs > 600 or zr_dist(me.lat, me.lng, p_lat, p_lng) / greatest(secs, 1) <= 70 then
      v := case when me.lat is not null and secs <= 30 then zr_dist(me.lat, me.lng, p_lat, p_lng) / greatest(secs, 1) else 0 end;
      if p_speed is not null and p_speed >= 0 then v := p_speed; end if;
      -- 50 SC per mile traveled while active (sane movement only)
      if me.lat is not null and secs <= 30 and coalesce(p_acc, 99) <= 35 and zr_dist(me.lat, me.lng, p_lat, p_lng) / greatest(secs, 1) <= 45 then
        update zr_players set dist_acc = coalesce(dist_acc, 0) + zr_dist(me.lat, me.lng, p_lat, p_lng) where id = p_id;
      end if;
      update zr_players set lat = p_lat, lng = p_lng, acc = p_acc, fix_at = now(), speed = least(v, 45) where id = p_id;
    end if;
  end if;
  el := least(10, greatest(0, extract(epoch from now() - coalesce(me.last_seen, now()))));
  update zr_players set tz_offset = coalesce(p_tz, tz_offset), last_seen = now() where id = p_id;
  select * into me from zr_players where id = p_id;
  -- survival credits: survivors earn 1 SC per 5 s online; everyone earns 50 SC per mile
  update zr_players set
    sc_acc = case when state = 'human' and coalesce(paused_until, now()) <= now() then coalesce(sc_acc, 0) + el / 5.0 else coalesce(sc_acc, 0) end,
    points = points + 50 * floor(coalesce(dist_acc, 0) / 1609.34)::int,
    dist_acc = coalesce(dist_acc, 0) - 1609.34 * floor(coalesce(dist_acc, 0) / 1609.34)
  where id = p_id;
  update zr_players set points = points + floor(sc_acc)::int, sc_acc = sc_acc - floor(sc_acc) where id = p_id and sc_acc >= 1;
  select * into me from zr_players where id = p_id;
  if me.inf_left is not null then perform zr_tick_inf(p_id, me.speed >= 0.6); end if;

  hd := me.gear->'head';
  if hd is not null and ((me.headlamp_on and hd->>'t' = 'headlamp') or (me.nvg_on and hd->>'t' = 'nvg')) then
    hd := jsonb_set(hd, '{b}', to_jsonb(greatest(0, (hd->>'b')::float8 - el * (case when hd->>'t' = 'nvg' then 35 else 20 end) / 3600.0)));
    update zr_players set gear = jsonb_set(gear, '{head}', hd),
      headlamp_on = headlamp_on and (hd->>'b')::float8 > 0, nvg_on = nvg_on and (hd->>'b')::float8 > 0 where id = p_id;
  end if;
  update zr_players set was_sheltered = zr_sheltered(me) where id = p_id;
  select * into me from zr_players where id = p_id;

  if me.state = 'human' and me.lat is not null then
    inrad := exists (select 1 from zr_zones z where z.kind = 'radiation' and z.until > now() and zr_dist(me.lat, me.lng, z.lat, z.lng) <= zr_zone_r(z));
    incdc := exists (select 1 from zr_zones z where z.kind = 'cdc' and z.until > now() and zr_dist(me.lat, me.lng, z.lat, z.lng) <= z.r0);
    resp := zr_live(me.gear->'head') and me.gear->'head'->>'t' = 'respirator';
    zd := el / 60.0 * ((case when inrad and not resp then 0.5 else 0 end) - (case when incdc then 3 else 0 end));
  end if;
  if me.state = 'human' then
    update zr_players set inf_pct = greatest(0, least(100, coalesce(inf_pct, 0) + 15 * extract(epoch from now() - coalesce(inf_pct_at, now())) / 86400.0 + zd)),
      inf_pct_at = now() where id = p_id returning * into me;
    if me.inf_pct >= 100 then
      perform zr_turn(p_id);
      insert into zr_events(kind, target, info) values ('meter_turned', p_id, '{}'::jsonb);
      select * into me from zr_players where id = p_id;
    end if;
  end if;

  if me.lat is not null then
    select * into mvp from zr_vpos(me); dla := mvp.vlat - me.lat; dln := mvp.vlng - me.lng;
  end if;
  lh := zr_local_hour(coalesce(me.tz_offset, 0)); night := lh >= 20 or lh < 6;
  if me.state = 'zombie' and coalesce(me.down_until, now()) <= now() and me.lat is not null then
    select * into zv from zr_vpos(me);
    for mine in select * from zr_mines where kind = 'claymore' and owner <> p_id and until > now()
                and zr_dist(lat, lng, zv.vlat, zv.vlng) <= 10 order by created limit 1 loop
      update zr_mines set until = now() - interval '1 second' where id = mine.id;
      boom := zr_damage(p_id, 100, 1, mine.owner);
      perform zr_ping(mine.lat, mine.lng, 400, 60, mine.owner, 'explosion');
      insert into zr_events(kind, actor, target, info) values ('mine_boom', p_id, mine.owner, boom);
    end loop;
    insert into zr_events(kind, actor, target, info)
    select 'flare_cross', p_id, f.owner, '{}'::jsonb from zr_mines f
    where f.kind = 'flare' and f.owner <> p_id and f.created > now() - interval '10 minutes' and zr_dist(f.lat, f.lng, zv.vlat, zv.vlng) <= 20
      and not exists (select 1 from zr_events e where e.kind = 'flare_cross' and e.actor = p_id and e.target = f.owner and e.at > now() - interval '2 minutes');
    if night then
      rate := 1;
      if me.hp < 100 then
        v_acc := coalesce(me.hp_acc, 0) + el / 60.0; addn := floor(v_acc)::int;
        update zr_players set hp = least(100, hp + addn), hp_acc = v_acc - addn where id = p_id;
      end if;
    end if;
    select * into me from zr_players where id = p_id;
  end if;

  if me.lat is not null and coalesce(me.paused_until, now()) <= now() then
    lamp_ok := me.headlamp_on and me.gear->'head'->>'t' = 'headlamp' and coalesce((me.gear->'head'->>'b')::float8, 0) > 0;
    nvg_ok := me.nvg_on and me.gear->'head'->>'t' = 'nvg' and coalesce((me.gear->'head'->>'b')::float8, 0) > 0;
    radar := case when lamp_ok or me.boost_until > now() then 200 else 100 end;

    if me.state = 'human' then
      select coalesce(json_agg(o), '[]'::json) into v_others from (
        select q.id, q.handle, q.is_npc as npc,
          case when q.state = 'zombie' then 'zombie' when q.inf_left is not null then 'infected' else 'human' end as state,
          q.patient_zero, q.infections, q.cures, q.vlat - dla as lat, q.vlng - dln as lng, round(q.d) as dist,
          case when q.state = 'zombie' then q.hp end as hp,
          case when q.state = 'zombie' then coalesce((q.z_head->>'d')::int, 0) + coalesce((q.z_armor->>'d')::int, 0) end as shell,
          (q.state = 'zombie' and q.d <= 30 and not (zr_live(q.z_armor) and q.z_armor->>'t' = 'tracksuit')) as close,
          (q.stunned_until > now()) as stunned, (q.bite_lock_until > now() or q.blinded_until > now()) as locked,
          (not q.is_npc and q.last_seen < now() - interval '20 seconds') as offline
        from (select q0.*, v.vlat, v.vlng, zr_dist(mvp.vlat, mvp.vlng, v.vlat, v.vlng) as d from zr_players q0 cross join lateral zr_vpos(q0) v
              where q0.id <> p_id and zr_present(q0) and coalesce(q0.down_until, now()) <= now()
                and abs(q0.lat - me.lat) < 0.015 and abs(q0.lng - me.lng) < 0.02) q
        where not zr_blocked(p_id, q.id)
          and ((q.state = 'human' and q.d <= 250)
            or (q.state = 'zombie' and (
                  q.d <= radar * (case when zr_live(q.z_armor) and q.z_armor->>'t' = 'ghillie' and not nvg_ok then 0.6 else 1 end)
               or exists (select 1 from zr_reveals r where r.owner = p_id and r.until > now() and zr_dist(r.lat, r.lng, q.vlat, q.vlng) <= r.radius)
               or exists (select 1 from zr_mines f where f.owner = p_id and f.kind = 'flare' and f.created > now() - interval '10 minutes'
                          and zr_dist(f.lat, f.lng, q.vlat, q.vlng) <= 20))))
        order by q.d limit 60) o;
      select coalesce(json_agg(json_build_object('id', id, 'kind', kind, 'lat', lat - dla, 'lng', lng - dln,
               'left', greatest(0, extract(epoch from (case when kind = 'flare' then created + interval '10 minutes' else until end) - now()))::int)), '[]'::json)
        into v_mines from zr_mines where owner = p_id and until > now();
      select coalesce(json_agg(json_build_object('lat', lat - dla, 'lng', lng - dln, 'radius', radius, 'kind', kind,
               'left', greatest(0, extract(epoch from until - now()))::int)), '[]'::json) into v_reveals from zr_reveals where owner = p_id and until > now();
      select coalesce(json_agg(rr), '[]'::json) into v_ripples from (
        select pg.lat - dla as lat, pg.lng - dln as lng, pg.kind, round(zr_dist(mvp.vlat, mvp.vlng, pg.lat, pg.lng)) as dist, round(pg.radius) as r
        from zr_pings pg where pg.until > now() and coalesce(pg.src, '00000000-0000-0000-0000-000000000000'::uuid) <> p_id
          and pg.kind <> 'scream' and zr_dist(mvp.vlat, mvp.vlng, pg.lat, pg.lng) <= 50 + pg.radius
        order by 4 limit 30) rr;
    else
      select coalesce(json_agg(o), '[]'::json) into v_others from (
        select q.id, q.handle, q.is_npc as npc,
          case when q.state = 'zombie' or q.disguised_until > now() then 'zombie' else 'human' end as state,
          q.patient_zero, q.infections, q.cures, q.vlat - dla as lat, q.vlng - dln as lng, round(q.d) as dist,
          (q.inf_left is not null) as infected, (not q.is_npc and q.last_seen < now() - interval '20 seconds') as offline
        from (select q0.*, v.vlat, v.vlng, zr_dist(mvp.vlat, mvp.vlng, v.vlat, v.vlng) as d from zr_players q0 cross join lateral zr_vpos(q0) v
              where q0.id <> p_id and zr_present(q0) and coalesce(q0.down_until, now()) <= now()
                and abs(q0.lat - me.lat) < 0.015 and abs(q0.lng - me.lng) < 0.02) q
        where not zr_blocked(p_id, q.id) and ((q.state = 'zombie' and q.d <= 400) or (q.state = 'human' and q.d <= 60))
        order by q.d limit 60) o;
      select coalesce(json_agg(rr), '[]'::json) into v_ripples from (select * from (
          select v.vlat - dla as lat, v.vlng - dln as lng, 'move' as kind, round(zr_dist(mvp.vlat, mvp.vlng, v.vlat, v.vlng)) as dist, round(zr_ring(hz)) as r
          from zr_players hz cross join lateral zr_vpos(hz) v
          where hz.state = 'human' and zr_present(hz) and hz.last_seen > now() - interval '20 seconds' and coalesce(hz.disguised_until, now()) <= now()
            and abs(hz.lat - me.lat) < 0.01 and abs(hz.lng - me.lng) < 0.013
            and zr_dist(mvp.vlat, mvp.vlng, v.vlat, v.vlng) > 60 and zr_dist(mvp.vlat, mvp.vlng, v.vlat, v.vlng) <= 50 + zr_ring(hz) and not zr_blocked(p_id, hz.id)
          union all
          select pg.lat - dla, pg.lng - dln, pg.kind, round(zr_dist(mvp.vlat, mvp.vlng, pg.lat, pg.lng)), round(pg.radius)
          from zr_pings pg where pg.until > now() and coalesce(pg.src, '00000000-0000-0000-0000-000000000000'::uuid) <> p_id
            and zr_dist(mvp.vlat, mvp.vlng, pg.lat, pg.lng) <= 50 + pg.radius) x order by dist limit 40) rr;
      select coalesce(json_agg(json_build_object('lat', lat - dla, 'lng', lng - dln)), '[]'::json) into v_beacons
        from zr_mines where kind = 'flare' and until > now() and zr_dist(lat, lng, mvp.vlat, mvp.vlng) <= 120;
      select coalesce(json_agg(json_build_object('id', h.id, 'lat', h.lat - dla, 'lng', h.lng - dln, 'radius', h.radius, 'mine', h.owner = p_id,
               'handle', (select handle from zr_players where id = h.owner), 'left', greatest(0, extract(epoch from h.until - now()))::int,
               'dist', round(zr_dist(mvp.vlat, mvp.vlng, h.lat, h.lng)))), '[]'::json) into v_hz
        from zr_hotzones h where h.until > now() and zr_dist(me.lat, me.lng, h.lat, h.lng) <= 2000 and not zr_blocked(p_id, h.owner);
    end if;

    enc := exists (select 1 from zr_players q cross join lateral zr_vpos(q) v where q.id <> p_id and zr_present(q)
                   and q.state <> me.state and abs(q.lat - me.lat) < 0.006 and abs(q.lng - me.lng) < 0.008
                   and zr_dist(mvp.vlat, mvp.vlng, v.vlat, v.vlng) <= 150);
    if enc then
      update zr_players set last_encounter = now() where id = p_id;
    elsif coalesce(me.last_encounter, now() - interval '4 hours') < now() - interval '3 hours' and zr_claim('spawn:' || p_id, 600) then
      perform zr_spawn_near(me.lat, me.lng, 1 + floor(random() * 5)::int, 1 + floor(random() * 5)::int, 320, 2400);
      update zr_players set last_encounter = now() where id = p_id;
    end if;

    select coalesce(json_agg(c), '[]'::json) into v_caches from (
      select * from (
        select 'c:' || k.id as id, false as sponsored, null::text as name, k.lat, k.lng, k.tier, k.kind,
          round(zr_dist(me.lat, me.lng, k.lat, k.lng)) as dist,
          greatest(0, 3600 - extract(epoch from now() - l.looted_at))::int as cooldown,
          greatest(0, extract(epoch from coalesce(cs.destroyed_until, now()) - now()))::int as destroyed
        from zr_caches k left join zr_loots l on l.player_id = p_id and l.cache_id = 'c:' || k.id
             left join zr_cache_state cs on cs.cache_id = 'c:' || k.id
        where abs(k.lat - me.lat) < 0.009 and abs(k.lng - me.lng) < 0.012
        union all
        select 's:' || s.id, true, s.name, s.lat, s.lng, 'military', 'shop', round(zr_dist(me.lat, me.lng, s.lat, s.lng)),
          greatest(0, 3600 - extract(epoch from now() - l.looted_at))::int,
          greatest(0, extract(epoch from coalesce(cs.destroyed_until, now()) - now()))::int
        from zr_sponsors s left join zr_loots l on l.player_id = p_id and l.cache_id = 's:' || s.id
             left join zr_cache_state cs on cs.cache_id = 's:' || s.id
        where s.active) a where dist <= 900 order by dist) c;
    select coalesce(json_agg(json_build_object('id', 'd:' || s.id, 'lat', s.lat, 'lng', s.lng,
             'lands', greatest(0, extract(epoch from s.lands_at - now()))::int, 'left', greatest(0, extract(epoch from s.until - now()))::int,
             'dist', round(zr_dist(me.lat, me.lng, s.lat, s.lng)),
             'looted', exists (select 1 from zr_loots l where l.player_id = p_id and l.cache_id = 'd:' || s.id))), '[]'::json)
      into v_crates from zr_supply s where s.until > now() and zr_dist(me.lat, me.lng, s.lat, s.lng) <= 3000;
    select coalesce(json_agg(json_build_object('id', z.id, 'kind', z.kind, 'lat', z.lat, 'lng', z.lng, 'r', round(zr_zone_r(z)),
             'left', greatest(0, extract(epoch from z.until - now()))::int, 'dist', round(zr_dist(me.lat, me.lng, z.lat, z.lng)))), '[]'::json)
      into v_zones from zr_zones z where z.until > now() and zr_dist(me.lat, me.lng, z.lat, z.lng) <= 3000;
    select coalesce(json_agg(json_build_object('id', b.id, 'lat', b.lat, 'lng', b.lng, 'n', jsonb_array_length(b.items),
             'dist', round(zr_dist(me.lat, me.lng, b.lat, b.lng)))), '[]'::json)
      into v_bags from zr_bags b where b.until > now() and zr_dist(me.lat, me.lng, b.lat, b.lng) <= 900;
    select coalesce(json_agg(json_build_object('key', zr_bunker_key(b.id), 'lat', b.bunker_vlat, 'lng', b.bunker_vlng, 'hp', b.bunker_hp,
             'dist', round(zr_dist(me.lat, me.lng, b.bunker_vlat, b.bunker_vlng)))), '[]'::json)
      into v_bunkers from zr_players b where b.id <> p_id and b.bunker_vlat is not null and b.bunker_ready <= now()
        and abs(b.bunker_vlat - me.lat) < 0.015 and abs(b.bunker_vlng - me.lng) < 0.02 and not zr_blocked(p_id, b.id);
    ci := floor(me.lat * 100); cj := floor(me.lng * 100);
    select coalesce(json_agg(tk), '[]'::json) into v_seed from (
      select (ci + a) || ':' || (cj + b) as tk from generate_series(-1, 1) a cross join generate_series(-1, 1) b
      where not exists (select 1 from zr_tiles t where t.tile = (ci + a) || ':' || (cj + b) and (t.n > 0 or t.seeded_at > now() - interval '1 hour'))
      order by abs(a) + abs(b) limit 2) s;
  end if;

  select json_build_object('by', z.handle, 'npc', z.is_npc, 'secs', z.bite_secs,
           'left', greatest(0, coalesce(z.bite_secs, 5) - extract(epoch from now() - z.bite_started))) into v_bb
    from zr_players z where z.bite_target = p_id and z.bite_started > now() - interval '15 seconds' order by z.bite_started limit 1;

  if me.bunker_lat is not null then
    near_b := me.lat is not null and zr_dist(me.lat, me.lng, me.bunker_lat, me.bunker_lng) <= 40;
    v_bunker := json_build_object('lat', me.bunker_lat, 'lng', me.bunker_lng, 'vlat', me.bunker_vlat, 'vlng', me.bunker_vlng,
      'ready', greatest(0, extract(epoch from me.bunker_ready - now()))::int, 'hp', me.bunker_hp,
      'n', jsonb_array_length(coalesce(me.bunker_items, '[]'::jsonb)), 'near', near_b,
      'dist', case when me.lat is not null then round(zr_dist(me.lat, me.lng, me.bunker_lat, me.bunker_lng)) end,
      'lock', greatest(0, extract(epoch from coalesce(me.bunker_lock_until, now()) - now()))::int,
      'items', case when near_b then me.bunker_items else null end);
  end if;

  select coalesce(json_agg(e order by e.at), '[]'::json) into v_events from (
    select ev.id, ev.at, ev.kind, ev.info, (ev.actor = p_id) as mine,
      (select handle from zr_players where id = case when ev.actor = p_id then ev.target else ev.actor end) as other
    from zr_events ev
    where (ev.target = p_id or ev.actor = p_id) and ev.at > coalesce(p_since, now() - interval '30 seconds')
    order by ev.at desc limit 30) e;
  select json_build_object('name', name, 'ends_at', ends_at) into v_season from zr_seasons where id = me.season_id;
  select json_build_object('id', r.id, 'n', r.n, 'starts_at', r.starts_at, 'ends_at', r.ends_at) into v_round
    from zr_rounds r where now() >= r.starts_at and now() < r.ends_at order by r.id desc limit 1;

  me1 := jsonb_build_object(
      'id', me.id, 'handle', me.handle, 'state', me.state, 'patient_zero', me.patient_zero,
      'lat', me.lat, 'lng', me.lng, 'acc', me.acc, 'speed', me.speed,
      'infected', me.inf_left is not null, 'inf_left', round(me.inf_left),
      'inf_rate', case when me.inf_left is null then 0 when me.epi_until > now() and me.speed >= 0.6 then 0 when me.cryo_until > now() then 0.5 else 1 end,
      'inf_pct', round(coalesce(me.inf_pct, 0)::numeric, 2), 'in_rad', inrad, 'in_cdc', incdc,
      'stunned', greatest(0, extract(epoch from coalesce(me.stunned_until, now()) - now()))::int,
      'blinded', greatest(0, extract(epoch from coalesce(me.blinded_until, now()) - now()))::int,
      'down', greatest(0, extract(epoch from coalesce(me.down_until, now()) - now()))::int,
      'cryo', greatest(0, extract(epoch from coalesce(me.cryo_until, now()) - now()))::int,
      'epi', greatest(0, extract(epoch from coalesce(me.epi_until, now()) - now()))::int,
      'boost', greatest(0, extract(epoch from coalesce(me.boost_until, now()) - now()))::int,
      'disguised', greatest(0, extract(epoch from coalesce(me.disguised_until, now()) - now()))::int,
      'bite_lock', greatest(0, extract(epoch from greatest(coalesce(me.bite_lock_until, now()), coalesce(me.blinded_until, now())) - now())),
      'shriek_lock', greatest(0, extract(epoch from coalesce(me.shriek_lock_until, now()) - now())),
      'shriek_cd', greatest(0, 45 - extract(epoch from now() - coalesce(me.last_scream, 'epoch'::timestamptz))));
  me2 := jsonb_build_object(
      'paused', greatest(0, extract(epoch from coalesce(me.paused_until, now()) - now()))::int,
      'pause_cd', greatest(0, extract(epoch from coalesce(me.pause_cd_until, now()) - now()))::int,
      'lock_what', case when me.self_lock_until > now() then me.self_lock_what end,
      'lock_left', greatest(0, extract(epoch from coalesce(me.self_lock_until, now()) - now())),
      'chan', case when me.chan_kind is not null then json_build_object('kind', me.chan_kind, 'ref', me.chan_ref, 'secs', me.chan_secs,
                 'left', greatest(0, me.chan_secs - extract(epoch from now() - me.chan_started))) end,
      'being_bitten', v_bb,
      'hp', me.hp, 'regen', case when me.hp < 100 then rate else 0 end, 'night', night,
      'z_head', me.z_head, 'z_armor', me.z_armor, 'shell', zr_shell(me),
      'gear', me.gear, 'pack', me.pack, 'bag', me.bag, 'cap', zr_cap(me.bag),
      'headlamp_on', me.headlamp_on, 'nvg_on', me.nvg_on,
      'eq_ready', json_build_object(
        'eq1', greatest(0, extract(epoch from coalesce((me.eq_ready->>'eq1')::timestamptz, now()) - now()))::int,
        'eq2', greatest(0, extract(epoch from coalesce((me.eq_ready->>'eq2')::timestamptz, now()) - now()))::int),
      'last_attack', me.last_attack, 'bite_time', zr_bite_time(me), 'ring', round(zr_ring(me)),
      'supplies', me.supplies, 'sheltered', me.was_sheltered, 'home', me.home_lat is not null, 'safe_start', me.safe_start,
      'points', me.points, 'sc', me.points, 'xp', coalesce(me.xp, 0), 'level', zr_level(coalesce(me.xp, 0)),
      'infections', me.infections, 'cures', me.cures, 'bunker', v_bunker);
  return json_build_object(
    'now', now(),
    'me', me1 || me2,

    'others', v_others, 'ripples', v_ripples, 'beacons', v_beacons, 'caches', v_caches, 'bags', v_bags,
    'mines', v_mines, 'reveals', v_reveals, 'hotzones', v_hz, 'bunkers', v_bunkers, 'crates', v_crates, 'zones', v_zones,
    'seed', v_seed, 'events', v_events, 'season', v_season, 'round', v_round);
end $$;

-- World & Intel tab
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
              from zr_zones z where z.until > now() and me.lat is not null and zr_dist(me.lat, me.lng, z.lat, z.lng) <= 5000),
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

grant execute on function zr_hb5(uuid, text, float8, float8, float8, int, timestamptz, float8) to anon, authenticated;
grant execute on function zr_world(uuid, text) to anon, authenticated;
grant execute on function zr_seed(uuid, text, text, jsonb) to anon, authenticated;

-- standings and leaderboard ignore NPCs
create or replace function zr_standings(p_id uuid, p_secret text) returns json
language plpgsql security definer set search_path to public as $$
declare me zr_players; v json; bl int;
begin
  me := zr_me(p_id, p_secret);
  select count(*) into bl from zr_events where kind = 'bloodline' and target = p_id;
  select json_build_object(
    'sc', me.points,
    'rank', (select count(*) + 1 from zr_players q where q.season_id = me.season_id and not q.is_npc and q.points > me.points
              and me.lat is not null and q.lat is not null and zr_dist(q.lat, q.lng, me.lat, me.lng) <= 5000),
    'sector_n', (select count(*) from zr_players q where q.season_id = me.season_id and not q.is_npc
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
       where q.season_id = me.season_id and not q.is_npc and q.last_seen > now() - interval '30 days'
         and (p_filter = 'all' or (p_filter = 'humans' and q.state = 'human') or (p_filter = 'zombies' and q.state = 'zombie'))
         and (q.id = p_id or not zr_blocked(p_id, q.id))
       order by q.points desc, q.infections desc, q.cures desc limit 25) x),
    'humans', (select count(*) from zr_players where season_id = me.season_id and not is_npc and state = 'human' and inf_left is null
               and last_seen > now() - interval '7 days'),
    'zombies_n', (select count(*) from zr_players where season_id = me.season_id and not is_npc and (state = 'zombie' or inf_left is not null)
               and last_seen > now() - interval '7 days')
  ) into v;
  return v;
end $$;

-- 300 SC for a kill or an infection
create or replace function zr_damage(p_z uuid, p_dmg double precision, p_mult double precision, p_actor uuid) returns jsonb
language plpgsql security definer set search_path to public as $$
declare z zr_players; rem float8 := p_dmg; eff float8; d float8; broke text[] := '{}'; v_hp int; killed boolean := false; zh jsonb; za jsonb;
begin
  select * into z from zr_players where id = p_z for update;
  if z.id is null or z.state <> 'zombie' or z.down_until > now() then return '{"error":"invalid"}'; end if;
  zh := z.z_head; za := z.z_armor;
  if zh is not null and coalesce((zh->>'d')::float8, 0) > 0 and rem > 0 then
    d := (zh->>'d')::float8; eff := rem * p_mult;
    if eff >= d then rem := rem - d / p_mult; broke := broke || (zh->>'t'); zh := null;
    else zh := jsonb_set(zh, '{d}', to_jsonb(round((d - eff)::numeric))); rem := 0; end if;
  end if;
  if za is not null and coalesce((za->>'d')::float8, 0) > 0 and rem > 0 then
    d := (za->>'d')::float8; eff := rem * p_mult;
    if eff >= d then rem := rem - d / p_mult; broke := broke || (za->>'t'); za := null;
    else za := jsonb_set(za, '{d}', to_jsonb(round((d - eff)::numeric))); rem := 0; end if;
  end if;
  v_hp := z.hp - round(rem)::int;
  if v_hp <= 0 then killed := true; v_hp := 0; end if;
  update zr_players set hp = v_hp, z_head = zh, z_armor = za,
    down_until = case when killed then now() + interval '8 minutes' else down_until end,
    bite_target = case when killed then null else bite_target end where id = p_z;
  insert into zr_events(kind, actor, target, info) values (case when killed then 'killed' else 'hit' end, p_actor, p_z,
    jsonb_build_object('dmg', round(p_dmg), 'hp', v_hp, 'broke', to_jsonb(broke), 'pts', case when killed then 300 else 0 end));
  if killed and p_actor is not null then update zr_players set points = points + 300 where id = p_actor; end if;
  return jsonb_build_object('handle', z.handle, 'killed', killed, 'hp', v_hp,
    'shell', coalesce((zh->>'d')::int, 0) + coalesce((za->>'d')::int, 0), 'broke', to_jsonb(broke));
end $$;

create or replace function zr_bite_finish(p_id uuid, p_secret text) returns json
language plpgsql security definer set search_path to public as $$
declare me zr_players; t zr_players; why text;
begin
  me := zr_me(p_id, p_secret);
  perform zr_tick_world();
  select * into me from zr_players where id = p_id;
  if me.bite_target is null or me.bite_started is null then return json_build_object('error', 'no_bite'); end if;
  if me.bite_started > now() - make_interval(secs => coalesce(me.bite_secs, 5) - 0.7) then return json_build_object('error', 'too_soon'); end if;
  if me.bite_started < now() - make_interval(secs => coalesce(me.bite_secs, 5) + 15) then
    update zr_players set bite_target = null, bite_started = null where id = p_id;
    return json_build_object('error', 'expired');
  end if;
  select * into t from zr_players where id = me.bite_target;
  update zr_players set bite_target = null, bite_started = null where id = p_id;
  why := zr_bite_check(me, t);
  if why is not null then return json_build_object('error', why); end if;
  if t.is_npc then perform zr_turn(t.id);
  else update zr_players set inf_left = 300, inf_tick = now(), infected_at = now(), infected_by = p_id where id = t.id; end if;
  update zr_players set points = points + 300, infections = infections + 1 where id = p_id;
  if me.infected_by is not null then
    update zr_players set points = points + 5 where id = me.infected_by;
    insert into zr_events(kind, actor, target, info) values ('bloodline', t.id, me.infected_by, jsonb_build_object('via', me.handle));
  end if;
  insert into zr_events(kind, actor, target, info) values ('bitten', p_id, t.id, '{"pts":300}'::jsonb);
  return json_build_object('result', 'infected', 'handle', t.handle, 'pts', 300);
end $$;
