-- Zombie Radius v2: gear, combat, sound. Schema + catalog + helpers.

alter table zr_players
  add column if not exists hp int not null default 100,
  add column if not exists down_until timestamptz,
  add column if not exists blinded_until timestamptz,
  add column if not exists gear jsonb not null default '{}'::jsonb,
  add column if not exists pack jsonb not null default '[]'::jsonb,
  add column if not exists bag text not null default 'none',
  add column if not exists headlamp_on boolean not null default false,
  add column if not exists nvg_on boolean not null default false,
  add column if not exists inf_left float8,
  add column if not exists inf_tick timestamptz,
  add column if not exists cryo_until timestamptz,
  add column if not exists epi_until timestamptz,
  add column if not exists boost_until timestamptz,
  add column if not exists disguised_until timestamptz,
  add column if not exists last_attack timestamptz,
  add column if not exists bat_hits int not null default 0,
  add column if not exists eq_ready jsonb not null default '{}'::jsonb,
  add column if not exists speed float8 not null default 0,
  add column if not exists bite_secs float8,
  add column if not exists z_head jsonb,
  add column if not exists z_armor jsonb;

-- old v1 items are retired; new players start empty-handed
alter table zr_players alter column antidotes set default 0;
alter table zr_players alter column vaccines set default 0;
alter table zr_players alter column flares set default 0;
alter table zr_players alter column masks set default 0;

create table if not exists zr_items (
  t text primary key,
  name text not null,
  slot text not null check (slot in ('weapon','head','armor','eq','bag')),
  kind text not null,              -- weapon | head | armor | item | consumable | bag
  elec boolean not null default false,
  dur int,                         -- armor HP or uses
  hit_loss int,                    -- armor HP lost per zombie hit
  bite_s int,                      -- bite channel seconds this gear forces
  carry_hp int not null default 0, -- zombie carryover armor (0 = breaks)
  dmg int, cd float8, targets int, range_m int,
  ping_r int, ping_s int,
  cap int,                         -- backpack capacity
  descr text not null default ''
);
alter table zr_items enable row level security;

create table if not exists zr_loot_table (
  tier text not null, t text not null references zr_items(t), w int not null,
  primary key (tier, t)
);
alter table zr_loot_table enable row level security;

create table if not exists zr_pings (
  id bigserial primary key, at timestamptz not null default now(), until timestamptz not null,
  lat float8 not null, lng float8 not null, radius float8 not null, src uuid, kind text not null
);
create index if not exists zr_pings_until on zr_pings(until);
alter table zr_pings enable row level security;

create table if not exists zr_mines (
  id bigserial primary key, owner uuid not null, kind text not null check (kind in ('claymore','flare')),
  lat float8 not null, lng float8 not null, created timestamptz not null default now(), until timestamptz not null
);
create index if not exists zr_mines_until on zr_mines(until);
alter table zr_mines enable row level security;

create table if not exists zr_reveals (
  id bigserial primary key, owner uuid not null, lat float8 not null, lng float8 not null,
  radius float8 not null, until timestamptz not null, kind text not null
);
create index if not exists zr_reveals_owner on zr_reveals(owner, until);
alter table zr_reveals enable row level security;

create table if not exists zr_bags (
  id bigserial primary key, lat float8 not null, lng float8 not null, items jsonb not null,
  created timestamptz not null default now(), until timestamptz not null default now() + interval '2 hours',
  owner uuid
);
alter table zr_bags enable row level security;

create table if not exists zr_cache_state (
  cache_id text primary key, destroyed_until timestamptz, by uuid
);
alter table zr_cache_state enable row level security;

