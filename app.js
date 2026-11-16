(() => {
'use strict';
const SB = 'https://cidcepbbigusappypdqs.supabase.co';
const KEY = 'sb_publishable_FGF_IxpGZr1JV5Mdt8ENdA_jGAb9Lhj';
const BITE_M = 15.24, EXPOSED_M = 45.72, HB_MS = 3000;
const $ = id => document.getElementById(id);

/* ---------- storage ---------- */
const store = {
  get(k){ try { return JSON.parse(localStorage.getItem(k)); } catch(e){ return null; } },
  set(k,v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} },
  del(k){ try { localStorage.removeItem(k); } catch(e){} }
};
let auth = store.get('zr_auth');

async function rpc(fn, args){
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, {
    method:'POST', headers:{ apikey:KEY, 'Content-Type':'application/json' }, body: JSON.stringify(args || {})
  });
  let j = null; try { j = await r.json(); } catch(e){}
  if (!r.ok) { const e = new Error((j && j.message) || ('HTTP ' + r.status)); e.status = r.status; throw e; }
  return j;
}
const A = extra => Object.assign({ p_id: auth.id, p_secret: auth.secret }, extra || {});
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = s => { s = Math.max(0, Math.round(s)); return Math.floor(s/60) + ':' + String(s%60).padStart(2,'0'); };
const ft = m => Math.round(m * 3.281);

/* ---------- catalog ---------- */
let CAT = {};
const SHOVE = { t:'shove', name:'Shove', dmg:0, cd:15, targets:1, range_m:15, descr:'Pushes a zombie back: a 10-second stun.' };
const nm = t => (CAT[t] && CAT[t].name) || t;
async function loadCatalog(){
  try { const c = await rpc('zr_catalog'); CAT = {}; (c || []).forEach(i => CAT[i.t] = i); store.set('zr_cat', CAT); }
  catch(e){ CAT = store.get('zr_cat') || {}; }
}

/* ---------- intro ---------- */
const ADJ = ['Grim','Rotten','Feral','Silent','Rusty','Pale','Hollow','Swift','Lucky','Ashen','Mossy','Shady','Static','Restless','Crooked','Bitter'];
const NOUN = ['Otter','Crow','Medic','Ghoul','Scout','Wolf','Moth','Ranger','Badger','Shade','Lynx','Raven','Drifter','Hound','Viper','Fox'];
const pick = a => a[Math.floor(Math.random()*a.length)];
const randHandle = () => pick(ADJ) + pick(NOUN) + Math.floor(10 + Math.random()*89);

function showIntro(){
  $('intro').hidden = false; hideSplash();
  $('handle').value = randHandle();
  const sel = $('byear'); const y = new Date().getFullYear();
  sel.innerHTML = '<option value="">Select…</option>';
  for (let i = y - 10; i >= y - 90; i--) sel.insertAdjacentHTML('beforeend', `<option>${i}</option>`);
  const check = () => { $('joinBtn').disabled = !($('agree').checked && sel.value && $('handle').value.trim().length >= 3); };
  ['input','change'].forEach(ev => { sel.addEventListener(ev, check); $('agree').addEventListener(ev, check); $('handle').addEventListener(ev, check); });
  $('reroll').onclick = () => { $('handle').value = randHandle(); check(); };
  $('joinBtn').onclick = async () => {
    const h = $('handle').value.trim(), by = parseInt(sel.value, 10);
    $('joinErr').textContent = '';
    if (!/^[A-Za-z0-9_]{3,16}$/.test(h)) { $('joinErr').textContent = 'Handles are 3–16 letters, numbers or _.'; return; }
    $('joinBtn').disabled = true;
    try {
      const r = await rpc('zr_join', { p_handle: h, p_birth_year: by });
      if (r.error) {
        $('joinErr').textContent = { too_young:'You must be 13 or older to play.', handle_taken:'That handle is taken. Try another.', bad_handle:'Handles are 3–16 letters, numbers or _.' }[r.error] || r.error;
        $('joinBtn').disabled = false; return;
      }
      auth = { id: r.id, secret: r.secret, handle: h };
      store.set('zr_auth', auth);
      $('intro').hidden = true;
      startLocation();
    } catch (e) { $('joinErr').textContent = 'Could not connect. Check your signal and try again.'; $('joinBtn').disabled = false; }
  };
}

/* ---------- location ---------- */
let fix = null, watchId = null;
function startLocation(){
  if (!('geolocation' in navigator)) { $('locScreen').hidden = false; hideSplash(); $('locMsg').textContent = "This browser can't share location, so the game can't run here."; $('locBtn').hidden = true; return; }
  const begin = () => {
    $('locBtn').disabled = true;
    watchId = navigator.geolocation.watchPosition(p => {
      fix = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy,
              speed: (p.coords.speed != null && p.coords.speed >= 0) ? p.coords.speed : null, t: Date.now() };
      if (!started) { $('locScreen').hidden = true; startGame(); }
    }, err => {
      $('locBtn').disabled = false;
      if (!started) {
        $('locScreen').hidden = false; hideSplash();
        $('locMsg').textContent = err.code === 1
          ? 'Location is blocked. Turn it on for this site in your browser settings, then tap Try again.'
          : 'Still looking for a GPS signal. Step outside or near a window, then tap Try again.';
        $('locBtn').textContent = 'Try again';
      }
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  };
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name:'geolocation' }).then(s => { if (s.state === 'granted') begin(); else showLoc(begin); }).catch(() => showLoc(begin));
  } else showLoc(begin);
}
function showLoc(begin){ $('locScreen').hidden = false; hideSplash(); $('locBtn').onclick = () => { if (watchId !== null) navigator.geolocation.clearWatch(watchId); begin(); }; }

/* ---------- game state ---------- */
let started = false, map, layer, meMarker, meRing, meRing2, soundRing, follow = true, data = null, since = null;
const seenEvents = new Set();
let prevState = null, prevInfected = false, hbBusy = false, wakeLock = null, pinMode = null, closeAlerted = new Set();
let localCdUntil = 0;

