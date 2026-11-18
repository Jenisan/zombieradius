-- v5 part B: offset combat, lockouts, channels, items, bunker stash, pause
create or replace function zr_bite_check(me zr_players, t zr_players) returns text
language plpgsql stable security definer set search_path to public as $$
declare d float8; grp int; tv record; mv record;
begin
  if me.state <> 'zombie' then return 'not_zombie'; end if;
  if me.down_until > now() then return 'down'; end if;
  if me.stunned_until > now() then return 'stunned'; end if;
  if me.blinded_until > now() then return 'blinded'; end if;
  if me.bite_lock_until > now() then return 'locked'; end if;
  if me.paused_until > now() then return 'paused'; end if;
  if not me.is_npc and (me.fix_at is null or me.fix_at < now() - interval '20 seconds' or me.acc > 35) then return 'weak_gps'; end if;
  if t.id is null or t.state <> 'human' or t.inf_left is not null then return 'not_target'; end if;
  if t.disguised_until > now() then return 'not_target'; end if;
  if zr_blocked(me.id, t.id) then return 'not_target'; end if;
  if t.paused_until > now() then return 'paused_t'; end if;
  if t.was_sheltered then return 'sheltered'; end if;
  if not zr_present(t) then return 'not_target'; end if;
  if not t.is_npc and t.acc > 35 then return 'target_gps'; end if;
  select * into tv from zr_vpos(t);
  select * into mv from zr_vpos(me);
  d := zr_dist(mv.vlat, mv.vlng, tv.vlat, tv.vlng);
  if d > 20 then return 'too_far'; end if;
  if not me.is_npc and not t.is_npc and zr_dist(me.lat, me.lng, t.lat, t.lng) < 25 then return 'too_close'; end if;
  select count(*) into grp from zr_players g
  where g.state = 'human' and g.inf_left is null and zr_present(g) and g.last_seen > now() - interval '20 seconds'
    and zr_dist(g.lat, g.lng, t.lat, t.lng) <= 15.24;
  if grp >= 3 then return 'group'; end if;
  return null;
end $$;

create or replace function zr_bite_start(p_id uuid, p_secret text, p_target uuid) returns json
language plpgsql security definer set search_path to public as $$
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
  update zr_players set gear = g, headlamp_on = headlamp_on and g->'head' is not null, nvg_on = nvg_on and g->'head' is not null,
    self_lock_until = null, self_lock_what = null, chan_kind = null, chan_ref = null, last_encounter = now() where id = t.id;
  update zr_players set bite_target = p_target, bite_started = now(), bite_secs = secs, last_encounter = now() where id = p_id;
  insert into zr_events(kind, actor, target, info) values ('bite_warning', p_id, p_target, jsonb_build_object('secs', secs, 'broke', to_jsonb(broke)));
  return json_build_object('ok', true, 'hold', secs);
end $$;

create or replace function zr_turn(p_id uuid) returns void
language plpgsql security definer set search_path to public as $$
declare p zr_players; items jsonb := '[]'::jsonb; zh jsonb; za jsonb; ch int; vp record;
begin
  select * into p from zr_players where id = p_id for update;
  if p.state = 'zombie' then return; end if;
  if p.gear->'weapon' is not null then items := items || jsonb_build_array(p.gear->'weapon'); end if;
  if p.gear->'eq1' is not null then items := items || jsonb_build_array(p.gear->'eq1'); end if;
  if p.gear->'eq2' is not null then items := items || jsonb_build_array(p.gear->'eq2'); end if;
  items := items || coalesce(p.pack, '[]'::jsonb);
  if p.bag is not null and p.bag <> 'none' then items := items || jsonb_build_array(zr_new_item(p.bag)); end if;
  select * into vp from zr_vpos(p);
  perform zr_bagit(vp.vlat, vp.vlng, items, null);
  if zr_live(p.gear->'head') then
    select carry_hp into ch from zr_items where t = p.gear->'head'->>'t';
    if ch > 0 then zh := jsonb_build_object('t', p.gear->'head'->>'t', 'd', least(ch, (p.gear->'head'->>'d')::int)); end if;
  end if;
  if zr_live(p.gear->'armor') then
    select carry_hp into ch from zr_items where t = p.gear->'armor'->>'t';
    if ch > 0 then za := jsonb_build_object('t', p.gear->'armor'->>'t', 'd', least(ch, (p.gear->'armor'->>'d')::int)); end if;
  end if;
  update zr_players set state = 'zombie', infected_at = null, inf_left = null, inf_tick = null, inf_pct = 100, inf_pct_at = now(),
    gear = '{}'::jsonb, pack = '[]'::jsonb, bag = 'none', hp = 100, down_until = null,
    z_head = zh, z_armor = za, headlamp_on = false, nvg_on = false, cryo_until = null, epi_until = null,
    eq_ready = '{}'::jsonb, bite_target = null, bite_started = null, self_lock_until = null, chan_kind = null
  where id = p_id;
  insert into zr_events(kind, target, info) values ('turned', p_id, jsonb_build_object('lost', jsonb_array_length(items),
      'shell', coalesce((zh->>'d')::int, 0) + coalesce((za->>'d')::int, 0)));
end $$;

create or replace function zr_attack(p_id uuid, p_secret text, p_target uuid) returns json
language plpgsql security definer set search_path to public as $$
declare me zr_players; t zr_players; w zr_items; wt text; cd float8; rng float8; dmg int; tg int; pr int; ps int; lock float8;
  res jsonb; hits jsonb := '[]'::jsonb; z record; stun boolean := false; k int := 0; tv record; mv record;
