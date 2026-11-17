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

/* ---------- icons ---------- */
const P = {
  home:'<path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V19a1 1 0 001 1h12a1 1 0 001-1V9.5"/><path d="M9 20v-5h6v5"/>',
  pack:'<path d="M9 6V5a3 3 0 016 0v1"/><rect x="5" y="6" width="14" height="14" rx="4"/><path d="M9 12h6"/><path d="M8 16h8"/>',
  radar:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6.4-6.4"/>',
  cog:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  target:'<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  light:'<path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z"/>',
  hand:'<path d="M18 11V6a2 2 0 00-4 0M14 10V4a2 2 0 00-4 0v2M10 10.5V6a2 2 0 00-4 0v8"/><path d="M18 8a2 2 0 014 0v6a8 8 0 01-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 012.8-2.8L7 15"/>',
  bat:'<path d="M4 20l2-2"/><path d="M6.5 17.5L18 6a2.1 2.1 0 013 3L9.5 20.5z"/>',
  crow:'<path d="M5 19L17 7"/><path d="M17 7c1-2 3-3 4-2s-1 2-2 2"/><path d="M5 19l-2-1"/>',
  gun:'<path d="M3 9h15l2-2h1v4h-4l-1 2h-4l-1 5H7l1-5H3z"/>',
  bow:'<path d="M6 3c8 3 12 7 15 15"/><path d="M6 3L21 18"/><path d="M3 21l8-8"/>',
  syr:'<path d="M18 2l4 4M17 7l3-3M19 9L9 19l-4 1 1-4L16 6z"/><path d="M14 8l2 2M11 11l2 2"/>',
  spray:'<rect x="7" y="9" width="8" height="13" rx="2"/><path d="M9 9V6h4v3M13 4h2M17 3l2-1M17 5h3M17 7l2 1"/>',
  pill:'<rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-35 12 12)"/><path d="M9.3 8.8l5.3 6.6"/>',
  mine:'<path d="M4 16h16l-2-6H6z"/><path d="M12 10V5M9 6l3-1 3 1"/>',
  flare:'<path d="M12 2c2 3 4 5 4 9a4 4 0 01-8 0c0-4 2-6 4-9z"/><path d="M10 15v7h4v-7"/>',
  drone:'<circle cx="5" cy="5" r="2.5"/><circle cx="19" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M7 7l2 2M17 7l-2 2M7 17l2-2M17 17l-2-2"/>',
  batt:'<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M21 10v4M7 10v4M11 10v4"/>',
  radio:'<rect x="4" y="8" width="16" height="13" rx="2"/><path d="M8 8l8-5M8 13h4M8 17h4"/><circle cx="16" cy="15" r="2"/>',
  torch:'<path d="M9 2h6v5l-1 2v13h-4V9L9 7z"/><path d="M9 5h6"/>',
  tape:'<circle cx="11" cy="12" r="8"/><circle cx="11" cy="12" r="3"/><path d="M19 12h3"/>',
  case:'<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V4h8v3M12 11v5M9.5 13.5h5"/>',
  bolt:'<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  helm:'<path d="M4 15a8 8 0 0116 0v2H4z"/><path d="M12 7v4M2 17h20"/>',
  vest:'<path d="M8 3L4 6v14h6v-5h4v5h6V6l-4-3-4 3z"/><path d="M10 10h4"/>',
  bag:'<path d="M9 6V5a3 3 0 016 0v1"/><rect x="5" y="6" width="14" height="14" rx="4"/><path d="M9 12h6"/>',
  scream:'<path d="M3 10v4h4l5 4V6L7 10z"/><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13"/>',
  claw:'<path d="M6 3c2.5 6 2.5 12 0 18M11 3c2.5 6 2.5 12 0 18M16 3c2.5 6 2.5 12 0 18"/>',
  bite:'<path d="M3 8c3-4 15-4 18 0v3c-3 5-15 5-18 0z"/><path d="M7 9l1.5 2L10 9l2 2 2-2 1.5 2L17 9"/>',
  lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>'
};
const svg = (k, cls) => `<svg class="${cls || 'ic'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${P[k] || P.target}</svg>`;
const ITEM_IC = { bat:'bat', crowbar:'crow', shotgun:'gun', rifle:'gun', carbine:'gun', bow:'bow', shove:'hand', antiviral:'syr', epipen:'syr',
  bearspray:'spray', scentspray:'spray', pills:'pill', claymore:'mine', roadflare:'flare', drone:'drone', aa:'batt', powerbank:'batt', radio:'radio',
  maglite:'torch', ducttape:'tape', cryocase:'case', stungun:'bolt' };
const icFor = t => { const c = CAT[t] || {}; return ITEM_IC[t] || (c.slot === 'head' ? 'helm' : c.slot === 'armor' ? 'vest' : c.slot === 'bag' ? 'bag' : 'target'); };
const SHORT = { powerbank:'Power Bank', aa:'Batteries', scentspray:'Scent Spray', roadflare:'Flare', ducttape:'Duct Tape', cryocase:'Cryo Case',
  stungun:'Stun Gun', bearspray:'Bear Spray', radio:'Radio', drone:'Drone', antiviral:'Antiviral', claymore:'Claymore', maglite:'Maglite', pills:'Pills', epipen:'EpiPen' };
const short = t => SHORT[t] || (nm(t).split(' ')[0]);
const RAR = { covert:'Covert', classified:'Classified', restricted:'Restricted', milspec:'Mil-Spec', industrial:'Industrial' };
const rar = t => (CAT[t] && CAT[t].rarity) || 'industrial';

/* ---------- game state ---------- */
let started = false, map, layer, fxLayer, meMarker, meRing, meRing2, soundRing, sweepMk, follow = true, data = null, since = null;
const seenEvents = new Set();
let prevState = null, prevInfected = false, hbBusy = false, wakeLock = null, pinMode = null, closeAlerted = new Set();
let localCdUntil = 0, localScreamAt = 0, localScratchAt = 0, wingBusy = {};
const DBG = /[?&]debug\b/.test(location.search) ? { role:null, night:null, bunker:null, hp:null } : null;

const MAXHP = 100;
const left = key => data ? Math.max(0, (data.me[key] || 0) - (Date.now() - data._at)/1000) : 0;
function infLeft(){
  if (!data || !data.me.infected) return null;
  return Math.max(0, data.me.inf_left - (Date.now() - data._at)/1000 * (data.me.inf_rate == null ? 1 : data.me.inf_rate));
}
function V(){
  const me = data.me, d = DBG || {};
  const zombie = d.role ? d.role === 'zombie' : me.state === 'zombie';
  const night = d.night != null ? d.night : !!me.night;
  const inb = d.bunker != null ? d.bunker : !!me.in_bunker;
  const rate = zombie ? (night && !(me.down > 0) ? 1 : 0) : (inb ? 5 : 0);
  let hp;
  if (d.hp != null) hp = d.hp;
  else hp = Math.min(MAXHP, (me.hp == null ? MAXHP : me.hp) + (me.regen || 0) * (Date.now() - data._at) / 60000);
  return { me, zombie, night, inb, rate, hp, infected: !zombie && me.infected };
}
const Z = () => !!(data && V().zombie);
function weapon(){ const w = data && data.me.gear && data.me.gear.weapon; return w ? Object.assign({}, CAT[w.t] || {}, { t:w.t }) : SHOVE; }
function cdLeft(){
  if (!data) return 0;
  const w = weapon();
  const srvLeft = data.me.last_attack ? (w.cd - (Date.now() - data._skew - Date.parse(data.me.last_attack)) / 1000) : 0;
  return Math.max(0, srvLeft, (localCdUntil - Date.now()) / 1000);
}
const screamLeft = () => Math.max(0, data ? (data.me.scream_cd || 0) - (Date.now() - data._at)/1000 : 0, 30 - (Date.now() - localScreamAt)/1000);
const scratchLeft = () => Math.max(0, data ? (data.me.scratch_cd || 0) - (Date.now() - data._at)/1000 : 0, 2.5 - (Date.now() - localScratchAt)/1000);
function armorPct(){
  const me = data.me; let d = 0, m = 0;
  if (Z()) {
    [me.z_head, me.z_armor].filter(Boolean).forEach(p => { d += Math.max(0, p.d || 0); m += (CAT[p.t] && CAT[p.t].carry_hp) || p.d || 1; });
    return m ? Math.round(d / m * 100) : null;
  }
  const g = me.gear || {};
  ['head','armor'].forEach(k => { const it = g[k], c = it && CAT[it.t]; if (it && c && c.dur) { d += Math.max(0, it.d || 0); m += c.dur; } });
  return m ? Math.round(d / m * 100) : 0;
}