function startGame(){
  started = true;
  $('game').hidden = false;
  map = L.map('map', { zoomControl:false, attributionControl:true, zoomSnap:0.5 }).setView([fix.lat, fix.lng], 18);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20, maxNativeZoom: 19,
    attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  layer = L.layerGroup().addTo(map);
  soundRing = L.circle([fix.lat, fix.lng], { radius: 10, color:'#ffb547', weight:1, dashArray:'3 6', fill:false, opacity:.6, interactive:false }).addTo(map);
  meRing2 = L.circle([fix.lat, fix.lng], { radius: EXPOSED_M, color:'#ff4d4d', weight:1.5, dashArray:'6 6', fill:false, opacity:0, interactive:false }).addTo(map);
  meRing = L.circle([fix.lat, fix.lng], { radius: BITE_M, color:'#5ad1ff', weight:2, fillOpacity:.08, interactive:false }).addTo(map);
  meMarker = L.marker([fix.lat, fix.lng], { icon: mkIcon('me', '#5ad1ff', ''), zIndexOffset: 1000, interactive:false }).addTo(map);
  map.on('dragstart', () => { follow = false; });
  map.on('click', e => { if (pinMode) { const f = pinMode; pinMode = null; f(e.latlng); } });
  $('recenter').onclick = () => { follow = true; if (fix) map.setView([fix.lat, fix.lng], Math.max(map.getZoom(), 17.5)); };
  $('menuBtn').onclick = openMenu;
  $('q-eq1').onclick = () => useSlot('eq1');
  $('q-eq2').onclick = () => useSlot('eq2');
  $('q-gear').onclick = openGear;
  $('q-light').onclick = toggleLight;
  $('atkBtn').onclick = attack;
  $('smashBtn').onclick = smashNearest;
  setupBite();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { heartbeat(); requestWake(); } });
  requestWake();
  heartbeat();
  setInterval(heartbeat, HB_MS);
  setInterval(tickLocal, 500);
  if (!store.get('zr_seen_howto2')) { store.set('zr_seen_howto2', 1); setTimeout(showHowTo, 700); }
}
async function requestWake(){ try { if ('wakeLock' in navigator && !document.hidden) wakeLock = await navigator.wakeLock.request('screen'); } catch(e){} }

function mkIcon(kind, color, label, extra){
  return L.divIcon({ className:'', iconSize:[24,24], iconAnchor:[12,12],
    html:`<div class="mk ${kind}" style="color:${color}">${extra || ''}<div class="b"></div>${label ? `<div class="lbl">${esc(label)}</div>` : ''}</div>` });
}

async function heartbeat(){
  if (hbBusy || !fix || document.hidden) return;
  hbBusy = true;
  try {
    const fresh = Date.now() - fix.t < 15000;
    const r = await rpc('zr_heartbeat', A({
      p_lat: fresh ? fix.lat : null, p_lng: fresh ? fix.lng : null, p_acc: fresh ? fix.acc : null,
      p_tz: new Date().getTimezoneOffset(), p_since: since, p_speed: fresh ? fix.speed : null
    }));
    data = r; data._at = Date.now(); data._skew = Date.now() - Date.parse(r.now);
    since = r.now;
    hideSplash();
    render();
    handleEvents(r.events || []);
  } catch (e) {
    if (/bad_auth/.test(e.message)) { store.del('zr_auth'); location.reload(); return; }
    banner('net', 'Connection lost. Retrying…', 'red');
  } finally { hbBusy = false; }
}

const left = key => data ? Math.max(0, (data.me[key] || 0) - (Date.now() - data._at)/1000) : 0;
function infLeft(){
  if (!data || !data.me.infected) return null;
  return Math.max(0, data.me.inf_left - (Date.now() - data._at)/1000 * (data.me.inf_rate == null ? 1 : data.me.inf_rate));
}
function weapon(){ const w = data && data.me.gear && data.me.gear.weapon; return w ? Object.assign({}, CAT[w.t] || {}, { t:w.t }) : SHOVE; }
function cdLeft(){
  if (!data) return 0;
  const w = weapon();
  const srvLeft = data.me.last_attack ? (w.cd - (Date.now() - data._skew - Date.parse(data.me.last_attack)) / 1000) : 0;
  return Math.max(0, srvLeft, (localCdUntil - Date.now()) / 1000);
}

/* titles */
function title(p){
  if (p.state === 'zombie') return p.patient_zero ? 'Patient Zero' : p.infections >= 10 ? 'Alpha' : p.infections >= 3 ? 'Stalker' : 'Shambler';
  return p.cures >= 10 ? 'Medic' : p.cures >= 3 ? 'Field Medic' : 'Survivor';
}
function itemMeta(it){
  if (!it) return '';
  const c = CAT[it.t] || {}; const bits = [];
  if (c.kind === 'head' || c.kind === 'armor') bits.push(`${it.d}/${c.dur} armor`);
  else if (c.kind === 'item') bits.push(`${it.d} uses`);
  if (it.b != null) bits.push(`${Math.round(it.b)}% batt`);
  return bits.join(' · ');
}

