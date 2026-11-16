-- Zombie Radius v2 game logic

-- put an item somewhere sensible on a player; returns where it went or null
create or replace function zr_place(p_id uuid, it jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare p zr_players; s text; cap int; oldbag text;
begin
  select * into p from zr_players where id = p_id for update;
  select slot into s from zr_items where t = it->>'t';
  if s in ('weapon','head','armor') and p.gear->s is null then
    update zr_players set gear = gear || jsonb_build_object(s, it) where id = p_id; return s;
  end if;
  if s = 'eq' then
    if p.gear->'eq1' is null then update zr_players set gear = gear || jsonb_build_object('eq1', it) where id = p_id; return 'eq1'; end if;
    if p.gear->'eq2' is null then update zr_players set gear = gear || jsonb_build_object('eq2', it) where id = p_id; return 'eq2'; end if;
  end if;
  if s = 'bag' and zr_cap(it->>'t') > zr_cap(p.bag) then
    oldbag := p.bag;
    update zr_players set bag = it->>'t',
      pack = case when oldbag <> 'none' then pack || jsonb_build_array(zr_new_item(oldbag)) else pack end
    where id = p_id;
    return 'bag';
  end if;
  cap := zr_cap(p.bag);
  if jsonb_array_length(p.pack) < cap then
    update zr_players set pack = pack || jsonb_build_array(it) where id = p_id; return 'pack';
  end if;
  return null;
end $$;

create or replace function zr_drop_bag(p_lat float8, p_lng float8, p_items jsonb, p_owner uuid) returns void
language sql security definer set search_path = public as $$
  insert into zr_bags(lat, lng, items, owner)
  select p_lat, p_lng, p_items, p_owner
  where p_lat is not null and p_items is not null and jsonb_array_length(p_items) > 0;
$$;

-- damage a zombie: armor shell first, then HP
create or replace function zr_damage(p_z uuid, p_dmg float8, p_mult float8, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare z zr_players; rem float8 := p_dmg; eff float8; d float8; broke text[] := '{}'; v_hp int; killed boolean := false;
  zh jsonb; za jsonb;
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
    bite_target = case when killed then null else bite_target end
  where id = p_z;
  insert into zr_events(kind, actor, target, info)
    values (case when killed then 'killed' else 'hit' end, p_actor, p_z,
            jsonb_build_object('dmg', round(p_dmg), 'hp', v_hp, 'broke', to_jsonb(broke)));
  if killed and p_actor is not null then update zr_players set points = points + 5 where id = p_actor; end if;
  return jsonb_build_object('handle', z.handle, 'killed', killed, 'hp', v_hp,
    'shell', coalesce((zh->>'d')::int, 0) + coalesce((za->>'d')::int, 0), 'broke', to_jsonb(broke));
end $$;

-- human turns into a zombie: drop weapon/equip/backpack as a loot bag, keep head + armor as zombie armor
create or replace function zr_turn(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p zr_players; items jsonb := '[]'::jsonb; zh jsonb; za jsonb; ch int;
begin
  select * into p from zr_players where id = p_id for update;
  if p.state = 'zombie' then return; end if;
  if p.gear->'weapon' is not null then items := items || jsonb_build_array(p.gear->'weapon'); end if;
  if p.gear->'eq1' is not null then items := items || jsonb_build_array(p.gear->'eq1'); end if;
  if p.gear->'eq2' is not null then items := items || jsonb_build_array(p.gear->'eq2'); end if;
  items := items || p.pack;
  if p.bag <> 'none' then items := items || jsonb_build_array(zr_new_item(p.bag)); end if;
  perform zr_drop_bag(p.lat, p.lng, items, null);
  if zr_live(p.gear->'head') then
    select carry_hp into ch from zr_items where t = p.gear->'head'->>'t';
    if ch > 0 then zh := jsonb_build_object('t', p.gear->'head'->>'t', 'd', least(ch, (p.gear->'head'->>'d')::int)); end if;
  end if;
  if zr_live(p.gear->'armor') then
    select carry_hp into ch from zr_items where t = p.gear->'armor'->>'t';
    if ch > 0 then za := jsonb_build_object('t', p.gear->'armor'->>'t', 'd', least(ch, (p.gear->'armor'->>'d')::int)); end if;
  end if;
  update zr_players set state = 'zombie', infected_at = null, inf_left = null, inf_tick = null,
    gear = '{}'::jsonb, pack = '[]'::jsonb, bag = 'none', hp = 100, down_until = null,
    z_head = zh, z_armor = za, headlamp_on = false, nvg_on = false, cryo_until = null, epi_until = null,
    eq_ready = '{}'::jsonb, bite_target = null, bite_started = null
  where id = p_id;
  insert into zr_events(kind, target, info)
    values ('turned', p_id, jsonb_build_object('dropped', jsonb_array_length(items),
      'shell', coalesce((zh->>'d')::int, 0) + coalesce((za->>'d')::int, 0)));
end $$;

create or replace function zr_tick_inf(p_id uuid, p_moving boolean) returns void
language plpgsql security definer set search_path = public as $$
declare p zr_players; el float8; rate float8;
begin
  select * into p from zr_players where id = p_id for update;
  if p.inf_left is null then return; end if;
  el := greatest(0, extract(epoch from now() - coalesce(p.inf_tick, now())));
  rate := case when p.epi_until > now() and p_moving then 0 when p.cryo_until > now() then 0.5 else 1 end;
  update zr_players set inf_left = inf_left - el * rate, inf_tick = now() where id = p_id;
  if p.inf_left - el * rate <= 0 then perform zr_turn(p_id); end if;
end $$;

create or replace function zr_tick_world() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  update zr_players set hp = 100, down_until = null where down_until is not null and down_until < now();
  for r in select id from zr_players where inf_left is not null
           and (last_seen is null or last_seen < now() - interval '20 seconds')
           and coalesce(inf_tick, now() - interval '1 hour') < now() - interval '5 seconds' loop
    perform zr_tick_inf(r.id, false);
  end loop;
end $$;

-- cure an infected human or a zombie
create or replace function zr_cure(p_target uuid, p_actor uuid) returns text
language plpgsql security definer set search_path = public as $$
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
      cryo_until = null, epi_until = null where id = p_target;
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

-- ---------------- HEARTBEAT ----------------
create or replace function zr_heartbeat(p_id uuid, p_secret text, p_lat float8, p_lng float8, p_acc float8,
  p_tz int, p_since timestamptz default null, p_speed float8 default null) returns json
language plpgsql security definer set search_path = public as $$
declare
  me zr_players; gap float8; drain int := 0; h int; hr int; marked boolean; n int; zc int; need int;
  v float8; secs float8; el float8; hd jsonb; mine record; boom jsonb;
  bite_r constant float8 := 15.24;
  radar float8; nvg_on_ok boolean; lamp_ok boolean;
  v_others json; v_ripples json; v_caches json; v_bags json; v_mines json; v_reveals json; v_beacons json;
  v_events json; v_season json; ci int; cj int;
begin
  me := zr_me(p_id, p_secret);
  perform zr_tick_world();
  select * into me from zr_players where id = p_id;

  -- position, speed, teleport guard
  if p_lat is not null and p_lng is not null then
    secs := extract(epoch from now() - coalesce(me.fix_at, now() - interval '1 hour'));
    if me.lat is null or secs > 600 or zr_dist(me.lat, me.lng, p_lat, p_lng) / greatest(secs, 1) <= 70 then
      v := case when me.lat is not null and secs <= 30 then zr_dist(me.lat, me.lng, p_lat, p_lng) / greatest(secs, 1) else 0 end;
      if p_speed is not null and p_speed >= 0 then v := p_speed; end if;
      update zr_players set lat = p_lat, lng = p_lng, acc = p_acc, fix_at = now(), speed = least(v, 15) where id = p_id;
    end if;
  end if;
  update zr_players set tz_offset = coalesce(p_tz, tz_offset) where id = p_id;
  select * into me from zr_players where id = p_id;

  -- infection clock
  if me.inf_left is not null then perform zr_tick_inf(p_id, me.speed >= 0.6); end if;

  -- battery drain for lit headgear (only while the app is open)
  el := least(10, greatest(0, extract(epoch from now() - coalesce(me.last_seen, now()))));
  hd := me.gear->'head';
  if hd is not null and ((me.headlamp_on and hd->>'t' = 'headlamp') or (me.nvg_on and hd->>'t' = 'nvg')) then
    hd := jsonb_set(hd, '{b}', to_jsonb(greatest(0, (hd->>'b')::float8 - el * (case when hd->>'t' = 'nvg' then 35 else 20 end) / 3600.0)));
    update zr_players set gear = jsonb_set(gear, '{head}', hd),
      headlamp_on = headlamp_on and (hd->>'b')::float8 > 0, nvg_on = nvg_on and (hd->>'b')::float8 > 0
    where id = p_id;
  end if;
  select * into me from zr_players where id = p_id;

  -- returning from hiding (humans only)
  if me.last_seen is not null and me.state = 'human' then
    gap := extract(epoch from now() - me.last_seen);
    if gap > 120 and not me.was_sheltered then
      marked := me.near_zombie;
      for h in 0 .. least(floor(gap / 3600)::int - 1, 96) loop
        hr := zr_local_hour(me.tz_offset, me.last_seen + make_interval(hours => h));
        if me.safe_start is null or ((hr - me.safe_start + 24) % 24) >= 8 then drain := drain + 2; end if;
      end loop;
      update zr_players set
        exposed_until = now() + case when marked then interval '5 minutes' else interval '2 minutes' end,
        supplies = greatest(0, supplies - drain)
      where id = p_id;
      insert into zr_events(kind, target, info)
        values ('returned', p_id, json_build_object('marked', marked, 'drain', drain, 'secs', case when marked then 300 else 120 end));
      if me.lat is not null then
        insert into zr_events(kind, actor, target, info)
        select 'emerged', p_id, z2.id, json_build_object('handle', me.handle)
        from zr_players z2
        where z2.state = 'zombie' and z2.id <> p_id and z2.last_seen > now() - interval '20 seconds'
          and z2.lat is not null and zr_dist(z2.lat, z2.lng, me.lat, me.lng) <= 45.72;
      end if;
    end if;
  end if;

  -- patient zero seeding
  if not me.pz_checked and me.lat is not null then
    select count(*), count(*) filter (where state = 'zombie' or inf_left is not null) into n, zc
    from zr_players q
    where q.lat is not null and q.last_seen > now() - interval '7 days'
      and zr_dist(q.lat, q.lng, me.lat, me.lng) <= 5000 and q.id <> p_id;
    n := n + 1;
    need := case when n >= 2 then ceil(n * 0.1)::int else 0 end;
    if zc < need then
      update zr_players set state = 'zombie', patient_zero = true, inf_left = null, hp = 100 where id = p_id;
      insert into zr_events(kind, target, info) values ('patient_zero', p_id, '{}'::json);
    end if;
    update zr_players set pz_checked = true where id = p_id;
  end if;

  select * into me from zr_players where id = p_id;
  update zr_players set
    last_seen = now(),
    was_sheltered = zr_sheltered(me),
    near_zombie = (me.state = 'human' and me.lat is not null and exists (
      select 1 from zr_players z3 where z3.state = 'zombie' and z3.id <> p_id and coalesce(z3.down_until, now()) <= now()
        and z3.last_seen > now() - interval '20 seconds' and z3.lat is not null
        and zr_dist(z3.lat, z3.lng, me.lat, me.lng) <= bite_r + 5))
  where id = p_id;
  select * into me from zr_players where id = p_id;

  -- zombie walks into claymores / past road flares
  if me.state = 'zombie' and coalesce(me.down_until, now()) <= now() and me.lat is not null then
    for mine in select * from zr_mines where kind = 'claymore' and owner <> p_id and until > now()
                and zr_dist(lat, lng, me.lat, me.lng) <= 10 order by created limit 1 loop
      update zr_mines set until = now() - interval '1 second' where id = mine.id;
      boom := zr_damage(p_id, 100, 1, mine.owner);
      perform zr_ping(mine.lat, mine.lng, 400, 60, mine.owner, 'explosion');
      insert into zr_events(kind, actor, target, info) values ('mine_boom', p_id, mine.owner, boom);
    end loop;
    insert into zr_events(kind, actor, target, info)
    select 'flare_cross', p_id, f.owner, '{}'::jsonb from zr_mines f
    where f.kind = 'flare' and f.owner <> p_id and f.created > now() - interval '10 minutes'
      and zr_dist(f.lat, f.lng, me.lat, me.lng) <= 20
      and not exists (select 1 from zr_events e where e.kind = 'flare_cross' and e.actor = p_id and e.target = f.owner
                      and e.at > now() - interval '2 minutes');
    select * into me from zr_players where id = p_id;
  end if;

  v_others := '[]'::json; v_ripples := '[]'::json; v_caches := '[]'::json; v_bags := '[]'::json;
  v_mines := '[]'::json; v_reveals := '[]'::json; v_beacons := '[]'::json;

  if me.lat is not null then
    lamp_ok := me.headlamp_on and me.gear->'head'->>'t' = 'headlamp' and coalesce((me.gear->'head'->>'b')::float8, 0) > 0;
    nvg_on_ok := me.nvg_on and me.gear->'head'->>'t' = 'nvg' and coalesce((me.gear->'head'->>'b')::float8, 0) > 0;
    radar := case when lamp_ok or me.boost_until > now() then 200 else 100 end;

    if me.state = 'human' then
      select coalesce(json_agg(o), '[]'::json) into v_others from (
        select q.id, q.handle,
          case when q.state = 'zombie' then 'zombie' when q.inf_left is not null then 'infected' else 'human' end as state,
          q.patient_zero, q.infections, q.cures,
          (q.d <= bite_r + 5) as exact,
          case when q.d <= bite_r + 5 then q.lat else floor(q.lat / 0.0006) * 0.0006 + 0.0003 end as lat,
          case when q.d <= bite_r + 5 then q.lng else floor(q.lng / 0.0008) * 0.0008 + 0.0004 end as lng,
          case when q.d <= 50 then round(q.d / 5) * 5 else round(q.d / 10) * 10 end as dist,
          case when q.state = 'zombie' then q.hp end as hp,
          case when q.state = 'zombie' then coalesce((q.z_head->>'d')::int, 0) + coalesce((q.z_armor->>'d')::int, 0) end as shell,
          (q.state = 'zombie' and q.d <= 30 and not (zr_live(q.z_armor) and q.z_armor->>'t' = 'tracksuit')) as close,
          (q.stunned_until > now()) as stunned
        from (select q0.*, zr_dist(me.lat, me.lng, q0.lat, q0.lng) as d from zr_players q0
              where q0.id <> p_id and q0.lat is not null and q0.last_seen > now() - interval '20 seconds'
                and not q0.was_sheltered and coalesce(q0.down_until, now()) <= now()) q
        where not zr_blocked(p_id, q.id)
          and ((q.state = 'human' and q.d <= 250)
            or (q.state = 'zombie' and (
                  q.d <= radar * (case when zr_live(q.z_armor) and q.z_armor->>'t' = 'ghillie' and not nvg_on_ok then 0.6 else 1 end)
               or exists (select 1 from zr_reveals r where r.owner = p_id and r.until > now()
                          and zr_dist(r.lat, r.lng, q.lat, q.lng) <= r.radius)
               or exists (select 1 from zr_mines f where f.owner = p_id and f.kind = 'flare' and f.created > now() - interval '10 minutes'
                          and zr_dist(f.lat, f.lng, q.lat, q.lng) <= 20))))
        order by q.d limit 60
      ) o;

      select coalesce(json_agg(json_build_object('id', id, 'kind', kind, 'lat', lat, 'lng', lng,
               'left', greatest(0, extract(epoch from (case when kind = 'flare' then created + interval '10 minutes' else until end) - now()))::int)), '[]'::json)
        into v_mines from zr_mines where owner = p_id and until > now();
      select coalesce(json_agg(json_build_object('lat', lat, 'lng', lng, 'radius', radius, 'kind', kind,
               'left', greatest(0, extract(epoch from until - now()))::int)), '[]'::json)
        into v_reveals from zr_reveals where owner = p_id and until > now();
    else
      -- zombie view: allies, humans in bite range, sound ripples, flare beacons
      select coalesce(json_agg(o), '[]'::json) into v_others from (
        select q.id, q.handle,
          case when q.state = 'zombie' or q.disguised_until > now() then 'zombie' else 'human' end as state,
          q.patient_zero, q.infections, q.cures,
          (q.d <= bite_r + 5 or (q.state = 'human' and q.exposed_until > now() and q.d <= 48.72)) as exact,
          case when q.d <= bite_r + 5 or (q.state = 'human' and q.exposed_until > now() and q.d <= 48.72)
               then q.lat else floor(q.lat / 0.0006) * 0.0006 + 0.0003 end as lat,
          case when q.d <= bite_r + 5 or (q.state = 'human' and q.exposed_until > now() and q.d <= 48.72)
               then q.lng else floor(q.lng / 0.0008) * 0.0008 + 0.0004 end as lng,
          case when q.d <= 50 then round(q.d / 5) * 5 else round(q.d / 10) * 10 end as dist,
          (q.exposed_until > now()) as exposed, (q.inf_left is not null) as infected
        from (select q0.*, zr_dist(me.lat, me.lng, q0.lat, q0.lng) as d from zr_players q0
              where q0.id <> p_id and q0.lat is not null and q0.last_seen > now() - interval '20 seconds'
                and not q0.was_sheltered and coalesce(q0.down_until, now()) <= now()) q
        where not zr_blocked(p_id, q.id)
          and ((q.state = 'zombie' and q.d <= 400)
            or (q.state = 'human' and (q.d <= bite_r + 5 or (q.exposed_until > now() and q.d <= 48.72))))
        order by q.d limit 60
      ) o;

      select coalesce(json_agg(r), '[]'::json) into v_ripples from (
        select * from (
          select floor(h.lat / 0.0006) * 0.0006 + 0.0003 as lat, floor(h.lng / 0.0008) * 0.0008 + 0.0004 as lng,
                 'move' as kind, round(zr_dist(me.lat, me.lng, h.lat, h.lng) / 10) * 10 as dist, round(zr_ring(h)) as r
          from zr_players h
          where h.state = 'human' and h.lat is not null and h.last_seen > now() - interval '20 seconds'
            and not h.was_sheltered and coalesce(h.disguised_until, now()) <= now()
            and zr_dist(me.lat, me.lng, h.lat, h.lng) > bite_r + 5
            and not (h.exposed_until > now() and zr_dist(me.lat, me.lng, h.lat, h.lng) <= 48.72)
            and zr_dist(me.lat, me.lng, h.lat, h.lng) <= 50 + zr_ring(h) and not zr_blocked(p_id, h.id)
          union all
          select floor(pg.lat / 0.0006) * 0.0006 + 0.0003, floor(pg.lng / 0.0008) * 0.0008 + 0.0004,
                 pg.kind, round(zr_dist(me.lat, me.lng, pg.lat, pg.lng) / 10) * 10, round(pg.radius)
          from zr_pings pg
          where pg.until > now() and coalesce(pg.src, '00000000-0000-0000-0000-000000000000'::uuid) <> p_id
            and zr_dist(me.lat, me.lng, pg.lat, pg.lng) <= 50 + pg.radius
        ) x order by dist limit 40
      ) r;

      select coalesce(json_agg(json_build_object('lat', lat, 'lng', lng)), '[]'::json) into v_beacons
      from zr_mines where kind = 'flare' and until > now() and zr_dist(lat, lng, me.lat, me.lng) <= 120;
    end if;

    ci := floor(me.lat / 0.003)::int; cj := floor(me.lng / 0.004)::int;
    select coalesce(json_agg(c), '[]'::json) into v_caches from (
      select * from (
        select 'g:' || gi || ':' || gj as id, false as sponsored, null::text as name, cp.lat, cp.lng,
          zr_cache_tier('g:' || gi || ':' || gj) as tier,
          zr_dist(me.lat, me.lng, cp.lat, cp.lng) as dist,
          greatest(0, 3600 - extract(epoch from now() - l.looted_at))::int as cooldown,
          greatest(0, extract(epoch from coalesce(cs.destroyed_until, now()) - now()))::int as destroyed
        from generate_series(ci - 2, ci + 2) as gs1(gi) cross join generate_series(cj - 2, cj + 2) as gs2(gj)
             cross join lateral zr_cache_pos(gi, gj) cp
             left join zr_loots l on l.player_id = p_id and l.cache_id = 'g:' || gi || ':' || gj
             left join zr_cache_state cs on cs.cache_id = 'g:' || gi || ':' || gj
        union all
        select 's:' || s.id, true, s.name, s.lat, s.lng, 'military', zr_dist(me.lat, me.lng, s.lat, s.lng),
          greatest(0, 3600 - extract(epoch from now() - l.looted_at))::int,
          greatest(0, extract(epoch from coalesce(cs.destroyed_until, now()) - now()))::int
        from zr_sponsors s left join zr_loots l on l.player_id = p_id and l.cache_id = 's:' || s.id
             left join zr_cache_state cs on cs.cache_id = 's:' || s.id
        where s.active
      ) all_c where dist <= 800 order by dist
    ) c;

    select coalesce(json_agg(json_build_object('id', b.id, 'lat', b.lat, 'lng', b.lng,
             'n', jsonb_array_length(b.items), 'dist', round(zr_dist(me.lat, me.lng, b.lat, b.lng)))), '[]'::json)
      into v_bags from zr_bags b where b.until > now() and zr_dist(me.lat, me.lng, b.lat, b.lng) <= 800;
  end if;

  select coalesce(json_agg(e order by e.at), '[]'::json) into v_events from (
    select ev.id, ev.at, ev.kind, ev.info, (ev.actor = p_id) as mine,
      (select handle from zr_players where id = case when ev.actor = p_id then ev.target else ev.actor end) as other
    from zr_events ev
    where (ev.target = p_id or ev.actor = p_id) and ev.at > coalesce(p_since, now() - interval '30 seconds')
    order by ev.at desc limit 30
  ) e;

  select json_build_object('name', name, 'ends_at', ends_at) into v_season from zr_seasons where id = me.season_id;

  return json_build_object(
    'now', now(),
    'me', json_build_object(
      'id', me.id, 'handle', me.handle, 'state', me.state, 'patient_zero', me.patient_zero,
      'lat', me.lat, 'lng', me.lng, 'acc', me.acc, 'speed', me.speed,
      'infected', me.inf_left is not null, 'inf_left', round(me.inf_left),
      'inf_rate', case when me.inf_left is null then 0 when me.epi_until > now() and me.speed >= 0.6 then 0
                       when me.cryo_until > now() then 0.5 else 1 end,
      'exposed', greatest(0, extract(epoch from coalesce(me.exposed_until, now()) - now()))::int,
      'stunned', greatest(0, extract(epoch from coalesce(me.stunned_until, now()) - now()))::int,
      'blinded', greatest(0, extract(epoch from coalesce(me.blinded_until, now()) - now()))::int,
      'down', greatest(0, extract(epoch from coalesce(me.down_until, now()) - now()))::int,
      'cryo', greatest(0, extract(epoch from coalesce(me.cryo_until, now()) - now()))::int,
      'epi', greatest(0, extract(epoch from coalesce(me.epi_until, now()) - now()))::int,
      'boost', greatest(0, extract(epoch from coalesce(me.boost_until, now()) - now()))::int,
      'disguised', greatest(0, extract(epoch from coalesce(me.disguised_until, now()) - now()))::int,
      'hp', me.hp, 'z_head', me.z_head, 'z_armor', me.z_armor, 'shell', zr_shell(me),
      'gear', me.gear, 'pack', me.pack, 'bag', me.bag, 'cap', zr_cap(me.bag),
      'headlamp_on', me.headlamp_on, 'nvg_on', me.nvg_on,
      'eq_ready', json_build_object(
        'eq1', greatest(0, extract(epoch from coalesce((me.eq_ready->>'eq1')::timestamptz, now()) - now()))::int,
        'eq2', greatest(0, extract(epoch from coalesce((me.eq_ready->>'eq2')::timestamptz, now()) - now()))::int),
      'last_attack', me.last_attack,
      'bite_time', zr_bite_time(me), 'ring', round(zr_ring(me)),
      'supplies', me.supplies, 'sheltered', me.was_sheltered,
      'home', me.home_lat is not null, 'safe_start', me.safe_start, 'minor', zr_is_minor(me),
      'points', me.points, 'infections', me.infections, 'cures', me.cures),
    'others', v_others, 'ripples', v_ripples, 'beacons', v_beacons, 'caches', v_caches, 'bags', v_bags,
    'mines', v_mines, 'reveals', v_reveals, 'events', v_events, 'season', v_season);
end $$;

-- ---------------- BITES ----------------
create or replace function zr_bite_check(me zr_players, t zr_players) returns text
language plpgsql stable security definer set search_path = public as $$
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
  d := zr_dist(me.lat, me.lng, t.lat, t.lng);
  if d > (case when t.exposed_until > now() then 45.72 else 15.24 end) + 3 then return 'too_far'; end if;
  select count(*) into grp from zr_players g
  where g.state = 'human' and g.inf_left is null and g.lat is not null
    and g.last_seen > now() - interval '20 seconds' and not g.was_sheltered
    and zr_dist(g.lat, g.lng, t.lat, t.lng) <= 15.24;
  if grp >= 3 then return 'group'; end if;
  return null;
end $$;

create or replace function zr_bite_start(p_id uuid, p_secret text, p_target uuid) returns json
language plpgsql security definer set search_path = public as $$
declare me zr_players; t zr_players; why text; secs float8; g jsonb; hl int; broke text[] := '{}';
begin
  me := zr_me(p_id, p_secret);
  perform zr_tick_world();
  select * into me from zr_players where id = p_id;
  select * into t from zr_players where id = p_target;
  why := zr_bite_check(me, t);
  if why is not null then return json_build_object('error', why); end if;
  secs := zr_bite_time(t);
  g := t.gear;
  if zr_live(g->'head') then
    select hit_loss into hl from zr_items where zr_items.t = g->'head'->>'t';
    if (g->'head'->>'d')::int - coalesce(hl, 0) <= 0 then broke := broke || (g->'head'->>'t'); g := g - 'head';
    else g := jsonb_set(g, '{head,d}', to_jsonb((g->'head'->>'d')::int - coalesce(hl, 0))); end if;
  end if;
  if zr_live(g->'armor') then
    select hit_loss into hl from zr_items where zr_items.t = g->'armor'->>'t';
    if (g->'armor'->>'d')::int - coalesce(hl, 0) <= 0 then broke := broke || (g->'armor'->>'t'); g := g - 'armor';
    else g := jsonb_set(g, '{armor,d}', to_jsonb((g->'armor'->>'d')::int - coalesce(hl, 0))); end if;
  end if;
  update zr_players set gear = g, headlamp_on = headlamp_on and g->'head' is not null,
    nvg_on = nvg_on and g->'head' is not null where id = t.id;
  update zr_players set bite_target = p_target, bite_started = now(), bite_secs = secs where id = p_id;
  insert into zr_events(kind, actor, target, info)
    values ('bite_warning', p_id, p_target, jsonb_build_object('secs', secs, 'broke', to_jsonb(broke)));
  return json_build_object('ok', true, 'hold', secs);
end $$;

create or replace function zr_bite_finish(p_id uuid, p_secret text) returns json
language plpgsql security definer set search_path = public as $$
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
  update zr_players set inf_left = 300, inf_tick = now(), infected_at = now(), infected_by = p_id where id = t.id;
  update zr_players set points = points + 10, infections = infections + 1 where id = p_id;
  if me.infected_by is not null then
    update zr_players set points = points + 5 where id = me.infected_by;
    insert into zr_events(kind, actor, target, info) values ('bloodline', t.id, me.infected_by, json_build_object('via', me.handle));
  end if;
  insert into zr_events(kind, actor, target, info) values ('bitten', p_id, t.id, '{}'::json);
  return json_build_object('result', 'infected', 'handle', t.handle);
end $$;

-- ---------------- HUMAN ATTACKS ----------------
create or replace function zr_attack(p_id uuid, p_secret text, p_target uuid) returns json
language plpgsql security definer set search_path = public as $$
declare me zr_players; t zr_players; w zr_items; wt text; cd float8; rng float8; dmg int; tg int; pr int; ps int;
  res jsonb; hits jsonb := '[]'::jsonb; z record; stun boolean := false; k int := 0;
begin
  me := zr_me(p_id, p_secret);
  perform zr_tick_world();
  select * into me from zr_players where id = p_id;
  if me.state <> 'human' then return json_build_object('error', 'zombies_cant'); end if;
  if me.exposed_until > now() then return json_build_object('error', 'exposed'); end if;
  if me.lat is null or me.fix_at < now() - interval '20 seconds' then return json_build_object('error', 'weak_gps'); end if;
  wt := coalesce(me.gear->'weapon'->>'t', 'shove');
  if wt = 'shove' then cd := 15; rng := 15; dmg := 0; tg := 1; pr := 5; ps := 3;
  else select * into w from zr_items where zr_items.t = wt; cd := w.cd; rng := w.range_m; dmg := w.dmg; tg := w.targets; pr := w.ping_r; ps := w.ping_s; end if;
  if me.last_attack > now() - make_interval(secs => cd) then
    return json_build_object('error', 'cooldown', 'left', round(extract(epoch from me.last_attack + make_interval(secs => cd) - now())::numeric, 1));
  end if;
  select * into t from zr_players where id = p_target;
  if t.id is null or t.state <> 'zombie' or t.down_until > now() or t.last_seen < now() - interval '20 seconds' or t.lat is null then
    return json_build_object('error', 'no_target'); end if;
  if zr_dist(me.lat, me.lng, t.lat, t.lng) > rng + 5 then return json_build_object('error', 'out_of_range', 'range', rng); end if;

  update zr_players set last_attack = now() where id = p_id;
  perform zr_ping(me.lat, me.lng, pr, ps, p_id, wt);

  for z in select q.id from zr_players q
           where q.state = 'zombie' and coalesce(q.down_until, now()) <= now() and q.last_seen > now() - interval '20 seconds'
             and q.lat is not null and (q.id = t.id or zr_dist(me.lat, me.lng, q.lat, q.lng) <= rng + 5)
           order by (q.id = t.id) desc, zr_dist(me.lat, me.lng, q.lat, q.lng) limit tg loop
    k := k + 1;
    if wt = 'shove' then
      update zr_players set stunned_until = greatest(coalesce(stunned_until, now()), now() + interval '10 seconds'),
        bite_target = null where id = z.id;
      insert into zr_events(kind, actor, target, info) values ('stunned', p_id, z.id, '{"secs":10}'::jsonb);
      res := jsonb_build_object('handle', (select handle from zr_players where id = z.id), 'stunned', 10);
    else
      res := zr_damage(z.id, dmg, case when wt = 'crowbar' then 1.5 else 1 end, p_id);
      if wt = 'bat' and k = 1 then
        update zr_players set bat_hits = bat_hits + 1 where id = p_id returning (bat_hits % 3 = 0) into stun;
        if stun and not coalesce((res->>'killed')::boolean, false) then
          update zr_players set stunned_until = now() + interval '3 minutes', bite_target = null where id = z.id;
          insert into zr_events(kind, actor, target, info) values ('stunned', p_id, z.id, '{"secs":180}'::jsonb);
          update zr_players set points = points + 2 where id = p_id;
          res := res || '{"stunned":180}'::jsonb;
        end if;
      end if;
    end if;
    hits := hits || jsonb_build_array(res);
  end loop;
  return json_build_object('result', 'hit', 'weapon', wt, 'hits', hits, 'cd', cd);
end $$;

-- ---------------- EQUIP-SLOT ITEMS ----------------
create or replace function zr_use(p_id uuid, p_secret text, p_slot text, p_target uuid default null,
  p_lat float8 default null, p_lng float8 default null) returns json
language plpgsql security definer set search_path = public as $$
declare me zr_players; it jsonb; tt text; g jsonb; b float8; cost int := 0; out json; cnt int; z record;
  best text; bestb float8; s text; rr text; d float8; mx int; other zr_players;
begin
  me := zr_me(p_id, p_secret);
  perform zr_tick_world();
  select * into me from zr_players where id = p_id;
  if me.state <> 'human' then return json_build_object('error', 'zombies_cant'); end if;
  if p_slot not in ('eq1', 'eq2') then return json_build_object('error', 'bad_slot'); end if;
  if me.exposed_until > now() then return json_build_object('error', 'exposed'); end if;
  if me.supplies <= 0 then return json_build_object('error', 'no_supplies'); end if;
  it := me.gear->p_slot;
  if it is null then return json_build_object('error', 'empty'); end if;
  if (me.eq_ready->>p_slot)::timestamptz > now() then
    return json_build_object('error', 'equipping', 'left', ceil(extract(epoch from (me.eq_ready->>p_slot)::timestamptz - now())));
  end if;
  tt := it->>'t'; g := me.gear; b := coalesce((it->>'b')::float8, 0);
  cost := case tt when 'maglite' then 10 when 'radio' then 10 when 'stungun' then 20 when 'cryocase' then 25 else 0 end;
  if cost > 0 and b < cost then return json_build_object('error', 'battery'); end if;
  if tt in ('maglite','radio','stungun','cryocase','claymore','roadflare','drone','bearspray') and (me.lat is null or me.fix_at < now() - interval '30 seconds')
    then return json_build_object('error', 'weak_gps'); end if;

  if tt = 'maglite' then
    update zr_players set boost_until = now() + interval '3 minutes' where id = p_id;
    out := json_build_object('result', 'boost');
  elsif tt = 'radio' then
    insert into zr_reveals(owner, lat, lng, radius, until, kind) values (p_id, me.lat, me.lng, 150, now() + interval '15 seconds', 'radio');
    out := json_build_object('result', 'radio');
  elsif tt = 'stungun' then
    select q.id, q.handle into z from zr_players q
    where q.state = 'zombie' and coalesce(q.down_until, now()) <= now() and q.last_seen > now() - interval '20 seconds'
      and q.lat is not null and zr_dist(me.lat, me.lng, q.lat, q.lng) <= 20
    order by zr_dist(me.lat, me.lng, q.lat, q.lng) limit 1;
    if not found then return json_build_object('error', 'no_target'); end if;
    update zr_players set stunned_until = now() + interval '6 minutes', bite_target = null where id = z.id;
    insert into zr_events(kind, actor, target, info) values ('stunned', p_id, z.id, '{"secs":360}'::jsonb);
    perform zr_ping(me.lat, me.lng, 30, 10, p_id, 'stungun');
    update zr_players set points = points + 2 where id = p_id;
    out := json_build_object('result', 'stunned', 'handle', z.handle);
  elsif tt = 'cryocase' then
    if me.inf_left is null then return json_build_object('error', 'not_infected'); end if;
    perform zr_tick_inf(p_id, false);
    update zr_players set cryo_until = now() + interval '5 minutes' where id = p_id;
    out := json_build_object('result', 'cryo');
  elsif tt = 'ducttape' then
    best := null; bestb := 2;
    foreach s in array array['head', 'armor'] loop
      if zr_live(g->s) then
        select dur into mx from zr_items where t = g->s->>'t';
        d := (g->s->>'d')::float8;
        if d < mx and d / mx < bestb then best := s; bestb := d / mx; end if;
      end if;
    end loop;
    if best is null then return json_build_object('error', 'nothing_to_repair'); end if;
    select dur into mx from zr_items where t = g->best->>'t';
    g := jsonb_set(g, array[best, 'd'], to_jsonb(least(mx, (g->best->>'d')::int + 35)));
    out := json_build_object('result', 'repaired', 'slot', best);
  elsif tt in ('powerbank', 'aa') then
    best := null; bestb := 100;
    foreach s in array array['head', 'eq1', 'eq2'] loop
      if s <> p_slot and g->s is not null and g->s ? 'b' and (g->s->>'b')::float8 < bestb then best := s; bestb := (g->s->>'b')::float8; end if;
    end loop;
    if best is null then return json_build_object('error', 'nothing_to_charge'); end if;
    g := jsonb_set(g, array[best, 'b'], to_jsonb(least(100, bestb + 50)));
    out := json_build_object('result', 'charged', 'slot', best);
  elsif tt = 'bearspray' then
    update zr_players set bite_target = null, bite_started = null where bite_target = p_id;
    with hit as (
      update zr_players q set blinded_until = now() + interval '4 seconds', bite_target = null
      where q.state = 'zombie' and q.last_seen > now() - interval '20 seconds' and q.lat is not null
        and zr_dist(me.lat, me.lng, q.lat, q.lng) <= 20 returning q.id)
    , ev as (insert into zr_events(kind, actor, target, info) select 'blinded', p_id, id, '{}'::jsonb from hit returning 1)
    select count(*) into cnt from ev;
    perform zr_ping(me.lat, me.lng, 45, 5, p_id, 'bearspray');
    out := json_build_object('result', 'sprayed', 'blinded', cnt);
  elsif tt = 'roadflare' then
    insert into zr_mines(owner, kind, lat, lng, until) values (p_id, 'flare', me.lat, me.lng, now() + interval '30 minutes');
    perform zr_ping(me.lat, me.lng, 15, 5, p_id, 'flare');
    out := json_build_object('result', 'flare');
  elsif tt = 'epipen' then
    if me.inf_left is null then return json_build_object('error', 'not_infected'); end if;
    perform zr_tick_inf(p_id, me.speed >= 0.6);
    update zr_players set epi_until = now() + interval '3 minutes' where id = p_id;
    out := json_build_object('result', 'epi');
  elsif tt = 'pills' then
    if me.inf_left is null then return json_build_object('error', 'not_infected'); end if;
    perform zr_tick_inf(p_id, me.speed >= 0.6);
    update zr_players set inf_left = inf_left + 1200 where id = p_id;
    out := json_build_object('result', 'pills');
  elsif tt = 'antiviral' then
    if p_target is null or p_target = p_id then
      rr := zr_cure(p_id, p_id);
    else
      select * into other from zr_players where id = p_target;
      if other.id is null or other.last_seen < now() - interval '20 seconds' or other.lat is null or me.lat is null
         or zr_dist(me.lat, me.lng, other.lat, other.lng) > 20 then return json_build_object('error', 'too_far'); end if;
      rr := zr_cure(p_target, p_id);
    end if;
    if rr <> 'cured' then return json_build_object('error', rr); end if;
    select * into me from zr_players where id = p_id; g := me.gear;
    out := json_build_object('result', 'cured', 'self', p_target is null or p_target = p_id);
  elsif tt = 'scentspray' then
    update zr_players set disguised_until = now() + interval '3 minutes' where id = p_id;
    out := json_build_object('result', 'disguised');
  elsif tt = 'claymore' then
    insert into zr_mines(owner, kind, lat, lng, until) values (p_id, 'claymore', me.lat, me.lng, now() + interval '24 hours');
    out := json_build_object('result', 'mine');
  elsif tt = 'drone' then
    if p_lat is null or p_lng is null then return json_build_object('error', 'need_pin'); end if;
    if zr_dist(me.lat, me.lng, p_lat, p_lng) > 200 then return json_build_object('error', 'pin_too_far'); end if;
    insert into zr_reveals(owner, lat, lng, radius, until, kind) values (p_id, p_lat, p_lng, 50, now() + interval '2 minutes', 'drone');
    perform zr_ping(me.lat, me.lng, 25, 5, p_id, 'drone');
    out := json_build_object('result', 'drone');
  else
    return json_build_object('error', 'cant_use');
  end if;

  -- spend the item
  select kind into s from zr_items where t = tt;
  if s = 'consumable' then
    g := g - p_slot;
  else
    it := g->p_slot;
    it := jsonb_set(it, '{d}', to_jsonb(coalesce((it->>'d')::int, 1) - 1));
    if it ? 'b' then it := jsonb_set(it, '{b}', to_jsonb(greatest(0, (it->>'b')::float8 - cost))); end if;
    if (it->>'d')::int <= 0 then g := g - p_slot; else g := jsonb_set(g, array[p_slot], it); end if;
  end if;
  update zr_players set gear = g where id = p_id;
  return out;
end $$;

create or replace function zr_toggle(p_id uuid, p_secret text) returns json
language plpgsql security definer set search_path = public as $$
declare me zr_players; hd jsonb; v boolean;
begin
  me := zr_me(p_id, p_secret);
  hd := me.gear->'head';
  if hd is null or hd->>'t' not in ('headlamp', 'nvg') then return json_build_object('error', 'no_light'); end if;
  if coalesce((hd->>'b')::float8, 0) <= 0 then return json_build_object('error', 'battery'); end if;
  if hd->>'t' = 'headlamp' then update zr_players set headlamp_on = not headlamp_on where id = p_id returning headlamp_on into v;
    return json_build_object('result', case when v then 'on' else 'off' end);
  else update zr_players set nvg_on = not nvg_on where id = p_id returning nvg_on into v;
    return json_build_object('result', case when v then 'on' else 'off' end);
  end if;
end $$;

-- ---------------- INVENTORY ----------------
create or replace function zr_inv(p_id uuid, p_secret text, p_action text, p_from text, p_index int default null, p_to text default null)
returns json language plpgsql security definer set search_path = public as $$
declare me zr_players; g jsonb; pk jsonb; it jsonb; s text; old jsonb; tgt text; newcap int; cnt int; oldbag text; dropped jsonb;
begin
  me := zr_me(p_id, p_secret);
  if me.state <> 'human' then return json_build_object('error', 'zombies_cant'); end if;
  g := me.gear; pk := me.pack;

  if p_action = 'equip' then
    if p_from <> 'pack' or p_index is null or p_index < 0 or p_index >= jsonb_array_length(pk) then return json_build_object('error', 'bad_index'); end if;
    it := pk->p_index; pk := pk - p_index;
    select slot into s from zr_items where t = it->>'t';
    if s in ('weapon', 'head', 'armor') then
      old := g->s; g := g || jsonb_build_object(s, it);
      if old is not null then pk := pk || jsonb_build_array(old); end if;
      update zr_players set gear = g, pack = pk,
        headlamp_on = case when s = 'head' then false else headlamp_on end,
        nvg_on = case when s = 'head' then false else nvg_on end where id = p_id;
      return json_build_object('result', 'equipped', 'slot', s);
    elsif s = 'eq' then
      tgt := coalesce(p_to, case when g->'eq1' is null then 'eq1' when g->'eq2' is null then 'eq2' else 'eq1' end);
      if tgt not in ('eq1', 'eq2') then return json_build_object('error', 'bad_slot'); end if;
      old := g->tgt; g := g || jsonb_build_object(tgt, it);
      if old is not null then pk := pk || jsonb_build_array(old); end if;
      update zr_players set gear = g, pack = pk,
        eq_ready = eq_ready || jsonb_build_object(tgt, now() + interval '10 seconds') where id = p_id;
      return json_build_object('result', 'equipping', 'slot', tgt, 'secs', 10);
    elsif s = 'bag' then
      newcap := zr_cap(it->>'t'); oldbag := me.bag;
      cnt := jsonb_array_length(pk) + case when oldbag <> 'none' then 1 else 0 end;
      if cnt > newcap then return json_build_object('error', 'too_full'); end if;
      if oldbag <> 'none' then pk := pk || jsonb_build_array(zr_new_item(oldbag)); end if;
      update zr_players set bag = it->>'t', pack = pk where id = p_id;
      return json_build_object('result', 'equipped', 'slot', 'bag');
    end if;
    return json_build_object('error', 'cant_equip');

  elsif p_action = 'unequip' then
    if p_from not in ('weapon', 'head', 'armor', 'eq1', 'eq2') or g->p_from is null then return json_build_object('error', 'empty'); end if;
    if jsonb_array_length(pk) >= zr_cap(me.bag) then return json_build_object('error', 'pack_full'); end if;
    pk := pk || jsonb_build_array(g->p_from); g := g - p_from;
    update zr_players set gear = g, pack = pk,
      headlamp_on = case when p_from = 'head' then false else headlamp_on end,
      nvg_on = case when p_from = 'head' then false else nvg_on end where id = p_id;
    return json_build_object('result', 'unequipped');

  elsif p_action = 'drop' then
    if me.lat is null then return json_build_object('error', 'weak_gps'); end if;
    if p_from = 'pack' then
      if p_index is null or p_index < 0 or p_index >= jsonb_array_length(pk) then return json_build_object('error', 'bad_index'); end if;
      dropped := jsonb_build_array(pk->p_index); pk := pk - p_index;
    elsif p_from = 'bag' then
      if me.bag = 'none' then return json_build_object('error', 'empty'); end if;
      if jsonb_array_length(pk) > 2 then return json_build_object('error', 'too_full'); end if;
      dropped := jsonb_build_array(zr_new_item(me.bag));
      update zr_players set bag = 'none' where id = p_id;
    elsif p_from in ('weapon', 'head', 'armor', 'eq1', 'eq2') and g->p_from is not null then
      dropped := jsonb_build_array(g->p_from); g := g - p_from;
    else
      return json_build_object('error', 'empty');
    end if;
    perform zr_drop_bag(me.lat, me.lng, dropped, p_id);
    update zr_players set gear = g, pack = pk,
      headlamp_on = case when p_from = 'head' then false else headlamp_on end,
      nvg_on = case when p_from = 'head' then false else nvg_on end where id = p_id;
    return json_build_object('result', 'dropped');
  end if;
  return json_build_object('error', 'bad_action');
end $$;

-- ---------------- LOOT / BAGS / SMASH ----------------
create or replace function zr_loot(p_id uuid, p_secret text, p_cache text) returns json
language plpgsql security definer set search_path = public as $$
declare me zr_players; c_lat float8; c_lng float8; parts text[]; last timestamptz; tier text; k int; it jsonb; wh text;
  got jsonb := '[]'::jsonb; left_behind jsonb := '[]'::jsonb;
begin
  me := zr_me(p_id, p_secret);
  if me.state <> 'human' then return json_build_object('error', 'zombies_cant'); end if;
  if me.lat is null or me.fix_at < now() - interval '20 seconds' then return json_build_object('error', 'weak_gps'); end if;
  parts := string_to_array(p_cache, ':');
  if parts[1] = 'g' then select cp.lat, cp.lng into c_lat, c_lng from zr_cache_pos(parts[2]::int, parts[3]::int) cp;
  elsif parts[1] = 's' then select lat, lng into c_lat, c_lng from zr_sponsors where id = parts[2]::int and active; end if;
  if c_lat is null then return json_build_object('error', 'bad_cache'); end if;
  if zr_dist(me.lat, me.lng, c_lat, c_lng) > 35 then return json_build_object('error', 'too_far'); end if;
  if exists (select 1 from zr_cache_state where cache_id = p_cache and destroyed_until > now()) then return json_build_object('error', 'destroyed'); end if;
  select looted_at into last from zr_loots where player_id = p_id and cache_id = p_cache;
  if last > now() - interval '60 minutes' then return json_build_object('error', 'cooldown'); end if;
  tier := zr_cache_tier(p_cache);
  for k in 1 .. zr_cache_count(p_cache) loop
    it := zr_new_item(zr_roll(tier));
    wh := zr_place(p_id, it);
    if wh is null then left_behind := left_behind || jsonb_build_array(it); end if;
    got := got || jsonb_build_array(jsonb_build_object('t', it->>'t', 'where', coalesce(wh, 'ground')));
  end loop;
  perform zr_drop_bag(c_lat, c_lng, left_behind, p_id);
  update zr_players set supplies = least(100, supplies + 30) where id = p_id;
  insert into zr_loots(player_id, cache_id, looted_at) values (p_id, p_cache, now())
    on conflict (player_id, cache_id) do update set looted_at = now();
  return json_build_object('result', 'looted', 'tier', tier, 'items', got);
end $$;

create or replace function zr_take_bag(p_id uuid, p_secret text, p_bag bigint) returns json
language plpgsql security definer set search_path = public as $$
declare me zr_players; b zr_bags; it jsonb; wh text; got jsonb := '[]'::jsonb; rest jsonb := '[]'::jsonb;
begin
  me := zr_me(p_id, p_secret);
  if me.state <> 'human' then return json_build_object('error', 'zombies_cant'); end if;
  if me.lat is null or me.fix_at < now() - interval '20 seconds' then return json_build_object('error', 'weak_gps'); end if;
  select * into b from zr_bags where id = p_bag and until > now() for update;
  if b.id is null then return json_build_object('error', 'bad_cache'); end if;
  if zr_dist(me.lat, me.lng, b.lat, b.lng) > 35 then return json_build_object('error', 'too_far'); end if;
  for it in select value from jsonb_array_elements(b.items) loop
    wh := zr_place(p_id, it);
    if wh is null then rest := rest || jsonb_build_array(it);
    else got := got || jsonb_build_array(jsonb_build_object('t', it->>'t', 'where', wh)); end if;
  end loop;
  if jsonb_array_length(rest) = 0 then update zr_bags set until = now() - interval '1 second', items = '[]'::jsonb where id = p_bag;
  else update zr_bags set items = rest where id = p_bag; end if;
  return json_build_object('result', 'taken', 'items', got, 'left', jsonb_array_length(rest));
end $$;

create or replace function zr_smash(p_id uuid, p_secret text, p_ref text) returns json
language plpgsql security definer set search_path = public as $$
declare me zr_players; parts text[]; c_lat float8; c_lng float8; n int; b zr_bags;
begin
  me := zr_me(p_id, p_secret);
  perform zr_tick_world();
  select * into me from zr_players where id = p_id;
  if me.state <> 'zombie' then return json_build_object('error', 'not_zombie'); end if;
  if me.down_until > now() then return json_build_object('error', 'down'); end if;
  if me.stunned_until > now() then return json_build_object('error', 'stunned'); end if;
  if me.lat is null or me.fix_at < now() - interval '20 seconds' then return json_build_object('error', 'weak_gps'); end if;
  parts := string_to_array(p_ref, ':');
  if parts[1] = 'b' then
    select * into b from zr_bags where id = parts[2]::bigint and until > now() for update;
    if b.id is null then return json_build_object('error', 'bad_cache'); end if;
    if zr_dist(me.lat, me.lng, b.lat, b.lng) > 35 then return json_build_object('error', 'too_far'); end if;
    n := jsonb_array_length(b.items);
    update zr_bags set until = now() - interval '1 second', items = '[]'::jsonb where id = b.id;
  else
    if parts[1] = 'g' then select cp.lat, cp.lng into c_lat, c_lng from zr_cache_pos(parts[2]::int, parts[3]::int) cp;
    elsif parts[1] = 's' then select lat, lng into c_lat, c_lng from zr_sponsors where id = parts[2]::int and active; end if;
    if c_lat is null then return json_build_object('error', 'bad_cache'); end if;
    if zr_dist(me.lat, me.lng, c_lat, c_lng) > 35 then return json_build_object('error', 'too_far'); end if;
    if exists (select 1 from zr_cache_state where cache_id = p_ref and destroyed_until > now()) then return json_build_object('error', 'destroyed'); end if;
    n := zr_cache_count(p_ref);
    insert into zr_cache_state(cache_id, destroyed_until, by) values (p_ref, now() + interval '45 minutes', p_id)
      on conflict (cache_id) do update set destroyed_until = excluded.destroyed_until, by = excluded.by;
  end if;
  update zr_players set points = points + n * 2 where id = p_id;
  return json_build_object('result', 'smashed', 'items', n, 'points', n * 2);
end $$;

create or replace function zr_catalog() returns json language sql stable security definer set search_path = public as $$
  select json_agg(i order by i.slot, i.t) from zr_items i
$$;

revoke all on function zr_place(uuid, jsonb) from public, anon, authenticated;
revoke all on function zr_drop_bag(float8, float8, jsonb, uuid) from public, anon, authenticated;
revoke all on function zr_damage(uuid, float8, float8, uuid) from public, anon, authenticated;
revoke all on function zr_turn(uuid) from public, anon, authenticated;
revoke all on function zr_tick_inf(uuid, boolean) from public, anon, authenticated;
revoke all on function zr_tick_world() from public, anon, authenticated;
revoke all on function zr_cure(uuid, uuid) from public, anon, authenticated;
revoke all on function zr_bite_check(zr_players, zr_players) from public, anon, authenticated;
grant execute on function zr_heartbeat(uuid, text, float8, float8, float8, int, timestamptz, float8) to anon, authenticated;
grant execute on function zr_attack(uuid, text, uuid) to anon, authenticated;
grant execute on function zr_use(uuid, text, text, uuid, float8, float8) to anon, authenticated;
grant execute on function zr_toggle(uuid, text) to anon, authenticated;
grant execute on function zr_inv(uuid, text, text, text, int, text) to anon, authenticated;
grant execute on function zr_loot(uuid, text, text) to anon, authenticated;
grant execute on function zr_take_bag(uuid, text, bigint) to anon, authenticated;
grant execute on function zr_smash(uuid, text, text) to anon, authenticated;
grant execute on function zr_catalog() to anon, authenticated;