-- ---------- catalog ----------
insert into zr_items(t,name,slot,kind,elec,dur,hit_loss,bite_s,carry_hp,dmg,cd,targets,range_m,ping_r,ping_s,cap,descr) values
-- weapons
('bat','Baseball Bat','weapon','weapon',false,null,null,null,0,35,2,1,15,35,4,null,'35 damage every 2s. Every 3rd hit stuns for 3 min.'),
('crowbar','Crowbar','weapon','weapon',false,null,null,null,0,50,3,1,15,40,4,null,'50 damage every 3s. +50% damage to zombie armor.'),
('bow','Compound Bow','weapon','weapon',false,null,null,null,0,75,4,1,30,10,3,null,'75 damage every 4s. Nearly silent.'),
('shotgun','12-Gauge Shotgun','weapon','weapon',false,null,null,null,0,60,4,3,20,350,60,null,'60 damage to up to 3 zombies. Extremely loud.'),
('rifle','Hunting Rifle','weapon','weapon',false,null,null,null,0,100,5,1,75,300,30,null,'100 damage every 5s at long range. Very loud.'),
('carbine','Military Carbine','weapon','weapon',false,null,null,null,0,50,1.5,1,50,200,30,null,'50 damage every 1.5s. Loud.'),
-- head
('headlamp','LED Headlamp','head','head',true,15,10,null,0,null,null,null,null,null,null,null,'Toggle: doubles your radar, but you''re 50% louder. 20% battery/hr.'),
('bikehelmet','Bike Helmet','head','head',false,25,15,6,25,null,null,null,null,null,null,null,'Bites on you take 6s.'),
('hardhat','Hardhat','head','head',false,40,15,7,40,null,null,null,null,null,null,null,'Bites on you take 7s.'),
('respirator','Respirator Mask','head','head',true,25,10,null,25,null,null,null,null,null,null,null,'Protects in toxic zones (coming soon).'),
('kevlar','Kevlar Helmet','head','head',false,60,20,8,60,null,null,null,null,null,null,null,'Bites on you take 8s.'),
('nvg','Night-Vision Goggles','head','head',true,20,10,null,0,null,null,null,null,null,null,null,'Toggle: see stealth zombies at full range. 35% battery/hr.'),
-- armor
('denim','Denim Jacket & Boots','armor','armor',false,30,15,6,30,null,null,null,null,null,null,null,'Bites on you take 6s.'),
('tracksuit','Tracksuit & Runners','armor','armor',false,20,15,null,20,null,null,null,null,null,null,null,'Sprinting stays quiet (15 m sound).'),
('moto','Motorcycle Gear','armor','armor',false,55,20,8,55,null,null,null,null,null,null,null,'Bites on you take 8s.'),
('ghillie','Ghillie Suit','armor','armor',false,40,20,null,40,null,null,null,null,null,null,null,'Zombies detect your movement 40% closer.'),
('plate','Plate Carrier','armor','armor',false,100,20,10,100,null,null,null,null,null,null,null,'Bites on you take 10s.'),
-- reusable items
('maglite','Maglite','eq','item',true,10,null,null,0,null,null,null,null,null,null,null,'Doubles your radar for 3 min. 10% battery.'),
('radio','Police Radio','eq','item',true,8,null,null,0,null,null,null,null,null,null,null,'Reveals zombies within 150 m for 15s. 10% battery.'),
('ducttape','Duct Tape & Sewing Kit','eq','item',false,3,null,null,0,null,null,null,null,null,null,null,'Repairs helmet or armor by 35.'),
('powerbank','USB Power Bank','eq','item',false,4,null,null,0,null,null,null,null,null,null,null,'Adds 50% battery to an equipped device.'),
('stungun','Stun Gun','eq','item',true,5,null,null,0,null,null,null,15,30,10,null,'Stuns the nearest zombie (50 ft) for 6 min. 20% battery.'),
('cryocase','Cryo-Cooler Case','eq','item',true,3,null,null,0,null,null,null,null,null,null,null,'Halves infection speed for 5 min. 25% battery.'),
-- consumables
('bearspray','Bear Spray','eq','consumable',false,null,null,null,0,null,null,null,15,45,5,null,'Stops a bite on you and blinds nearby zombies for 4s.'),
('roadflare','Road Flare','eq','consumable',false,null,null,null,0,null,null,null,null,15,5,null,'Drop here: reveals zombies within 20 m for 10 min and alerts you.'),
('epipen','EpiPen','eq','consumable',false,null,null,null,0,null,null,null,null,null,null,null,'Pauses your infection for 3 min while you keep moving.'),
('pills','Suppressant Pills','eq','consumable',false,null,null,null,0,null,null,null,null,null,null,null,'Adds 20 min to your infection timer.'),
('antiviral','Antiviral Syringe','eq','consumable',false,null,null,null,0,null,null,null,15,null,null,null,'Cures you, or an infected player or zombie within 50 ft.'),
('scentspray','Scent-Blocker Spray','eq','consumable',false,null,null,null,0,null,null,null,null,null,null,null,'For 3 min zombies see you as a zombie.'),
('claymore','Claymore Mine','eq','consumable',false,null,null,null,0,100,null,null,10,400,60,null,'Plant here: 100 damage to the first zombie within 10 m. Very loud.'),
('drone','Recon Drone','eq','consumable',false,null,null,null,0,null,null,null,200,25,5,null,'Pick a spot within 200 m: reveals zombies within 50 m for 2 min.'),
('aa','AA / 9V Batteries','eq','consumable',false,null,null,null,0,null,null,null,null,null,null,null,'Adds 50% battery to an equipped device.'),
-- backpacks
('fanny','Fanny Pack','bag','bag',false,null,null,null,0,null,null,null,null,null,null,4,'4 reserve slots.'),
('hiking','Hiking Backpack','bag','bag',false,null,null,null,0,null,null,null,null,null,null,6,'6 reserve slots.'),
('rucksack','Military Rucksack','bag','bag',false,null,null,null,0,null,null,null,null,null,null,10,'10 reserve slots, but you''re 15% louder.')
on conflict (t) do update set name=excluded.name, slot=excluded.slot, kind=excluded.kind, elec=excluded.elec, dur=excluded.dur, hit_loss=excluded.hit_loss, bite_s=excluded.bite_s, carry_hp=excluded.carry_hp, dmg=excluded.dmg, cd=excluded.cd, targets=excluded.targets, range_m=excluded.range_m, ping_r=excluded.ping_r, ping_s=excluded.ping_s, cap=excluded.cap, descr=excluded.descr;