function startGame(){
  started = true;
  $('game').hidden = false;
  $('homeBtn').innerHTML = svg('home'); $('packBtn').innerHTML = svg('pack');
  $('invHome').innerHTML = svg('home'); $('invBack').innerHTML = svg('radar');
  $('cmdBack').innerHTML = svg('radar'); $('cmdSet').innerHTML = svg('cog');
  $('recenter').innerHTML = svg('target'); $('lightBtn').innerHTML = svg('light');
  map = L.map('map', { zoomControl:false, attributionControl:true, zoomSnap:0.5 }).setView([fix.lat, fix.lng], 18);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20, maxNativeZoom: 19,
    attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  sweepMk = L.marker([fix.lat, fix.lng], { icon: L.divIcon({ className:'', iconSize:[420,420], iconAnchor:[210,210], html:'<div class="sweep"></div>' }), interactive:false, zIndexOffset:-1000 }).addTo(map);
  layer = L.layerGroup().addTo(map);
  fxLayer = L.layerGroup().addTo(map);
  soundRing = L.circle([fix.lat, fix.lng], { radius: 10, color:'#b45309', weight:1.5, dashArray:'5 7', fill:false, opacity:.45, interactive:false }).addTo(map);
  meRing2 = L.circle([fix.lat, fix.lng], { radius: EXPOSED_M, color:'#ef4444', weight:1.5, dashArray:'6 6', fill:false, opacity:0, interactive:false }).addTo(map);
  meRing = L.circle([fix.lat, fix.lng], { radius: BITE_M, color:'#10b981', weight:2, fillOpacity:.07, interactive:false }).addTo(map);
  meMarker = L.marker([fix.lat, fix.lng], { icon: mkIcon('me', '#10b981', ''), zIndexOffset: 1000, interactive:false }).addTo(map);
  map.on('dragstart', () => { follow = false; });
  map.on('click', e => { if (pinMode) { const f = pinMode; pinMode = null; f(e.latlng); } });
  $('recenter').onclick = () => { follow = true; if (fix) map.setView([fix.lat, fix.lng], Math.max(map.getZoom(), 17.5)); };
  $('homeBtn').onclick = () => openCmd('st');
  $('packBtn').onclick = () => openInv('gear');
  $('invHome').onclick = () => { closeInv(); openCmd('st'); };
  $('invBack').onclick = closeInv;
  $('cmdBack').onclick = closeCmd;
  $('cmdSet').onclick = openMenu;
  $('invTabs').querySelectorAll('button').forEach(b => b.onclick = () => { invTab = b.dataset.t; drawInv(); });
  $('cmdTabs').querySelectorAll('button').forEach(b => b.onclick = () => openCmd(b.dataset.t));
  $('lightBtn').onclick = toggleLight;
  $('wing1').onclick = () => Z() ? scream() : useSlot('eq1');
  $('wing2').onclick = () => Z() ? scratch() : useSlot('eq2');
  $('mainBtn').addEventListener('click', () => { if (!Z()) attack(); });
  setupBite();
  if (DBG) setupDebug();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { heartbeat(); requestWake(); } });
  requestWake();
  heartbeat();
  setInterval(heartbeat, HB_MS);
  setInterval(tickLocal, 250);
  setInterval(regenTick, 1000);
  if (!store.get('zr_seen_howto3')) { store.set('zr_seen_howto3', 1); setTimeout(showHowTo, 700); }
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
    const r = await rpc('zr_hb3', A({
      p_lat: fresh ? fix.lat : null, p_lng: fresh ? fix.lng : null, p_acc: fresh ? fix.acc : null,
      p_tz: new Date().getTimezoneOffset(), p_since: since, p_speed: fresh ? fix.speed : null
    }));
    data = r; data._at = Date.now(); data._skew = Date.now() - Date.parse(r.now);
    since = r.now;
    delete bannerState.net;
    hideSplash();
    render();
    handleEvents(r.events || []);
  } catch (e) {
    if (/bad_auth/.test(e.message)) { store.del('zr_auth'); location.reload(); return; }
    banner('net', 'Connection lost. Retrying…', 'red');
  } finally { hbBusy = false; }
}

/* titles */
function title(p){
  if (p.state === 'zombie') return p.patient_zero ? 'Patient Zero' : p.infections >= 10 ? 'Alpha' : p.infections >= 3 ? 'Stalker' : 'Shambler';
  return p.cures >= 10 ? 'Medic' : p.cures >= 3 ? 'Field Medic' : 'Survivor';
}
const usesOf = it => { const c = CAT[it.t] || {}; return c.kind === 'item' ? (it.d || 0) : 1; };
function durOf(it){
  const c = CAT[it.t] || {};
  if ((c.kind === 'head' || c.kind === 'armor') && c.dur) return Math.max(0, Math.min(100, (it.d || 0) / c.dur * 100));
  if (it.b != null) return Math.max(0, Math.min(100, it.b));
  return null;
}
const durBar = it => { const p = durOf(it); if (p == null || p >= 100) return ''; return `<div class="dur ${p < 65 ? 'red' : ''}"><i style="width:${p}%"></i></div>`; };

