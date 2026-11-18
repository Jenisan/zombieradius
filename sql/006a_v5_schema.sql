-- v5 part A: schema, helpers, items, rounds
alter table zr_players
  add column if not exists off_b float8, add column if not exists off_d float8,
  add column if not exists inf_pct float8 default 0, add column if not exists inf_pct_at timestamptz,
  add column if not exists bite_lock_until timestamptz, add column if not exists shriek_lock_until timestamptz,
  add column if not exists self_lock_until timestamptz, add column if not exists self_lock_what text,
  add column if not exists chan_kind text, add column if not exists chan_ref text, add column if not exists chan_slot text,
  add column if not exists chan_started timestamptz, add column if not exists chan_secs float8,
  add column if not exists bunker_hp int, add column if not exists bunker_items jsonb default '[]'::jsonb,
  add column if not exists bunker_vlat float8, add column if not exists bunker_vlng float8,
  add column if not exists bunker_lock_until timestamptz, add column if not exists xp bigint default 0,
  add column if not exists paused_until timestamptz, add column if not exists pause_cd_until timestamptz,
  add column if not exists is_npc boolean default false, add column if not exists npc_active boolean default false,
  add column if not exists npc_seen_at timestamptz, add column if not exists npc_heading float8,
  add column if not exists last_encounter timestamptz, add column if not exists round_id int,
  add column if not exists sc_acc float8 default 0, add column if not exists dist_acc float8 default 0;
update zr_players set off_b = random() * 2 * pi(), off_d = 50 + random() * 50 where off_b is null;
update zr_players set inf_pct = 0, inf_pct_at = now() where inf_pct_at is null;
update zr_players set inf_pct = 100 where state = 'zombie';
update zr_players set pz_checked = true;

create table if not exists zr_world_state (k text primary key, v timestamptz);
create table if not exists zr_rounds (id serial primary key, season_id int, n int, starts_at timestamptz, ends_at timestamptz, processed_at timestamptz);
create table if not exists zr_tiles (tile text primary key, seeded_at timestamptz default now(), n int default 0);
create table if not exists zr_caches (id bigserial primary key, tile text, lat float8, lng float8, kind text, tier text, created timestamptz default now());
create table if not exists zr_supply (id bigserial primary key, lat float8, lng float8, announced timestamptz default now(), lands_at timestamptz, until timestamptz);
create table if not exists zr_zones (id bigserial primary key, kind text, lat float8, lng float8, r0 float8, r1 float8, created timestamptz default now(), until timestamptz);
alter table zr_world_state enable row level security; alter table zr_rounds enable row level security;
alter table zr_tiles enable row level security; alter table zr_caches enable row level security;
alter table zr_supply enable row level security; alter table zr_zones enable row level security;
create index if not exists zr_caches_tile on zr_caches(tile);
create index if not exists zr_players_npc on zr_players(is_npc, npc_active);

-- season 1 = 12 rounds of 7 days
update zr_seasons set ends_at = '2027-02-08 12:00:00+00' where id = 1;
insert into zr_rounds (season_id, n, starts_at, ends_at)
select 1, g, timestamptz '2026-11-16 12:00:00+00' + (g - 1) * interval '7 days', timestamptz '2026-11-16 12:00:00+00' + g * interval '7 days'
from generate_series(1, 12) g where not exists (select 1 from zr_rounds where season_id = 1);
update zr_players set round_id = (select id from zr_rounds where season_id = 1 and n = 1) where round_id is null;

-- new items + tuning to the v5 spec
insert into zr_items (t, name, slot, kind, elec, dur, range_m, ping_r, ping_s, carry_hp, descr, rarity) values
  ('antivpills', 'Antiviral Pills', 'eq', 'consumable', false, null, null, 0, 0, 0, 'Lowers your infection meter by 30%. Useless once the meter hits 100%.', 'restricted'),
  ('antidote', 'Lazarus-X Antidote', 'eq', 'consumable', false, null, 20, 0, 0, 0, 'The only cure at 100% infection. 60-second injection on a zombie or yourself; resets infection to 0%. Being bitten cancels it.', 'covert')
on conflict (t) do nothing;
update zr_items set descr = 'Adds 5 minutes to an active bite countdown.' where t = 'pills';
update zr_items set name = 'Military Antivirus', descr = 'Instantly cures an active bite infection (3s injection). Does not work on zombies; that takes Lazarus-X.' where t = 'antiviral';
update zr_items set ping_r = 15 where t = 'shove';
update zr_items set ping_r = 50 where t = 'bow';
update zr_items set descr = 'Resets an active bite to 0 and locks out nearby zombies (bite and shriek) for 5 seconds.' where t = 'bearspray';
insert into zr_loot_table (tier, t, w) values ('common', 'antivpills', 8), ('hunting', 'antivpills', 8), ('military', 'antivpills', 6),
  ('military', 'antidote', 3), ('hunting', 'antidote', 1)