begin
  me := zr_me(p_id, p_secret);
  perform zr_tick_world();
  select * into me from zr_players where id = p_id;
  if me.state <> 'human' then return json_build_object('error', 'zombies_cant'); end if;
  if me.paused_until > now() then return json_build_object('error', 'paused'); end if;
  if me.self_lock_until > now() then return json_build_object('error', 'busy', 'what', me.self_lock_what); end if;
  if me.lat is null or me.fix_at < now() - interval '20 seconds' then return json_build_object('error', 'weak_gps'); end if;
  wt := coalesce(me.gear->'weapon'->>'t', 'shove');
  if wt = 'shove' then cd := 15; rng := 15; dmg := 0; tg := 1; pr := 15; ps := 3;
  else select * into w from zr_items where zr_items.t = wt; cd := w.cd; rng := w.range_m; dmg := w.dmg; tg := w.targets; pr := w.ping_r; ps := w.ping_s; end if;
  lock := case wt when 'shove' then 3 when 'bat' then 1.5 when 'crowbar' then 2 when 'shotgun' then 3 else 0 end;
  if me.last_attack > now() - make_interval(secs => cd) then
    return json_build_object('error', 'cooldown', 'left', round(extract(epoch from me.last_attack + make_interval(secs => cd) - now())::numeric, 1));
  end if;
  select * into t from zr_players where id = p_target;
  if t.id is null or t.state <> 'zombie' or t.down_until > now() or not zr_present(t) then return json_build_object('error', 'no_target'); end if;
  select * into tv from zr_vpos(t);
  select * into mv from zr_vpos(me);
  if zr_dist(mv.vlat, mv.vlng, tv.vlat, tv.vlng) > rng + 8 then return json_build_object('error', 'out_of_range', 'range', rng); end if;
  if not t.is_npc and zr_dist(me.lat, me.lng, t.lat, t.lng) < 25 then return json_build_object('error', 'too_close'); end if;
  update zr_players set last_attack = now(), last_encounter = now() where id = p_id;
  perform zr_ping(mv.vlat, mv.vlng, pr, ps, p_id, wt);
  for z in select q.id from zr_players q cross join lateral zr_vpos(q) qv
           where q.state = 'zombie' and coalesce(q.down_until, now()) <= now() and zr_present(q)
             and (q.id = t.id or zr_dist(mv.vlat, mv.vlng, qv.vlat, qv.vlng) <= rng + 8)
           order by (q.id = t.id) desc, zr_dist(mv.vlat, mv.vlng, qv.vlat, qv.vlng) limit tg loop
    k := k + 1;
    if lock > 0 then
      update zr_players set bite_target = null, bite_started = null,
        bite_lock_until = greatest(coalesce(bite_lock_until, now()), now() + make_interval(secs => lock)),
        shriek_lock_until = case when wt = 'shotgun' then greatest(coalesce(shriek_lock_until, now()), now() + make_interval(secs => lock)) else shriek_lock_until end,
        last_encounter = now()
      where id = z.id;
    end if;
    if wt = 'shove' then
      insert into zr_events(kind, actor, target, info) values ('interrupted', p_id, z.id, jsonb_build_object('secs', lock, 'by', 'shove'));
      res := jsonb_build_object('handle', (select handle from zr_players where id = z.id), 'locked', lock);
    else
      res := zr_damage(z.id, dmg, case when wt = 'crowbar' then 1.5 else 1 end, p_id);
      if lock > 0 then res := res || jsonb_build_object('locked', lock); end if;
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

create or replace function zr_scratch(p_id uuid, p_secret text, p_target uuid) returns json
language sql as $$ select json_build_object('error', 'removed') $$;

-- quick-slot items (v5): offsets, self lockouts, new infection items
create or replace function zr_use(p_id uuid, p_secret text, p_slot text, p_target uuid default null, p_lat float8 default null, p_lng float8 default null)
returns json language plpgsql security definer set search_path to public as $$
declare me zr_players; it jsonb; tt text; g jsonb; b float8; cost int := 0; out json; cnt int; z record;
  best text; bestb float8; s text; rr text; d float8; mx int; other zr_players; mv record; ov record; slock float8 := 0;