/* ---------- render ---------- */
function render(){
  const me = data.me;
  const zombie = me.state === 'zombie';
  const infected = !zombie && me.infected;

  // status chip
  $('stText').style.color = zombie ? 'var(--rot)' : infected ? 'var(--blood)' : 'var(--human)';
  const days = data.season ? Math.max(0, Math.ceil((new Date(data.season.ends_at) - Date.now()) / 86400000)) : 0;
  if (zombie) {
    $('stSub').textContent = `${me.handle} · ${title(me)} · HP ${me.hp}${me.shell ? ' + ' + me.shell + ' armor' : ''} · ${me.points} pts`;
    const tot = Math.max(100, me.hp + me.shell);
    $('barA').style.width = (me.hp / tot * 100) + '%'; $('barA').style.background = 'var(--rot)';
    $('barB').style.width = (me.shell / tot * 100) + '%';
  } else {
    $('stSub').textContent = `${me.handle} · ${title(me)} · ${me.points} pts · ${data.season ? days + 'd left' : ''}`;
    $('barA').style.width = me.supplies + '%'; $('barA').style.background = 'var(--warn)';
    $('barB').style.width = '0%';
  }
  updateStatusText();

  // gps / sound chip
  const acc = fix ? Math.round(fix.acc) : null;
  $('gps').textContent = (acc == null ? 'GPS —' : acc > 35 ? `GPS ±${acc} m · weak` : `GPS ±${acc} m`) + (zombie ? '' : ` · noise ${me.ring} m`);
  $('gps').style.color = acc > 35 ? 'var(--warn)' : 'var(--dim)';

  // me on map
  if (fix) {
    const ll = [fix.lat, fix.lng];
    meMarker.setLatLng(ll); meRing.setLatLng(ll); meRing2.setLatLng(ll); soundRing.setLatLng(ll);
    if (follow) map.panTo(ll, { animate:true });
  }
  const c = zombie ? '#9be564' : infected ? '#ff4d4d' : '#5ad1ff';
  meMarker.setIcon(mkIcon('me', c, ''));
  meRing.setStyle({ color: c, fillColor: c });
  meRing2.setStyle({ opacity: (!zombie && me.exposed > 0) ? .9 : 0 });
  soundRing.setRadius(me.ring || 10); soundRing.setStyle({ opacity: zombie ? 0 : .6 });

  // layers
  layer.clearLayers();
  for (const cc of data.caches || []) {
    const cls = cc.destroyed > 0 ? 'dead' : cc.cooldown > 0 ? 'cd' : cc.sponsored ? 'sp' : cc.tier === 'military' ? 'mil' : cc.tier === 'hunting' ? 'hunt' : '';
    const sym = cc.destroyed > 0 ? '×' : cc.sponsored ? '★' : cc.tier === 'military' ? 'M' : cc.tier === 'hunting' ? 'H' : '+';
    layer.addLayer(L.marker([cc.lat, cc.lng], { icon: L.divIcon({ className:'', iconSize:[22,22], iconAnchor:[11,11],
      html:`<div class="crate ${cls}">${sym}</div>` }) }).on('click', () => tapCache(cc)));
  }
  for (const b of data.bags || []) {
    layer.addLayer(L.marker([b.lat, b.lng], { icon: L.divIcon({ className:'', iconSize:[20,20], iconAnchor:[10,10],
      html:`<div class="bagmk">${b.n}</div>` }) }).on('click', () => tapBag(b)));
  }
  for (const m of data.mines || []) {
    if (m.kind === 'claymore') layer.addLayer(L.marker([m.lat, m.lng], { icon: L.divIcon({ className:'', iconSize:[12,12], iconAnchor:[6,6], html:'<div class="minemk"></div>' }) })
      .on('click', () => toast('Your claymore. It goes off when a zombie comes within 33 ft.')));
    else {
      layer.addLayer(L.circle([m.lat, m.lng], { radius: 20, color:'#ff8a3d', weight:1, fillOpacity:.08, interactive:false }));
      layer.addLayer(L.marker([m.lat, m.lng], { icon: L.divIcon({ className:'', iconSize:[14,14], iconAnchor:[7,7], html:'<div class="flaremk"></div>' }) })
        .on('click', () => toast(`Your road flare. Watching for zombies for ${fmt(m.left)}.`)));
    }
  }
  for (const r of data.reveals || []) {
    layer.addLayer(L.circle([r.lat, r.lng], { radius: r.radius, color:'#5ad1ff', weight:1.5, dashArray:'4 6', fillOpacity:.05, interactive:false }));
  }
  for (const b of data.beacons || []) {
    layer.addLayer(L.marker([b.lat, b.lng], { icon: L.divIcon({ className:'', iconSize:[14,14], iconAnchor:[7,7], html:'<div class="flaremk"></div>' }) })
      .on('click', () => toast('A road flare. Zombies near it get spotted.')));
  }
  for (const r of data.ripples || []) {
    const loud = r.kind !== 'move';
    const label = r.kind === 'move' ? '' : ({ explosion:'blast', shotgun:'gunshot', rifle:'gunshot', carbine:'gunshot', bat:'clang', crowbar:'clang',
      bow:'twang', bearspray:'hiss', stungun:'crackle', flare:'hiss', drone:'buzz', shove:'scuffle' }[r.kind] || 'noise');
    layer.addLayer(L.marker([r.lat, r.lng], { icon: L.divIcon({ className:'', iconSize:[34,34], iconAnchor:[17,17],
      html:`<div class="ripple ${loud ? 'loud' : ''}"></div>${label ? `<div class="riplbl">${label}</div>` : ''}` }) })
      .on('click', () => toast(r.kind === 'move' ? `Footsteps somewhere around here (~${r.dist} m)` : `A ${label} came from around here (~${r.dist} m)`)));
  }
  let anyClose = false;
  for (const o of data.others || []) {
    const oc = o.state === 'zombie' ? '#9be564' : o.state === 'infected' ? '#ff4d4d' : '#5ad1ff';
    if (o.state === 'zombie' && o.close) anyClose = true;
    if (o.exact) {
      const hpb = (!zombie && o.state === 'zombie' && o.hp != null) ? `<div class="hpb">${o.hp}${o.shell ? '+' + o.shell : ''}</div>` : '';
      layer.addLayer(L.marker([o.lat, o.lng], { icon: mkIcon('', oc, o.handle + (o.stunned ? ' (stunned)' : ''), hpb), zIndexOffset: 500 }).on('click', () => tapPlayer(o)));
    } else {
      layer.addLayer(L.circle([o.lat, o.lng], { radius: 40, color: oc, weight: 1, fillColor: oc, fillOpacity: .14, opacity: .5 })
        .on('click', () => o.state === 'zombie' && !zombie ? tapPlayer(o)
          : toast(`${o.state === 'zombie' ? 'Zombie' : o.state === 'infected' ? 'Infected human' : 'Human'} somewhere in this zone (~${o.dist} m)`)));
    }
  }
  if (anyClose && !zombie) {
    const ids = (data.others || []).filter(o => o.close).map(o => o.id);
    if (ids.some(id => !closeAlerted.has(id))) { navigator.vibrate && navigator.vibrate([120,80,120]); }
    closeAlerted = new Set(ids);
  } else closeAlerted = new Set();

  // controls
  $('humanCtl').hidden = zombie;
  $('zombieCtl').hidden = !zombie;
  if (!zombie) renderQuick(); else { updateBiteBtn(); updateSmashBtn(); }
  updateAtkBtn();
  $('downOv').hidden = !(zombie && me.down > 0);
  banners();

  // transitions
  if (prevState === 'human' && zombie) modal('You turned', `The infection took hold. Your weapon, items and backpack dropped where you stood. ${me.shell ? `Your armor stayed on: +${me.shell} armor.` : ''} Hunt humans within 50 ft and hold Bite. Smash stockpiles to starve them.`, 'Hunt');
  if (!prevInfected && infected && prevState) navigator.vibrate && navigator.vibrate([300,100,300]);
  if (prevState === 'zombie' && !zombie) modal("You're human again", 'Someone cured you. Your armor is back on, but you\'ll need to find a new weapon.', 'Survive');
  prevState = me.state; prevInfected = infected;
}

function updateStatusText(){
  if (!data) return;
  const me = data.me;
  if (me.state === 'zombie') $('stText').textContent = me.down > 0 ? 'Zombie · down' : 'Zombie';
  else if (me.infected) {
    const r = me.inf_rate; const tag = r === 0 ? ' · paused' : r === 0.5 ? ' · slowed' : '';
    $('stText').textContent = 'Infected ' + fmt(infLeft()) + tag;
  } else $('stText').textContent = 'Human';
  if (me.state === 'zombie' && me.down > 0) $('downTxt').textContent = `A human took you out. You'll rise again in ${fmt(left('down'))}.`;
}