insert into zr_loot_table(tier,t,w) values
('common','bat',8),('common','crowbar',6),('common','bikehelmet',6),('common','hardhat',5),('common','headlamp',6),
('common','denim',7),('common','tracksuit',6),('common','fanny',6),('common','hiking',3),('common','maglite',6),
('common','radio',4),('common','ducttape',6),('common','powerbank',5),('common','stungun',3),('common','bearspray',7),
('common','roadflare',7),('common','aa',10),('common','pills',4),('common','antiviral',3),('common','epipen',2),
('hunting','bow',6),('hunting','shotgun',4),('hunting','rifle',3),('hunting','ghillie',5),('hunting','scentspray',6),
('hunting','moto',3),('hunting','epipen',4),('hunting','respirator',3),('hunting','hiking',4),('hunting','bearspray',4),
('hunting','aa',6),('hunting','roadflare',5),('hunting','antiviral',3),('hunting','pills',4),
('military','carbine',4),('military','kevlar',4),('military','nvg',3),('military','plate',3),('military','rucksack',4),
('military','claymore',4),('military','drone',4),('military','antiviral',5),('military','cryocase',3),('military','epipen',4),
('military','pills',4),('military','aa',6),('military','shotgun',2),('military','rifle',2)
on conflict (tier, t) do update set w = excluded.w;

-- ---------- helpers ----------
create or replace function zr_new_item(p_t text) returns jsonb language sql volatile as $$
  select jsonb_strip_nulls(jsonb_build_object('id', substr(md5(random()::text || clock_timestamp()::text), 1, 8),
    't', i.t, 'd', i.dur, 'b', case when i.elec then 100 end))
  from zr_items i where i.t = p_t
$$;

create or replace function zr_roll(p_tier text) returns text language plpgsql volatile as $$
declare total int; r int; acc int := 0; rec record;
begin
  select sum(w) into total from zr_loot_table where tier = p_tier;
  r := floor(random() * total)::int;
  for rec in select t, w from zr_loot_table where tier = p_tier order by t loop
    acc := acc + rec.w;
    if r < acc then return rec.t; end if;
  end loop;
  return 'aa';
end $$;

create or replace function zr_cache_tier(p_id text) returns text language sql immutable as $$
  select case when p_id like 's:%' then 'military'
              when abs(hashtext('tier' || p_id)) % 100 < 10 then 'military'
              when abs(hashtext('tier' || p_id)) % 100 < 30 then 'hunting'
              else 'common' end
$$;
create or replace function zr_cache_count(p_id text) returns int language sql immutable as $$
  select case when p_id like 's:%' then 3 else 1 + abs(hashtext('cnt' || p_id)) % 2 end
$$;

create or replace function zr_cap(p_bag text) returns int language sql stable as $$
  select coalesce((select cap from zr_items where t = p_bag), 2)
$$;

-- live (non-broken) gear item in a slot
create or replace function zr_live(g jsonb) returns boolean language sql immutable as $$
  select g is not null and jsonb_typeof(g) = 'object' and coalesce((g->>'d')::float8, 1) > 0
$$;

create or replace function zr_bite_time(p zr_players) returns float8 language sql stable as $$
  select greatest(5,
    coalesce((select bite_s from zr_items where zr_live(p.gear->'head') and t = p.gear->'head'->>'t'), 0),
    coalesce((select bite_s from zr_items where zr_live(p.gear->'armor') and t = p.gear->'armor'->>'t'), 0))::float8
$$;

-- acoustic movement ring of a human (meters)
create or replace function zr_ring(p zr_players) returns float8 language sql stable as $$
  select (case when p.speed < 0.6 then 10
               when p.speed < 2.5 then 35
               when zr_live(p.gear->'armor') and p.gear->'armor'->>'t' = 'tracksuit' then 15
               else 50 end)
       * (case when p.bag = 'rucksack' then 1.15 else 1 end)
       * (case when zr_live(p.gear->'armor') and p.gear->'armor'->>'t' = 'ghillie' then 0.6 else 1 end)
       * (case when p.headlamp_on and zr_live(p.gear->'head') and p.gear->'head'->>'t' = 'headlamp'
                    and coalesce((p.gear->'head'->>'b')::float8, 0) > 0 then 1.5 else 1 end)
$$;

create or replace function zr_ping(p_lat float8, p_lng float8, p_r float8, p_secs int, p_src uuid, p_kind text)
returns void language sql as $$
  insert into zr_pings(lat, lng, radius, until, src, kind)
  select p_lat, p_lng, p_r, now() + make_interval(secs => p_secs), p_src, p_kind
  where p_lat is not null and p_r is not null and p_r > 0;
$$;

-- zombie armor shell total
create or replace function zr_shell(p zr_players) returns int language sql immutable as $$
  select (coalesce((p.z_head->>'d')::float8, 0) + coalesce((p.z_armor->>'d')::float8, 0))::int
$$;