begin
  me := zr_me(p_id, p_secret);
  perform zr_tick_world();
  select * into me from zr_players where id = p_id;
  if me.state <> 'human' then return json_build_object('error', 'zombies_cant'); end if;
  if p_slot not in ('eq1', 'eq2') then return json_build_object('error', 'bad_slot'); end if;
  if me.paused_until > now() then return json_build_object('error', 'paused'); end if;
  if me.self_lock_until > now() then return json_build_object('error', 'busy', 'what', me.self_lock_what); end if;
  if me.supplies <= 0 then return json_build_object('error', 'no_supplies'); end if;
  it := me.gear->p_slot;
  if it is null then return json_build_object('error', 'empty'); end if;
  if (me.eq_ready->>p_slot)::timestamptz > now() then
    return json_build_object('error', 'equipping', 'left', ceil(extract(epoch from (me.eq_ready->>p_slot)::timestamptz - now())));
  end if;
  tt := it->>'t'; g := me.gear; b := coalesce((it->>'b')::float8, 0);
  cost := case tt when 'maglite' then 10 when 'radio' then 10 when 'stungun' then 20 when 'cryocase' then 25 else 0 end;
  if cost > 0 and b < cost then return json_build_object('error', 'battery'); end if;
  if me.lat is null or me.fix_at < now() - interval '30 seconds' then
    if tt in ('maglite','radio','stungun','claymore','roadflare','drone','bearspray','antiviral') then return json_build_object('error', 'weak_gps'); end if;
  end if;
  select * into mv from zr_vpos(me);

  if tt = 'maglite' then
    update zr_players set boost_until = now() + interval '3 minutes' where id = p_id;
    out := json_build_object('result', 'boost');
  elsif tt = 'radio' then
    insert into zr_reveals(owner, lat, lng, radius, until, kind) values (p_id, mv.vlat, mv.vlng, 150, now() + interval '15 seconds', 'radio');
    perform zr_ping(mv.vlat, mv.vlng, 15, 5, p_id, 'radio');
    out := json_build_object('result', 'radio');
  elsif tt = 'stungun' then
    select q.id, q.handle into z from zr_players q cross join lateral zr_vpos(q) qv
    where q.state = 'zombie' and coalesce(q.down_until, now()) <= now() and zr_present(q)
      and zr_dist(mv.vlat, mv.vlng, qv.vlat, qv.vlng) <= 22
    order by zr_dist(mv.vlat, mv.vlng, qv.vlat, qv.vlng) limit 1;
    if not found then return json_build_object('error', 'no_target'); end if;
    update zr_players set stunned_until = now() + interval '6 minutes', bite_target = null where id = z.id;
    insert into zr_events(kind, actor, target, info) values ('stunned', p_id, z.id, '{"secs":360}'::jsonb);
    perform zr_ping(mv.vlat, mv.vlng, 30, 10, p_id, 'stungun');
    update zr_players set points = points + 2, last_encounter = now() where id = p_id;
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
    perform zr_ping(mv.vlat, mv.vlng, 10, 3, p_id, 'ducttape');
    slock := 4;
    out := json_build_object('result', 'repaired', 'slot', best);
  elsif tt in ('powerbank', 'aa') then
    best := null; bestb := 100;
    foreach s in array array['head', 'eq1', 'eq2'] loop
      if s <> p_slot and g->s is not null and (g->s) ? 'b' and (g->s->>'b')::float8 < bestb then best := s; bestb := (g->s->>'b')::float8; end if;
    end loop;
    if best is null then return json_build_object('error', 'nothing_to_charge'); end if;
    g := jsonb_set(g, array[best, 'b'], to_jsonb(least(100, bestb + 50)));
    slock := case when tt = 'aa' then 2 else 0 end;
    out := json_build_object('result', 'charged', 'slot', best);
  elsif tt = 'bearspray' then
    update zr_players set bite_target = null, bite_started = null where bite_target = p_id;
    with hit as (
      update zr_players q set blinded_until = now() + interval '5 seconds', bite_target = null,
        bite_lock_until = now() + interval '5 seconds', shriek_lock_until = now() + interval '5 seconds'
      where q.state = 'zombie' and zr_present(q) and zr_dist(mv.vlat, mv.vlng, (zr_vpos(q)).vlat, (zr_vpos(q)).vlng) <= 22 returning q.id)
    , ev as (insert into zr_events(kind, actor, target, info) select 'blinded', p_id, id, '{"secs":5}'::jsonb from hit returning 1)
    select count(*) into cnt from ev;
    perform zr_ping(mv.vlat, mv.vlng, 45, 5, p_id, 'bearspray');
    out := json_build_object('result', 'sprayed', 'blinded', cnt);
  elsif tt = 'roadflare' then
    insert into zr_mines(owner, kind, lat, lng, until) values (p_id, 'flare', mv.vlat, mv.vlng, now() + interval '30 minutes');
    perform zr_ping(mv.vlat, mv.vlng, 15, 5, p_id, 'flare');
    out := json_build_object('result', 'flare');
  elsif tt = 'epipen' then
    if me.inf_left is null then return json_build_object('error', 'not_infected'); end if;
    perform zr_tick_inf(p_id, me.speed >= 0.6);
    update zr_players set epi_until = now() + interval '3 minutes' where id = p_id;
    out := json_build_object('result', 'epi');
  elsif tt = 'pills' then
    if me.inf_left is null then return json_build_object('error', 'not_infected'); end if;
    perform zr_tick_inf(p_id, me.speed >= 0.6);
    update zr_players set inf_left = inf_left + 300 where id = p_id;
    out := json_build_object('result', 'pills');
  elsif tt = 'antivpills' then
    if coalesce(me.inf_pct, 0) <= 0 then return json_build_object('error', 'not_infected'); end if;
    update zr_players set inf_pct = greatest(0, inf_pct - 30) where id = p_id;
    out := json_build_object('result', 'meter', 'pct', greatest(0, me.inf_pct - 30));
  elsif tt = 'antiviral' then
    if p_target is null or p_target = p_id then
      if me.inf_left is null then return json_build_object('error', 'not_infected'); end if;
      rr := zr_cure(p_id, p_id);
    else
      select * into other from zr_players where id = p_target;
      if other.state = 'zombie' then return json_build_object('error', 'need_antidote'); end if;
      select * into ov from zr_vpos(other);
      if other.id is null or not zr_present(other) or zr_dist(mv.vlat, mv.vlng, ov.vlat, ov.vlng) > 22 then return json_build_object('error', 'too_far'); end if;
      rr := zr_cure(p_target, p_id);
    end if;
    if rr <> 'cured' then return json_build_object('error', rr); end if;
    select * into me from zr_players where id = p_id; g := me.gear;
    slock := 3;
    out := json_build_object('result', 'cured', 'self', p_target is null or p_target = p_id);
  elsif tt = 'scentspray' then
    update zr_players set disguised_until = now() + interval '3 minutes' where id = p_id;
    out := json_build_object('result', 'disguised');
  elsif tt = 'claymore' then
    insert into zr_mines(owner, kind, lat, lng, until) values (p_id, 'claymore', mv.vlat, mv.vlng, now() + interval '24 hours');
    out := json_build_object('result', 'mine');
  elsif tt = 'drone' then
    if p_lat is null or p_lng is null then return json_build_object('error', 'need_pin'); end if;
    if zr_dist(me.lat, me.lng, p_lat, p_lng) > 200 then return json_build_object('error', 'pin_too_far'); end if;
    insert into zr_reveals(owner, lat, lng, radius, until, kind) values (p_id, p_lat + (mv.vlat - me.lat), p_lng + (mv.vlng - me.lng), 50, now() + interval '2 minutes', 'drone');
    perform zr_ping(mv.vlat, mv.vlng, 25, 5, p_id, 'drone');
    slock := 5;
    out := json_build_object('result', 'drone');
  else
    return json_build_object('error', 'cant_use');
  end if;

  select kind into s from zr_items where t = tt;
  if s = 'consumable' then
    g := g - p_slot;
  else
    it := g->p_slot;
    it := jsonb_set(it, '{d}', to_jsonb(coalesce((it->>'d')::int, 1) - 1));
    if it ? 'b' then it := jsonb_set(it, '{b}', to_jsonb(greatest(0, (it->>'b')::float8 - cost))); end if;
    if (it->>'d')::int <= 0 then g := g - p_slot; else g := jsonb_set(g, array[p_slot], it); end if;
  end if;
  update zr_players set gear = g,
    self_lock_until = case when slock > 0 then now() + make_interval(secs => slock) else self_lock_until end,
    self_lock_what = case when slock > 0 then (select name from zr_items where t = tt) else self_lock_what end
  where id = p_id;
  return (out::jsonb || jsonb_build_object('lock', slock))::json;