function renderQuick(){
  const me = data.me, g = me.gear || {};
  for (const s of ['eq1','eq2']) {
    const it = g[s], b = $('q-' + s);
    const rdy = (me.eq_ready && me.eq_ready[s]) ? Math.max(0, me.eq_ready[s] - (Date.now() - data._at)/1000) : 0;
    b.className = 'qs' + (it ? '' : ' empty');
    b.innerHTML = `<span class="k">Slot ${s === 'eq1' ? 1 : 2}</span><span class="n">${it ? esc(nm(it.t)) : 'Empty'}</span>` +
      `<span class="m">${it ? (rdy > 0 ? `Equipping ${Math.ceil(rdy)}s` : esc(itemMeta(it))) : ''}</span>` +
      (rdy > 0 ? `<i class="cfill" style="width:${(1 - rdy/10)*100}%"></i>` : '');
  }
  const hd = g.head; const lightable = hd && (hd.t === 'headlamp' || hd.t === 'nvg');
  $('q-light').hidden = !lightable;
  $('quick').classList.toggle('light', !!lightable);
  if (lightable) {
    const on = hd.t === 'headlamp' ? me.headlamp_on : me.nvg_on;
    $('q-light').className = 'qs' + (on ? ' on' : '');
    $('q-light').innerHTML = `<span class="k">${hd.t === 'nvg' ? 'NVG' : 'Lamp'}</span><span class="n">${on ? 'On' : 'Off'}</span><span class="m">${Math.round(hd.b || 0)}%</span>`;
  }
  const used = (me.pack || []).length;
  $('q-gear').innerHTML = `<span class="k">Gear</span><span class="n">Backpack</span><span class="m">${used}/${me.cap} slots</span>`;
}

function nearestZombie(maxD){
  return (data.others || []).filter(o => o.state === 'zombie' && !o.stunned && (maxD == null || o.dist <= maxD)).sort((a,b) => a.dist - b.dist)[0]
      || (data.others || []).filter(o => o.state === 'zombie' && (maxD == null || o.dist <= maxD)).sort((a,b) => a.dist - b.dist)[0] || null;
}
function updateAtkBtn(){
  if (!data || data.me.state === 'zombie') return;
  const w = weapon(), cd = cdLeft();
  const verb = { shove:'Shove', bat:'Swing', crowbar:'Swing', bow:'Shoot', shotgun:'Fire', rifle:'Fire', carbine:'Fire' }[w.t] || 'Attack';
  const t = nearestZombie(w.range_m + 3), any = nearestZombie();
  $('atkLbl').textContent = `${verb} ${w.t === 'shove' ? '' : nm(w.t)}`.trim();
  $('atkFill').style.width = cd > 0 ? (cd / w.cd * 100) + '%' : '0';
  const exp = left('exposed') > 0;
  $('atkBtn').disabled = !t || cd > 0 || exp;
  $('atkSub').textContent = exp ? 'Exposed: you can\'t fight yet'
    : cd > 0 ? `Reloading ${cd.toFixed(1)}s`
    : t ? `${t.handle} · ~${t.dist} m${t.hp != null ? ` · ${t.hp}${t.shell ? '+' + t.shell : ''} HP` : ''}`
    : any ? `Nearest zombie ~${any.dist} m (range ${ft(w.range_m)} ft)` : `No zombies on radar · range ${ft(w.range_m)} ft`;
}

function tickLocal(){
  if (!data) return;
  updateStatusText();
  if (data.me.state === 'zombie') { if (!biting) updateBiteBtn(); }
  else { updateAtkBtn(); renderQuick(); }
  $('blindOv').hidden = !(data.me.state === 'zombie' && left('blinded') > 0);
  banners();
}

const bannerState = {};
function banner(key, text, cls){ bannerState[key] = { text, cls, t: Date.now() }; drawBanners(); }
function banners(){
  if (!data) return;
  const me = data.me, z = me.state === 'zombie';
  const set = (k, cond, text, cls) => { if (cond) bannerState[k] = { text, cls, persist:true }; else delete bannerState[k]; };
  const il = infLeft();
  set('inc', !z && me.infected, `Infected! You turn in ${fmt(il)}${me.inf_rate === 0 ? ' (paused while you move)' : me.inf_rate === 0.5 ? ' (slowed)' : ''}. Find an antiviral.`, 'red');
  set('exp', !z && left('exposed') > 0, `Exposed for ${fmt(left('exposed'))}: no items or attacks, and zombies can bite from 150 ft.`, 'red');
  set('close', !z && (data.others || []).some(o => o.close), 'Zombie very close!', 'red');
  set('dis', !z && left('disguised') > 0, `Scent-blocked: zombies see you as one of them (${fmt(left('disguised'))}).`, 'blue');
  set('boost', !z && left('boost') > 0, `Flashlight on: radar doubled (${fmt(left('boost'))}).`, 'blue');
  set('stun', z && left('stunned') > 0, `Stunned: you can't bite or smash for ${fmt(left('stunned'))}.`, 'green');
  set('shel', me.sheltered, me.minor && !me.home ? "Night curfew (10pm–6am): you're sheltered and hidden." : "You're at home: sheltered and hidden from everyone.", 'blue');
  set('sup', !z && me.supplies <= 0, "Out of supplies: you can't use items until you reach a stockpile.", 'red');
  set('gpsw', fix && fix.acc > 35, 'Weak GPS. Step outside for fights and stockpiles to work.', '');
  if (bannerState.net && Date.now() - bannerState.net.t > 6000) delete bannerState.net;
  drawBanners();
}
function drawBanners(){
  const keys = Object.keys(bannerState).slice(0, 3);
  $('banners').innerHTML = keys.map(k => `<div class="banner ${bannerState[k].cls || ''}">${esc(bannerState[k].text)}</div>`).join('');
}

/* ---------- toasts / alarm / modal ---------- */
let toastT;
function toast(msg){ const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3400); }
let alarmT;
function alarm(msg, ms){ $('alarmText').textContent = msg; $('alarm').hidden = false; navigator.vibrate && navigator.vibrate([250,100,250,100,250]);
  clearTimeout(alarmT); alarmT = setTimeout(() => { $('alarm').hidden = true; }, ms || 4500); }
function modal(h, p, btn){
  $('modalBody').innerHTML = `<h2>${esc(h)}</h2><p>${esc(p)}</p><button class="btn" id="mOk">${esc(btn || 'OK')}</button>`;
  $('modal').hidden = false; $('mOk').onclick = () => { $('modal').hidden = true; };
}