on conflict (tier, t) do nothing;

-- geometry helpers
create or replace function zr_shift(lat float8, lng float8, dx float8, dy float8, out olat float8, out olng float8)
language sql immutable as $$ select lat + dy / 111320.0, lng + dx / (111320.0 * cos(radians(lat))) $$;

-- what other players see: real position + per-round 50-100 m offset + slow 40 m wander
create or replace function zr_vpos(p zr_players, out vlat float8, out vlng float8)
language plpgsql stable as $$
declare s bigint; t float8 := extract(epoch from now()); a float8; b float8; c float8; d float8; dx float8; dy float8;
begin
  if p.lat is null then return; end if;
  if p.is_npc then vlat := p.lat; vlng := p.lng; return; end if;
  s := abs(('x' || substr(md5(p.id::text), 1, 8))::bit(32)::int)::bigint;
  a := (s % 628) / 100.0; b := ((s / 628) % 628) / 100.0; c := ((s / 394384) % 628) / 100.0; d := ((s / 7) % 628) / 100.0;
  dx := coalesce(p.off_d, 75) * sin(coalesce(p.off_b, 0)) + 22 * sin(t / 53 + a) + 14 * sin(t / 23 + b);
  dy := coalesce(p.off_d, 75) * cos(coalesce(p.off_b, 0)) + 22 * cos(t / 61 + c) + 14 * sin(t / 29 + d);
  select o.olat, o.olng into vlat, vlng from zr_shift(p.lat, p.lng, dx, dy) o;
end $$;

-- on the map and attackable: online, or offline for under 30 minutes; never while paused or at home
create or replace function zr_present(p zr_players) returns boolean language sql stable as $$
  select p.lat is not null and (p.paused_until is null or p.paused_until <= now()) and not coalesce(p.was_sheltered, false)
     and case when p.is_npc then p.npc_active else p.last_seen > now() - interval '30 minutes' end
$$;

create or replace function zr_bagit(p_lat float8, p_lng float8, p_items jsonb, p_owner uuid) returns void
language sql security definer set search_path to public as $$
  insert into zr_bags(lat, lng, items, owner) select p_lat, p_lng, p_items, p_owner
  where p_lat is not null and p_items is not null and jsonb_array_length(p_items) > 0;
$$;

create or replace function zr_zone_r(z zr_zones) returns float8 language sql stable as $$
  select z.r0 + (z.r1 - z.r0) * least(1, greatest(0, extract(epoch from now() - z.created) / greatest(1, extract(epoch from z.until - z.created))))
$$;

create or replace function zr_dir(a_lat float8, a_lng float8, b_lat float8, b_lng float8) returns text language sql immutable as $$
  select (array['N','NE','E','SE','S','SW','W','NW'])[1 + (round(((degrees(atan2((b_lng - a_lng) * cos(radians(a_lat)), b_lat - a_lat)) + 360)::numeric % 360) / 45)::int % 8)]
$$;

-- items a player carries (gear slots + backpack + the bag itself)
create or replace function zr_carried(p zr_players) returns jsonb language sql as $$
  select coalesce((select jsonb_agg(v) from (
      select p.gear->k as v from unnest(array['weapon','head','armor','eq1','eq2']) k where p.gear->k is not null
      union all select e from jsonb_array_elements(coalesce(p.pack, '[]'::jsonb)) e
      union all select zr_new_item(p.bag) where p.bag is not null and p.bag <> 'none') x), '[]'::jsonb)
$$;

-- noise radius by speed (v5): still 10, walk 50, sprint 100 (tracksuit 15), cycling 250, vehicle 350
create or replace function zr_ring(p zr_players) returns float8 language sql stable as $$
  select (case when p.speed < 0.6 then 10
               when p.speed < 2.5 then 50
               when p.speed < 5.5 then case when zr_live(p.gear->'armor') and p.gear->'armor'->>'t' = 'tracksuit' then 15 else 100 end
               when p.speed < 12.5 then 250
               else 350 end)
       * (case when p.bag = 'rucksack' then 1.15 else 1 end)
       * (case when p.headlamp_on and zr_live(p.gear->'head') and p.gear->'head'->>'t' = 'headlamp'
                    and coalesce((p.gear->'head'->>'b')::float8, 0) > 0 then 1.5 else 1 end)
$$;

create or replace function zr_level(x bigint) returns int language sql immutable as $$
  select greatest(1, floor((1 + sqrt(1 + 4 * greatest(x, 0) / 50.0)) / 2)::int)
$$;