end $$;

-- inventory: every equip is a 10-second channel; "discard" leaves a loot bag in your offset sector
create or replace function zr_inv(p_id uuid, p_secret text, p_action text, p_from text, p_index integer default null, p_to text default null)
returns json language plpgsql security definer set search_path to public as $$
declare me zr_players; g jsonb; pk jsonb; it jsonb; s text; old jsonb; tgt text; newcap int; cnt int; oldbag text; lost jsonb; vp record; nm text;
begin
  me := zr_me(p_id, p_secret);
  if me.state <> 'human' then return json_build_object('error', 'zombies_cant'); end if;
  g := me.gear; pk := me.pack;
  if p_action = 'equip' then
    if me.self_lock_until > now() then return json_build_object('error', 'busy', 'what', me.self_lock_what); end if;
    if p_from <> 'pack' or p_index is null or p_index < 0 or p_index >= jsonb_array_length(pk) then return json_build_object('error', 'bad_index'); end if;
    it := pk->p_index; pk := pk - p_index;
    select slot, name into s, nm from zr_items where t = it->>'t';
    if s in ('weapon', 'head', 'armor') then
      old := g->s; g := g || jsonb_build_object(s, it);
      if old is not null then pk := pk || jsonb_build_array(old); end if;
      update zr_players set gear = g, pack = pk,
        headlamp_on = case when s = 'head' then false else headlamp_on end, nvg_on = case when s = 'head' then false else nvg_on end,
        self_lock_until = now() + interval '10 seconds', self_lock_what = 'Equipping ' || nm where id = p_id;
      return json_build_object('result', 'equipping', 'slot', s, 'secs', 10);
    elsif s = 'eq' then
      tgt := coalesce(p_to, case when g->'eq1' is null then 'eq1' when g->'eq2' is null then 'eq2' else 'eq1' end);
      if tgt not in ('eq1', 'eq2') then return json_build_object('error', 'bad_slot'); end if;
      old := g->tgt; g := g || jsonb_build_object(tgt, it);
      if old is not null then pk := pk || jsonb_build_array(old); end if;
      update zr_players set gear = g, pack = pk, eq_ready = eq_ready || jsonb_build_object(tgt, now() + interval '10 seconds'),
        self_lock_until = now() + interval '10 seconds', self_lock_what = 'Equipping ' || nm where id = p_id;
      return json_build_object('result', 'equipping', 'slot', tgt, 'secs', 10);
    elsif s = 'bag' then
      newcap := zr_cap(it->>'t'); oldbag := me.bag;
      cnt := jsonb_array_length(pk) + case when oldbag <> 'none' then 1 else 0 end;
      if cnt > newcap then return json_build_object('error', 'too_full'); end if;
      if oldbag <> 'none' then pk := pk || jsonb_build_array(zr_new_item(oldbag)); end if;
      update zr_players set bag = it->>'t', pack = pk, self_lock_until = now() + interval '10 seconds', self_lock_what = 'Equipping ' || nm where id = p_id;
      return json_build_object('result', 'equipping', 'slot', 'bag', 'secs', 10);
    end if;
    return json_build_object('error', 'cant_equip');
  elsif p_action = 'unequip' then
    if p_from not in ('weapon', 'head', 'armor', 'eq1', 'eq2') or g->p_from is null then return json_build_object('error', 'empty'); end if;
    if jsonb_array_length(pk) >= zr_cap(me.bag) then return json_build_object('error', 'pack_full'); end if;
    pk := pk || jsonb_build_array(g->p_from); g := g - p_from;
    update zr_players set gear = g, pack = pk,
      headlamp_on = case when p_from = 'head' then false else headlamp_on end, nvg_on = case when p_from = 'head' then false else nvg_on end where id = p_id;
    return json_build_object('result', 'unequipped');
  elsif p_action = 'discard' then
    if me.lat is null then return json_build_object('error', 'weak_gps'); end if;
    if p_from = 'pack' then
      if p_index is null or p_index < 0 or p_index >= jsonb_array_length(pk) then return json_build_object('error', 'bad_index'); end if;
      lost := jsonb_build_array(pk->p_index); pk := pk - p_index;
    elsif p_from = 'bag' then
      if me.bag = 'none' then return json_build_object('error', 'empty'); end if;
      if jsonb_array_length(pk) > 2 then return json_build_object('error', 'too_full'); end if;
      lost := jsonb_build_array(zr_new_item(me.bag));
      update zr_players set bag = 'none' where id = p_id;
    elsif p_from in ('weapon', 'head', 'armor', 'eq1', 'eq2') and g->p_from is not null then
      lost := jsonb_build_array(g->p_from); g := g - p_from;
    else
      return json_build_object('error', 'empty');
    end if;
    select * into vp from zr_vpos(me);
    perform zr_bagit(vp.vlat, vp.vlng, lost, p_id);
    update zr_players set gear = g, pack = pk,
      headlamp_on = case when p_from = 'head' then false else headlamp_on end, nvg_on = case when p_from = 'head' then false else nvg_on end where id = p_id;
    return json_build_object('result', 'discarded');
  end if;
  return json_build_object('error', 'bad_action');