/* ---------- events ---------- */
function handleEvents(evs){
  for (const e of evs) {
    if (seenEvents.has(e.id)) continue;
    seenEvents.add(e.id);
    const o = e.other || 'someone', i = e.info || {};
    switch (e.kind) {
      case 'bite_warning': if (!e.mine) alarm(`${o} is biting you! ${i.secs || 5}s to stop it. Run, spray or fight!`, (i.secs || 5) * 1000); break;
      case 'bitten': if (e.mine) toast(`You infected ${o}. +10`); else { $('alarm').hidden = true; modal('Bitten', `${o} bit you. You turn in 5 minutes unless you cure it. Antivirals cure; pills, cryo cases and EpiPens buy time.`, 'Find a cure'); } break;
      case 'cured': if (e.mine && e.other === data.me.handle) toast('You cured yourself.'); else if (e.mine) toast(`You cured ${o}. +10`); else toast(`${o} cured you.`); break;
      case 'hit': if (!e.mine) toast(`${o} hit you for ${i.dmg}. HP ${i.hp}${i.broke && i.broke.length ? ' · your ' + i.broke.map(nm).join(' & ') + ' broke' : ''}`); break;
      case 'killed': if (e.mine) toast(`You put ${o} down for 8 minutes. +5`); break;
      case 'stunned': if (!e.mine) toast(`${o} stunned you for ${i.secs >= 60 ? Math.round(i.secs/60) + ' min' : i.secs + 's'}.`); break;
      case 'blinded': if (!e.mine) toast('Bear spray! You can\'t see.'); break;
      case 'mine_boom': toast(`Your claymore went off on ${o}!${i.killed ? ' Put down. +5' : ''}`); break;
      case 'flare_cross': toast(`A zombie crossed your road flare!`); navigator.vibrate && navigator.vibrate(200); break;
      case 'turned': break;
      case 'emerged': alarm(`${o} just came out of hiding nearby. They're exposed!`); break;
      case 'returned': toast(`Back from hiding: exposed for ${Math.round(i.secs/60)} min${i.drain ? `, −${i.drain} supplies` : ''}.`); break;
      case 'patient_zero': modal('Patient Zero', "You're one of the first zombies here. Listen for footsteps and gunfire (red ripples), get within 50 ft of a human and hold Bite. Smash stockpiles to starve them.", 'Start hunting'); break;
      case 'bloodline': if (!e.mine) toast(`Bloodline +5: ${i.via} infected ${o}.`); break;
      case 'lost_victim': if (!e.mine) toast(`${o} was cured.`); break;
    }
  }
}

/* ---------- human actions ---------- */
const ERR = {
  exposed:"You just came back from hiding. Wait for the timer.", no_supplies:'Out of supplies. Reach a stockpile first.',
  not_infected:"Nobody here needs that.", too_far:'Get closer first.', zombies_cant:"Zombies can't do that.",
  weak_gps:'GPS too weak. Step outside.', target_gps:'Their GPS is too weak right now.', stunned:"You're stunned.",
  blinded:"You can't see!", down:"You're down.", not_target:"That player can't be bitten.", sheltered:"They're sheltered.",
  group:"They're in a group of 3+. Bites don't work.", cooldown:'Still reloading.', destroyed:'Zombies wrecked this stockpile.',
  too_soon:'Keep holding.', expired:'Too slow. Try again.', no_bite:'Your bite was stopped!', not_zombie:'Only zombies can do that.',
  bad_cache:"That's gone.", battery:'Battery too low. Use batteries or a power bank.', empty:'Nothing in that slot.',
  equipping:'Still equipping.', no_target:'No zombie in range.', out_of_range:'Out of range.', nothing_to_repair:'Your armor is already in full shape.',
  nothing_to_charge:'Nothing equipped needs charging.', need_pin:'Pick a spot on the map.', pin_too_far:'That spot is more than 200 m away.',
  cant_use:"That can't be used from a quick slot.", pack_full:'Your backpack is full.', too_full:'Too many items for that bag.',
  no_light:'No light to toggle.', bad_index:'Try again.', cant_equip:"Can't equip that."
};
const errMsg = r => ERR[r.error] || r.error;

async function attack(){
  if (!data) return;
  const w = weapon(); const t = nearestZombie(w.range_m + 3);
  if (!t) return;
  try {
    const r = await rpc('zr_attack', A({ p_target: t.id }));
    if (r.error) { toast(errMsg(r) + (r.error === 'out_of_range' ? ` Range ${ft(r.range)} ft.` : '')); return; }
    localCdUntil = Date.now() + r.cd * 1000;
    const h = r.hits || [];
    if (r.weapon === 'shove') toast(`Shoved ${t.handle}! Stunned for 10s. Run!`);
    else toast(h.map(x => x.killed ? `${x.handle} down!` : `${x.handle}: ${x.hp} HP${x.shell ? ' + ' + x.shell : ''}${x.stunned ? ' · stunned' : ''}${x.broke && x.broke.length ? ' · armor broke' : ''}`).join(' · ') || 'Missed.');
    navigator.vibrate && navigator.vibrate(60);
    heartbeat();
  } catch(e){ toast('Network error.'); }
}

async function useSlot(slot){
  if (!data) return;
  const it = data.me.gear && data.me.gear[slot];
  if (!it) { openGear(); return; }
  let extra = {};
  if (it.t === 'antiviral' && !data.me.infected) {
    const c = (data.others || []).filter(o => o.exact && (o.state === 'infected' || o.state === 'zombie') && o.dist <= 18).sort((a,b) => a.dist - b.dist)[0];
    if (!c) { toast('Antiviral: get within 50 ft of an infected player or zombie, or save it for yourself.'); return; }
    extra.p_target = c.id;
  }
  if (it.t === 'drone') {
    toast('Tap the map where to send the drone (within 200 m).');
    pinMode = async ll => { await doUse(slot, { p_lat: ll.lat, p_lng: ll.lng }); };
    return;
  }
  if (it.t === 'claymore' && !confirm('Plant a claymore here? It goes off on the first zombie within 33 ft, and the blast is heard 400 m away.')) return;
  await doUse(slot, extra);
}
async function doUse(slot, extra){
  try {
    const r = await rpc('zr_use', A(Object.assign({ p_slot: slot }, extra)));
    if (r.error) { toast(r.error === 'equipping' ? `Still equipping: ${r.left}s` : errMsg(r)); return; }
    const msg = {
      boost:'Flashlight on: radar range doubled for 3 min.', radio:'Radio scan: zombies within 150 m revealed for 15s.',
      stunned:`Zapped ${r.handle}: stunned for 6 min.`, cryo:'Cryo case on: infection slowed by half for 5 min.',
      repaired:`Patched up your ${r.slot === 'head' ? 'helmet' : 'armor'} (+35).`, charged:'Battery topped up (+50%).',
      sprayed: r.blinded ? `Bear spray! ${r.blinded} zombie${r.blinded > 1 ? 's' : ''} blinded.` : 'Bear spray. Any bite on you is stopped.',
      flare:'Road flare dropped: zombies within 20 m show up for 10 min.', epi:'EpiPen: infection paused while you keep moving (3 min).',
      pills:'Pills: +20 minutes before you turn.', cured: r.self ? 'Antiviral: you\'re cured!' : 'Antiviral: they\'re cured! +10',
      disguised:'Scent-blocker: zombies see you as a zombie for 3 min.', mine:'Claymore planted.', drone:'Drone out: zombies near that spot revealed for 2 min.'
    }[r.result] || 'Done.';
    toast(msg); heartbeat();
  } catch(e){ toast('Network error.'); }
}
async function toggleLight(){
  try { const r = await rpc('zr_toggle', A()); if (r.error) toast(errMsg(r)); else { toast(r.result === 'on' ? 'Light on. You see further, but you\'re louder.' : 'Light off.'); heartbeat(); } }
  catch(e){ toast('Network error.'); }
}