/* ---------- render ---------- */
function render(){
  const v = V(), me = v.me, zombie = v.zombie, infected = v.infected;
  $('game').classList.toggle('z', zombie);
  $('game').classList.toggle('night', v.night);
  document.querySelector('meta[name=theme-color]').setAttribute('content', zombie ? '#0c0608' : '#0a0f0d');
  updatePill();

  const acc = fix ? Math.round(fix.acc) : null;
  $('gpsTxt').textContent = (acc == null ? 'GPS —' : `GPS ±${acc}m${acc > 35 ? ' · weak' : ''}`) + (zombie ? (v.night ? ' · night' : '') : ` · noise ${me.ring}m`);
  $('gps').classList.toggle('weak', acc > 35);

  if (fix) {
    const ll = [fix.lat, fix.lng];
    meMarker.setLatLng(ll); meRing.setLatLng(ll); meRing2.setLatLng(ll); soundRing.setLatLng(ll); sweepMk.setLatLng(ll);
    if (follow) map.panTo(ll, { animate:true });
  }
  const c = zombie ? '#f43f5e' : infected ? '#fb923c' : '#10b981';
  meMarker.setIcon(mkIcon('me', c, ''));
  meRing.setStyle({ color: c, fillColor: c });
  meRing2.setStyle({ opacity: (!zombie && me.exposed > 0) ? .9 : 0 });
  soundRing.setRadius(me.ring || 10); soundRing.setStyle({ opacity: zombie ? 0 : .45 });

  layer.clearLayers();
  for (const cc of data.caches || []) {
    const cls = cc.destroyed > 0 ? 'dead' : cc.cooldown > 0 ? 'cd' : cc.sponsored ? 'sp' : cc.tier === 'military' ? 'mil' : cc.tier === 'hunting' ? 'hunt' : '';
    const sym = cc.destroyed > 0 ? '×' : cc.sponsored ? '★' : cc.tier === 'military' ? 'M' : cc.tier === 'hunting' ? 'H' : '+';
    layer.addLayer(L.marker([cc.lat, cc.lng], { icon: L.divIcon({ className:'', iconSize:[26,26], iconAnchor:[13,13],
      html:`<div class="beacon ${cls}"><div class="core"><b>${sym}</b></div></div>` }) }).on('click', () => tapCache(cc)));
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
  for (const r of data.reveals || []) layer.addLayer(L.circle([r.lat, r.lng], { radius: r.radius, color:'#38bdf8', weight:1.5, dashArray:'4 6', fillOpacity:.05, interactive:false }));
  for (const b of data.beacons || []) {
    layer.addLayer(L.marker([b.lat, b.lng], { icon: L.divIcon({ className:'', iconSize:[14,14], iconAnchor:[7,7], html:'<div class="flaremk"></div>' }) })
      .on('click', () => toast('A road flare. Zombies near it get spotted.')));
  }
  for (const h of data.hotzones || []) {
    layer.addLayer(L.circle([h.lat, h.lng], { radius: h.radius, color:'#f43f5e', weight:2, dashArray:'6 6', fillColor:'#f43f5e', fillOpacity:.1, interactive:false }));
    layer.addLayer(L.marker([h.lat, h.lng], { icon: L.divIcon({ className:'', iconSize:[22,22], iconAnchor:[11,11],
      html:`<div class="hzmk"><div class="core"></div><div class="lbl">HOTZONE ${fmt(h.left)}</div></div>` }), zIndexOffset:400 })
      .on('click', () => toast(h.mine ? `Your hotzone. Zombies are rallying here for ${fmt(h.left)}.` : zombie ? `${h.handle} is calling the horde here (~${h.dist} m).` : `A zombie screamed here. Horde hotzone ~${h.dist} m away.`)));
  }
  const bk = me.bunker;
  if (bk && !zombie) {
    layer.addLayer(L.circle([bk.lat, bk.lng], { radius: 30, color:'#10b981', weight:1.5, dashArray: bk.ready > 0 ? '3 6' : null, fillColor:'#10b981', fillOpacity:.08, interactive:false }));
    layer.addLayer(L.marker([bk.lat, bk.lng], { icon: L.divIcon({ className:'', iconSize:[24,24], iconAnchor:[12,12], html:`<div class="bunkmk">${svg('home','x')}</div>` }) })
      .on('click', () => openCmd('bk')));
  }
  for (const r of data.ripples || []) {
    const loud = r.kind !== 'move';
    const label = r.kind === 'move' ? '' : ({ explosion:'blast', shotgun:'gunshot', rifle:'gunshot', carbine:'gunshot', bat:'clang', crowbar:'clang',
      bow:'twang', bearspray:'hiss', stungun:'crackle', flare:'hiss', drone:'buzz', shove:'scuffle', scream:'scream', scratch:'snarl' }[r.kind] || 'noise');
    layer.addLayer(L.marker([r.lat, r.lng], { icon: L.divIcon({ className:'', iconSize:[34,34], iconAnchor:[17,17],
      html:`<div class="ripple ${loud ? 'loud' : ''}"></div>${label ? `<div class="riplbl">${label}</div>` : ''}` }) })
      .on('click', () => toast(r.kind === 'move' ? `Footsteps somewhere around here (~${r.dist} m)` : `A ${label} came from around here (~${r.dist} m)`)));
  }
  let anyClose = false;
  for (const o of data.others || []) {
    const oc = o.state === 'zombie' ? '#f43f5e' : o.state === 'infected' ? '#fb923c' : '#10b981';
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

  renderControls();
  $('downOv').hidden = !(zombie && me.down > 0);
  banners();
  if (!$('inv').hidden && !dragging) drawInv();

  const realZ = me.state === 'zombie';
  if (prevState === 'human' && realZ) modal('You turned', `The infection took hold. Your weapon, items and backpack dropped where you stood. ${me.shell ? `Your armor stayed on: +${me.shell} armor.` : ''} Hold Bite on humans within 50 ft, Scratch to wear them down, and Scream to call the horde.`, 'Hunt');
  if (!prevInfected && me.infected && prevState) navigator.vibrate && navigator.vibrate([300,100,300]);
  if (prevState === 'zombie' && !realZ) modal("You're human again", 'Someone cured you. Your armor is back on, but you\'ll need to find a new weapon.', 'Survive');
  prevState = me.state; prevInfected = !realZ && me.infected;
}

function updatePill(){
  const v = V(), me = v.me, hp = Math.round(v.hp), a = armorPct();
  $('pillLbl').textContent = v.zombie && a == null ? `ZOMBIE • HP ${hp}%` : `ARMOR ${a || 0}% / HP ${hp}%`;
  $('armTrk').style.visibility = v.zombie && a == null ? 'hidden' : 'visible';
  $('armBar').style.width = (a || 0) + '%';
  $('hpBar').style.width = hp + '%';
  $('hpBar').classList.toggle('low', !v.zombie && hp <= 30);
  const showRegen = v.rate > 0 && hp < MAXHP;
  $('regenB').hidden = !showRegen; $('pill').classList.toggle('rg', showRegen);
  $('regenB').textContent = `+${v.rate}%/m`;
  let st;
  if (v.zombie) st = me.down > 0 ? 'DOWN' : title(Object.assign({}, me, { state:'zombie' })).toUpperCase();
  else if (me.infected) st = 'INFECTED ' + fmt(infLeft());
  else if (left('exposed') > 0) st = 'EXPOSED';
  else st = title(Object.assign({}, me, { state:'human' })).toUpperCase();
  $('pillState').textContent = (DBG && (DBG.role || DBG.hp != null) ? 'TEST · ' : '') + st;
  $('pillState').style.color = v.infected ? '#fb923c' : '';
}

function setRing(frac){ $('ringFg').style.strokeDashoffset = (238.8 * Math.max(0, Math.min(1, 1 - frac))).toFixed(1); }

function wingHtml(it, slot, side){
  if (!it) return `<span class="wc"><i class="diamond"></i></span>`;
  const rdy = (data.me.eq_ready && data.me.eq_ready[slot]) ? Math.max(0, data.me.eq_ready[slot] - (Date.now() - data._at)/1000) : 0;
  const busy = wingBusy[slot] ? Math.max(0, (wingBusy[slot] - Date.now()) / 1500) : 0;
  const p = durOf(it);
  const meta = rdy > 0 ? `EQUIP ${Math.ceil(rdy)}s` : (it.b != null ? `${Math.round(it.b)}%` : `${(CAT[it.t] && CAT[it.t].ping_r) || 0}m`);
  const cd = rdy > 0 ? rdy / 10 : busy;
  return `<span class="qty">x${usesOf(it)}</span><span class="wc">${svg(icFor(it.t))}<span class="wt"><span class="wn">${esc(short(it.t))}</span><span class="wm">${meta}</span></span></span>` +
    (cd > 0 ? `<i class="wcd" style="width:${Math.min(1, cd) * 100}%"></i>` : '');
}
function zWing(label, icon, cdl, cdMax, sub){
  return `<span class="wc">${svg(icon)}<span class="wt"><span class="wn">${label}</span><span class="wm">${cdl > 0 ? cdl.toFixed(cdMax < 5 ? 1 : 0) + 's' : sub}</span></span></span>` +
    (cdl > 0 ? `<i class="wcd" style="width:${cdl / cdMax * 100}%"></i>` : '');
}

function renderControls(){
  if (!data) return;
  const v = V(), me = v.me;
  if (!v.zombie) {
    const g = me.gear || {};
    for (const [s, id, side] of [['eq1','wing1','l'],['eq2','wing2','r']]) {
      const b = $(id); b.classList.toggle('empty', !g[s]); b.disabled = false;
      b.innerHTML = wingHtml(g[s], s, side);
      b.setAttribute('aria-label', g[s] ? `Use ${nm(g[s].t)}` : `Item ${s === 'eq1' ? 1 : 2} empty`);
    }
    const w = weapon(), cd = cdLeft();
    const verb = { shove:'Shove', bat:'Swing', crowbar:'Swing', bow:'Shoot', shotgun:'Fire', rifle:'Fire', carbine:'Fire' }[w.t] || 'Attack';
    const t = nearestZombie(w.range_m + 3), any = nearestZombie();
    const exp = left('exposed') > 0;
    $('mainIc').innerHTML = svg(icFor(w.t));
    $('mainLbl').textContent = w.t === 'shove' ? 'SHOVE' : verb.toUpperCase();
    $('mainBtn').disabled = !t || cd > 0 || exp;
    $('mainBtn').classList.toggle('ready', !!t && cd <= 0 && !exp);
    setRing(cd > 0 ? 1 - cd / w.cd : 1);
    $('mainSub').textContent = exp ? "Exposed: you can't fight yet"
      : cd > 0 ? `Reloading ${cd.toFixed(1)}s`
      : t ? `${t.handle} · ~${t.dist}m${t.hp != null ? ` · ${t.hp}${t.shell ? '+' + t.shell : ''} HP` : ''}`
      : any ? `${w.t === 'shove' ? 'Bare hands' : nm(w.t)} · zombie ~${any.dist}m · range ${ft(w.range_m)} ft`
      : `${w.t === 'shove' ? 'Bare hands' : nm(w.t)} · ${w.dmg || 0} DMG · sound ${w.ping_r || 0}m`;
    const hd = g.head, lightable = hd && (hd.t === 'headlamp' || hd.t === 'nvg');
    $('lightBtn').hidden = !lightable;
    if (lightable) $('lightBtn').classList.toggle('on', !!(hd.t === 'headlamp' ? me.headlamp_on : me.nvg_on));
  } else {
    $('lightBtn').hidden = true;
    const stun = left('stunned') > 0, down = left('down') > 0, blind = left('blinded') > 0;
    const sl = screamLeft(), xl = scratchLeft();
    $('wing1').classList.remove('empty'); $('wing2').classList.remove('empty');
    $('wing1').innerHTML = zWing('Scream', 'scream', sl, 30, 'HOTZONE');
    $('wing2').innerHTML = zWing('Scratch', 'claw', xl, 2.5, '15 DMG');
    $('wing1').disabled = stun || down;
    const t = biteTarget();
    $('wing2').disabled = stun || down || blind || !t;
    $('mainIc').innerHTML = svg('bite');
    if (!biting) {
      $('mainLbl').textContent = 'BITE';
      $('mainBtn').disabled = !t || stun || down || blind;
      $('mainBtn').classList.toggle('ready', !!t && !stun && !down && !blind);
      setRing(t ? 1 : 0);
      $('mainSub').textContent = down ? 'Down' : stun ? 'Stunned' : blind ? 'Blinded' : t ? `Hold on ${t.handle} (${t.dist}m)` : 'No humans in range · tap stockpiles to smash';
    }
  }
}

function nearestZombie(maxD){
  return (data.others || []).filter(o => o.state === 'zombie' && !o.stunned && (maxD == null || o.dist <= maxD)).sort((a,b) => a.dist - b.dist)[0]
      || (data.others || []).filter(o => o.state === 'zombie' && (maxD == null || o.dist <= maxD)).sort((a,b) => a.dist - b.dist)[0] || null;
}

function tickLocal(){
  if (!data) return;
  updatePill();
  renderControls();
  $('blindOv').hidden = !(Z() && left('blinded') > 0);
  if (Z() && data.me.down > 0) $('downTxt').textContent = `A human took you out. You'll rise again in ${fmt(left('down'))}.`;
  banners();
  if (!$('cmd').hidden && cmdTab === 'bk') drawBunker();
}
function regenTick(){
  if (!DBG || DBG.hp == null || !data) return;
  const v = V();
  if (v.rate > 0 && DBG.hp < MAXHP) DBG.hp = Math.min(MAXHP, DBG.hp + v.rate / 60);
}

/* ---------- banners ---------- */
const bannerState = {};
function banner(key, text, cls){ bannerState[key] = { text, cls, t: Date.now() }; drawBanners(); }
function dataBanner(){
  const v = V(), me = v.me, el = (Date.now() - data._at) / 1000;
  const hz = (data.hotzones || []).map(h => Object.assign({}, h, { l: Math.max(0, h.left - el) })).filter(h => h.l > 0);
  const mine = hz.find(h => h.mine), near = hz.filter(h => !h.mine).sort((a,b) => a.dist - b.dist)[0];
  const bk = me.bunker, bkLeft = bk ? Math.max(0, bk.ready - el) : 0;
  if (!v.zombie && me.infected) return { tag:'INFECTED', cls:'red', p: infLeft() / 300,
    txt:`Turning in ${fmt(infLeft())}${me.inf_rate === 0 ? ' (paused while moving)' : me.inf_rate === 0.5 ? ' (slowed)' : ''}. Find an antiviral.` };
  if (!v.zombie && left('exposed') > 0) return { tag:'EXPOSED', cls:'red', p: left('exposed') / 300, txt:`No items or attacks for ${fmt(left('exposed'))} · bites reach 150 ft` };
  if (v.zombie && mine) return { tag:'HOTZONE', cls:'', p: mine.l / 600, txt:`Hotzone alert active: ${fmt(mine.l)} remaining` };
  if (!v.zombie && near && near.dist <= 600) return { tag:'HOTZONE', cls:'red', p: near.l / 600, txt:`Horde hotzone ~${near.dist}m away · ${fmt(near.l)}` };
  if (v.zombie && near) return { tag:'HORDE', cls:'', p: near.l / 600, txt:`${near.handle} is calling the horde ~${near.dist}m away` };
  if (!v.zombie && bk && bkLeft > 0) return { tag:'BUNKER', cls:'amber', p: 1 - bkLeft / 600, txt:`Bunker build: ${fmt(bkLeft)} remaining` };
  if (v.rate > 0 && v.hp < MAXHP) return { tag:'REGEN', cls:'', txt: v.zombie ? 'Nocturnal regeneration active (+1%/min)' : 'Sheltered in bunker: regenerating HP (+5%/min)' };
  if (!v.zombie && v.inb) return { tag:'BUNKER', cls:'', txt:'Sheltered in bunker: zombies can\'t bite or scratch you here' };
  return null;
}
function banners(){
  if (!data) return;
  const v = V(), me = v.me, z = v.zombie;
  const db = dataBanner();
  $('dataBan').hidden = !db;
  if (db) {
    $('dataBan').className = 'surf ' + (db.cls || '');
    $('dbTag').textContent = db.tag; $('dbTxt').textContent = db.txt;
    $('dbTrk').hidden = db.p == null; if (db.p != null) $('dbBar').style.width = Math.max(0, Math.min(1, db.p)) * 100 + '%';
  }
  $('banners').classList.toggle('up', !db);
  const set = (k, cond, text, cls) => { if (cond) bannerState[k] = { text, cls, persist:true }; else delete bannerState[k]; };
  set('close', !z && (data.others || []).some(o => o.close), 'Zombie very close!', 'red');
  set('stun', z && left('stunned') > 0, `Stunned: you can't bite, scratch or scream for ${fmt(left('stunned'))}.`, 'green');
  set('dis', !z && left('disguised') > 0, `Scent-blocked: zombies see you as one of them (${fmt(left('disguised'))}).`, 'blue');
  set('boost', !z && left('boost') > 0, `Flashlight on: radar doubled (${fmt(left('boost'))}).`, 'blue');
  set('shel', me.sheltered, me.minor && !me.home ? "Night curfew (10pm–6am): you're sheltered and hidden." : "You're at home: sheltered and hidden from everyone.", 'blue');
  set('sup', !z && me.supplies <= 0, "Out of supplies: you can't use items until you reach a stockpile.", 'red');
  set('gpsw', fix && fix.acc > 35, 'Weak GPS. Step outside for fights and stockpiles to work.', '');
  if (bannerState.net && Date.now() - bannerState.net.t > 6000) delete bannerState.net;
  drawBanners();
}
function drawBanners(){
  const keys = Object.keys(bannerState).slice(0, 2);
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
function shock(radius, color){
  if (!radius || !fix || !fxLayer) return;
  const c = L.circle([fix.lat, fix.lng], { radius: 1, color: color || '#f59e0b', weight: 2.5, fill:false, opacity:.9, interactive:false }).addTo(fxLayer);
  const t0 = performance.now(), dur = 1400;
  const step = now => {
    const p = Math.min(1, (now - t0) / dur);
    c.setRadius(Math.max(1, radius * (1 - Math.pow(1 - p, 3)))); c.setStyle({ opacity: .9 * (1 - p) });
    if (p < 1) requestAnimationFrame(step); else fxLayer.removeLayer(c);
  };
  requestAnimationFrame(step);
}

/* ---------- events ---------- */
function handleEvents(evs){
  for (const e of evs) {
    if (seenEvents.has(e.id)) continue;
    seenEvents.add(e.id);
    const o = e.other || 'someone', i = e.info || {};
    switch (e.kind) {
      case 'bite_warning': if (!e.mine) alarm(`${o} is biting you! ${i.secs || 5}s to stop it. Run, spray or fight!`, (i.secs || 5) * 1000); break;
      case 'bitten':
        if (e.mine) toast(`You infected ${o}. +10`);
        else { $('alarm').hidden = true; modal(i.scratch ? 'Clawed down' : 'Bitten', `${o} ${i.scratch ? 'scratched you down to 0 HP' : 'bit you'}. You turn in 5 minutes unless you cure it. Antivirals cure; pills, cryo cases and EpiPens buy time.`, 'Find a cure'); }
        break;
      case 'scratched': if (!e.mine) { toast(`${o} scratched you: −${i.dmg - (i.absorbed || 0)} HP${i.absorbed ? ` (armor took ${i.absorbed})` : ''}. HP ${i.hp}.`); navigator.vibrate && navigator.vibrate([90,60,90]); } break;
      case 'scream_near': if (!e.mine) alarm(`A zombie screamed ~${i.dist || '?'} m away. The horde is gathering!`, 3500); break;
      case 'cured': if (e.mine && e.other === data.me.handle) toast('You cured yourself.'); else if (e.mine) toast(`You cured ${o}. +10`); else toast(`${o} cured you.`); break;
      case 'hit': if (!e.mine) toast(`${o} hit you for ${i.dmg}. HP ${i.hp}${i.broke && i.broke.length ? ' · your ' + i.broke.map(nm).join(' & ') + ' broke' : ''}`); break;
      case 'killed': if (e.mine) toast(`You put ${o} down for 8 minutes. +5`); break;
      case 'stunned': if (!e.mine) toast(`${o} stunned you for ${i.secs >= 60 ? Math.round(i.secs/60) + ' min' : i.secs + 's'}.`); break;
      case 'blinded': if (!e.mine) toast('Bear spray! You can\'t see.'); break;
      case 'mine_boom': toast(`Your claymore went off on ${o}!${i.killed ? ' Put down. +5' : ''}`); break;
      case 'flare_cross': toast('A zombie crossed your road flare!'); navigator.vibrate && navigator.vibrate(200); break;
      case 'emerged': alarm(`${o} just came out of hiding nearby. They're exposed!`); break;
      case 'returned': toast(`Back from hiding: exposed for ${Math.round(i.secs/60)} min${i.drain ? `, −${i.drain} supplies` : ''}.`); break;
      case 'patient_zero': modal('Patient Zero', "You're one of the first zombies here. Listen for footsteps and gunfire (red ripples), get within 50 ft of a human and hold Bite. Scream to call the horde; tap stockpiles to smash them.", 'Start hunting'); break;
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
  blinded:"You can't see!", down:"You're down.", not_target:"That player can't be attacked.", sheltered:"They're sheltered.",
  group:"They're in a group of 3+. Bites and scratches don't work.", cooldown:'Still on cooldown.', destroyed:'Zombies wrecked this stockpile.',
  too_soon:'Keep holding.', expired:'Too slow. Try again.', no_bite:'Your bite was stopped!', not_zombie:'Only zombies can do that.',
  bad_cache:"That's gone.", battery:'Battery too low. Use batteries or a power bank.', empty:'Nothing in that slot.',
  equipping:'Still equipping.', no_target:'No zombie in range.', out_of_range:'Out of range.', nothing_to_repair:'Your armor is already in full shape.',
  nothing_to_charge:'Nothing equipped needs charging.', need_pin:'Pick a spot on the map.', pin_too_far:'That spot is more than 200 m away.',
  cant_use:"That can't be used from a quick slot.", pack_full:'Your backpack is full.', too_full:'Too many items for that bag.',
  no_light:'No light to toggle.', bad_index:'Try again.', cant_equip:"Can't equip that.", bunker:"They're inside their bunker.",
  have_bunker:'You already have a bunker. Abandon it first.', infected:"You can't build while infected.", bad_action:'Try again.'
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
    shock(w.ping_r, '#f59e0b');
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
  if (!it) { openInv('pack'); toast(`Tap an item and choose Equip to fill Item ${slot === 'eq1' ? 1 : 2}.`); return; }
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
  const it = data.me.gear && data.me.gear[slot];
  try {
    const r = await rpc('zr_use', A(Object.assign({ p_slot: slot }, extra)));
    if (r.error) { toast(r.error === 'equipping' ? `Still equipping: ${r.left}s` : errMsg(r)); return; }
    wingBusy[slot] = Date.now() + 1500;
    if (it && CAT[it.t] && it.t !== 'claymore') shock(CAT[it.t].ping_r, '#38bdf8');
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
  if (Z()) {
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
  if (Z()) { if (b.dist > 35) toast(`Loot bag ${b.dist} m away.`); else smash('b:' + b.id); return; }
  if (b.dist > 35) { toast(`A dropped bag with ${b.n} item${b.n > 1 ? 's' : ''}, ${b.dist} m away.`); return; }
  try {
    const r = await rpc('zr_take_bag', A({ p_bag: b.id }));
    if (r.error) { toast(errMsg(r)); return; }
    showLoot(r.items, 'Bag picked up', r.left ? `${r.left} item${r.left > 1 ? 's' : ''} didn't fit and stayed in the bag` : '');
    heartbeat();
  } catch(e){ toast('Network error.'); }
}
function showLoot(items, head, note){
  const where = { weapon:'equipped as weapon', head:'put on', armor:'put on', eq1:'in Item 1', eq2:'in Item 2', bag:'now your backpack', pack:'in backpack', ground:"no room: left on the ground" };
  openSheet(head, `<div class="sh-sec">${(items || []).map(i => `<p class="r-${rar(i.t)}"><b class="rarc">${esc(nm(i.t))}</b> · ${where[i.where] || i.where}</p>`).join('') || '<p>Empty.</p>'}
    ${note ? `<p>${esc(note)}</p>` : ''}</div><button class="btn" id="lootOk">Got it</button><button class="btn ghost" id="lootGear">Open gear</button>`);
  $('lootOk').onclick = closeSheet; $('lootGear').onclick = () => { closeSheet(); openInv('gear'); };
}

function tapPlayer(o){
  const st = o.state === 'zombie' ? 'Zombie' : o.state === 'infected' ? 'Infected' : 'Human';
  openSheet(o.handle, `
    <div class="sh-sec"><p><b style="color:var(--tx)">${st}</b> · ${esc(title(o))} · ~${o.dist} m away<br>
      ${o.state === 'zombie' ? `${o.infections} infections${o.hp != null ? ` · ${o.hp} HP${o.shell ? ' + ' + o.shell + ' armor' : ''}` : ''}` : o.cures + ' cures'}</p></div>
    <div class="menu-grid"><button class="btn ghost" id="pBlock">Block</button><button class="btn ghost" id="pReport">Report</button></div>`);
  $('pBlock').onclick = () => blockPlayer(o, null);
  $('pReport').onclick = () => { const why = prompt('What happened? (optional)'); blockPlayer(o, why || 'reported'); };
}
async function blockPlayer(o, report){
  try { await rpc('zr_block', A({ p_target: o.id, p_report: report })); closeSheet(); toast(report ? `Reported and blocked ${o.handle}.` : `Blocked ${o.handle}. You won't see each other.`); heartbeat(); }
  catch(e){ toast('Network error.'); }
}

/* ---------- zombie actions ---------- */
let biting = false, biteRaf = null, biteStart = 0, biteOk = false, biteHold = 5;
function biteTarget(){
  if (!data) return null;
  return (data.others || []).filter(o => o.exact && o.state === 'human' && !o.infected && o.dist <= (o.exposed ? EXPOSED_M : BITE_M) + 3)
    .sort((a,b) => a.dist - b.dist)[0] || null;
}
async function scream(){
  if (screamLeft() > 0) { toast(`Scream ready in ${Math.ceil(screamLeft())}s.`); return; }
  try {
    const r = await rpc('zr_scream', A());
    if (r.error) { toast(r.error === 'cooldown' ? `Scream ready in ${r.left}s.` : errMsg(r)); return; }
    localScreamAt = Date.now();
    shock(300, '#f43f5e');
    toast('You screamed! A 10-minute hotzone calls the horde here.');
    navigator.vibrate && navigator.vibrate([60,40,140]);
    heartbeat();
  } catch(e){ toast('Network error.'); }
}
async function scratch(){
  const t = biteTarget();
  if (!t) { toast('No human within 50 ft.'); return; }
  if (scratchLeft() > 0) return;
  localScratchAt = Date.now();
  try {
    const r = await rpc('zr_scratch', A({ p_target: t.id }));
    if (r.error) { localScratchAt = 0; toast(errMsg(r)); return; }
    shock(30, '#f43f5e');
    toast(r.result === 'infected' ? `You clawed ${r.handle} down. Infected! +10` : `Scratched ${r.handle}: ${r.hp} HP left${r.absorbed ? ` (armor took ${r.absorbed})` : ''}${r.broke && r.broke.length ? ' · armor broke' : ''}.`);
    navigator.vibrate && navigator.vibrate(50);
    heartbeat();
  } catch(e){ toast('Network error.'); }
}
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
  const btn = $('mainBtn');
  const end = (done) => {
    biting = false; cancelAnimationFrame(biteRaf);
    if (!done && biteOk) toast(`Bite cancelled. Hold for ${biteHold}s.`);
    biteOk = false; renderControls();
  };
  btn.addEventListener('pointerdown', async e => {
    if (!Z()) return;
    e.preventDefault();
    if (btn.disabled || biting) return;
    const t = biteTarget(); if (!t) return;
    biting = true; biteOk = false; biteStart = Date.now(); biteHold = 5;
    $('mainLbl').textContent = 'BITING'; $('mainSub').textContent = t.handle;
    try { btn.setPointerCapture(e.pointerId); } catch(_){}
    const anim = () => {
      const p = Math.min(1, (Date.now() - biteStart) / (biteHold * 1000));
      setRing(p);
      if (p >= 1) { finish(); return; }
      biteRaf = requestAnimationFrame(anim);
    };
    setRing(0);
    biteRaf = requestAnimationFrame(anim);
    try {
      const r = await rpc('zr_bite_start', A({ p_target: t.id }));
      if (!biting) return;
      if (r.error) { toast(errMsg(r)); end(true); return; }
      biteOk = true; biteHold = r.hold || 5;
      if (biteHold > 5) $('mainSub').textContent = `${t.handle} is armored: ${biteHold}s`;
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

/* ---------- debug strip (?debug) ---------- */
function setupDebug(){
  const el = $('dbg'); el.hidden = false;
  const seg = (k, opts) => `<div class="seg" data-k="${k}">${opts.map(([v,l]) => `<button data-v="${v}">${l}</button>`).join('')}</div>`;
  el.innerHTML = `<div class="t"><span>TEST VIEW · ONLY ON THIS PHONE</span><button id="dbgReset" style="color:var(--mut);font-size:8.5px">RESET</button></div>` +
    seg('role', [['human','HUMAN'],['zombie','ZOMBIE']]) + seg('night', [['0','DAY'],['1','NIGHT']]) + seg('bunker', [['1','IN BUNKER'],['0','ROAMING']]) +
    `<button id="dbgDmg">DAMAGE −25%</button>`;
  const paint = () => {
    if (!data) return;
    const v = V();
    const cur = { role: v.zombie ? 'zombie' : 'human', night: v.night ? '1' : '0', bunker: v.inb ? '1' : '0' };
    el.querySelectorAll('.seg').forEach(s => s.querySelectorAll('button').forEach(b => b.classList.toggle('on', cur[s.dataset.k] === b.dataset.v)));
    el.querySelector('[data-k=bunker]').style.display = v.zombie ? 'none' : '';
  };
  el.querySelectorAll('.seg button').forEach(b => b.onclick = () => {
    const k = b.parentNode.dataset.k, val = b.dataset.v;
    DBG[k] = k === 'role' ? val : val === '1';
    if (DBG.hp == null && data) DBG.hp = V().hp;
    render(); paint();
  });
  $('dbgDmg').onclick = () => { if (!data) return; DBG.hp = Math.max(0, V().hp - 25); updatePill(); paint(); };
  $('dbgReset').onclick = () => { DBG.role = DBG.night = DBG.bunker = DBG.hp = null; render(); paint(); };
  setInterval(paint, 1000);
}

/* ---------- avatar ---------- */
function avatar(z){
  const f = z ? '#3b1018' : '#2a332e', s = z ? '#9f1239' : '#64748b', p = z ? '#4c1122' : '#27312c';
  return `<svg class="av" viewBox="0 0 300 500" fill="none">
    <circle cx="150" cy="225" r="126" stroke="${z ? '#3a0f18' : '#242e29'}" stroke-dasharray="3 6"/><circle cx="150" cy="225" r="88" stroke="${z ? '#2c0b12' : '#1e2722'}"/>
    <line x1="150" y1="22" x2="150" y2="472" stroke="${z ? '#2c0b12' : '#26312b'}" stroke-dasharray="2 5"/>
    <circle cx="150" cy="68" r="24" fill="${f}" stroke="${s}" stroke-width="1.5"/>
    <rect x="141" y="90" width="18" height="18" rx="4" fill="${f}"/>
    <path d="M106 116C116 108 132 106 150 106C168 106 184 108 194 116L212 146L218 202L214 256L202 262L198 250L201 202L193 156L186 152L183 244L117 244L114 152L107 156L99 202L102 250L98 262L86 256L82 202L88 146Z" fill="${f}" stroke="${s}" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M121 122L179 122L176 196L124 196Z" fill="${p}" stroke="${s}" stroke-width="1.1"/>
    <rect x="115" y="236" width="70" height="12" rx="3" fill="${p}" stroke="${s}" stroke-width="1.2"/>
    <path d="M117 248L183 248L188 338L182 436L191 452L162 452L160 434L156 342L150 282L144 342L140 434L138 452L109 452L118 436L112 338Z" fill="${f}" stroke="${s}" stroke-width="1.5" stroke-linejoin="round"/>
    ${z ? '<path d="M138 62l6 6M162 62l-6 6M140 80q10-6 20 0" stroke="#f43f5e" stroke-width="2" stroke-linecap="round"/><path d="M128 140l10 22M170 170l8 18M120 300l8 26" stroke="#f43f5e" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"/>' : ''}
  </svg>`;
}

/* ---------- inventory ---------- */
let invTab = 'gear', dragging = null;
function openInv(tab){
  if (!data) return;
  invTab = tab || 'gear'; $('inv').hidden = false; drawInv();
}
function closeInv(){ $('inv').hidden = true; }
function invItem(where){
  const me = data.me;
  if (where === 'bag') return me.bag && me.bag !== 'none' ? { t: me.bag } : null;
  if (where === 'z_head') return me.z_head; if (where === 'z_armor') return me.z_armor;
  return (me.gear || {})[where] || null;
}
function slotMeta(it, key){
  const c = CAT[it.t] || {};
  if (key === 'bag') return `<span class="m">${c.cap || data.me.cap} SLOTS</span>`;
  if (c.slot === 'weapon') return `<span class="m">${c.dmg} DMG · ${c.ping_r}m</span>`;
  if (c.kind === 'head' || c.kind === 'armor') return `<span class="m">${Math.max(0, it.d || 0)}/${key.startsWith('z_') ? (c.carry_hp || c.dur) : c.dur}</span>${durBar(key.startsWith('z_') ? { t: it.t, d: it.d } : it)}`;
  return `<span class="m">${it.b != null ? Math.round(it.b) + '%' : (c.ping_r || 0) + 'm'}</span>${durBar(it)}`;
}
function gslot(key, label, tall){
  const it = invItem(key), me = data.me;
  const rdy = (key === 'eq1' || key === 'eq2') && me.eq_ready && me.eq_ready[key] ? Math.max(0, me.eq_ready[key] - (Date.now() - data._at)/1000) : 0;
  const empty = key === 'weapon' ? 'Bare hands' : key === 'bag' ? 'Pockets · 2' : 'Empty';
  return `<button class="gslot ${tall ? 'tall' : ''} ${it ? 'rs r-' + rar(it.t) : 'empty'}" data-slot="${key}">
    <span class="k">${label}</span>${it ? svg(icFor(it.t)) : ''}<i class="diamond"></i>
    <span><span class="n">${it ? esc(nm(it.t)) : empty}</span>${it ? (rdy > 0 ? `<span class="m">EQUIPPING ${Math.ceil(rdy)}s</span>` : slotMeta(it, key)) : ''}</span>
    ${it && (key === 'eq1' || key === 'eq2') ? `<span class="qb">x${usesOf(it)}</span>` : ''}</button>`;
}
function drawInv(){
  if (!data) return;
  const v = V(), me = v.me, z = v.zombie;
  $('invTitle').textContent = z ? 'MUTANT GEAR' : invTab === 'gear' ? 'GEAR LOADOUT' : 'BACKPACK';
  $('invSub').textContent = z ? 'INFECTED REMNANTS' : v.inb ? '● IN BUNKER ZONE' : me.bunker ? `● BUNKER ~${me.bunker.dist}m` : '● ROAMING';
  $('invSc').hidden = z; $('invScV').textContent = (me.sc || me.points || 0).toLocaleString() + ' SC';
  $('invTabs').hidden = z; $('invZ').hidden = !z;
  $('invTabs').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === invTab));
  const body = $('invBody');
  if (z) {
    body.innerHTML = `<div id="doll">${avatar(true)}<div class="gcol l">${gslot('z_head','Headgear')}<div style="flex:1"></div></div><div class="gcol r">${gslot('z_armor','Armor')}<div style="flex:1"></div></div></div>`;
    $('invFoot').textContent = "Zombies can't carry weapons, items or backpacks. Remnant armor soaks damage until it breaks.";
  } else if (invTab === 'gear') {
    body.innerHTML = `<div id="doll">${avatar(false)}
      <div class="gcol l">${gslot('head','Headgear')}${gslot('armor','Armor')}${gslot('eq1','Item 1')}</div>
      <div class="gcol r">${gslot('weapon','Weapon',true)}${gslot('bag','Backpack',true)}${gslot('eq2','Item 2')}</div></div>`;
    $('invFoot').textContent = 'Tap a slot to inspect. Moving an item into Item 1 or 2 takes 10s.';
  } else {
    const pack = me.pack || [], cap = me.cap, used = pack.length;
    let cells = '';
    for (let i = 0; i < 12; i++) {
      const it = pack[i];
      if (i >= cap) cells += `<div class="pk lock">${svg('lock')}<span>BIGGER BAG</span></div>`;
      else if (!it) cells += `<div class="pk free"><i class="diamond"></i></div>`;
      else cells += `<button class="pk rs r-${rar(it.t)}" data-i="${i}">${svg(icFor(it.t))}<span><span class="n">${esc(nm(it.t))}</span>${slotMeta(it, 'pack')}</span>${CAT[it.t] && CAT[it.t].slot === 'eq' ? `<span class="qb">x${usesOf(it)}</span>` : ''}</button>`;
    }
    body.innerHTML = `<div class="fill ${used / cap >= .9 ? 'hi' : ''}"><span>${used}/${cap} SLOTS</span><div class="trk"><i style="width:${used / cap * 100}%"></i></div><span>${esc(me.bag !== 'none' ? nm(me.bag) : 'Pockets')}</span></div>
      <div id="packGrid">${cells}</div>
      <div class="menu-grid" style="margin-top:8px"><div id="dzEq" class="pk" style="min-height:40px;display:grid;place-items:center"><span class="n">EQUIP ▸</span></div><div id="dzDrop" class="pk" style="min-height:40px;display:grid;place-items:center"><span class="n">DROP ▾</span></div></div>`;
    $('invFoot').textContent = 'Tap to inspect, or drag an item onto Equip or Drop.';
    body.querySelectorAll('.pk[data-i]').forEach(b => setupDrag(b, +b.dataset.i));
  }
  body.querySelectorAll('.gslot').forEach(b => b.onclick = () => {
    const k = b.dataset.slot, it = invItem(k);
    if (it) return inspect({ where:k });
    if (k === 'eq1' || k === 'eq2') { invTab = 'pack'; drawInv(); toast(`Pick an item and Equip it into Item ${k === 'eq1' ? 1 : 2}.`); }
    else if (k === 'weapon') inspect({ where:'weapon' });
  });
}
function setupDrag(el, i){
  let sx, sy, moved = false, ghost = null, over = null;
  const it = () => (data.me.pack || [])[i];
  const zoneAt = (x, y) => { const e = document.elementFromPoint(x, y); return e && e.closest && e.closest('#dzEq,#dzDrop'); };
  el.addEventListener('pointerdown', e => {
    sx = e.clientX; sy = e.clientY; moved = false; dragging = null;
    try { el.setPointerCapture(e.pointerId); } catch(_){}
  });
  el.addEventListener('pointermove', e => {
    if (sx == null) return;
    if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 8) return;
    if (!moved) { moved = true; dragging = i; ghost = el.cloneNode(true); ghost.classList.add('dragGhost'); document.body.appendChild(ghost); el.style.opacity = .35; }
    ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
    const z = zoneAt(e.clientX, e.clientY);
    ['dzEq','dzDrop'].forEach(id => $(id).classList.remove('dv','di'));
    if (z) { const ok = z.id === 'dzDrop' || !!(CAT[it().t] && CAT[it().t].slot); z.classList.add(ok ? 'dv' : 'di'); }
    over = z;
  });
  const up = e => {
    if (sx == null) return;
    sx = null;
    if (ghost) { ghost.remove(); ghost = null; }
    el.style.opacity = '';
    if (!moved) { dragging = null; inspect({ where:'pack', i }); return; }
    const z = over; over = null; dragging = null;
    ['dzEq','dzDrop'].forEach(id => $(id) && $(id).classList.remove('dv','di'));
    if (!z) return;
    const c = CAT[it().t] || {};
    if (z.id === 'dzDrop') invAction({ p_action:'drop', p_from:'pack', p_index:i });
    else if (c.slot === 'eq') pickSlot(i);
    else invAction({ p_action:'equip', p_from:'pack', p_index:i, p_to:null });
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

function inspect(src){
  const me = data.me, z = Z();
  const it = src.where === 'pack' ? (me.pack || [])[src.i] : src.where === 'weapon' && !invItem('weapon') ? { t:'shove' } : invItem(src.where);
  if (!it) return;
  const c = it.t === 'shove' ? SHOVE : (CAT[it.t] || {});
  const r = it.t === 'shove' ? 'industrial' : rar(it.t);
  let stats = [];
  if (c.slot === 'weapon' || it.t === 'shove') stats = [['Damage', c.dmg || 0], ['Range', ft(c.range_m || 0) + ' ft'], ['Sound', (c.ping_r || 0) + ' m']];
  else if (c.kind === 'head' || c.kind === 'armor') stats = [['Durability', `${Math.max(0, it.d || 0)}/${src.where.startsWith('z_') ? (c.carry_hp || c.dur) : c.dur}`], ['Zombie carry', c.carry_hp || 0], ['Bite slow', c.bite_s ? '+' + c.bite_s + 's' : '—']];
  else if (c.slot === 'bag') stats = [['Capacity', (c.cap || 0) + ' slots'], ['Type', 'Backpack'], ['Sound', '0 m']];
  else stats = [['Qty', usesOf(it)], ['Sound', (c.ping_r || 0) + ' m'], [it.b != null ? 'Battery' : 'Range', it.b != null ? Math.round(it.b) + '%' : c.range_m ? ft(c.range_m) + ' ft' : '—']];
  let acts = '';
  if (z) acts = `<button class="btn red" data-a="shred">Shred</button><button class="btn ghost" data-a="zdrop">Drop remnant</button>`;
  else if (it.t === 'shove') acts = '';
  else if (src.where === 'pack') acts = `<button class="btn" data-a="equip">${c.slot === 'bag' ? 'Switch bag' : 'Equip'}</button><button class="btn ghost" data-a="drop">Drop</button>`;
  else {
    if (src.where !== 'bag') acts += `<button class="btn ghost" data-a="unequip">Unequip</button>`;
    if ((it.t === 'headlamp' || it.t === 'nvg') && src.where === 'head') acts += `<button class="btn ghost" data-a="light">Toggle light</button>`;
    acts += `<button class="btn red" data-a="drop">Drop</button>`;
  }
  openSheet(c.name || nm(it.t), `
    <div class="r-${r}"><span class="rar rarc">${RAR[r]}</span> <span class="rar" style="color:var(--mut)">· ${esc((c.slot === 'eq' ? 'consumable' : c.slot || 'melee').toUpperCase())}</span></div>
    <div class="stats">${stats.map(([k, val]) => `<div class="stat"><div class="k">${k}</div><div class="v">${esc(val)}</div></div>`).join('')}</div>
    ${(c.kind === 'head' || c.kind === 'armor' || it.b != null) && durOf(it) != null ? `<div class="dur ${durOf(it) < 65 ? 'red' : ''}" style="height:5px"><i style="width:${durOf(it)}%"></i></div>` : ''}
    <div class="sh-sec"><p>${esc(c.descr || '')}</p></div>
    ${acts ? `<div class="menu-grid">${acts}</div>` : ''}`);
  $('sheetBody').querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
    const a = b.dataset.a;
    if (a === 'light') return toggleLight();
    if (a === 'shred' || a === 'zdrop') {
      if (a === 'shred' && !confirm(`Shred your ${nm(it.t)}? It's gone for good.`)) return;
      return zShed(src.where === 'z_head' ? 'head' : 'armor', a === 'zdrop');
    }
    if (src.where === 'pack') {
      if (a === 'drop') return invAction({ p_action:'drop', p_from:'pack', p_index:src.i });
      if (c.slot === 'eq') return pickSlot(src.i);
      return invAction({ p_action:'equip', p_from:'pack', p_index:src.i, p_to:null });
    }
    invAction({ p_action: a === 'drop' ? 'drop' : 'unequip', p_from: src.where });
  });
}
function pickSlot(i){
  const g = data.me.gear || {}, it = (data.me.pack || [])[i];
  const cell = s => `<button data-s="${s}"><div class="k">Item ${s === 'eq1' ? 1 : 2}</div><div class="n">${g[s] ? esc(nm(g[s].t)) + ' <span style="color:var(--mut);font-weight:600">(swap)</span>' : 'Empty'}</div></button>`;
  openSheet(`Equip ${short(it.t)}`, `<div class="sh-sec"><p>Which quick slot? It's ready to use 10 seconds after you move it.</p></div><div class="pick2">${cell('eq1')}${cell('eq2')}</div>`);
  $('sheetBody').querySelectorAll('[data-s]').forEach(b => b.onclick = () => invAction({ p_action:'equip', p_from:'pack', p_index:i, p_to:b.dataset.s }));
}
async function invAction(args){
  try {
    const r = await rpc('zr_inv', A(args));
    if (r.error) { toast(errMsg(r)); return; }
    toast({ equipped:'Equipped.', equipping:`Equipping into Item ${r.slot === 'eq1' ? 1 : 2}: ready in 10s.`, unequipped:'Moved to backpack.', dropped:'Dropped. Anyone can pick it up for 2 hours.' }[r.result] || 'Done.');
    closeSheet();
    await heartbeat();
    if (!$('inv').hidden) drawInv();
  } catch(e){ toast('Network error.'); }
}
async function zShed(slot, drop){
  try {
    const r = await rpc('zr_shed', A({ p_slot: slot, p_drop: drop }));
    if (r.error) { toast(errMsg(r)); return; }
    toast(drop ? 'Remnant dropped. Humans can pick it up.' : 'Shredded.');
    closeSheet(); await heartbeat(); if (!$('inv').hidden) drawInv();
  } catch(e){ toast('Network error.'); }
}

/* ---------- home command ---------- */
let cmdTab = 'st', lbFilter = 'all', standCache = null;
function openCmd(tab){
  if (!data) return;
  cmdTab = tab || 'st'; $('cmd').hidden = false;
  $('cmdTabs').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === cmdTab));
  $('tabBk').innerHTML = Z() ? `${svg('lock','x')} BUNKER` : 'BUNKER';
  $('tabBk').querySelector && $('tabBk').querySelectorAll('svg').forEach(s => { s.style.width = '12px'; s.style.height = '12px'; });
  $('cmdScV').textContent = (data.me.sc || data.me.points || 0).toLocaleString() + ' SC';
  const days = data.season ? Math.max(0, Math.ceil((new Date(data.season.ends_at) - Date.now()) / 86400000)) : 0;
  $('cmdSub').textContent = `${data.me.handle} · ${data.season ? esc(data.season.name) + ' · ' + days + 'd left' : ''}`;
  if (cmdTab === 'st') drawStandings(); else if (cmdTab === 'lb') drawBoard(); else drawBunker();
}
function closeCmd(){ $('cmd').hidden = true; }
const dur = s => { s = Math.max(0, s | 0); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
async function drawStandings(){
  const body = $('cmdBody');
  const paint = s => {
    const kd = s.deaths ? (s.kills / s.deaths).toFixed(2) : String(s.kills);
    const tile = (k, v, sub) => `<div class="tile surf"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
    body.innerHTML = `<div class="tiles">
        ${tile('Sector rank', '#' + s.rank, `of ${s.sector_n} within 5 km`)}
        ${tile('Survival credits', (s.sc || 0).toLocaleString(), 'SC this season')}
        ${tile('Season horde size', s.horde, 'infections + bloodline')}
        ${tile('Survivors infected', s.infected, `${s.cures} cured by you`)}</div>
      <div class="h4">Career</div>
      <div class="career">${tile('Total horde', s.total_horde)}${tile('Longest survival', dur(s.longest))}${tile('Seasons played', s.seasons)}${tile('K/D', kd, `${s.kills} downs · ${s.deaths} deaths`)}</div>
      <div class="setrow" style="margin-top:12px"><button class="btn ghost" id="cHow">How to play</button><button class="btn ghost" id="cMenu">Settings</button></div>`;
    $('cHow').onclick = showHowTo; $('cMenu').onclick = openMenu;
  };
  if (standCache) paint(standCache); else body.innerHTML = '<div class="lockv">Loading…</div>';
  try { standCache = await rpc('zr_standings', A()); if (cmdTab === 'st' && !$('cmd').hidden) paint(standCache); }
  catch(e){ if (!standCache) body.innerHTML = '<div class="lockv">Could not load standings.</div>'; }
}
async function drawBoard(){
  const body = $('cmdBody');
  const f = ['all','humans','zombies'];
  body.innerHTML = `<div class="lbf">${f.map(x => `<button data-f="${x}" class="${x === lbFilter ? 'on' : ''}">${x.toUpperCase()}</button>`).join('')}</div><div class="lbrows" id="lbRows"><div class="lockv">Loading…</div></div><div class="ffoot" id="lbFoot" style="margin-top:6px"></div>`;
  body.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { lbFilter = b.dataset.f; drawBoard(); });
  try {
    const b = await rpc('zr_board2', A({ p_filter: lbFilter }));
    if (cmdTab !== 'lb') return;
    const rowsEl = $('lbRows'); rowsEl.innerHTML = '';
    let rows = b.rows || [];
    const fit = Math.max(3, Math.floor(rowsEl.clientHeight / 38));
    if (rows.length > fit) { const meRow = rows.find(r => r.me); rows = rows.slice(0, fit); if (meRow && !rows.includes(meRow)) rows[fit - 1] = meRow; }
    rowsEl.innerHTML = rows.map(r => `<div class="lbr surf ${r.me ? 'me' : ''}"><span class="rk">${r.rank}</span><span class="nm">${esc(r.handle)}</span>
      <span class="fb ${r.faction === 'zombie' ? 'z' : 'h'}">${r.faction === 'zombie' ? 'ZOMBIE' : 'HUMAN'}</span>
      <span class="sc">${r.points}</span><span class="sv">${r.faction === 'zombie' ? r.infections + ' inf' : dur(r.surv)}</span></div>`).join('') || '<div class="lockv">Nobody yet.</div>';
    $('lbFoot').textContent = `${b.humans} humans vs ${b.zombies_n} zombies this season · humans win if under half are infected at the end`;
  } catch(e){ $('lbRows').innerHTML = '<div class="lockv">Could not load the leaderboard.</div>'; }
}
function drawBunker(){
  const body = $('cmdBody'), me = data.me;
  if (Z()) { body.innerHTML = `<div class="lockv"><div>${svg('lock','x')}<br><b style="color:var(--tx)">Bunkers are for survivors</b><br>Zombies can't build or use bunkers. Get cured to reclaim yours.</div></div>`; return; }
  const el = (Date.now() - data._at) / 1000, bk = me.bunker, bl = bk ? Math.max(0, bk.ready - el) : 0;
  const rules = `<ul><li>Safe zone: zombies can't bite or scratch you within 100 ft.</li><li>Heals 5% HP per minute while you're inside. Armor doesn't regenerate.</li><li>No storage. One bunker per player; it takes 10 minutes to build.</li><li>Separate from your Home zone, which hides you instead.</li></ul>`;
  let html;
  const key = !bk ? 'none' : bl > 0 ? 'build' : 'ready';
  if (key === 'none') html = `<div class="bunk surf"><p><b style="color:var(--tx)">No bunker yet.</b> Pick a spot you return to often, like a park bench or your block. You'll set it where you're standing.</p>${rules}
      <button class="btn" id="bkSet">Set bunker here</button></div>`;
  else if (key === 'build') html = `<div class="bunk surf"><p style="text-align:center">BUNKER UNDER CONSTRUCTION</p><div class="big" id="bkCd">${fmt(bl)}</div>
      <div class="trk"><i id="bkBar" style="width:${(1 - bl / 600) * 100}%;background:var(--hl)"></i></div><p>It works once the timer ends. You don't have to stay.</p>${rules}
      <button class="btn red" id="bkAb">Abandon</button></div>`;
  else html = `<div class="bunk surf"><p style="text-align:center">${V().inb ? 'YOU ARE INSIDE YOUR BUNKER' : 'BUNKER READY'}</p><div class="big">${V().inb ? (V().hp < MAXHP ? '+5%/min' : 'FULL HP') : '~' + bk.dist + 'm'}</div>
      <p>${V().inb ? "You're safe from bites and scratches here." : 'Head back within 100 ft to heal and be safe.'}</p>${rules}
      <div class="menu-grid"><button class="btn ghost" id="bkRe">Abandon &amp; build new</button><button class="btn red" id="bkAb">Abandon</button></div></div>`;
  if (body.dataset.bk === key && key === 'build') { $('bkCd').textContent = fmt(bl); $('bkBar').style.width = (1 - bl / 600) * 100 + '%'; return; }
  if (body.dataset.bk === key && key !== 'build' && body.querySelector('.bunk')) return;
  body.dataset.bk = key; body.innerHTML = html;
  const act = async (a, msg) => {
    try { const r = await rpc('zr_bunker', A({ p_action: a })); if (r.error) { toast(errMsg(r)); return; } toast(msg); body.dataset.bk = ''; await heartbeat(); drawBunker(); }
    catch(e){ toast('Network error.'); }
  };
  if ($('bkSet')) $('bkSet').onclick = () => act('set', 'Bunker started. Ready in 10 minutes.');
  if ($('bkRe')) $('bkRe').onclick = () => { if (confirm('Abandon your bunker and start a new one where you are? The new one takes 10 minutes.')) act('rebuild', 'New bunker started. Ready in 10 minutes.'); };
  if ($('bkAb')) $('bkAb').onclick = () => { if (confirm('Abandon your bunker?')) act('abandon', 'Bunker abandoned.'); };
}

/* ---------- sheets ---------- */
function openSheet(h, html){
  $('sheetBody').innerHTML = `<div class="sh-h"><h2>${esc(h)}</h2><button class="sh-x" id="shX" aria-label="Close">×</button></div>${html}`;
  $('sheet').hidden = false; $('shX').onclick = closeSheet;
  $('sheet').onclick = e => { if (e.target === $('sheet')) closeSheet(); };
}
function closeSheet(){ $('sheet').hidden = true; }

function openMenu(){
  if (!data) return;
  const me = data.me;
  const hours = ['<option value="">Off</option>'].concat([...Array(24).keys()].map(h => {
    const l = (h % 12 || 12) + (h < 12 ? 'am' : 'pm'), e = ((h + 8) % 24), el = (e % 12 || 12) + (e < 12 ? 'am' : 'pm');
    return `<option value="${h}" ${me.safe_start === h ? 'selected' : ''}>${l} – ${el}</option>`;
  })).join('');
  openSheet('Settings', `
    <div class="sh-sec"><h3>Home zone</h3>
      <p>${me.home ? "Within 500 ft of home you're sheltered: hidden, and can't be bitten." : "Set your home so you're never shown on the map there."}</p>
      <button class="btn ghost" id="mHome">${me.home ? 'Clear home' : 'Set home to where I am now'}</button></div>
    <div class="sh-sec"><h3>Safe hours</h3><p>8 hours a day with no supply drain while you're away.</p>
      <select id="mSafe">${hours}</select></div>
    <div class="menu-grid">
      <button class="btn ghost" id="mHow">How to play</button>
      <button class="btn ghost" id="mNear">Nearby players</button>
      <button class="btn ghost" id="mOut" style="grid-column:span 2">Sign out</button>
    </div>`);
  $('mHome').onclick = async () => {
    try { const r = await rpc('zr_set_home', A({ p_clear: me.home })); if (r.error) toast(errMsg(r)); else { toast(me.home ? 'Home cleared.' : "Home set. You're sheltered within 500 ft of here."); closeSheet(); heartbeat(); } }
    catch(e){ toast('Network error.'); }
  };
  $('mSafe').onchange = async e => {
    const v = e.target.value === '' ? null : parseInt(e.target.value, 10);
    try { await rpc('zr_set_safe', A({ p_start: v })); toast(v == null ? 'Safe hours off.' : 'Safe hours saved.'); data.me.safe_start = v; } catch(_) { toast('Network error.'); }
  };
  $('mHow').onclick = showHowTo;
  $('mNear').onclick = openNearby;
  $('mOut').onclick = () => {
    if (!confirm('Sign out? Your handle and progress live on this phone. Signing out loses them.')) return;
    store.del('zr_auth'); location.reload();
  };
}
function openNearby(){
  const list = (data.others || []).slice(0, 6);
  openSheet('Nearby players', list.length ? `<div class="plist">${list.map((o,i) => `<div class="prow">
      <span class="nm"><b style="color:${o.state==='zombie'?'#f43f5e':o.state==='infected'?'#fb923c':'#10b981'}">●</b> ${esc(o.handle)} · ${o.dist} m</span>
      <button class="btn ghost small" data-i="${i}" data-a="b">Block</button><button class="btn ghost small" data-i="${i}" data-a="r">Report</button></div>`).join('')}</div>`
    : '<div class="sh-sec"><p>Nobody nearby right now.</p></div>');
  $('sheetBody').querySelectorAll('button[data-i]').forEach(b => b.onclick = () => {
    const o = list[+b.dataset.i];
    if (b.dataset.a === 'b') blockPlayer(o, null); else { const why = prompt('What happened? (optional)'); blockPlayer(o, why || 'reported'); }
  });
}
function showHowTo(){
  openSheet('How to play', `<ol class="how">
    <li><b style="color:#10b981">Humans</b> start empty-handed. Raid <b style="color:#f59e0b">supply beacons</b> (H hunting, M military) for weapons, armor, items and backpacks. The backpack button opens your gear.</li>
    <li><b>Fight back:</b> the round button uses your weapon on the nearest zombie. Item 1 and 2 sit on either side. Guns hit hard but are loud.</li>
    <li><b style="color:#f43f5e">Zombies</b> hold Bite on a human within 50 ft, Scratch for quick damage (armor absorbs it first; 0 HP means infected), and Scream to open a 10-minute horde hotzone. Tap stockpiles to smash them.</li>
    <li><b style="color:#fb923c">Infected?</b> You turn in 5 minutes. Antivirals cure; pills, cryo cases and EpiPens buy time.</li>
    <li><b>Bunker:</b> build one from Home Command. It's a safe zone that heals 5% HP a minute. Zombies regenerate 1% a minute at night.</li>
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