end $$;

-- channels: 3s area search before looting; 60s Lazarus-X antidote
create or replace function zr_chan(p_id uuid, p_secret text, p_action text, p_kind text default null, p_ref text default null, p_slot text default null)
returns json language plpgsql security definer set search_path to public as $$
declare me zr_players; parts text[]; c_lat float8; c_lng float8; t zr_players; tv record; it jsonb; rr text; mv record;
begin
  me := zr_me(p_id, p_secret);
  perform zr_tick_world();
  select * into me from zr_players where id = p_id;
  if p_action = 'cancel' then
    update zr_players set chan_kind = null, chan_ref = null, self_lock_until = null, self_lock_what = null where id = p_id;
    return json_build_object('result', 'cancelled');
  end if;
  if me.state <> 'human' then return json_build_object('error', 'zombies_cant'); end if;
  if me.paused_until > now() then return json_build_object('error', 'paused'); end if;
  if me.self_lock_until > now() and p_action = 'start' then return json_build_object('error', 'busy', 'what', me.self_lock_what); end if;
  if me.lat is null or me.fix_at < now() - interval '30 seconds' then return json_build_object('error', 'weak_gps'); end if;

  if p_action = 'start' and p_kind = 'search' then
    parts := string_to_array(p_ref, ':');
    if parts[1] = 'c' then select lat, lng into c_lat, c_lng from zr_caches where id = parts[2]::bigint;
    elsif parts[1] = 's' then select lat, lng into c_lat, c_lng from zr_sponsors where id = parts[2]::int and active;
    elsif parts[1] = 'd' then select lat, lng into c_lat, c_lng from zr_supply where id = parts[2]::bigint and lands_at <= now() and until > now();
    elsif parts[1] = 'b' then select lat, lng into c_lat, c_lng from zr_bags where id = parts[2]::bigint and until > now(); end if;
    if c_lat is null then return json_build_object('error', 'bad_cache'); end if;
    if zr_dist(me.lat, me.lng, c_lat, c_lng) > (case when parts[1] = 'b' then 35 else 25 end) then return json_build_object('error', 'too_far'); end if;
    update zr_players set chan_kind = 'search', chan_ref = p_ref, chan_started = now(), chan_secs = 3,
      self_lock_until = now() + interval '3 seconds', self_lock_what = 'Searching area' where id = p_id;
    return json_build_object('result', 'started', 'secs', 3);
  elsif p_action = 'start' and p_kind = 'antidote' then
    if p_slot not in ('eq1', 'eq2') or me.gear->p_slot->>'t' <> 'antidote' then return json_build_object('error', 'empty'); end if;
    if p_ref is not null and p_ref::uuid <> p_id then
      select * into t from zr_players where id = p_ref::uuid;
      if t.id is null or not zr_present(t) or not (t.state = 'zombie' or t.inf_left is not null) then return json_build_object('error', 'not_infected'); end if;
      select * into tv from zr_vpos(t);
      select * into mv from zr_vpos(me);
      if zr_dist(mv.vlat, mv.vlng, tv.vlat, tv.vlng) > 22 then return json_build_object('error', 'too_far'); end if;
    end if;
    update zr_players set chan_kind = 'antidote', chan_ref = coalesce(p_ref, p_id::text), chan_slot = p_slot, chan_started = now(), chan_secs = 60,
      self_lock_until = now() + interval '60 seconds', self_lock_what = 'Injecting Lazarus-X' where id = p_id;
    return json_build_object('result', 'started', 'secs', 60);
  elsif p_action = 'finish' then
    if me.chan_kind is distinct from 'antidote' then return json_build_object('error', 'no_channel'); end if;
    if me.chan_started > now() - interval '59 seconds' then return json_build_object('error', 'too_soon'); end if;
    it := me.gear->me.chan_slot;
    if it is null or it->>'t' <> 'antidote' then return json_build_object('error', 'empty'); end if;
    if me.chan_ref::uuid <> p_id then
      select * into t from zr_players where id = me.chan_ref::uuid;
      select * into tv from zr_vpos(t);
      select * into mv from zr_vpos(me);
      if t.id is null or not zr_present(t) or zr_dist(mv.vlat, mv.vlng, tv.vlat, tv.vlng) > 28 then
        update zr_players set chan_kind = null, self_lock_until = null where id = p_id;
        return json_build_object('error', 'too_far');
      end if;
      rr := zr_cure(t.id, p_id);
      update zr_players set inf_pct = 0, inf_pct_at = now() where id = t.id;
    else
      if me.inf_left is not null then rr := zr_cure(p_id, p_id); end if;
      update zr_players set inf_pct = 0, inf_pct_at = now() where id = p_id;
    end if;
    update zr_players set gear = gear - chan_slot, chan_kind = null, chan_ref = null, self_lock_until = null, self_lock_what = null where id = p_id;
    return json_build_object('result', 'cured', 'self', me.chan_ref::uuid = p_id);
  end if;
  return json_build_object('error', 'bad_action');