async function tapCache(c){
  if (!data) return;
  const tierName = c.sponsored ? `${esc(c.name)} stockpile` : { military:'Military stockpile', hunting:'Hunting stockpile', common:'Stockpile' }[c.tier] || 'Stockpile';
  if (data.me.state === 'zombie') {
    if (c.destroyed > 0) { toast(`Wrecked. Back in ${Math.ceil(c.destroyed/60)} min.`); return; }
    if (c.dist > 35) { toast(`${tierName}: ${Math.round(c.dist)} m away. Get within 100 ft to smash it.`); return; }
    return smash(c.id);
  }
  if (c.destroyed > 0) { toast(`Zombies wrecked this. Restocked in ${Math.ceil(c.destroyed/60)} min.`); return; }
  if (c.cooldown > 0) { toast(`You raided this. Restocks for you in ${Math.ceil(c.cooldown/60)} min.`); return; }
  if (c.dist > 35) { toast(`${tierName}: ${Math.round(c.dist)} m away. Get within 100 ft.`); return; }
  try {
    const r = await rpc('zr_loot', A({ p_cache: c.id }));
    if (r.error) { toast(errMsg(r)); return; }
    showLoot(r.items, `${tierName} raided`, '+30 supplies');
    heartbeat();
  } catch(e){ toast('Network error.'); }
}
async function tapBag(b){
  if (!data) return;
  if (data.me.state === 'zombie') { if (b.dist > 35) toast(`Loot bag ${b.dist} m away.`); else smash('b:' + b.id); return; }
  if (b.dist > 35) { toast(`A dropped bag with ${b.n} item${b.n > 1 ? 's' : ''}, ${b.dist} m away.`); return; }
  try {
    const r = await rpc('zr_take_bag', A({ p_bag: b.id }));
    if (r.error) { toast(errMsg(r)); return; }
    showLoot(r.items, 'Bag picked up', r.left ? `${r.left} item${r.left > 1 ? 's' : ''} didn't fit and stayed in the bag` : '');
    heartbeat();
  } catch(e){ toast('Network error.'); }
}
function showLoot(items, head, note){
  const where = { weapon:'equipped as weapon', head:'put on', armor:'put on', eq1:'in slot 1', eq2:'in slot 2', bag:'now your backpack', pack:'in backpack', ground:"no room: left on the ground" };
  openSheet(head, `<div class="sh-sec">${(items || []).map(i => `<p><b style="color:var(--text)">${esc(nm(i.t))}</b> · ${where[i.where] || i.where}</p>`).join('') || '<p>Empty.</p>'}
    ${note ? `<p>${esc(note)}</p>` : ''}</div><button class="btn" id="lootOk">Got it</button><button class="btn ghost" id="lootGear">Open gear</button>`);
  $('lootOk').onclick = closeSheet; $('lootGear').onclick = openGear;
}

function tapPlayer(o){
  const st = o.state === 'zombie' ? 'Zombie' : o.state === 'infected' ? 'Infected' : 'Human';
  openSheet(o.handle, `
    <div class="sh-sec"><p><b style="color:var(--text)">${st}</b> · ${esc(title(o))} · ~${o.dist} m away<br>
      ${o.state === 'zombie' ? `${o.infections} infections${o.hp != null ? ` · ${o.hp} HP${o.shell ? ' + ' + o.shell + ' armor' : ''}` : ''}` : o.cures + ' cures'}</p></div>
    <div class="menu-grid"><button class="btn ghost" id="pBlock">Block</button><button class="btn ghost" id="pReport">Report</button></div>`);
  $('pBlock').onclick = () => blockPlayer(o, null);
  $('pReport').onclick = () => { const why = prompt('What happened? (optional)'); blockPlayer(o, why || 'reported'); };
}
async function blockPlayer(o, report){
  try { await rpc('zr_block', A({ p_target: o.id, p_report: report })); closeSheet(); toast(report ? `Reported and blocked ${o.handle}.` : `Blocked ${o.handle}. You won't see each other.`); heartbeat(); }
  catch(e){ toast('Network error.'); }
}