end $$;

-- loot a searched zone: OSM-seeded caches (c:), sponsors (s:), supply crates (d:)
create or replace function zr_loot(p_id uuid, p_secret text, p_cache text) returns json
language plpgsql security definer set search_path to public as $$
declare me zr_players; c_lat float8; c_lng float8; parts text[]; last timestamptz; tier text; k int; n int; it jsonb; wh text;
  got jsonb := '[]'::jsonb; left_behind jsonb := '[]'::jsonb;
begin
  me := zr_me(p_id, p_secret);
  if me.state <> 'human' then return json_build_object('error', 'zombies_cant'); end if;
  if me.lat is null or me.fix_at < now() - interval '30 seconds' then return json_build_object('error', 'weak_gps'); end if;
  if me.chan_kind is distinct from 'search' or me.chan_ref is distinct from p_cache or me.chan_started > now() - interval '2.6 seconds' then
    return json_build_object('error', 'search_first'); end if;
  parts := string_to_array(p_cache, ':');
  if parts[1] = 'c' then select lat, lng, zr_caches.tier into c_lat, c_lng, tier from zr_caches where id = parts[2]::bigint;
  elsif parts[1] = 's' then select lat, lng, 'military' into c_lat, c_lng, tier from zr_sponsors where id = parts[2]::int and active;
  elsif parts[1] = 'd' then select lat, lng, 'military' into c_lat, c_lng, tier from zr_supply where id = parts[2]::bigint and lands_at <= now() and until > now(); end if;
  if c_lat is null then return json_build_object('error', 'bad_cache'); end if;
  if zr_dist(me.lat, me.lng, c_lat, c_lng) > 28 then return json_build_object('error', 'too_far'); end if;
  if exists (select 1 from zr_cache_state where cache_id = p_cache and destroyed_until > now()) then return json_build_object('error', 'destroyed'); end if;
  select looted_at into last from zr_loots where player_id = p_id and cache_id = p_cache;
  if last > now() - interval '60 minutes' then return json_build_object('error', 'cooldown'); end if;
  n := case when parts[1] = 'd' then 4 else zr_cache_count(p_cache) end;
  for k in 1 .. n loop
    it := zr_new_item(zr_roll(tier));
    wh := zr_place(p_id, it);
    if wh is null then left_behind := left_behind || jsonb_build_array(it); end if;
    got := got || jsonb_build_array(jsonb_build_object('t', it->>'t', 'where', coalesce(wh, 'ground')));
  end loop;
  perform zr_bagit(c_lat, c_lng, left_behind, p_id);
  update zr_players set supplies = least(100, supplies + 30), chan_kind = null, chan_ref = null, self_lock_until = null where id = p_id;
  insert into zr_loots(player_id, cache_id, looted_at) values (p_id, p_cache, now())
    on conflict (player_id, cache_id) do update set looted_at = now();
  return json_build_object('result', 'looted', 'tier', tier, 'items', got);
end $$;

create or replace function zr_take_bag(p_id uuid, p_secret text, p_bag bigint) returns json
language plpgsql security definer set search_path to public as $$
declare me zr_players; b zr_bags; it jsonb; wh text; got jsonb := '[]'::jsonb; rest jsonb := '[]'::jsonb;
begin
  me := zr_me(p_id, p_secret);
  if me.state <> 'human' then return json_build_object('error', 'zombies_cant'); end if;
  if me.lat is null or me.fix_at < now() - interval '30 seconds' then return json_build_object('error', 'weak_gps'); end if;
  if me.chan_kind is distinct from 'search' or me.chan_ref is distinct from ('b:' || p_bag) or me.chan_started > now() - interval '2.6 seconds' then
    return json_build_object('error', 'search_first'); end if;
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
  update zr_players set chan_kind = null, chan_ref = null, self_lock_until = null where id = p_id;
  return json_build_object('result', 'taken', 'items', got, 'left', jsonb_array_length(rest));
end $$;

create or replace function zr_smash(p_id uuid, p_secret text, p_ref text) returns json
language plpgsql security definer set search_path to public as $$
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
    if parts[1] = 'c' then select lat, lng into c_lat, c_lng from zr_caches where id = parts[2]::bigint;
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

-- horde shriek: 150 m sector ping for zombies, 45 s cooldown
create or replace function zr_scream(p_id uuid, p_secret text) returns json
language plpgsql security definer set search_path to public as $$
declare me zr_players; mv record;
begin
  me := zr_me(p_id, p_secret);
  if me.state <> 'zombie' then return json_build_object('error', 'not_zombie'); end if;
  if me.down_until > now() then return json_build_object('error', 'down'); end if;
  if me.stunned_until > now() then return json_build_object('error', 'stunned'); end if;
  if me.blinded_until > now() or me.shriek_lock_until > now() then return json_build_object('error', 'locked'); end if;
  if me.paused_until > now() then return json_build_object('error', 'paused'); end if;
  if me.fix_at is null or me.fix_at < now() - interval '20 seconds' or me.acc > 35 then return json_build_object('error', 'weak_gps'); end if;
  if me.last_scream > now() - interval '44 seconds' then
    return json_build_object('error', 'cooldown', 'left', ceil(45 - extract(epoch from now() - me.last_scream)));
  end if;
  select * into mv from zr_vpos(me);
  update zr_hotzones set until = now() where owner = p_id and until > now();
  insert into zr_hotzones(owner, lat, lng, radius, until) values (p_id, mv.vlat, mv.vlng, 150, now() + interval '2 minutes');
  update zr_players set last_scream = now() where id = p_id;
  perform zr_ping(mv.vlat, mv.vlng, 150, 30, p_id, 'scream');
  insert into zr_events(kind, actor, target, info)
  select 'scream_near', p_id, q.id, jsonb_build_object('dist', round(zr_dist((zr_vpos(q)).vlat, (zr_vpos(q)).vlng, mv.vlat, mv.vlng)))
  from zr_players q
  where q.id <> p_id and not q.is_npc and q.state = 'human' and q.lat is not null and q.last_seen > now() - interval '20 seconds'
    and not q.was_sheltered and zr_dist((zr_vpos(q)).vlat, (zr_vpos(q)).vlng, mv.vlat, mv.vlng) <= 150 and not zr_blocked(p_id, q.id);
  return json_build_object('result', 'shriek', 'secs', 120);
end $$;

-- safety pause: up to 5 minutes, then a 10-minute cooldown; hidden and untouchable while paused
create or replace function zr_pause(p_id uuid, p_secret text, p_on boolean) returns json
language plpgsql security definer set search_path to public as $$
declare me zr_players;
begin
  me := zr_me(p_id, p_secret);
  if p_on then
    if me.paused_until > now() then return json_build_object('result', 'paused', 'secs', ceil(extract(epoch from me.paused_until - now()))); end if;
    if me.pause_cd_until > now() then return json_build_object('error', 'cooldown', 'left', ceil(extract(epoch from me.pause_cd_until - now()))); end if;
    update zr_players set bite_target = null, bite_started = null where bite_target = p_id;
    update zr_players set paused_until = now() + interval '5 minutes', pause_cd_until = now() + interval '15 minutes',
      bite_target = null, bite_started = null, chan_kind = null, self_lock_until = null where id = p_id;
    return json_build_object('result', 'paused', 'secs', 300);
  end if;
  update zr_players set paused_until = null, pause_cd_until = least(coalesce(pause_cd_until, now() + interval '10 minutes'), now() + interval '10 minutes')
  where id = p_id and paused_until > now();
  return json_build_object('result', 'resumed');
end $$;

-- bunker v5: 100 SC to build, 5,000 HP, 50-item stash, public marker offset 75-100 m
create or replace function zr_bunker(p_id uuid, p_secret text, p_action text) returns json
language plpgsql security definer set search_path to public as $$
declare me zr_players; o record; miss int; heal int; cost int;
begin
  me := zr_me(p_id, p_secret);
  if p_action = 'abandon' then
    update zr_players set bunker_lat = null, bunker_lng = null, bunker_ready = null, bunker_hp = null, bunker_items = '[]'::jsonb,
      bunker_vlat = null, bunker_vlng = null where id = p_id;
    return json_build_object('result', 'abandoned');
  end if;
  if me.state <> 'human' then return json_build_object('error', 'zombies_cant'); end if;
  if p_action = 'repair' then
    if me.bunker_lat is null then return json_build_object('error', 'no_bunker'); end if;
    if me.lat is null or zr_dist(me.lat, me.lng, me.bunker_lat, me.bunker_lng) > 40 then return json_build_object('error', 'not_near'); end if;
    miss := 5000 - coalesce(me.bunker_hp, 5000);
    if miss <= 0 then return json_build_object('error', 'full_hp'); end if;
    heal := least(miss, me.points * 25);
    if heal <= 0 then return json_build_object('error', 'no_sc', 'need', ceil(miss / 25.0)); end if;
    cost := ceil(heal / 25.0);
    update zr_players set bunker_hp = bunker_hp + heal, points = points - cost where id = p_id;
    return json_build_object('result', 'repaired', 'hp', coalesce(me.bunker_hp, 5000) + heal, 'cost', cost);
  end if;
  if p_action not in ('set', 'rebuild') then return json_build_object('error', 'bad_action'); end if;
  if me.inf_left is not null then return json_build_object('error', 'infected'); end if;
  if me.fix_at is null or me.fix_at < now() - interval '20 seconds' or me.acc > 35 then return json_build_object('error', 'weak_gps'); end if;
  if me.bunker_lat is not null and p_action = 'set' then return json_build_object('error', 'have_bunker'); end if;
  if me.home_lat is not null and zr_dist(me.lat, me.lng, me.home_lat, me.home_lng) < 400 then return json_build_object('error', 'near_home'); end if;
  if me.points < 100 then return json_build_object('error', 'no_sc', 'need', 100); end if;
  select s.olat, s.olng into o from (select random() * 2 * pi() as b, 75 + random() * 25 as d) r cross join lateral zr_shift(me.lat, me.lng, r.d * sin(r.b), r.d * cos(r.b)) s;
  update zr_players set bunker_lat = me.lat, bunker_lng = me.lng, bunker_ready = now() + interval '10 minutes', bunker_hp = 5000,
    bunker_items = '[]'::jsonb, bunker_vlat = o.olat, bunker_vlng = o.olng, points = points - 100 where id = p_id;
  return json_build_object('result', 'building', 'secs', 600, 'cost', 100);
end $$;