/* ---------- gear sheet ---------- */
let gearSel = null;
function openGear(){
  if (!data) return;
  const me = data.me;
  if (me.state === 'zombie') {
    const a = [me.z_head, me.z_armor].filter(Boolean);
    openSheet('Zombie', `<div class="sh-sec"><p>Zombies carry nothing. You keep the helmet and armor you were wearing when you turned. They soak up damage until they break, and they can't be repaired.</p>
      <p><b style="color:var(--text)">HP ${me.hp}</b>${a.map(x => ` · ${esc(nm(x.t))} ${x.d}`).join('')}</p></div>`);
    return;
  }
  gearSel = null; drawGear(); $('sheet').hidden = false;
}
function drawGear(){
  const me = data.me, g = me.gear || {}, pack = me.pack || [];
  const slot = (k, label) => {
    const it = k === 'bag' ? (me.bag !== 'none' ? { t: me.bag } : null) : g[k];
    const sel = gearSel && gearSel.where === k ? ' sel' : '';
    const meta = k === 'bag' ? (it ? `${me.cap} slots` : '2 pocket slots') : itemMeta(it);
    return `<button class="slot${it ? '' : ' empty'}${sel}" data-slot="${k}"><span class="k">${label}</span><span class="n">${it ? esc(nm(it.t)) : (k === 'weapon' ? 'Bare hands' : k === 'bag' ? 'Pockets' : 'Empty')}</span><span class="m">${esc(meta)}</span></button>`;
  };
  let grid = '';
  for (let i = 0; i < me.cap; i++) {
    const it = pack[i];
    grid += it ? `<button class="pk${gearSel && gearSel.where === 'pack' && gearSel.i === i ? ' sel' : ''}" data-i="${i}">${esc(nm(it.t))}</button>` : '<div class="pk free"></div>';
  }
  let det = '<p>Tap a slot or a backpack item to see it.</p>';
  let acts = '';
  if (gearSel) {
    const it = gearSel.where === 'pack' ? pack[gearSel.i] : gearSel.where === 'bag' ? (me.bag !== 'none' ? { t: me.bag } : null) : g[gearSel.where];
    const c = it ? (CAT[it.t] || {}) : (gearSel.where === 'weapon' ? SHOVE : null);
    if (c) {
      det = `<b>${esc(c.name || nm(it && it.t))}</b><p>${esc(c.descr || '')}${it ? ' ' + esc(itemMeta(it)) : ''}</p>`;
      if (it && gearSel.where === 'pack') {
        if (c.slot === 'eq') acts = `<button class="btn ghost" data-a="eq1">To slot 1</button><button class="btn ghost" data-a="eq2">To slot 2</button>`;
        else acts = `<button class="btn ghost" data-a="equip">${c.slot === 'bag' ? 'Switch bag' : 'Equip'}</button>`;
        acts += `<button class="btn ghost" data-a="drop">Drop</button>`;
      } else if (it) {
        if (gearSel.where !== 'bag') acts = `<button class="btn ghost" data-a="unequip">To backpack</button>`;
        if ((it.t === 'headlamp' || it.t === 'nvg') && gearSel.where === 'head') acts += `<button class="btn ghost" data-a="light">Toggle light</button>`;
        acts += `<button class="btn ghost" data-a="drop">Drop</button>`;
      }
    }
  }
  $('sheetBody').innerHTML = `<div class="sh-h"><h2>Gear</h2><button class="sh-x" id="shX" aria-label="Close">×</button></div>
    <div class="slots">${slot('head','Head')}${slot('armor','Armor')}${slot('weapon','Weapon')}${slot('eq1','Slot 1')}${slot('eq2','Slot 2')}${slot('bag','Backpack')}</div>
    <div class="sh-sub">Backpack · ${pack.length}/${me.cap} · moving an item to a slot takes 10s</div>
    <div class="packgrid">${grid}</div>
    <div class="detail">${det}${acts ? `<div class="acts">${acts}</div>` : ''}</div>`;
  $('shX').onclick = closeSheet;
  $('sheet').onclick = e => { if (e.target === $('sheet')) closeSheet(); };
  $('sheetBody').querySelectorAll('.slot').forEach(b => b.onclick = () => { gearSel = { where: b.dataset.slot }; drawGear(); });
  $('sheetBody').querySelectorAll('.pk[data-i]').forEach(b => b.onclick = () => { gearSel = { where:'pack', i: +b.dataset.i }; drawGear(); });
  $('sheetBody').querySelectorAll('.acts .btn').forEach(b => b.onclick = () => gearAction(b.dataset.a));
}
async function gearAction(a){
  const s = gearSel; if (!s) return;
  let args;
  if (a === 'light') return toggleLight();
  if (s.where === 'pack') {
    if (a === 'drop') args = { p_action:'drop', p_from:'pack', p_index: s.i };
    else args = { p_action:'equip', p_from:'pack', p_index: s.i, p_to: (a === 'eq1' || a === 'eq2') ? a : null };
  } else {
    args = { p_action: a === 'drop' ? 'drop' : 'unequip', p_from: s.where };
  }
  try {
    const r = await rpc('zr_inv', A(args));
    if (r.error) { toast(errMsg(r)); return; }
    toast({ equipped:'Equipped.', equipping:`Equipping into slot ${r.slot === 'eq1' ? 1 : 2}: ready in 10s.`, unequipped:'Moved to backpack.', dropped:'Dropped. Anyone can pick it up for 2 hours.' }[r.result] || 'Done.');
    gearSel = null;
    await heartbeat();
    if (!$('sheet').hidden && data.me.state !== 'zombie') drawGear();
  } catch(e){ toast('Network error.'); }
}

/* ---------- zombie actions ---------- */
let biting = false, biteRaf = null, biteStart = 0, biteOk = false, biteHold = 5;
function biteTarget(){
  if (!data) return null;
  return (data.others || []).filter(o => o.exact && o.state === 'human' && !o.infected && o.dist <= (o.exposed ? EXPOSED_M : BITE_M) + 3)
    .sort((a,b) => a.dist - b.dist)[0] || null;
}
function updateBiteBtn(){
  if (!data) return;
  const t = biteTarget(), stun = left('stunned') > 0, down = left('down') > 0, blind = left('blinded') > 0;
  $('biteBtn').disabled = !t || stun || down || blind;
  $('biteLbl').textContent = 'Bite';
  $('biteSub').textContent = down ? 'Down' : stun ? 'Stunned' : blind ? 'Blinded' : t ? `Hold on ${t.handle} (${t.dist} m)` : 'No humans in range';
}
function smashTargets(){
  if (!data) return [];
  const c = (data.caches || []).filter(x => x.dist <= 35 && !(x.destroyed > 0)).map(x => ({ ref: x.id, d: x.dist, n: 'stockpile' }));
  const b = (data.bags || []).filter(x => x.dist <= 35).map(x => ({ ref: 'b:' + x.id, d: x.dist, n: 'loot bag' }));
  return c.concat(b).sort((a,b) => a.d - b.d);
}
function updateSmashBtn(){
  const t = smashTargets()[0], stun = left('stunned') > 0 || left('down') > 0;
  $('smashBtn').disabled = !t || stun;
  $('smashSub').textContent = t ? `${t.n} · ${Math.round(t.d)} m` : 'Nothing near';
}
function smashNearest(){ const t = smashTargets()[0]; if (t) smash(t.ref); }
async function smash(ref){
  try {
    const r = await rpc('zr_smash', A({ p_ref: ref }));
    if (r.error) { toast(errMsg(r)); return; }
    toast(`Smashed! ${r.items} item${r.items > 1 ? 's' : ''} destroyed. +${r.points}`);
    navigator.vibrate && navigator.vibrate(80);
    heartbeat();
  } catch(e){ toast('Network error.'); }
}
function setupBite(){
  const btn = $('biteBtn');
  const end = (done) => {
    biting = false; cancelAnimationFrame(biteRaf); $('biteFill').style.width = '0';
    if (!done && biteOk) toast(`Bite cancelled. Hold for ${biteHold}s.`);
    biteOk = false; updateBiteBtn();
  };
  btn.addEventListener('pointerdown', async e => {
    e.preventDefault();
    if (btn.disabled || biting) return;
    const t = biteTarget(); if (!t) return;
    biting = true; biteOk = false; biteStart = Date.now(); biteHold = 5;
    $('biteLbl').textContent = 'Biting…'; $('biteSub').textContent = t.handle;
    try { btn.setPointerCapture(e.pointerId); } catch(_){}
    const anim = () => {
      const p = Math.min(1, (Date.now() - biteStart) / (biteHold * 1000));
      $('biteFill').style.width = (p * 100) + '%';
      if (p >= 1) { finish(); return; }
      biteRaf = requestAnimationFrame(anim);
    };
    biteRaf = requestAnimationFrame(anim);
    try {
      const r = await rpc('zr_bite_start', A({ p_target: t.id }));
      if (!biting) return;
      if (r.error) { toast(errMsg(r)); end(true); return; }
      biteOk = true; biteHold = r.hold || 5;
      if (biteHold > 5) $('biteSub').textContent = `${t.handle} is armored: ${biteHold}s`;
    } catch(_) { toast('Network error.'); end(true); }
  });
  const finish = async () => {
    cancelAnimationFrame(biteRaf);
    if (!biteOk) { setTimeout(() => { if (biting) finish(); }, 300); return; }
    try {
      const r = await rpc('zr_bite_finish', A());
      if (r.error) toast(errMsg(r));
      else toast(`You bit ${r.handle}. They turn in 5 minutes unless cured.`);
    } catch(_) { toast('Network error.'); }
    end(true); heartbeat();
  };
  ['pointerup','pointercancel','pointerleave'].forEach(ev => btn.addEventListener(ev, () => { if (biting && Date.now() - biteStart < biteHold * 1000) end(false); }));
  btn.addEventListener('contextmenu', e => e.preventDefault());
}

/* ---------- sheets ---------- */
function openSheet(h, html){
  $('sheetBody').innerHTML = `<div class="sh-h"><h2>${esc(h)}</h2><button class="sh-x" id="shX" aria-label="Close">×</button></div>${html}`;
  $('sheet').hidden = false; $('shX').onclick = closeSheet;
  $('sheet').onclick = e => { if (e.target === $('sheet')) closeSheet(); };
}
function closeSheet(){ $('sheet').hidden = true; gearSel = null; }

function openMenu(){
  if (!data) return;
  const me = data.me;
  const hours = ['<option value="">Off</option>'].concat([...Array(24).keys()].map(h => {
    const l = (h % 12 || 12) + (h < 12 ? 'am' : 'pm'), e = ((h + 8) % 24), el = (e % 12 || 12) + (e < 12 ? 'am' : 'pm');
    return `<option value="${h}" ${me.safe_start === h ? 'selected' : ''}>${l} – ${el}</option>`;
  })).join('');
  openSheet('Menu', `
    <div class="sh-sec"><h3>Home zone</h3>
      <p>${me.home ? "Within 500 ft of home you're sheltered: hidden, and can't be bitten." : "Set your home so you're never shown on the map there."}</p>
      <button class="btn ghost" id="mHome">${me.home ? 'Clear home' : 'Set home to where I am now'}</button></div>
    <div class="sh-sec"><h3>Safe hours</h3><p>8 hours a day with no supply drain while you're away.</p>
      <select id="mSafe">${hours}</select></div>
    <div class="menu-grid">
      <button class="btn ghost" id="mBoard">Leaderboard</button>
      <button class="btn ghost" id="mHow">How to play</button>
      <button class="btn ghost" id="mNear">Nearby players</button>
      <button class="btn ghost" id="mOut">Sign out</button>
    </div>`);
  $('mHome').onclick = async () => {
    try { const r = await rpc('zr_set_home', A({ p_clear: me.home })); if (r.error) toast(errMsg(r)); else { toast(me.home ? 'Home cleared.' : "Home set. You're sheltered within 500 ft of here."); closeSheet(); heartbeat(); } }
    catch(e){ toast('Network error.'); }
  };
  $('mSafe').onchange = async e => {
    const v = e.target.value === '' ? null : parseInt(e.target.value, 10);
    try { await rpc('zr_set_safe', A({ p_start: v })); toast(v == null ? 'Safe hours off.' : 'Safe hours saved.'); data.me.safe_start = v; } catch(_) { toast('Network error.'); }
  };
  $('mBoard').onclick = openBoard;
  $('mHow').onclick = showHowTo;
  $('mNear').onclick = openNearby;
  $('mOut').onclick = () => {
    if (!confirm('Sign out? Your handle and progress live on this phone. Signing out loses them.')) return;
    store.del('zr_auth'); location.reload();
  };
}
async function openBoard(){
  try {
    const b = await rpc('zr_board', A());
    const li = (arr, k) => arr.slice(0,5).map(x => `<li>${esc(x.handle)} <span class="n">${x[k]}</span></li>`).join('') || '<li style="color:var(--dim)">None yet</li>';
    openSheet('Leaderboard', `
      <div class="sh-sec"><p>${b.humans} humans vs ${b.zombies_n} zombies this season. Humans win if under half are infected at the end.</p></div>
      <div class="lb"><div><h3 style="margin:0;font-size:12px;color:var(--rot);text-transform:uppercase;letter-spacing:.08em">Top zombies</h3><ol>${li(b.zombies,'infections')}</ol></div>
      <div><h3 style="margin:0;font-size:12px;color:var(--human);text-transform:uppercase;letter-spacing:.08em">Top medics</h3><ol>${li(b.medics,'cures')}</ol></div></div>`);
  } catch(e){ toast('Network error.'); }
}
function openNearby(){
  const list = (data.others || []).slice(0, 6);
  openSheet('Nearby players', list.length ? `<div class="plist">${list.map((o,i) => `<div class="prow">
      <span class="nm"><b style="color:${o.state==='zombie'?'var(--rot)':o.state==='infected'?'var(--blood)':'var(--human)'}">●</b> ${esc(o.handle)} · ${o.dist} m</span>
      <button class="btn ghost small" data-i="${i}" data-a="b">Block</button><button class="btn ghost small" data-i="${i}" data-a="r">Report</button></div>`).join('')}</div>`
    : '<div class="sh-sec"><p>Nobody nearby right now.</p></div>');
  $('sheetBody').querySelectorAll('button[data-i]').forEach(b => b.onclick = () => {
    const o = list[+b.dataset.i];
    if (b.dataset.a === 'b') blockPlayer(o, null); else { const why = prompt('What happened? (optional)'); blockPlayer(o, why || 'reported'); }
  });
}
function showHowTo(){
  openSheet('How to play', `<ol class="how">
    <li><b style="color:var(--human)">Humans</b> start empty-handed. Raid <b style="color:var(--warn)">stockpiles</b> (+, H for hunting, M for military) for weapons, armor, items and backpacks. Tap Gear to manage them.</li>
    <li><b>Fight back:</b> the big button attacks the nearest zombie in range. Guns hit hard but are loud. Helmets and armor make bites take longer.</li>
    <li><b style="color:var(--rot)">Zombies</b> carry nothing. Hold Bite on a human within 50 ft (5s, longer if they're armored) and smash stockpiles and bags.</li>
    <li><b style="color:var(--blood)">Bitten?</b> You turn in 5 minutes. Antivirals cure; pills, cryo cases and EpiPens buy time. When you turn, your gear drops as a bag.</li>
    <li><b>Noise:</b> walking, sprinting, fighting and gunfire show up as red ripples on zombie maps. Your current noise is on the GPS chip.</li>
    <li>Others see your exact spot only within 50 ft. Set a <b>home zone</b> so you're never shown there. Closing the app hides you, but you return exposed.</li>
  </ol>`);
}

/* ---------- splash ---------- */
const splashT0 = Date.now(); let splashGone = false;
function hideSplash(){
  if (splashGone) return; splashGone = true;
  setTimeout(() => { $('splash').classList.add('out'); setTimeout(() => { $('splash').hidden = true; }, 700); },
    Math.max(0, 2000 - (Date.now() - splashT0)));
}
setTimeout(hideSplash, 7000);

/* ---------- boot ---------- */
if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js').catch(() => {}); }
loadCatalog().finally(() => { if (auth && auth.id) startLocation(); else showIntro(); });
})();