create or replace function zr_stash(p_id uuid, p_secret text, p_action text, p_from text default null, p_index int default null)
returns json language plpgsql security definer set search_path to public as $$
declare me zr_players; it jsonb; bi jsonb; wh text;
begin
  me := zr_me(p_id, p_secret);
  if me.state <> 'human' then return json_build_object('error', 'zombies_cant'); end if;
  if me.bunker_lat is null then return json_build_object('error', 'no_bunker'); end if;
  if me.bunker_ready > now() then return json_build_object('error', 'building'); end if;
  if me.bunker_lock_until > now() then return json_build_object('error', 'bunker_locked', 'secs', ceil(extract(epoch from me.bunker_lock_until - now()))); end if;
  if me.lat is null or me.fix_at < now() - interval '30 seconds' or zr_dist(me.lat, me.lng, me.bunker_lat, me.bunker_lng) > 40 then
    return json_build_object('error', 'not_near'); end if;
  bi := coalesce(me.bunker_items, '[]'::jsonb);
  if p_action = 'put' then
    if jsonb_array_length(bi) >= 50 then return json_build_object('error', 'bunker_full'); end if;
    if p_from = 'pack' then
      if p_index is null or p_index < 0 or p_index >= jsonb_array_length(me.pack) then return json_build_object('error', 'bad_index'); end if;
      it := me.pack->p_index;
      update zr_players set pack = pack - p_index, bunker_items = bi || jsonb_build_array(it) where id = p_id;
    elsif p_from in ('weapon', 'head', 'armor', 'eq1', 'eq2') and me.gear->p_from is not null then
      it := me.gear->p_from;
      update zr_players set gear = gear - p_from, bunker_items = bi || jsonb_build_array(it),
        headlamp_on = case when p_from = 'head' then false else headlamp_on end, nvg_on = case when p_from = 'head' then false else nvg_on end where id = p_id;
    else return json_build_object('error', 'empty'); end if;
    return json_build_object('result', 'stashed', 'n', jsonb_array_length(bi) + 1);
  elsif p_action = 'take' then
    if p_index is null or p_index < 0 or p_index >= jsonb_array_length(bi) then return json_build_object('error', 'bad_index'); end if;
    it := bi->p_index;
    wh := zr_place(p_id, it);
    if wh is null then return json_build_object('error', 'pack_full'); end if;
    update zr_players set bunker_items = bi - p_index where id = p_id;
    return json_build_object('result', 'taken', 'where', wh, 't', it->>'t');
  end if;
  return json_build_object('error', 'bad_action');
end $$;

create or replace function zr_bunker_key(p_owner uuid) returns text language sql immutable as $$ select substr(md5(p_owner::text || ':bunker'), 1, 12) $$;

create or replace function zr_smash_bunker(p_id uuid, p_secret text, p_key text) returns json
language plpgsql security definer set search_path to public as $$
declare me zr_players; o zr_players; v_hp int;
begin
  me := zr_me(p_id, p_secret);
  if me.state <> 'zombie' then return json_build_object('error', 'not_zombie'); end if;
  if me.down_until > now() or me.stunned_until > now() or me.paused_until > now() then return json_build_object('error', 'down'); end if;
  if me.lat is null or me.fix_at < now() - interval '20 seconds' then return json_build_object('error', 'weak_gps'); end if;
  if me.last_attack > now() - interval '1.8 seconds' then return json_build_object('error', 'cooldown'); end if;
  select * into o from zr_players where zr_bunker_key(id) = p_key and bunker_lat is not null and bunker_ready <= now() for update;
  if o.id is null then return json_build_object('error', 'bad_cache'); end if;
  if o.id = p_id then return json_build_object('error', 'own_bunker'); end if;
  if zr_dist(me.lat, me.lng, o.bunker_vlat, o.bunker_vlng) > 35 then return json_build_object('error', 'too_far'); end if;
  update zr_players set last_attack = now(), last_encounter = now() where id = p_id;
  v_hp := coalesce(o.bunker_hp, 5000) - 50;
  if v_hp <= 0 then
    update zr_players set bunker_lat = null, bunker_lng = null, bunker_ready = null, bunker_hp = null, bunker_items = '[]'::jsonb,
      bunker_vlat = null, bunker_vlng = null where id = o.id;
    update zr_players set points = points + 50 where id = p_id;
    insert into zr_events(kind, actor, target, info) values ('bunker_destroyed', p_id, o.id, '{}'::jsonb);
    return json_build_object('result', 'destroyed', 'points', 50);
  end if;
  update zr_players set bunker_hp = v_hp where id = o.id;
  update zr_players set points = points + 1 where id = p_id;
  if v_hp % 500 < 50 then insert into zr_events(kind, actor, target, info) values ('bunker_hit', p_id, o.id, jsonb_build_object('hp', v_hp)); end if;
  return json_build_object('result', 'hit', 'hp', v_hp, 'points', 1);
end $$;

create or replace function zr_convert_xp(p_id uuid, p_secret text) returns json
language plpgsql security definer set search_path to public as $$
declare me zr_players;
begin
  me := zr_me(p_id, p_secret);
  if me.points <= 0 then return json_build_object('error', 'no_sc'); end if;
  update zr_players set xp = coalesce(xp, 0) + points, points = 0 where id = p_id;
  return json_build_object('result', 'converted', 'xp', coalesce(me.xp, 0) + me.points, 'gained', me.points);
end $$;

grant execute on function zr_chan(uuid, text, text, text, text, text) to anon, authenticated;
grant execute on function zr_pause(uuid, text, boolean) to anon, authenticated;
grant execute on function zr_stash(uuid, text, text, text, int) to anon, authenticated;
grant execute on function zr_smash_bunker(uuid, text, text) to anon, authenticated;
grant execute on function zr_convert_xp(uuid, text) to anon, authenticated;
