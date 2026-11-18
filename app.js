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

/* ---------- accounts / onboarding ---------- */
const TERMS_VER = '2026-11-16';
const HOME_R = 150;
let profile = store.get('zr_profile');
const saveProfile = p => { profile = Object.assign({}, profile || {}, p); store.set('zr_profile', profile); };
const ADJ = ['Grim','Rotten','Feral','Silent','Rusty','Pale','Hollow','Swift','Lucky','Ashen','Mossy','Shady','Static','Restless','Crooked','Bitter'];
const NOUN = ['Otter','Crow','Medic','Ghoul','Scout','Wolf','Moth','Ranger','Badger','Shade','Lynx','Raven','Drifter','Hound','Viper','Fox'];
const pick = a => a[Math.floor(Math.random()*a.length)];
const randHandle = () => pick(ADJ) + pick(NOUN) + Math.floor(10 + Math.random()*89);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
function pwInfo(p){
  const r = { len: p.length >= 8, up: /[A-Z]/.test(p), num: /[0-9]/.test(p) };
  const ok = r.len && r.up && r.num;
  const extra = (p.length >= 12) + /[^A-Za-z0-9]/.test(p) + /[a-z]/.test(p);
  const level = !p ? 0 : !ok ? 1 : (p.length >= 12 && extra >= 2) ? 3 : 2;
  return { r, ok, level, label: ['', 'WEAK', 'MODERATE', 'TACTICAL'][level] };
}
function ageOf(iso){
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number); if (!y || !m || !d) return null;
  const t = new Date(); let a = t.getFullYear() - y;
  if (t.getMonth() + 1 < m || (t.getMonth() + 1 === m && t.getDate() < d)) a--;
  return a;
}
function maskEmail(e){
  if (!e) return '—';
  const [u, dmn] = e.split('@'); if (!dmn) return e;
  const parts = dmn.split('.'), tld = parts.pop(), host = parts.join('.');
  const mu = u.length <= 2 ? u[0] + '•' : u[0] + '•'.repeat(Math.min(5, u.length - 2)) + u[u.length - 1];
  return `${mu}@${host[0] || ''}${'•'.repeat(Math.min(5, Math.max(1, host.length - 1)))}.${tld}`;
}
function maskAddr(a){
  if (!a) return null;
  const [first, ...rest] = a.split(',');
  const m = first.trim().split(/\s+/).map(w => w.length <= 2 ? w : w[0] + '•'.repeat(Math.min(6, w.length - 1))).join(' ');
  return [m].concat(rest.map(s => s.trim()).slice(0, 2)).join(', ');
}
const dateStr = iso => iso ? new Date(iso).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' }) : '—';

/* onboarding state */
const OB = { view:'boot', back:null, claim:null, email:'', pw:'', pw2:'', handle:'', dob:'', gender:'', home:null,
  terms:false, privacy:false, gps:'idle', how:0, emailOk:null, nameOk:null, err:'' };
let obMap = null, obMarker = null, obCircle = null;

const SIL_M = '<path d="M15 2a7 7 0 110 14 7 7 0 010-14z"/><path d="M5 22c2-3 6-4 10-4s8 1 10 4l2 18h-5l-1 30h-5l-1-24-1 24h-5l-1-30H3z"/>';
const SIL_F = '<path d="M15 2a7 7 0 110 14 7 7 0 010-14z"/><path d="M21 6c4 2 4 10 1 14"/><path d="M8 22c2-3 4-4 7-4s5 1 7 4l2 14-3 1 4 16h-6l-1 17h-5l-1-17H6l4-16-3-1z"/>';
const silSvg = f => `<svg viewBox="0 0 30 72" fill="currentColor">${f ? SIL_F : SIL_M}</svg>`;

function showOnb(view){
  hideSplash();
  $('onb').hidden = false; $('game').hidden = true;
  goOnb(view);
}
function goOnb(view){ OB.view = view; OB.err = ''; drawOnb(); }
const prog = (n, back) => `<div class="ohead"><button class="oback" id="obBack" aria-label="Back">${svg('back')}</button>
  <div class="oprog" aria-hidden="true">${[1,2,3,4].map(i => `<i class="${i < n ? 'done' : i === n ? 'on' : ''}"></i>`).join('')}</div><span class="ostep">STEP ${n} OF 4</span></div>`;
const fld = (id, label, type, val, attrs, o) => {
  o = o || {};
  return `<label class="ofld" for="${id}"><span class="olbl">${label}${o.aside ? `<em>${o.aside}</em>` : ''}</span>
    <span class="oin" id="${id}W">${o.ic ? svg(o.ic, 'oic') : ''}<input id="${id}" type="${type}" value="${esc(val || '')}" ${attrs || ''}>${o.eye ? `<button type="button" class="eye" data-eye="${id}" aria-label="Show password">${svg('eye')}</button>` : ''}${o.after || ''}</span>
    <span class="ohint" id="${id}H" aria-live="polite">${o.hint || ''}</span></label>`;
};
function hint(id, text, cls){ const h = $(id + 'H'); if (!h) return; h.innerHTML = text; h.className = 'ohint ' + (cls || ''); const w = $(id + 'W'); if (w) { w.classList.toggle('ok', cls === 'ok'); w.classList.toggle('bad', cls === 'bad'); } }
function bindEyes(root){
  (root || document).querySelectorAll('[data-eye]').forEach(b => b.onclick = () => {
    const i = $(b.dataset.eye); const show = i.type === 'password'; i.type = show ? 'text' : 'password';
    b.innerHTML = svg(show ? 'eyeoff' : 'eye'); b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
}
function debounce(fn, ms){ let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
const meterHtml = (id) => `<div class="meter" id="${id}M"><div class="bars"><i></i><i></i><i></i></div><b id="${id}L">STRENGTH</b></div>
  <div class="rules2" id="${id}R"><span data-r="len">8+ CHARS</span><span data-r="up">1 UPPERCASE</span><span data-r="num">1 NUMBER</span></div>`;
function paintMeter(id, p){
  const i = pwInfo(p); const m = $(id + 'M'); if (!m) return i;
  m.className = 'meter l' + i.level; $(id + 'L').textContent = i.label || 'STRENGTH';
  $(id + 'R').querySelectorAll('[data-r]').forEach(s => s.classList.toggle('ok', i.r[s.dataset.r]));
  return i;
}

const EMBLEM = `<svg viewBox="0 0 120 120" fill="none"><circle cx="60" cy="60" r="56" stroke="#10b981" stroke-opacity=".35" stroke-width="1.5"/>
  <circle cx="60" cy="60" r="40" stroke="#10b981" stroke-opacity=".3" stroke-dasharray="3 5"/><circle cx="60" cy="60" r="22" stroke="#10b981" stroke-opacity=".45"/>
  <path d="M60 2v14M60 104v14M2 60h14M104 60h14" stroke="#10b981" stroke-opacity=".6" stroke-width="2"/>
  <g class="sw"><path d="M60 60L60 4A56 56 0 0198.6 19.4Z" fill="url(#swg)"/></g>
  <defs><linearGradient id="swg" x1="60" y1="4" x2="98" y2="30"><stop stop-color="#10b981" stop-opacity="0"/><stop offset="1" stop-color="#10b981" stop-opacity=".45"/></linearGradient></defs>
  <circle cx="60" cy="60" r="5" fill="#10b981"/><circle cx="84" cy="38" r="4.5" fill="#f43f5e"><animate attributeName="opacity" values="1;.2;1" dur="1.6s" repeatCount="indefinite"/></circle>
  <circle cx="40" cy="80" r="3" fill="#10b981" fill-opacity=".7"/></svg>`;

const HOW = [
  { t:'Your street is the map', p:'GPS radar shows your real neighborhood. Raid supply drops at real places for weapons, armor and gear. Everything you do makes noise zombies can hear.',
    ill:`<svg viewBox="0 0 300 180"><g stroke="#10b981" fill="none" stroke-opacity=".35"><circle cx="150" cy="95" r="70"/><circle cx="150" cy="95" r="44" stroke-dasharray="3 5"/><path d="M150 20v150M75 95h150"/></g>
      <path d="M150 95L150 25A70 70 0 01205 52Z" fill="#10b981" fill-opacity=".18"/><circle cx="150" cy="95" r="6" fill="#10b981"/>
      <g transform="translate(196 58) rotate(45)"><rect x="-9" y="-9" width="18" height="18" rx="3" fill="#f59e0b"/></g><circle cx="196" cy="58" r="16" fill="none" stroke="#f59e0b" stroke-opacity=".6"/>
      <g transform="translate(104 128) rotate(45)"><rect x="-8" y="-8" width="16" height="16" rx="3" fill="#ef4444"/></g>
      <circle cx="120" cy="60" r="12" fill="none" stroke="#f43f5e" stroke-width="2" opacity=".6"/></svg>` },
  { t:'Survive or spread', p:"Humans scavenge and fight back. Zombies bite, scratch and scream to call the horde. Get infected and you have 5 minutes to find a cure before you turn.",
    ill:`<svg viewBox="0 0 300 180"><line x1="150" y1="20" x2="150" y2="160" stroke="#2b3530" stroke-dasharray="3 5"/>
      <g fill="#10b981" fill-opacity=".85" transform="translate(70 40) scale(1.45)">${SIL_M}</g>
      <g fill="#f43f5e" fill-opacity=".85" transform="translate(205 46) scale(1.35) skewX(-10)"><path d="M18 2a7 7 0 110 14 7 7 0 010-14z"/><path d="M4 22c4-4 10-4 14 0l14 6-2 4-12-4 1 14 4 28h-6l-4-22-4 22H3l3-30z"/></g>
      <text x="75" y="172" fill="#6ee7b7" font-family="JetBrains Mono,monospace" font-size="11" font-weight="800" letter-spacing="2">HUMAN</text>
      <text x="200" y="172" fill="#fda4af" font-family="JetBrains Mono,monospace" font-size="11" font-weight="800" letter-spacing="2">ZOMBIE</text></svg>` },
  { t:'Home stays hidden', p:"Set a Home Stealth Zone. Inside it you vanish from the radar, hotzone alerts and nearby players, so no one can ever track where you live.",
    ill:`<svg viewBox="0 0 300 180"><circle cx="150" cy="92" r="64" fill="#10b981" fill-opacity=".08" stroke="#10b981" stroke-opacity=".7" stroke-dasharray="6 6"/>
      <path d="M118 96l32-28 32 28v34h-64z" fill="#0b1310" stroke="#10b981" stroke-width="2.5" stroke-linejoin="round"/><path d="M142 130v-18h16v18" stroke="#10b981" stroke-width="2.5" fill="none"/>
      <circle cx="250" cy="40" r="5" fill="#f43f5e" fill-opacity=".6"/><circle cx="42" cy="150" r="5" fill="#f43f5e" fill-opacity=".6"/>
      <text x="150" y="172" fill="#6ee7b7" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="10.5" font-weight="800" letter-spacing="2">STEALTH PERIMETER · 500 FT</text></svg>` }
];

const VIEWS = {
  boot: () => `<div class="emb">${EMBLEM}</div>
    <div class="bootT"><h1>Zombie <span>Radius</span></h1><p>The outbreak is closer than you think.</p></div>
    <div class="ospacer"></div>
    <button class="obtn" id="bEnlist">${svg('shield')} Enlist</button>
    <button class="obtn ghost" id="bSign">${svg('key')} Sign in</button>`,
  claim: () => `<span class="okick">SECURE YOUR SURVIVOR</span><h2 class="otitle">${esc(OB.handle || 'Survivor')}</h2>
    <p class="osub">Zombie Radius now uses real accounts. Add an email and password so you can sign in on any phone. You keep your gear, points and progress.</p>
    <div class="callout">${svg('shield')}<div><b>TAKES ABOUT A MINUTE</b><p>We'll confirm you're 18+, set your Home Stealth Zone and turn on GPS.</p></div></div>
    <div class="ospacer"></div>
    <button class="obtn" id="cGo">Secure my account</button>
    <button class="obtn ghost" id="cOther">Sign in to a different account</button>`,
  signin: () => `<div class="ohead"><button class="oback" id="obBack" aria-label="Back">${svg('back')}</button><span class="ostep">SIGN IN</span></div>
    <h2 class="otitle">Welcome back</h2><p class="osub">Sign in with the email and password you enlisted with.</p>
    ${fld('siE', 'Email address', 'email', OB.email, 'autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false"', { ic:'mail' })}
    ${fld('siP', 'Password', 'password', '', 'autocomplete="current-password" class="pw"', { ic:'key', eye:true })}
    <div class="ferr" id="siErr">${esc(OB.err)}</div>
    <div class="ospacer"></div>
    <button class="obtn" id="siGo">Sign in</button>
    <p class="osub" style="text-align:center;margin:0">New here? <button class="olink" id="siNew">Enlist</button></p>`,
  safety: () => `<span class="okick">REQUIRED BRIEFING</span><h2 class="otitle">Field safety</h2>
    <p class="osub">This game is played on real streets. Before you deploy:</p>
    <div class="brief">
      <div>${svg('eye')}<p style="margin:0"><b>Stay aware</b><span>Look up from your phone. Watch for cars, cyclists, curbs and people around you.</span></p></div>
      <div>${svg('fence')}<p style="margin:0"><b>Never trespass</b><span>Stay on public property. No stockpile is worth entering private land or closed areas.</span></p></div>
      <div>${svg('traffic')}<p style="margin:0"><b>Obey traffic laws</b><span>Use crosswalks and signals. Never chase or flee into traffic.</span></p></div>
      <div>${svg('car')}<p style="margin:0"><b>Never play while driving</b><span>No playing behind the wheel or on a bike, scooter or skateboard.</span></p></div>
    </div>
    <div class="ospacer"></div>
    <button class="obtn" id="sfGo">Confirm and proceed</button>`,
  how: () => { const s = HOW[OB.how]; return `<div class="ohead"><button class="oback" id="obBack" aria-label="Back">${svg('back')}</button><span class="ostep">HOW IT WORKS · ${OB.how + 1} OF 3</span><span style="flex:1"></span><button class="olink" id="hwSkip" style="font-size:12px">Skip</button></div>
    <div class="slide" id="hwSlide"><div class="ill">${s.ill}</div><h2>${s.t}</h2><p>${s.p}</p></div>
    <div class="dots">${HOW.map((_, i) => `<i class="${i === OB.how ? 'on' : ''}"></i>`).join('')}</div>
    <div class="ospacer"></div>
    <button class="obtn" id="hwNext">${OB.how < 2 ? 'Next' : 'Begin enlistment'}</button>`; },
  s1: () => `${prog(1)}<h2 class="otitle">Account credentials</h2><p class="osub">Your email is only for signing in and recovery. It's never shown in the game.</p>
    ${fld('s1E', 'Email address', 'email', OB.email, 'autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false"', { ic:'mail', aside:'Login ID · private' })}
    ${fld('s1P', 'Password', 'password', OB.pw, 'autocomplete="new-password" class="pw"', { ic:'key', eye:true, hint:'' })}
    <div style="display:grid;gap:6px;margin-top:-8px">${meterHtml('s1')}</div>
    ${fld('s1C', 'Verify password', 'password', OB.pw2, 'autocomplete="new-password" class="pw"', { ic:'key', eye:true })}
    <div class="ferr">${esc(OB.err)}</div><div class="ospacer"></div>
    <button class="obtn" id="s1Go" disabled>Continue</button>`,
  s2: () => { const max = new Date().toISOString().slice(0, 10); return `${prog(2)}<h2 class="otitle">Character identity</h2><p class="osub">Your character name is what other players see. No real names.</p>
    ${fld('s2N', 'Character name', 'text', OB.handle, 'maxlength="16" autocomplete="off" autocapitalize="off" spellcheck="false"', { ic:'user', aside:'3–16 · A–Z 0–9 _', after:`<button type="button" class="eye" id="s2R" aria-label="Random name" style="width:auto;padding:0 10px;font-size:11px;font-weight:800;letter-spacing:.08em;color:#34d399">RANDOM</button>` })}
    ${fld('s2D', 'Date of birth', 'date', OB.dob, `max="${max}" min="1900-01-01"`, { aside:'18+ only' })}
    <div id="s2Lock"></div>
    <div class="ofld"><span class="olbl">Character build<em>Avatar silhouette &amp; gear fit</em></span>
      <div class="gcards" role="radiogroup" aria-label="Character build">
        <button type="button" class="gcard ${OB.gender === 'male' ? 'on' : ''}" data-g="male" role="radio" aria-checked="${OB.gender === 'male'}">${silSvg(false)}<b>MALE</b></button>
        <button type="button" class="gcard ${OB.gender === 'female' ? 'on' : ''}" data-g="female" role="radio" aria-checked="${OB.gender === 'female'}">${silSvg(true)}<b>FEMALE</b></button>
      </div></div>
    <div class="ferr">${esc(OB.err)}</div><div class="ospacer"></div>
    <button class="obtn" id="s2Go" disabled>Continue</button>`; },
  s3: () => `${prog(3)}<h2 class="otitle">Home Stealth Zone</h2>
    ${addrBlock('s3', OB.home)}
    <div class="callout">${svg('shield')}<div><b>PRIVACY PROTECTION</b><p>Within 500 ft of home you're invisible: not on the radar, not in hotzone alerts and never shown to nearby players, so no one can track where you live. Only the stealth circle is saved to your account; the street address stays on this phone and is never shown to other players.</p></div></div>
    <div class="ferr">${esc(OB.err)}</div>
    <button class="obtn" id="s3Go" ${OB.home ? '' : 'disabled'}>Continue</button>`,
  s4: () => `${prog(4)}<h2 class="otitle">Agreements &amp; GPS</h2>
    <label class="ochk"><input type="checkbox" id="s4T" ${OB.terms ? 'checked' : ''}><span class="bx">${svg('check')}</span><span>I agree to the <button type="button" class="olink" data-doc="terms">Terms of Service</button></span></label>
    <label class="ochk"><input type="checkbox" id="s4P" ${OB.privacy ? 'checked' : ''}><span class="bx">${svg('check')}</span><span>I've read the <button type="button" class="olink" data-doc="privacy">Privacy Policy</button>, including how my location is masked</span></label>
    ${permCard()}
    <div class="ferr" id="s4Err">${esc(OB.err)}</div><div class="ospacer"></div>
    <button class="obtn" id="s4Go" disabled>${svg('radar')} Enter sector</button>`,
  loc: () => `<span class="okick">SIGNED IN AS ${esc((auth && auth.handle) || '').toUpperCase()}</span><h2 class="otitle">GPS radar</h2>
    ${permCard()}
    <div class="ospacer"></div>
    <button class="obtn" id="lcGo" disabled>${svg('radar')} Enter sector</button>`
};

function addrBlock(pre, home){
  return `<div class="ofld acwrap"><span class="olbl">Home address<em>Street, city</em></span>
      <span class="oin" id="${pre}AW">${svg('pin', 'oic')}<input id="${pre}A" type="text" value="${esc(home && home.label || '')}" autocomplete="street-address" placeholder="Start typing your address" spellcheck="false"></span>
      <div class="aclist" id="${pre}L" hidden></div></div>
    <button type="button" class="obtn ghost" id="${pre}G" style="min-height:42px;font-size:12px">${svg('gps')} Use current GPS location</button>
    <div class="omap" id="${pre}M"><div class="empty" id="${pre}ME">${home ? '' : 'NO HOME PIN YET'}</div></div>`;
}
function permCard(){
  const st = OB.gps;
  const state = st === 'lock' ? `<div class="pstate lock"><i></i>GPS LOCKED${fix ? ` · ±${Math.round(fix.acc)} M` : ''}</div>`
    : st === 'pend' ? `<div class="pstate pend"><i></i>WAITING FOR YOUR PHONE…</div>`
    : st === 'deny' ? `<div class="pstate deny">LOCATION BLOCKED<span>${/iPhone|iPad/.test(navigator.userAgent)
        ? 'iPhone: Settings › Privacy &amp; Security › Location Services › Safari Websites › While Using the App. Then reload this page.'
        : 'Tap the icon left of the web address › Permissions › Location › Allow. Then tap the button again.'}</span></div>`
    : st === 'nosig' ? `<div class="pstate deny">NO GPS SIGNAL YET<span>Step outside or near a window, then try again.</span></div>`
    : `<div class="pstate idle"><i></i>PERMISSION PENDING</div>`;
  return `<div class="perm"><div class="ph">${svg('gps')}<b>Precise location required</b></div>
    <p>Radar sweeps, sound radiuses and supply drops all run on your exact GPS position. Choose <b style="color:var(--tx)">Allow While Using</b> and keep Precise on. The game only uses location while it's open, and others never see your exact spot beyond 50 ft.</p>
    ${state}
    ${st === 'lock' ? '' : `<button type="button" class="obtn ghost" id="gpsBtn" style="min-height:42px;font-size:12px">${svg('gps')} ${st === 'deny' || st === 'nosig' ? 'Try again' : 'Enable GPS radar permissions'}</button>`}</div>`;
}

function drawOnb(){
  const v = OB.view, c = $('ocard');
  if (obMap) { try { obMap.remove(); } catch(e){} obMap = null; }
  c.className = 'ocard v-' + v + (/^s[1-4]$|^signin$/.test(v) ? ' full' : '');
  c.innerHTML = VIEWS[v]();
  bindEyes(c);
  (BIND[v] || (() => {}))();
  const b = $('obBack'); if (b && !b.onclick) b.onclick = () => goOnb(BACK[v] || 'boot');
  requestAnimationFrame(layoutAtmo);
  const first = c.querySelector('input:not([type=checkbox])'); if (first && matchMedia('(min-width:700px)').matches) first.focus();
}
const BACK = { signin: 'boot', how: 'safety', s1: 'how', s2: 's1', s3: 's2', s4: 's3' };

const BIND = {
  boot(){ $('bEnlist').onclick = () => goOnb('safety'); $('bSign').onclick = () => goOnb('signin'); },
  claim(){ $('cGo').onclick = () => goOnb('safety'); $('cOther').onclick = () => { OB.claim = null; store.del('zr_auth'); auth = null; goOnb('signin'); }; },
  signin(){
    if (OB.claim) $('obBack').onclick = () => goOnb('claim');
    const go = async () => {
      const e = $('siE').value.trim(), p = $('siP').value;
      if (!EMAIL_RE.test(e) || !p) { $('siErr').textContent = 'Enter your email and password.'; return; }
      $('siGo').disabled = true; $('siErr').textContent = '';
      try {
        const r = await rpc('zr_login', { p_email: e, p_password: p });
        if (r.error) { $('siErr').textContent = r.error === 'locked' ? `Too many attempts. Try again in ${Math.ceil(r.secs / 60)} min.` : 'That email and password don\'t match.'; $('siGo').disabled = false; return; }
        auth = { id: r.id, secret: r.secret, handle: r.handle }; store.set('zr_auth', auth);
        saveProfile({ email: r.email, handle: r.handle, gender: r.gender, onboarded: true, termsVer: r.terms_ver, termsAt: r.terms_at,
          homeLabel: profile && profile.email === r.email ? profile.homeLabel : null });
        OB.view = 'loc'; startLocation();
      } catch(_) { $('siErr').textContent = 'Could not connect. Check your signal and try again.'; $('siGo').disabled = false; }
    };
    $('siGo').onclick = go; $('siP').addEventListener('keydown', ev => { if (ev.key === 'Enter') go(); });
    $('siNew').onclick = () => goOnb('safety');
  },
  safety(){ $('sfGo').onclick = () => goOnb(OB.claim ? 's1' : 'how'); },
  how(){
    $('obBack').onclick = () => { if (OB.how > 0) { OB.how--; drawOnb(); } else goOnb('safety'); };
    $('hwSkip').onclick = () => goOnb('s1');
    $('hwNext').onclick = () => { if (OB.how < 2) { OB.how++; drawOnb(); } else goOnb('s1'); };
    let x0 = null; const sl = $('hwSlide');
    sl.addEventListener('pointerdown', e => { x0 = e.clientX; });
    sl.addEventListener('pointerup', e => { if (x0 == null) return; const dx = e.clientX - x0; x0 = null;
      if (dx < -40 && OB.how < 2) { OB.how++; drawOnb(); } else if (dx > 40 && OB.how > 0) { OB.how--; drawOnb(); } });
  },
  s1(){
    if (OB.claim) $('obBack').onclick = () => goOnb('safety');
    const E = $('s1E'), Pw = $('s1P'), C = $('s1C');
    const valid = () => { const i = pwInfo(Pw.value); $('s1Go').disabled = !(OB.emailOk && i.ok && Pw.value === C.value); };
    const chk = debounce(async v => {
      if (!EMAIL_RE.test(v)) { OB.emailOk = null; hint('s1E', v ? 'Enter a valid email, like name@example.com' : '', v ? 'bad' : ''); valid(); return; }
      hint('s1E', 'Checking…');
      try {
        const r = await rpc('zr_check', { p_kind:'email', p_value: v, p_id: OB.claim ? OB.claim.id : null });
        if (E.value.trim() !== v) return;
        OB.emailOk = !!(r.valid && r.available);
        if (OB.emailOk) hint('s1E', '✓ Email available', 'ok');
        else { hint('s1E', `Account already exists · <button type="button" class="olink" id="s1Sign">Sign in</button>`, 'bad'); const b = $('s1Sign'); if (b) b.onclick = () => { OB.email = v; goOnb('signin'); }; }
      } catch(_) { OB.emailOk = null; hint('s1E', 'Could not check right now. Try again.', 'bad'); }
      valid();
    }, 450);
    const onE = () => { OB.email = E.value.trim(); OB.emailOk = null; valid(); chk(OB.email); };
    E.addEventListener('input', onE);
    const onP = () => {
      OB.pw = Pw.value; OB.pw2 = C.value; paintMeter('s1', Pw.value);
      if (C.value) hint('s1C', Pw.value === C.value ? '✓ Passwords match' : 'Passwords do not match', Pw.value === C.value ? 'ok' : 'bad'); else hint('s1C', '');
      valid();
    };
    Pw.addEventListener('input', onP); C.addEventListener('input', onP);
    onP(); if (OB.email) onE();
    $('s1Go').onclick = () => goOnb('s2');
  },
  s2(){
    const N = $('s2N'), D = $('s2D');
    if (!OB.handle) { OB.handle = randHandle(); N.value = OB.handle; }
    const valid = () => { const a = ageOf(OB.dob); $('s2Go').disabled = !(OB.nameOk && a != null && a >= 18 && OB.gender); };
    const chk = debounce(async v => {
      if (!NAME_RE.test(v)) { OB.nameOk = null; hint('s2N', 'Use 3–16 letters, numbers or _', 'bad'); valid(); return; }
      hint('s2N', 'Checking…');
      try {
        const r = await rpc('zr_check', { p_kind:'name', p_value: v, p_id: OB.claim ? OB.claim.id : null });
        if (N.value.trim() !== v) return;
        OB.nameOk = !!(r.valid && r.available);
        hint('s2N', OB.nameOk ? '✓ Character name available' : 'Character name taken', OB.nameOk ? 'ok' : 'bad');
      } catch(_) { OB.nameOk = null; hint('s2N', 'Could not check right now. Try again.', 'bad'); }
      valid();
    }, 400);
    const onN = () => { OB.handle = N.value.trim(); OB.nameOk = null; valid(); chk(OB.handle); };
    N.addEventListener('input', onN); onN();
    $('s2R').onclick = () => { N.value = randHandle(); onN(); };
    const onD = () => {
      OB.dob = D.value; const a = ageOf(OB.dob);
      if (a == null) { hint('s2D', ''); $('s2Lock').innerHTML = ''; }
      else if (a < 18) {
        hint('s2D', '', 'bad');
        $('s2Lock').innerHTML = `<div class="lockout" role="alert">${svg('lock')}<div><b>FIELD ACCESS DENIED</b><p>Players must be 18 years or older to take part in real-world GPS field operations.</p></div></div>`;
      } else if (a > 120) { hint('s2D', 'Check the year.', 'bad'); $('s2Lock').innerHTML = ''; }
      else { hint('s2D', `✓ Age verified · ${a}`, 'ok'); $('s2Lock').innerHTML = ''; }
      valid();
    };
    D.addEventListener('input', onD); D.addEventListener('change', onD); onD();
    document.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
      OB.gender = b.dataset.g;
      document.querySelectorAll('[data-g]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
      valid();
    });
    $('s2Go').onclick = () => goOnb('s3');
  },
  s3(){
    bindAddr('s3', OB.home, h => { OB.home = h; $('s3Go').disabled = !h; });
    $('s3Go').onclick = () => goOnb('s4');
  },
  s4(){
    const valid = () => { $('s4Go').disabled = !(OB.terms && OB.privacy && OB.gps === 'lock'); };
    $('s4T').onchange = e => { OB.terms = e.target.checked; valid(); };
    $('s4P').onchange = e => { OB.privacy = e.target.checked; valid(); };
    document.querySelectorAll('[data-doc]').forEach(b => b.onclick = ev => { ev.preventDefault(); openLegal(b.dataset.doc); });
    bindGps(valid); valid();
    $('s4Go').onclick = register;
  },
  loc(){ bindGps(() => { $('lcGo').disabled = OB.gps !== 'lock'; if (OB.gps === 'lock') enterGame(); }); }
};

function bindGps(after){
  const btn = $('gpsBtn');
  if (btn) btn.onclick = () => { OB.gps = 'pend'; refreshPerm(after); watchGps(); };
  if (OB.gps !== 'lock' && navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name:'geolocation' }).then(s => { if (s.state === 'granted' && OB.gps === 'idle') { OB.gps = 'pend'; refreshPerm(after); watchGps(); } }).catch(() => {});
  }
  gpsHook = () => refreshPerm(after);
  after && after();
}
function refreshPerm(after){
  const card = document.querySelector('#ocard .perm'); if (!card) return;
  const tmp = document.createElement('div'); tmp.innerHTML = permCard(); card.replaceWith(tmp.firstElementChild);
  bindGps(after);
}

async function register(){
  const btn = $('s4Go'); btn.disabled = true; $('s4Err').textContent = '';
  try {
    const r = await rpc('zr_register', { p_email: OB.email, p_password: OB.pw, p_handle: OB.handle, p_dob: OB.dob, p_gender: OB.gender,
      p_home_lat: OB.home.lat, p_home_lng: OB.home.lng, p_terms_ver: TERMS_VER,
      p_claim_id: OB.claim ? OB.claim.id : null, p_claim_secret: OB.claim ? OB.claim.secret : null });
    if (r.error) {
      const back = { email_taken:['s1','That email already has an account. Sign in instead, or use another.'], bad_email:['s1','Check your email address.'],
        weak_password:['s1','Password needs 8+ characters, 1 uppercase letter and 1 number.'], handle_taken:['s2','That character name was just taken. Pick another.'],
        bad_handle:['s2','Character names are 3–16 letters, numbers or _.'], under_18:['s2','Players must be 18 or older.'], bad_dob:['s2','Check your date of birth.'],
        bad_gender:['s2','Pick a character build.'], bad_home:['s3','Set your home pin again.'] }[r.error];
      if (back) { OB.view = back[0]; drawOnb(); OB.err = back[1]; const f = document.querySelector('#ocard .ferr'); if (f) f.textContent = back[1]; return; }
      $('s4Err').textContent = 'Something went wrong (' + r.error + '). Try again.'; btn.disabled = false; return;
    }
    auth = { id: r.id, secret: r.secret, handle: r.handle }; store.set('zr_auth', auth);
    saveProfile({ email: OB.email.toLowerCase(), handle: r.handle, gender: OB.gender, homeLabel: OB.home.label || null,
      onboarded: true, termsVer: TERMS_VER, termsAt: new Date().toISOString() });
    store.set('zr_seen_howto3', 1);
    OB.pw = OB.pw2 = '';
    enterGame();
  } catch(_) { $('s4Err').textContent = 'Could not connect. Check your signal and try again.'; btn.disabled = false; }
}
function enterGame(){
  if (started) return;
  $('onb').hidden = true; $('atmo').innerHTML = '';
  if (fix) startGame(); else { OB.view = 'loc'; showOnb('loc'); }
}

/* address search (Photon / OpenStreetMap) + preview map */
function bindAddr(pre, home, onPick){
  const I = $(pre + 'A'), LST = $(pre + 'L');
  let cur = home ? Object.assign({}, home) : null;
  const setPin = (h, fit) => {
    cur = h; onPick(h);
    const E = $(pre + 'ME'); if (E) E.textContent = h ? '' : 'NO HOME PIN YET';
    if (!h) return;
    if (!obMap) {
      obMap = L_map(pre + 'M', h);
    }
    const ll = [h.lat, h.lng];
    if (!obMarker || !obMap.hasLayer(obMarker)) {
      obCircle = L.circle(ll, { radius: HOME_R, color:'#10b981', weight:2, dashArray:'6 6', fillColor:'#10b981', fillOpacity:.12, interactive:false }).addTo(obMap);
      obMarker = L.marker(ll, { draggable:true, icon: L.divIcon({ className:'', iconSize:[26,26], iconAnchor:[13,26], html:'<div class="pinmk"></div>' }) }).addTo(obMap);
      obMarker.on('drag', e => obCircle.setLatLng(e.target.getLatLng()));
      obMarker.on('dragend', e => { const p = e.target.getLatLng(); setPin(Object.assign({}, cur, { lat: p.lat, lng: p.lng }), false); });
    } else { obMarker.setLatLng(ll); obCircle.setLatLng(ll); }
    if (fit !== false) obMap.setView(ll, 16);
  };
  const L_map = (id, h) => {
    const m = L.map(id, { zoomControl:false, attributionControl:true }).setView([h.lat, h.lng], 16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution:'© OpenStreetMap' }).addTo(m);
    obMarker = null; return m;
  };
  if (cur) setTimeout(() => setPin(cur), 0);
  const label = p => {
    const pr = p.properties || {};
    const street = [pr.housenumber, pr.street || pr.name].filter(Boolean).join(' ');
    return [street || pr.name, pr.city || pr.town || pr.village || pr.county, pr.state].filter(Boolean).join(', ');
  };
  const search = debounce(async q => {
    if (q.length < 4) { LST.hidden = true; return; }
    const bias = fix ? `&lat=${fix.lat.toFixed(3)}&lon=${fix.lng.toFixed(3)}` : '';
    try {
      const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=en${bias}`).then(x => x.json());
      if (I.value.trim() !== q) return;
      const fs = (r.features || []).filter(f => f.geometry);
      LST.innerHTML = fs.length ? fs.map((f, i) => `<button type="button" data-i="${i}">${esc(label(f))}</button>`).join('') : '<div class="acnote">No matches. Try adding the city.</div>';
      LST.hidden = false;
      LST.querySelectorAll('[data-i]').forEach(b => b.onclick = () => {
        const f = fs[+b.dataset.i]; const lbl = label(f);
        I.value = lbl; LST.hidden = true; setPin({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label: lbl });
      });
    } catch(_) { LST.innerHTML = '<div class="acnote">Address search is unavailable. Use your GPS location instead.</div>'; LST.hidden = false; }
  }, 400);
  I.addEventListener('input', () => search(I.value.trim()));
  I.addEventListener('blur', () => setTimeout(() => { LST.hidden = true; }, 200));
  $(pre + 'G').onclick = () => {
    const b = $(pre + 'G'); b.disabled = true; b.innerHTML = `${svg('gps')} Locating…`;
    navigator.geolocation.getCurrentPosition(async p => {
      const h = { lat: p.coords.latitude, lng: p.coords.longitude, label: '' };
      try {
        const r = await fetch(`https://photon.komoot.io/reverse?lat=${h.lat}&lon=${h.lng}&lang=en`).then(x => x.json());
        if (r.features && r.features[0]) h.label = label(r.features[0]);
      } catch(_) {}
      if (!h.label) h.label = 'Current GPS location';
      I.value = h.label; setPin(h);
      if (!fix) fix = { lat: h.lat, lng: h.lng, acc: p.coords.accuracy, speed: null, t: Date.now() };
      b.disabled = false; b.innerHTML = `${svg('gps')} Use current GPS location`;
    }, err => {
      b.disabled = false; b.innerHTML = `${svg('gps')} Use current GPS location`;
      I.placeholder = err.code === 1 ? 'Location blocked: type your address instead' : 'No GPS fix: type your address instead';
    }, { enableHighAccuracy:true, timeout:15000, maximumAge:10000 });
  };
}

/* space-aware background silhouettes */
const WALKER = (x, d, delay, s) => `<g class="walker" style="animation-duration:${d}s;animation-delay:-${delay}s"><g transform="translate(${x} ${200 - 96 * s}) scale(${s})"><g class="bd">
  <path class="beam" d="M40 30L150 8V62Z" fill="url(#beamG)"/>
  <path d="M14 9a8 8 0 0116 0v2H14z" fill="#9fb5aa"/><circle cx="22" cy="15" r="6" fill="#9fb5aa"/>
  <path d="M12 23h20l2 30H10z" fill="#7f958a"/><path d="M14 26h16v12H14z" fill="#60746a"/>
  <path d="M12 53l-4 40h7l6-28 6 28h7l-5-40z" fill="#7f958a"/><path d="M30 27l12 4-1 4-12-3z" fill="#9fb5aa"/>
  <path d="M8 22l-9 34 3 1 10-33z" fill="#55685f"/></g></g></g>`;
const RUNNER = (y, d, delay, s) => `<g class="runner" style="animation-duration:${d}s;animation-delay:-${delay}s"><g transform="translate(0 ${y}) scale(${s})"><g class="bd" fill="#f43f5e">
  <circle cx="10" cy="16" r="7"/><path d="M14 22c8-2 16 2 18 8l-4 24H12z" transform="skewX(-14)"/>
  <path d="M8 26l-20 6 1 4 20-4z"/><path d="M12 32l-18 12 2 3 18-10z"/>
  <path d="M14 52l-12 30 6 2 13-26zM24 52l14 26 5-3-11-27z"/></g></g></g>`;
function sceneSvg(kind){
  if (kind === 'horde') return `<svg viewBox="0 0 600 200" preserveAspectRatio="xMidYMax slice">
    <defs><radialGradient id="hg" cx="50%" cy="100%" r="70%"><stop stop-color="#f43f5e" stop-opacity=".35"/><stop offset="1" stop-color="#f43f5e" stop-opacity="0"/></radialGradient></defs>
    <rect width="600" height="200" fill="url(#hg)"/><path d="M0 196h600" stroke="#f43f5e" stroke-opacity=".4"/>
    <path d="M0 150h120v50H0zM470 120h130v80H470z" fill="#140609"/><path d="M210 196l40-22h100l40 22" stroke="#f43f5e" stroke-opacity=".25" fill="none"/>
    ${RUNNER(108, 11, 0, 1)}${RUNNER(128, 9, 3, .8)}${RUNNER(96, 13, 7, 1.15)}${RUNNER(140, 8, 5, .65)}</svg>`;
  return `<svg viewBox="0 0 600 200" preserveAspectRatio="xMidYMax slice">
    <defs><linearGradient id="beamG" x1="0" x2="1"><stop stop-color="#fef3c7" stop-opacity=".55"/><stop offset="1" stop-color="#fef3c7" stop-opacity="0"/></linearGradient>
      <radialGradient id="fogG"><stop stop-color="#cbd5e1" stop-opacity=".22"/><stop offset="1" stop-color="#cbd5e1" stop-opacity="0"/></radialGradient></defs>
    <path d="M0 0h90v200H0zM510 0h90v200H510z" fill="#0b1210"/>
    <g fill="#1d2a24">${[20,60,100,140].map(y => `<rect x="18" y="${y}" width="14" height="20"/><rect x="52" y="${y}" width="14" height="20"/><rect x="528" y="${y + 10}" width="14" height="20"/><rect x="562" y="${y + 10}" width="14" height="20"/>`).join('')}</g>
    <rect x="18" y="60" width="14" height="20" fill="#f59e0b" fill-opacity=".25"/>
    <path d="M0 196h600" stroke="#10b981" stroke-opacity=".3"/>
    ${WALKER(0, 46, 0, .95)}${WALKER(0, 52, 18, .8)}${WALKER(0, 40, 31, 1.05)}
    <ellipse class="fogp" cx="200" cy="185" rx="220" ry="26" fill="url(#fogG)"/><ellipse class="fogp" cx="430" cy="178" rx="200" ry="22" fill="url(#fogG)" style="animation-delay:-7s"/></svg>`;
}
function layoutAtmo(){
  const at = $('atmo'); if (!at || $('onb').hidden) return;
  at.innerHTML = '';
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = $('ocard').getBoundingClientRect(), W = innerWidth, H = innerHeight;
  const regs = [
    { k:'bottom', x:0, y:c.bottom + 10, w:W, h:H - c.bottom - 34 },
    { k:'top', x:0, y:0, w:W, h:c.top - 10 },
    { k:'left', x:0, y:0, w:c.left - 16, h:H },
    { k:'right', x:c.right + 16, y:0, w:W - c.right - 16, h:H }
  ].filter(r => (r.k === 'top' || r.k === 'bottom') ? (r.h >= 120 && r.w >= 300) : (r.w >= 180 && r.h >= 320));
  if (!regs.length) return;
  const hordeFirst = ['boot','signin','safety','claim'].includes(OB.view);
  const kinds = OB.view === 'boot' ? ['patrol','horde'] : [hordeFirst ? 'horde' : 'patrol'];
  regs.slice(0, OB.view === 'boot' ? 2 : 2).forEach((r, i) => {
    const kind = kinds[i % kinds.length];
    const d = document.createElement('div'); d.className = 'ascene ' + kind;
    const h = r.k === 'left' || r.k === 'right' ? Math.min(r.h, 260) : Math.min(r.h, 240);
    Object.assign(d.style, { left: r.x + 'px', top: (r.k === 'left' || r.k === 'right' ? H - h - 30 : r.k === 'top' ? Math.max(0, r.y + r.h - h) : r.y) + 'px', width: r.w + 'px', height: h + 'px' });
    d.innerHTML = sceneSvg(kind); at.appendChild(d);
  });
}
window.addEventListener('resize', debounce(layoutAtmo, 150));

/* legal documents (drafts) */
const LEGAL = {
  terms: { t:'Terms of Service', body:`<p class="draft">Draft for review. Have a lawyer check this before public launch.</p>
    <p>These terms are an agreement between you and Jenisan, Inc. ("we") for Zombie Radius (the "Game"). By creating an account you agree to them.</p>
    <h3>1. Who can play</h3><p>You must be at least 18 years old. You may hold one account, and the details you give us must be true.</p>
    <h3>2. Real-world safety</h3><div class="hl"><p>The Game is played in public places. You are responsible for your own safety and conduct. Stay aware of your surroundings, obey all laws and traffic rules, never enter private property or closed areas, and never play while driving or riding.</p></div>
    <h3>3. Conduct</h3><ul><li>No harassing, stalking, threatening or following other players outside the Game.</li><li>No physical contact. Bites, scratches and attacks happen only on screen.</li><li>No GPS spoofing, cheating, bots or exploiting bugs.</li><li>Character names may not contain real names, slurs or impersonation.</li></ul>
    <h3>4. Your account</h3><p>Keep your password secret. You are responsible for activity on your account. Tell us if you think it has been compromised.</p>
    <h3>5. Game items and points</h3><p>Items, Survival Credits, points and rankings have no cash value, can't be sold or transferred, and may change or reset each season.</p>
    <h3>6. Sponsored locations</h3><p>Sponsored stockpiles are placed with businesses' permission. Follow each business's rules and hours.</p>
    <h3>7. Suspension</h3><p>We may suspend or close accounts that break these terms or put others at risk.</p>
    <h3>8. No warranty</h3><p>The Game is provided "as is." GPS and network service can be inaccurate or unavailable.</p>
    <h3>9. Limitation of liability</h3><p>To the extent the law allows, we aren't liable for injury, loss or damage that results from how or where you choose to play.</p>
    <h3>10. Changes</h3><p>We may update these terms. If we make important changes we'll ask you to accept them again.</p>` },
  privacy: { t:'Privacy Policy', body:`<p class="draft">Draft for review. Have a lawyer check this before public launch.</p>
    <p>This policy explains what Zombie Radius collects and how it's protected.</p>
    <h3>What we collect</h3><ul><li><b>Email and password.</b> Used only to sign you in and recover your account. Your password is stored as a one-way hash.</li>
      <li><b>Character name and build.</b> The name is public in the Game. The build (male or female) only sets your avatar.</li>
      <li><b>Birth year.</b> Your date of birth is checked once to confirm you're 18+. We keep the year only.</li>
      <li><b>Location while the Game is open.</b> Needed for radar, combat and loot zones. Other players never see your real position: everyone's radar pin is offset 50–100 m and drifts.</li>
      <li><b>Home Stealth Zone.</b> A map point and a 500 ft radius.</li><li><b>Gameplay.</b> Items, points, infections, cures, blocks and reports.</li></ul>
    <h3>Email privacy</h3><div class="hl"><p>Your email is never shown to other players, on leaderboards or in combat logs.</p></div>
    <h3>Location masking</h3><div class="hl"><p>Other players see your exact position only within about 50 ft. Further away, you appear only as a rough zone. Closing the app removes you from the map.</p></div>
    <h3>Home Stealth Zone</h3><div class="hl"><p>Inside your zone you're hidden from the radar, hotzone alerts and nearby players. Only the zone's point and radius are saved to your account. The street address you type is looked up with a map search service (Photon, based on OpenStreetMap) and then kept only on your phone. Other players can never see your home.</p></div>
    <h3>Who we share with</h3><p>We don't sell your data. Service providers that run the Game handle it on our behalf: Supabase (database), Vercel (hosting), OpenStreetMap (map tiles) and Photon by Komoot (address search) and the OpenStreetMap Overpass service, which receives the map square around you to find public places for loot zones.</p>
    <h3>Keeping and deleting data</h3><p>We keep your account while it's active. Ask us to delete your account and we'll erase your email, password, home zone and location history.</p>
    <h3>Security</h3><p>Data is sent over encrypted connections and stored encrypted at rest by our providers.</p>
    <h3>Changes</h3><p>If we change this policy in an important way, we'll ask you to review it again.</p>` }
};
function openLegal(k){
  const d = LEGAL[k]; $('lgTitle').textContent = d.t;
  const acc = profile && profile.termsAt ? ` · ACCEPTED ${dateStr(profile.termsAt).toUpperCase()}` : '';
  $('lgMeta').textContent = `VERSION ${TERMS_VER}${acc}`;
  $('lgBody').innerHTML = d.body; $('lgBody').scrollTop = 0; $('legal').hidden = false;
  const close = () => { $('legal').hidden = true; };
  $('lgX').onclick = close; $('lgOk').onclick = close;
  $('legal').onclick = e => { if (e.target === $('legal')) close(); };
  $('lgOk').focus();
}

/* ---------- location ---------- */
let fix = null, watchId = null, gpsHook = null;
function watchGps(){
  if (!('geolocation' in navigator)) { OB.gps = 'deny'; gpsHook && gpsHook(); return; }
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(p => {
    fix = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy,
            speed: (p.coords.speed != null && p.coords.speed >= 0) ? p.coords.speed : null, t: Date.now() };
    if (OB.gps !== 'lock') { OB.gps = 'lock'; gpsHook && gpsHook(); }
  }, err => {
    if (started) return;
    OB.gps = err.code === 1 ? 'deny' : 'nosig'; gpsHook && gpsHook();
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
}
function startLocation(){
  const go = () => { OB.gps = 'pend'; gpsHook = () => { if (OB.gps === 'lock') enterGame(); else if (!started) showOnb('loc'); }; watchGps(); };
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name:'geolocation' }).then(s => { if (s.state === 'granted') go(); else showOnb('loc'); }).catch(() => showOnb('loc'));
  } else showOnb('loc');
}

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
Object.assign(P, {
  back:'<path d="M15 5l-7 7 7 7"/>',
  eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff:'<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 005.4-1.6"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/>',
  mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  key:'<circle cx="8" cy="14" r="4"/><path d="M11 11l9-9M16 6l3 3M14 8l2 2"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
  shield:'<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/><path d="M9 12l2 2 4-4"/>',
  pin:'<path d="M12 22s7-6.5 7-12a7 7 0 10-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
  gps:'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  check:'<path d="M5 12l5 5 9-10"/>',
  doc:'<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h7M9 17h7"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  fence:'<path d="M4 21V7l2-3 2 3v14M16 21V7l2-3 2 3v14M4 11h16M4 16h16"/>',
  traffic:'<rect x="8" y="2" width="8" height="20" rx="3"/><circle cx="12" cy="7" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="17" r="1.6"/>',
  car:'<path d="M5 16l1.5-5.5A2 2 0 018.4 9h7.2a2 2 0 011.9 1.5L19 16"/><rect x="3" y="16" width="18" height="4" rx="1"/><path d="M7 20v2M17 20v2"/>'
});
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
Object.assign(P, {
  pause:'<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  fist:'<path d="M7 11V7a2 2 0 014 0v3M11 10V6a2 2 0 014 0v4M15 10V7a2 2 0 014 0v6a7 7 0 01-7 7h-1a6 6 0 01-6-6v-2a2 2 0 014 0"/>',
  crate:'<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  rad:'<circle cx="12" cy="12" r="2"/><path d="M12 10V3a9 9 0 017.8 4.5L13.7 11M10.3 11L4.2 7.5A9 9 0 0112 3M13.7 13l6.1 3.5A9 9 0 0112 21v-7M10.3 13L4.2 16.5"/>',
  cdc:'<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/>',
  bunker:'<path d="M3 20h18M5 20v-7a7 7 0 0114 0v7"/><path d="M10 20v-4h4v4"/>',
  world:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>',
  nvg:'<rect x="3" y="8" width="7" height="8" rx="3"/><rect x="14" y="8" width="7" height="8" rx="3"/><path d="M10 12h4"/>',
  smash:'<path d="M4 20l7-7M13 11l3-3 4 4-3 3zM9 4l2 4M4 9l4 2M14 20l-1-4M20 14l-4-1"/>',
  w1:'<circle cx="12" cy="12" r="2"/><path d="M8 8a6 6 0 000 8M16 8a6 6 0 010 8"/>',
  w2:'<circle cx="12" cy="12" r="2"/><path d="M8 8a6 6 0 000 8M16 8a6 6 0 010 8M5 5a10 10 0 000 14M19 5a10 10 0 010 14"/>',
  w3:'<circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M8 8a6 6 0 000 8M16 8a6 6 0 010 8M5 5a10 10 0 000 14M19 5a10 10 0 010 14M2.5 2.5a13.5 13.5 0 000 19M21.5 2.5a13.5 13.5 0 010 19"/>',
  arrow:'<path d="M12 3l7 9h-4v9h-6v-9H5z" fill="currentColor"/>',
  emp:'<path d="M13 2L5 13h6l-1 9 8-11h-6z"/>',
  sound:'<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 010 6M19 6a8 8 0 010 12"/>',
  mute:'<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>'
});
Object.assign(ITEM_IC, { antivpills:'pill', antidote:'syr' });
Object.assign(SHORT, { antivpills:'Anti Pills', antidote:'Lazarus-X' });
let started = false, map, layer, fxLayer, othLayer, meMarker, meRing, soundRing, sweepMk, follow = true, data = null, since = null;
const seenEvents = new Set();
let prevState = null, prevInfected = false, hbBusy = false, wakeLock = null, pinMode = null, closeAlerted = new Set();
let localCdUntil = 0, localShriekAt = 0, wingBusy = {}, tab = 'radar', prevDis = {}, hold = null, lockTotal = 0, finishing = false, biteVib = 0;
const DBG = /[?&]debug\b/.test(location.search) ? { role:null, night:null } : null;
const MAXHP = 100;
const el0 = () => data ? (Date.now() - data._at) / 1000 : 0;
const left = key => data ? Math.max(0, (data.me[key] || 0) - el0()) : 0;
function infLeft(){
  if (!data || !data.me.infected) return null;
  return Math.max(0, data.me.inf_left - el0() * (data.me.inf_rate == null ? 1 : data.me.inf_rate));
}
const infPct = () => data ? Math.min(100, (data.me.inf_pct || 0) + 15 / 86400 * el0()) : 0;
function V(){
  const me = data.me, d = DBG || {};
  const zombie = d.role ? d.role === 'zombie' : me.state === 'zombie';
  const night = d.night != null ? d.night : !!me.night;
  const hp = Math.min(MAXHP, (me.hp == null ? MAXHP : me.hp) + (me.regen || 0) * el0() / 60);
  return { me, zombie, night, hp, infected: !zombie && me.infected };
}
const Z = () => !!(data && V().zombie);
function weapon(){ const w = data && data.me.gear && data.me.gear.weapon; return w ? Object.assign({}, CAT[w.t] || {}, { t:w.t }) : SHOVE; }
function cdLeft(){
  if (!data) return 0;
  const w = weapon();
  const srv = data.me.last_attack ? (w.cd - (Date.now() - data._skew - Date.parse(data.me.last_attack)) / 1000) : 0;
  return Math.max(0, srv, (localCdUntil - Date.now()) / 1000);
}
const shriekLeft = () => Math.max(0, left('shriek_cd'), 45 - (Date.now() - localShriekAt) / 1000);
const lockLeft = () => left('lock_left');
const pausedLeft = () => left('paused');
function armorHp(){
  const me = data.me;
  if (Z()) return me.shell || 0;
  const g = me.gear || {}; let d = 0;
  ['head','armor'].forEach(k => { if (g[k] && CAT[g[k].t] && CAT[g[k].t].dur) d += Math.max(0, g[k].d || 0); });
  return d;
}
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
const cum = L => 50 * L * (L - 1);
function levelInfo(xp){ xp = Math.max(0, xp || 0); const L = Math.max(1, Math.floor((1 + Math.sqrt(1 + 4 * xp / 50)) / 2));
  return { L, into: xp - cum(L), need: cum(L + 1) - cum(L), p: (xp - cum(L)) / (cum(L + 1) - cum(L)) }; }
const wavesOf = r => r <= 60 ? 1 : r <= 300 ? 2 : 3;

/* ---------- sound effects (synthesized, no assets) ---------- */
const SFX = (() => {
  let ctx = null;
  const ac = () => ctx || (ctx = new (window.AudioContext || window.webkitAudioContext)());
  const out = (node, t0, peak, a, dec) => { const c = ac(), g = c.createGain(); g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dec); node.connect(g); g.connect(c.destination); return g; };
  const noise = dur => { const c = ac(), b = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; const s = c.createBufferSource(); s.buffer = b; return s; };
  const filt = (src, type, f, q) => { const x = ac().createBiquadFilter(); x.type = type; x.frequency.value = f; if (q) x.Q.value = q; src.connect(x); return x; };
  const tone = (t0, type, f1, f2, dur, peak) => { const o = ac().createOscillator(); o.type = type; o.frequency.setValueAtTime(f1, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur); out(o, t0, peak, 0.004, dur); o.start(t0); o.stop(t0 + dur + 0.05); };
  const burst = (t0, dur, type, f, peak, q) => { const n = noise(dur + 0.05); out(filt(n, type, f, q), t0, peak, 0.003, dur); n.start(t0); n.stop(t0 + dur + 0.05); };
  const shot = (t0, p, lp) => { const n = noise(0.7), f = filt(n, 'lowpass', lp); f.frequency.setValueAtTime(lp, t0); f.frequency.exponentialRampToValueAtTime(250, t0 + 0.45);
    out(f, t0, p, 0.002, 0.5); n.start(t0); n.stop(t0 + 0.7); tone(t0, 'sine', 130, 38, 0.28, p * 0.7); };
  const S = {
    rifle: t => shot(t, 0.9, 6500), shotgun: t => { shot(t, 1, 3200); burst(t + 0.02, 0.6, 'lowpass', 900, 0.35); },
    carbine: t => { for (let i = 0; i < 4; i++) shot(t + i * 0.085, 0.55, 5200); },
    bow: t => { tone(t, 'triangle', 220, 150, 0.35, 0.5); burst(t, 0.06, 'highpass', 3000, 0.25); },
    bat: t => { burst(t, 0.22, 'bandpass', 900, 0.35, 0.8); tone(t + 0.18, 'sine', 110, 55, 0.18, 0.7); },
    crowbar: t => { burst(t, 0.2, 'bandpass', 1100, 0.3, 0.8); tone(t + 0.17, 'triangle', 1350, 1300, 0.6, 0.25); tone(t + 0.17, 'triangle', 910, 900, 0.5, 0.2); },
    shove: t => { tone(t, 'sine', 95, 45, 0.18, 0.8); burst(t, 0.08, 'lowpass', 600, 0.4); },
    bearspray: t => burst(t, 1.2, 'highpass', 2500, 0.35), scentspray: t => burst(t, 0.6, 'highpass', 3200, 0.25),
    stungun: t => { for (let i = 0; i < 9; i++) burst(t + i * 0.06, 0.035, 'bandpass', 2400 + Math.random() * 1500, 0.4, 2); tone(t, 'square', 60, 60, 0.55, 0.12); },
    roadflare: t => { burst(t, 0.15, 'bandpass', 1500, 0.5); burst(t + 0.1, 0.9, 'highpass', 1800, 0.18); },
    antiviral: t => { tone(t, 'square', 2200, 2200, 0.02, 0.12); burst(t + 0.05, 0.18, 'highpass', 4000, 0.18); },
    pills: t => { for (let i = 0; i < 6; i++) burst(t + i * 0.05 + Math.random() * 0.02, 0.025, 'bandpass', 3500, 0.3, 4); },
    cryocase: t => { for (let i = 0; i < 14; i++) burst(t + i * 0.03, 0.02, 'bandpass', 2800, 0.25, 3); burst(t + 0.45, 0.4, 'bandpass', 700, 0.15, 0.6); },
    ducttape: t => { const n = noise(0.45), f = filt(n, 'bandpass', 800, 1.2); f.frequency.setValueAtTime(800, t); f.frequency.exponentialRampToValueAtTime(3000, t + 0.4); out(f, t, 0.35, 0.01, 0.42); n.start(t); n.stop(t + 0.5); },
    aa: t => { tone(t, 'square', 1800, 1800, 0.03, 0.15); tone(t + 0.12, 'sine', 880, 1320, 0.12, 0.15); },
    radio: t => { burst(t, 0.45, 'bandpass', 1800, 0.25, 0.5); tone(t + 0.45, 'sine', 1200, 1200, 0.12, 0.2); },
    maglite: t => tone(t, 'square', 2500, 2500, 0.02, 0.15),
    drone: t => { const o = ac().createOscillator(), l = ac().createOscillator(), lg = ac().createGain(); o.type = 'sawtooth'; o.frequency.value = 190;
      l.frequency.value = 22; lg.gain.value = 40; l.connect(lg); lg.connect(o.frequency); out(filt(o, 'lowpass', 1400), t, 0.12, 0.08, 0.9); o.start(t); l.start(t); o.stop(t + 1.05); l.stop(t + 1.05); },
    claymore: t => { shot(t, 1, 1100); burst(t, 1.4, 'lowpass', 180, 0.6); },
    bite: t => { burst(t, 0.09, 'lowpass', 1800, 0.6); burst(t + 0.13, 0.11, 'lowpass', 1500, 0.6); },
    shriek: t => { const o = ac().createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(1100, t); o.frequency.exponentialRampToValueAtTime(260, t + 0.9);
      out(filt(o, 'bandpass', 1200, 0.7), t, 0.35, 0.03, 0.9); o.start(t); o.stop(t + 1); burst(t, 0.9, 'bandpass', 2500, 0.12, 1); },
    search: t => { for (let i = 0; i < 5; i++) burst(t + i * 0.09, 0.07, 'bandpass', 1300 + Math.random() * 900, 0.2, 1.5); },
    smash: t => { tone(t, 'sine', 80, 40, 0.25, 0.8); burst(t + 0.02, 0.4, 'bandpass', 2600, 0.3, 0.6); },
    primary: t => { tone(t, 'sine', 140, 60, 0.15, 0.6); burst(t, 0.05, 'lowpass', 1200, 0.3); },
    secondary: t => tone(t, 'triangle', 660, 990, 0.12, 0.2)
  };
  S.epipen = S.antiviral; S.antidote = S.antiviral; S.antivpills = S.pills; S.powerbank = S.aa; S.claymore_place = S.primary;
  return {
    play(k, fallback){ if (store.get('zr_mute')) return; try { const c = ac(); if (c.state === 'suspended') c.resume(); (S[k] || S[fallback] || S.primary)(c.currentTime + 0.01); } catch(e){} },
    unlock(){ try { const c = ac(); if (c.state === 'suspended') c.resume(); } catch(e){} }
  };
})();

function startGame(){
  started = true;
  $('game').hidden = false;
  $('pauseBtn').innerHTML = svg('pause');
  $('invMenu').innerHTML = svg('cog');
  $('cmdBack').innerHTML = svg('back'); $('cmdSet').innerHTML = svg('cog');
  $('recenter').innerHTML = svg('target');
  $('navRadar').innerHTML = svg('radar') + 'RADAR'; $('navGear').innerHTML = svg('pack') + 'GEAR'; $('navWorld').innerHTML = svg('world') + 'WORLD';
  map = L.map('map', { zoomControl:false, attributionControl:true, zoomSnap:0.5, maxZoom:20 }).setView([fix.lat, fix.lng], 18);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 19,
    attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  capZoom(); window.addEventListener('resize', capZoom);
  sweepMk = L.marker([fix.lat, fix.lng], { icon: L.divIcon({ className:'', iconSize:[420,420], iconAnchor:[210,210], html:'<div class="sweep"></div>' }), interactive:false, zIndexOffset:-1000 }).addTo(map);
  layer = L.layerGroup().addTo(map); othLayer = L.layerGroup().addTo(map); fxLayer = L.layerGroup().addTo(map);
  soundRing = L.circle([fix.lat, fix.lng], { radius: 10, color:'#b45309', weight:1.5, dashArray:'5 7', fill:false, opacity:.45, interactive:false }).addTo(map);
  meRing = L.circle([fix.lat, fix.lng], { radius: 20, color:'#10b981', weight:2, fillOpacity:.07, interactive:false }).addTo(map);
  meMarker = L.marker([fix.lat, fix.lng], { icon: mkIcon('me', '#10b981', ''), zIndexOffset: 1000, interactive:false }).addTo(map);
  map.on('dragstart', () => { follow = false; });
  map.on('move zoom', drawEdges);
  map.on('click', e => { if (pinMode) { const f = pinMode; pinMode = null; f(e.latlng); } });
  $('recenter').onclick = () => { follow = true; if (fix) map.setView([fix.lat, fix.lng], Math.max(map.getZoom(), 17.5)); };
  $('lvlBtn').onclick = () => openCmd('st');
  $('pauseBtn').onclick = togglePause; $('pauseGo').onclick = togglePause;
  $('hgBtn').onclick = toggleLight;
  $('invMenu').onclick = openGearMenu; $('cmdSet').onclick = openGearMenu;
  $('cmdBack').onclick = () => { closeCmd(); setTab('gear'); };
  document.querySelectorAll('#nav button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  $('invTabs').querySelectorAll('button').forEach(b => b.onclick = () => {
    if (b.dataset.t === 'bunker' && !bunkerOpen() && data.me.bunker) { toast('You must build or return to your bunker to access bunker inventory'); return; }
    invTab = b.dataset.t; bkPage = 0; drawInv();
  });
  $('cmdTabs').querySelectorAll('button').forEach(b => b.onclick = () => openCmd(b.dataset.t));
  $('wing1').onclick = () => Z() ? shriek() : useSlot('eq1');
  $('wing2').onclick = () => { if (!Z()) useSlot('eq2'); };
  $('mainBtn').addEventListener('click', () => { if (!Z()) attack(); });
  $('actX').onclick = cancelAction;
  setupBite(); setupProx();
  if (DBG) setupDebug();
  document.addEventListener('pointerdown', SFX.unlock, { once:true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { heartbeat(); requestWake(); } });
  requestWake();
  heartbeat();
  setInterval(heartbeat, HB_MS);
  setInterval(tickLocal, 200);
  requestAnimationFrame(tweenLoop);
  if (!store.get('zr_seen_howto5')) { store.set('zr_seen_howto5', 1); setTimeout(showHowTo, 900); }
}
function capZoom(){
  if (!map) return;
  const lat = fix ? fix.lat : 35, half = Math.hypot(innerWidth, innerHeight) / 2;
  const z = Math.log2(156543.03 * Math.cos(lat * Math.PI / 180) / (16093 / half));
  map.setMinZoom(Math.ceil(z * 2) / 2);
}
async function requestWake(){ try { if ('wakeLock' in navigator && !document.hidden) wakeLock = await navigator.wakeLock.request('screen'); } catch(e){} }
function mkIcon(kind, color, label, extra){
  return L.divIcon({ className:'', iconSize:[24,24], iconAnchor:[12,12],
    html:`<div class="mk ${kind}" style="color:${color}">${extra || ''}<div class="b"></div>${label ? `<div class="lbl">${esc(label)}</div>` : ''}</div>` });
}
function setTab(t){
  tab = t;
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $('inv').hidden = t !== 'gear'; $('world').hidden = t !== 'world';
  if (t !== 'gear') closeCmd();
  if (t === 'gear') { invTab = invTab || 'gear'; drawInv(); }
  if (t === 'world') drawWorld(true);
}

async function heartbeat(){
  if (hbBusy || !fix || document.hidden) return;
  hbBusy = true;
  try {
    const fresh = Date.now() - fix.t < 15000;
    const r = await rpc('zr_hb6', A({ p_lat: fresh ? fix.lat : null, p_lng: fresh ? fix.lng : null, p_acc: fresh ? fix.acc : null,
      p_tz: new Date().getTimezoneOffset(), p_since: since, p_speed: fresh ? fix.speed : null }));
    const prevLock = data ? data.me.lock_left : 0;
    data = r; data._at = Date.now(); data._skew = Date.now() - Date.parse(r.now);
    if ((r.me.lock_left || 0) > (prevLock || 0) + 0.5 || !lockTotal) lockTotal = Math.max(r.me.lock_left || 0, lockTotal && r.me.lock_left ? lockTotal : 0);
    if (!r.me.lock_left) lockTotal = 0;
    since = r.now;
    delete bannerState.net;
    hideSplash();
    render();
    handleEvents(r.events || []);
    if (r.seed && r.seed.length) seedTiles(r.seed);
  } catch (e) {
    if (/bad_auth/.test(e.message)) { store.del('zr_auth'); location.reload(); return; }
    banner('net', 'Connection lost. Retrying…', 'red');
  } finally { hbBusy = false; }
}

/* OpenStreetMap: find public spots (parks, businesses, footways, minor roads) for loot in a 0.01° tile */
let seeding = false;
async function seedTiles(tiles){
  if (seeding) return; seeding = true;
  try {
    for (const tk of tiles.slice(0, 1)) {
      if (store.get('zr_seedtry_' + tk) > Date.now() - 600000) continue;
      store.set('zr_seedtry_' + tk, Date.now());
      const [la, lo] = tk.split(':').map(Number);
      const s = la / 100, n = (la + 1) / 100, w = lo / 100, e = (lo + 1) / 100;
      const q = `[out:json][timeout:20][bbox:${s},${w},${n},${e}];
(node["shop"];node["amenity"~"^(cafe|restaurant|fast_food|fuel|pharmacy|library|townhall|community_centre|post_office|bank|cinema|marketplace|ice_cream)$"];)->.a;.a out 150;
(way["leisure"~"^(park|playground|pitch|garden|dog_park|recreation_ground)$"];way["landuse"="recreation_ground"];)->.p;.p out center 80;
way["highway"~"^(footway|pedestrian|path|cycleway|tertiary|secondary|unclassified|living_street)$"]["access"!="private"]->.r;.r out geom 150;
way["highway"="service"]["service"="alley"]->.y;.y out geom 80;`;
      const r = await fetch('https://overpass-api.de/api/interpreter', { method:'POST', body:'data=' + encodeURIComponent(q),
        headers:{ 'Content-Type':'application/x-www-form-urlencoded' } }).then(x => x.json());
      const parks = [], shops = [], roads = [], alleys = [];
      for (const el of r.elements || []) {
        if (el.type === 'way' && el.tags && el.tags.service === 'alley' && el.geometry && el.geometry.length) { const g = el.geometry[Math.floor(el.geometry.length / 2)]; alleys.push({ lat: g.lat, lng: g.lon, k:'alley' }); }
        else if (el.type === 'node' && el.tags) shops.push({ lat: el.lat, lng: el.lon, k:'shop' });
        else if (el.type === 'way' && el.tags && (el.tags.leisure || el.tags.landuse) && el.center) parks.push({ lat: el.center.lat, lng: el.center.lon, k:'park' });
        else if (el.type === 'way' && el.geometry && el.geometry.length) { const g = el.geometry[Math.floor(el.geometry.length / 2)]; roads.push({ lat: g.lat, lng: g.lon, k:'road' }); }
      }
      const shuf = a => a.sort(() => Math.random() - 0.5);
      const inTile = p => Math.floor(p.lat * 100) === la && Math.floor(p.lng * 100) === lo;
      const near = (a, b) => Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 111320 * Math.cos(a.lat * Math.PI / 180)) <= 120;
      const bizAlleys = shuf(alleys).filter(a => inTile(a) && shops.some(s => near(a, s))).slice(0, 40);
      const pts = shuf(parks).concat(shuf(shops), shuf(roads)).filter(inTile).slice(0, 300).concat(bizAlleys);
      if (pts.length) await rpc('zr_seed', A({ p_tile: tk, p_pts: pts }));
    }
  } catch(e){} finally { seeding = false; }
}

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
const OTH = new Map();
function tweenLoop(now){
  for (const [, o] of OTH) {
    const p = Math.min(1, (now - o.t0) / 2800), e = p * (2 - p);
    o.m.setLatLng([o.a[0] + (o.b[0] - o.a[0]) * e, o.a[1] + (o.b[1] - o.a[1]) * e]);
  }
  requestAnimationFrame(tweenLoop);
}
function render(){
  const v = V(), me = v.me, zombie = v.zombie, infected = v.infected;
  $('game').classList.toggle('z', zombie);
  $('game').classList.toggle('night', v.night);
  $('game').classList.toggle('emp', !zombie && !!me.in_emp && !me.emp_nvg);
  document.querySelector('meta[name=theme-color]').setAttribute('content', zombie ? '#0c0608' : '#0a0f0d');
  updateHeader();
  const acc = fix ? Math.round(fix.acc) : null;
  $('gpsTxt').textContent = (acc == null ? 'GPS —' : `GPS ±${acc}m${acc > 35 ? ' · weak' : ''}`) + (zombie ? (v.night ? ' · night' : '') : ` · noise ${me.ring}m`);
  $('gps').classList.toggle('weak', acc > 35);
  if (fix) {
    const ll = [fix.lat, fix.lng];
    meMarker.setLatLng(ll); meRing.setLatLng(ll); soundRing.setLatLng(ll); sweepMk.setLatLng(ll);
    if (follow && tab === 'radar') map.panTo(ll, { animate:true });
  }
  const c = zombie ? '#f43f5e' : infected ? '#fb923c' : '#10b981';
  meMarker.setIcon(mkIcon('me', c, '')); meRing.setStyle({ color: c, fillColor: c });
  soundRing.setRadius(me.ring || 10); soundRing.setStyle({ opacity: zombie ? 0 : .45 });

  layer.clearLayers();
  for (const cc of data.caches || []) {
    const off = cc.destroyed > 0 || cc.cooldown > 0;
    const col = cc.destroyed > 0 ? '#52525b' : cc.cooldown > 0 ? '#52525b' : cc.sponsored ? '#fde047' : cc.tier === 'military' ? '#ef4444' : cc.tier === 'hunting' ? '#eab308' : '#10b981';
    layer.addLayer(L.circle([cc.lat, cc.lng], { radius: 15, color: col, weight: 2, fillColor: col, fillOpacity: off ? .04 : .12, className: off ? '' : 'lootz' }).on('click', () => tapCache(cc)));
  }
  for (const d of data.crates || []) {
    const lbl = d.lands > 0 ? `INBOUND ${fmt(d.lands - el0())}` : d.looted ? 'RAIDED' : `OPEN ${fmt(d.left - el0())}`;
    layer.addLayer(L.circle([d.lat, d.lng], { radius: 25, color:'#f59e0b', weight: 2, dashArray: d.lands > 0 ? '6 6' : null, fillColor:'#f59e0b', fillOpacity:.1, interactive:false }));
    layer.addLayer(L.marker([d.lat, d.lng], { icon: L.divIcon({ className:'', iconSize:[24,24], iconAnchor:[12,12], html:`<div class="crate"><div class="core">${svg('crate','x')}</div><div class="lbl">${lbl}</div></div>` }), zIndexOffset: 300 })
      .on('click', () => toast(d.lands > 0 ? `Supply crate lands in ${fmt(d.lands - el0())}, ${d.dist} m away.` : `Supply crate, ${d.dist} m away. Military-grade gear.`)));
  }
  for (const zn of data.zones || []) {
    if (zn.kind === 'shadow') {
      layer.addLayer(L.circle([zn.lat, zn.lng], { radius: zn.r, color:'#475569', weight: 1.5, dashArray:'3 5', fillColor:'#020617', fillOpacity:.5, className:'shadowz' })
        .on('click', () => toast(zombie ? 'Shadow Alley: humans can\'t see you on radar in here unless they shine a light or drop a flare.' : 'Shadow Alley: zombies inside are invisible to your radar. A headlamp or road flare exposes them.')));
      continue;
    }
    if (zn.kind === 'emp') {
      layer.addLayer(L.circle([zn.lat, zn.lng], { radius: zn.r, color:'#a78bfa', weight: 2, dashArray:'1 7', fillColor:'#7c3aed', fillOpacity:.13, className:'empz', interactive:false }));
      layer.addLayer(L.marker([zn.lat, zn.lng], { icon: L.divIcon({ className:'', iconSize:[22,22], iconAnchor:[11,11],
        html:`<div class="zonemk emp" style="color:#c4b5fd">${svg('emp')}<div class="lbl">EMP FOG ${fmt(zn.left - el0())}</div></div>` }) })
        .on('click', () => toast('EMP fog: a drifting storm. Inside it, human radar shrinks by 75% and the zombie-close alarm is jammed. Night-vision goggles see through it.')));
      continue;
    }
    const rad = zn.kind === 'radiation';
    layer.addLayer(L.circle([zn.lat, zn.lng], { radius: zn.r, color: rad ? '#a3e635' : '#38bdf8', weight: 2, dashArray: rad ? '2 8' : null, fillColor: rad ? '#84cc16' : '#38bdf8', fillOpacity: rad ? .14 : .1, interactive:false }));
    layer.addLayer(L.marker([zn.lat, zn.lng], { icon: L.divIcon({ className:'', iconSize:[22,22], iconAnchor:[11,11],
      html:`<div class="zonemk ${rad ? 'rad' : 'cdc'}" style="color:${rad ? '#bef264' : '#7dd3fc'}">${svg(rad ? 'rad' : 'cdc')}<div class="lbl">${rad ? 'RADIATION' : 'CDC LAB'} ${fmt(zn.left - el0())}</div></div>` }) })
      .on('click', () => toast(rad ? 'Radiation zone: your infection meter rises while inside unless you wear a respirator.' : 'CDC Research Lab: standing inside purges your infection meter.')));
  }
  for (const b of data.bags || []) {
    layer.addLayer(L.circle([b.lat, b.lng], { radius: 12, color:'#c9a37a', weight: 2, fillColor:'#8a6a45', fillOpacity:.2 }).on('click', () => tapBag(b)));
  }
  for (const m of data.mines || []) {
    if (m.kind === 'claymore') layer.addLayer(L.marker([m.lat, m.lng], { icon: L.divIcon({ className:'', iconSize:[12,12], iconAnchor:[6,6], html:'<div class="minemk"></div>' }) })
      .on('click', () => toast('Your claymore. It goes off on the first zombie within 33 ft.')));
    else layer.addLayer(L.marker([m.lat, m.lng], { icon: L.divIcon({ className:'', iconSize:[14,14], iconAnchor:[7,7], html:'<div class="flaremk"></div>' }) }));
  }
  for (const r of data.reveals || []) layer.addLayer(L.circle([r.lat, r.lng], { radius: r.radius, color:'#38bdf8', weight:1.5, dashArray:'4 6', fillOpacity:.05, interactive:false }));
  for (const b of data.beacons || []) layer.addLayer(L.marker([b.lat, b.lng], { icon: L.divIcon({ className:'', iconSize:[14,14], iconAnchor:[7,7], html:'<div class="flaremk"></div>' }) }));
  for (const h of data.hotzones || []) {
    layer.addLayer(L.circle([h.lat, h.lng], { radius: h.radius, color:'#f43f5e', weight:2, dashArray:'6 6', fillColor:'#f43f5e', fillOpacity:.1, interactive:false }));
    layer.addLayer(L.marker([h.lat, h.lng], { icon: L.divIcon({ className:'', iconSize:[22,22], iconAnchor:[11,11],
      html:`<div class="hzmk"><div class="core"></div><div class="lbl">SHRIEK ${fmt(h.left - el0())}</div></div>` }), zIndexOffset:400 }));
  }
  for (const b of data.bunkers || []) {
    layer.addLayer(L.marker([b.lat, b.lng], { icon: L.divIcon({ className:'', iconSize:[26,26], iconAnchor:[13,13],
      html:`<div class="bkmk">${svg('bunker','x')}<div class="lbl">${Math.round(b.hp / 50)}%</div></div>` }) })
      .on('click', () => toast(zombie ? `A survivor bunker (${b.hp} HP), ${b.dist} m away. Get close to smash it.` : `Another survivor's bunker. Its marker is offset for privacy.`)));
  }
  const bk = me.bunker;
  if (bk && !zombie) {
    layer.addLayer(L.circle([bk.lat, bk.lng], { radius: 40, color:'#10b981', weight:1.5, dashArray: bk.ready > 0 ? '3 6' : null, fillColor:'#10b981', fillOpacity:.06, interactive:false }));
    layer.addLayer(L.marker([bk.lat, bk.lng], { icon: L.divIcon({ className:'', iconSize:[26,26], iconAnchor:[13,13], html:`<div class="bkmk mine">${svg('bunker','x')}</div>` }) })
      .on('click', () => { setTab('gear'); invTab = 'bunker'; drawInv(); }));
  }
  if (zombie) for (const tr of data.trails || []) {
    const pts = tr.pts || []; if (!pts.length) continue;
    for (let i = 1; i < pts.length; i++) layer.addLayer(L.polyline([[pts[i-1][0], pts[i-1][1]], [pts[i][0], pts[i][1]]],
      { color:'#e11d48', weight: 4, opacity: Math.max(.15, .8 - pts[i][2] / 150), dashArray:'2 8', lineCap:'round', interactive:false }));
    pts.forEach(p => layer.addLayer(L.circle([p[0], p[1]], { radius: 3, color:'#fb7185', weight: 0, fillColor:'#e11d48', fillOpacity: Math.max(.15, .9 - p[2] / 130), interactive:false })));
    const h = pts[pts.length - 1];
    layer.addLayer(L.marker([h[0], h[1]], { icon: L.divIcon({ className:'', iconSize:[14,14], iconAnchor:[7,7], html:'<div class="scentmk"></div>' }) })
      .on('click', () => toast(`Fresh blood scent, ${h[2]}s old. A wounded human passed here.`)));
  }
  for (const r of data.ripples || []) {
    const n = wavesOf(r.r), loud = r.kind !== 'move';
    const label = r.kind === 'move' ? '' : ({ explosion:'blast', shotgun:'gunshot', rifle:'gunshot', carbine:'gunfire', bat:'clang', crowbar:'clang',
      bow:'twang', bearspray:'hiss', stungun:'crackle', flare:'hiss', drone:'buzz', shove:'scuffle', scream:'shriek', radio:'static', ducttape:'rip' }[r.kind] || 'noise');
    layer.addLayer(L.marker([r.lat, r.lng], { icon: L.divIcon({ className:'', iconSize:[34,34], iconAnchor:[17,17],
      html:`<div class="ripple ${loud ? 'loud' : ''}"></div><div class="ripple-w" style="position:absolute;inset:0;display:grid;place-items:center;color:${loud ? '#fdba74' : '#fecaca'}">${svg('w' + n, 'wvic')}</div>${label ? `<div class="riplbl">${label}</div>` : ''}` }) })
      .on('click', () => toast(r.kind === 'move' ? `Movement around here (~${r.dist} m)` : `A ${label} from around here (~${r.dist} m)`)));
  }
  // other players: wandering pips, tweened between heartbeats
  const seen = new Set(); let anyClose = false;
  for (const o of data.others || []) {
    seen.add(o.id);
    const oc = o.state === 'zombie' ? '#f43f5e' : o.state === 'infected' ? '#fb923c' : '#10b981';
    if (o.state === 'zombie' && o.close) anyClose = true;
    const hpb = (!zombie && o.state === 'zombie' && o.hp != null) ? `<div class="hpb">${o.hp}${o.shell ? '+' + o.shell : ''}</div>` : '';
    const icon = mkIcon((o.npc ? 'npc ' : '') + (o.offline ? 'off' : ''), oc, o.handle + (o.stunned ? ' (stunned)' : o.locked ? ' (locked)' : ''), hpb);
    let rec = OTH.get(o.id);
    if (!rec) { const m = L.marker([o.lat, o.lng], { icon, zIndexOffset: 500 }).addTo(othLayer); rec = { m, a:[o.lat, o.lng], b:[o.lat, o.lng], t0: performance.now() }; OTH.set(o.id, rec); }
    else { const cur = rec.m.getLatLng(); rec.a = [cur.lat, cur.lng]; rec.b = [o.lat, o.lng]; rec.t0 = performance.now(); rec.m.setIcon(icon); }
    rec.m.off('click').on('click', () => tapPlayer(o));
  }
  for (const [id, rec] of OTH) if (!seen.has(id)) { othLayer.removeLayer(rec.m); OTH.delete(id); }
  if (anyClose && !zombie) {
    const ids = (data.others || []).filter(o => o.close).map(o => o.id);
    if (ids.some(id => !closeAlerted.has(id))) navigator.vibrate && navigator.vibrate([120,80,120]);
    closeAlerted = new Set(ids);
  } else closeAlerted = new Set();

  renderControls(); drawEdges();
  $('downOv').hidden = !(zombie && me.down > 0);
  banners();
  if (!$('inv').hidden && !dragging) drawInv();
  const realZ = me.state === 'zombie';
  if (prevState === 'human' && realZ) modal('You turned', `The infection took hold. Your weapon, items and backpack dropped nearby. ${me.shell ? `Your armor stayed on: +${me.shell} armor.` : ''} Get your pin onto a human's pip and hold Bite. Shriek calls the horde.`, 'Hunt');
  if (!prevInfected && me.infected && prevState) navigator.vibrate && navigator.vibrate([300,100,300]);
  if (prevState === 'zombie' && !realZ) modal("You're human again", 'Someone cured you with Lazarus-X. Your armor is back on; your infection meter is reset to 0%.', 'Survive');
  prevState = me.state; prevInfected = !realZ && me.infected;
}

function updateHeader(){
  const v = V(), me = v.me, a = armorPct(), lv = levelInfo(me.xp);
  $('lvNum').textContent = lv.L; $('lvFg').style.strokeDashoffset = (119.4 * (1 - lv.p)).toFixed(1);
  if (v.zombie) {
    const tot = Math.round(v.hp) + (me.shell || 0);
    $('pillLbl').textContent = `HP ${tot}${me.shell ? ` (100+${me.shell})` : ''}`;
    $('armTrk').style.visibility = a == null ? 'hidden' : 'visible';
    $('armBar').style.width = (a || 0) + '%';
    $('hpBar').className = ''; $('hpBar').style.width = Math.round(v.hp) + '%';
  } else {
    const ip = infPct();
    $('pillLbl').textContent = `ARM ${armorHp()} · INF ${Math.floor(ip)}%`;
    $('armTrk').style.visibility = 'visible'; $('armBar').style.width = (a || 0) + '%';
    $('hpBar').className = 'inf'; $('hpBar').style.width = ip + '%';
  }
  const showRegen = v.zombie && (me.regen || 0) > 0 && v.hp < MAXHP;
  $('regenB').hidden = !showRegen; $('pill').classList.toggle('rg', showRegen);
  let st;
  if (v.zombie) st = me.down > 0 ? 'DOWN' : title(Object.assign({}, me, { state:'zombie' })).toUpperCase();
  else if (me.infected) st = 'BITTEN ' + fmt(infLeft());
  else st = title(Object.assign({}, me, { state:'human' })).toUpperCase();
  $('pillState').textContent = (DBG && DBG.role ? 'TEST · ' : '') + st;
  $('pillState').style.color = v.infected ? '#fb923c' : '';
  const hd = (me.gear || {}).head, elec = !v.zombie && hd && (hd.t === 'headlamp' || hd.t === 'nvg');
  $('hgBtn').hidden = !elec;
  if (elec) {
    $('hgIc').innerHTML = svg(hd.t === 'nvg' ? 'nvg' : 'light');
    $('hgRing').style.strokeDashoffset = (125.7 * (1 - Math.max(0, Math.min(100, hd.b || 0)) / 100)).toFixed(1);
    $('hgBtn').classList.toggle('on', !!(hd.t === 'headlamp' ? me.headlamp_on : me.nvg_on));
  }
  const pl = pausedLeft();
  $('pauseBtn').classList.toggle('cd', pl <= 0 && left('pause_cd') > 0);
  $('pauseOv').hidden = pl <= 0;
  if (pl > 0) $('pauseT').textContent = fmt(pl);
}

function setRing(frac){ $('ringFg').style.strokeDashoffset = (238.8 * Math.max(0, Math.min(1, 1 - frac))).toFixed(1); }
function setDis(id, dis){
  const b = $(id); if (!b) return;
  if (prevDis[id] && !dis) { b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); }
  prevDis[id] = dis; b.disabled = dis;
}
function wingHtml(it, slot, side){
  if (!it) return `<span class="wc"><i class="diamond"></i></span>`;
  const rdy = (data.me.eq_ready && data.me.eq_ready[slot]) ? Math.max(0, data.me.eq_ready[slot] - el0()) : 0;
  const busy = wingBusy[slot] ? Math.max(0, (wingBusy[slot] - Date.now()) / 1500) : 0;
  const meta = rdy > 0 ? `EQUIP ${Math.ceil(rdy)}s` : (it.b != null ? `${Math.round(it.b)}%` : `${(CAT[it.t] && CAT[it.t].ping_r) || 0}m`);
  const cd = rdy > 0 ? rdy / 10 : busy;
  return `<span class="qty">x${usesOf(it)}</span><span class="wc">${svg(icFor(it.t))}<span class="wt"><span class="wn">${esc(short(it.t))}</span><span class="wm">${meta}</span></span></span>` +
    (cd > 0 ? `<i class="wcd" style="width:${(1 - Math.min(1, cd)) * 100}%"></i>` : '');
}
function renderControls(){
  if (!data) return;
  const v = V(), me = v.me, paused = pausedLeft() > 0, ll = lockLeft();
  const w1 = $('wing1'), w2 = $('wing2');
  if (!v.zombie) {
    const g = me.gear || {}, busy = ll > 0 || !!hold || paused;
    w2.classList.remove('hide');
    for (const [s, id, side] of [['eq1','wing1','l'],['eq2','wing2','r']]) {
      const b = $(id); b.classList.toggle('empty', !g[s]);
      b.innerHTML = wingHtml(g[s], s, side);
      setDis(id, busy && !!g[s]);
    }
    const w = weapon(), cd = cdLeft();
    const t = nearestZombie((w.range_m || 15) + 3), any = nearestZombie();
    const verb = { shove:'Shove', bat:'Swing', crowbar:'Swing', bow:'Shoot', shotgun:'Fire', rifle:'Fire', carbine:'Fire' }[w.t] || 'Attack';
    $('mainIc').innerHTML = svg(w.t === 'shove' ? 'fist' : icFor(w.t));
    $('mainBtn').classList.toggle('bare', w.t === 'shove');
    $('mainLbl').textContent = w.t === 'shove' ? 'SHOVE' : verb.toUpperCase();
    setDis('mainBtn', !t || cd > 0 || busy);
    $('mainBtn').classList.toggle('ready', !!t && cd <= 0 && !busy);
    setRing(cd > 0 ? 1 - cd / w.cd : 1);
    $('mainSub').textContent = paused ? 'Safety pause' : ll > 0 ? (me.lock_what || 'Busy') : cd > 0 ? `Reloading ${cd.toFixed(1)}s`
      : t ? `${t.handle} · ${t.dist}m${t.hp != null ? ` · ${t.hp}${t.shell ? '+' + t.shell : ''} HP` : ''}`
      : any ? `${w.t === 'shove' ? 'Bare hands' : nm(w.t)} · zombie ${any.dist}m · range ${w.range_m || 15}m`
      : `${w.t === 'shove' ? 'Bare hands' : nm(w.t)} · ${w.dmg || 0} DMG · ${w.ping_r || 15}m loud`;
  } else {
    const stun = left('stunned') > 0, down = left('down') > 0, blind = left('blinded') > 0, bl = left('bite_lock'), sl = Math.max(shriekLeft(), left('shriek_lock'));
    w1.classList.remove('empty'); w2.classList.add('hide');
    w1.innerHTML = `<span class="wc">${svg('scream')}<span class="wt"><span class="wn">Shriek</span><span class="wm">${sl > 0 ? sl.toFixed(0) + 's' : '150m CALL'}</span></span></span>` +
      (sl > 0 ? `<i class="wcd" style="width:${(1 - Math.min(1, sl / 45)) * 100}%"></i>` : '');
    setDis('wing1', stun || down || paused || sl > 0);
    const t = biteTarget();
    $('mainIc').innerHTML = svg('bite');
    if (!biting) {
      $('mainLbl').textContent = 'HOLD TO BITE';
      setDis('mainBtn', !t || stun || down || blind || bl > 0 || paused);
      $('mainBtn').classList.toggle('ready', !!t && !stun && !down && !blind && bl <= 0);
      setRing(bl > 0 ? 0 : t ? 1 : 0);
      $('mainSub').textContent = down ? 'Down' : stun ? 'Stunned' : blind ? 'Blinded' : bl > 0 ? `Bite locked ${bl.toFixed(1)}s` : paused ? 'Safety pause'
        : t ? `${t.handle} in contact · hold ${data.me.bite_time || 5}s+` : 'Get your ring onto a human pip';
    }
  }
}
function nearestZombie(maxD){
  const z = (data.others || []).filter(o => o.state === 'zombie' && (maxD == null || o.dist <= maxD)).sort((a,b) => a.dist - b.dist);
  return z.find(o => !o.stunned) || z[0] || null;
}

/* off-screen sound + event arrows along the screen edge */
function drawEdges(){
  const box = $('edge'); if (!box || !map || !data) return;
  const W = innerWidth, H = innerHeight, top = 120, bot = H - 250, lft = 20, rgt = W - 20;
  const items = [];
  (data.ripples || []).forEach(r => items.push({ lat:r.lat, lng:r.lng, c: r.kind === 'move' ? '#fca5a5' : '#fdba74', n: wavesOf(r.r) }));
  (data.hotzones || []).forEach(h => items.push({ lat:h.lat, lng:h.lng, c:'#f43f5e', n:3 }));
  (data.crates || []).forEach(d => items.push({ lat:d.lat, lng:d.lng, c:'#f59e0b', n:0 }));
  const cx = W / 2, cy = (top + bot) / 2; let html = '';
  for (const it of items.slice(0, 12)) {
    const p = map.latLngToContainerPoint([it.lat, it.lng]);
    if (p.x >= lft && p.x <= rgt && p.y >= top && p.y <= bot) continue;
    const dx = p.x - cx, dy = p.y - cy, ang = Math.atan2(dy, dx);
    const sx = dx ? ((dx > 0 ? rgt : lft) - cx) / dx : Infinity, sy = dy ? ((dy > 0 ? bot : top) - cy) / dy : Infinity;
    const s = Math.min(Math.abs(sx), Math.abs(sy));
    const x = cx + dx * s, y = cy + dy * s;
    html += `<div class="edgeA" style="left:${x}px;top:${y}px;color:${it.c}"><i></i><span style="transform:rotate(${ang * 180 / Math.PI + 90}deg);display:grid">${svg('arrow')}</span>${it.n ? `<b><span>${it.n}</span></b>` : ''}</div>`;
  }
  box.innerHTML = html;
}

/* proximity pill: being bitten, CDC purge, search area (hold 3s), smash */
function proxState(){
  if (!data || tab !== 'radar') return null;
  const v = V(), me = v.me, bb = me.being_bitten;
  if (!v.zombie && bb && bb.left - el0() > -0.5) return { cls:'red', txt:`BEING BITTEN! ${esc(bb.by)} · ${Math.max(0, bb.left - el0()).toFixed(1)}s`, ic:'bite' };
  if (pausedLeft() > 0) return null;
  if (!v.zombie) {
    if (me.in_cdc) return { cls:'cyan', txt:'PURGING INFECTION… −3%/MIN', ic:'cdc' };
    let best = null;
    (data.caches || []).forEach(c => { if (c.dist <= 22 && !(c.cooldown > 0) && !(c.destroyed > 0) && (!best || c.dist < best.d)) best = { d:c.dist, ref:c.id, kind:'cache' }; });
    (data.crates || []).forEach(c => { if (c.dist <= 22 && c.lands <= 0 && !c.looted && (!best || c.dist < best.d)) best = { d:c.dist, ref:c.id, kind:'crate' }; });
    (data.bags || []).forEach(b => { if (b.dist <= 32 && (!best || b.dist < best.d)) best = { d:b.dist, ref:'b:' + b.id, kind:'bag', bag:b.id }; });
    if (best) return { cls:'', txt: hold ? 'SEARCHING…' : 'SEARCH AREA · HOLD 3s', ic:'crate', act:'search', t:best };
    if (me.in_rad) return { cls:'amber', txt:'RADIATION · INFECTION RISING', ic:'rad' };
  } else {
    let best = null;
    (data.caches || []).forEach(c => { if (c.dist <= 32 && !(c.destroyed > 0) && (!best || c.dist < best.d)) best = { d:c.dist, ref:c.id, name:'stockpile' }; });
    (data.bags || []).forEach(b => { if (b.dist <= 32 && (!best || b.dist < best.d)) best = { d:b.dist, ref:'b:' + b.id, name:'loot bag' }; });
    (data.bunkers || []).forEach(b => { if (b.dist <= 32 && (!best || b.dist < best.d)) best = { d:b.dist, key:b.key, name:'bunker' }; });
    if (best) return { cls:'', txt:`SMASH ${best.name.toUpperCase()}`, ic:'smash', act:'smash', t:best };
  }
  return null;
}
let proxCur = null;
function drawProx(){
  const s = proxState(); proxCur = s; const p = $('prox');
  p.hidden = !s; if (!s) return;
  p.className = s.cls; p.innerHTML = `${svg(s.ic)}<span>${s.txt}</span>`;
  if (s.cls === 'red' && Date.now() - biteVib > 900) { biteVib = Date.now(); navigator.vibrate && navigator.vibrate([90,60,90,60,90]); }
}
function setupProx(){
  const p = $('prox');
  p.addEventListener('pointerdown', async e => {
    const s = proxCur; if (!s || !s.act) return;
    e.preventDefault();
    if (s.act === 'smash') { SFX.play('smash'); if (s.t.key) smashBunker(s.t.key); else smash(s.t.ref); return; }
    if (hold) return;
    try { p.setPointerCapture(e.pointerId); } catch(_){}
    const ref = s.t.ref, bag = s.t.bag;
    hold = { ref, bag, t0: Date.now(), secs: 3, what:'Searching area' };
    SFX.play('search');
    try {
      const r = await rpc('zr_chan', A({ p_action:'start', p_kind:'search', p_ref: ref }));
      if (r.error) { toast(errMsg(r)); hold = null; return; }
    } catch(_) { toast('Network error.'); hold = null; return; }
  });
  const up = () => { if (hold && Date.now() - hold.t0 < 2900) { hold = null; rpc('zr_chan', A({ p_action:'cancel' })).catch(() => {}); toast('Search cancelled. Hold for 3 seconds.'); } };
  p.addEventListener('pointerup', up); p.addEventListener('pointercancel', up);
}
async function finishSearch(){
  const h = hold; hold = null;
  try {
    if (h.bag) {
      const r = await rpc('zr_take_bag', A({ p_bag: h.bag }));
      if (r.error) { toast(errMsg(r)); return; }
      showLoot(r.items, 'Bag searched', r.left ? `${r.left} item${r.left > 1 ? 's' : ''} didn't fit and stayed in the bag` : '');
    } else {
      const r = await rpc('zr_loot', A({ p_cache: h.ref }));
      if (r.error) { toast(errMsg(r)); return; }
      showLoot(r.items, h.ref.startsWith('d:') ? 'Supply crate raided' : 'Area searched', '+30 supplies');
    }
    heartbeat();
  } catch(_) { toast('Network error.'); }
}

/* long-duration action HUD */
function drawAct(){
  const me = data.me; let what = null, lft = 0, tot = 1, cancel = false;
  if (hold) { lft = Math.max(0, hold.secs - (Date.now() - hold.t0) / 1000); tot = hold.secs; what = hold.what; cancel = true; if (lft <= 0 && !finishing) { finishing = true; finishSearch().finally(() => { finishing = false; }); } }
  else if (me.chan && me.chan.kind === 'antidote') {
    lft = Math.max(0, me.chan.left - el0()); tot = me.chan.secs; what = 'Injecting Lazarus-X'; cancel = true;
    if (lft <= 0 && !finishing) { finishing = true; finishAntidote().finally(() => { finishing = false; }); }
  } else if (lockLeft() > 0 && me.lock_what) { lft = lockLeft(); tot = Math.max(lockTotal || 0, lft, /Equipping/.test(me.lock_what) ? 10 : lft); what = me.lock_what; }
  $('act').hidden = !what || tab !== 'radar';
  if (!what) return;
  $('actSec').textContent = lft.toFixed(lft < 10 ? 1 : 0); $('actLbl').textContent = what;
  $('actFg').style.strokeDashoffset = (326.7 * (lft / Math.max(0.01, tot))).toFixed(1);
  $('actX').hidden = !cancel;
}
async function cancelAction(){ hold = null; try { await rpc('zr_chan', A({ p_action:'cancel' })); } catch(_){} heartbeat(); }
async function finishAntidote(){
  try { const r = await rpc('zr_chan', A({ p_action:'finish' }));
    if (r.error) toast(errMsg(r)); else { SFX.play('antidote'); toast(r.self ? 'Lazarus-X: your infection is reset to 0%.' : 'Lazarus-X worked: they\'re human again. +10'); }
    heartbeat(); } catch(_) { toast('Network error.'); }
}

function tickLocal(){
  if (!data) return;
  updateHeader(); renderControls(); drawProx(); drawAct();
  $('blindOv').hidden = !(Z() && left('blinded') > 0);
  if (Z() && data.me.down > 0) $('downTxt').textContent = `A survivor took you out. You rise again in ${fmt(left('down'))}.`;
  banners();
  if (tab === 'gear' && invTab === 'bunker' && data.me.bunker && data.me.bunker.ready > 0) drawInv();
}

/* ---------- banners ---------- */
const bannerState = {};
function banner(key, text, cls){ bannerState[key] = { text, cls, t: Date.now() }; drawBanners(); }
function dataBanner(){
  const v = V(), me = v.me, el = el0();
  const hz = (data.hotzones || []).filter(h => h.left - el > 0);
  const mine = hz.find(h => h.mine), near = hz.filter(h => !h.mine).sort((a,b) => a.dist - b.dist)[0];
  const bk = me.bunker, bkLeft = bk ? Math.max(0, bk.ready - el) : 0;
  const crate = (data.crates || []).filter(d => d.lands - el > 0).sort((a,b) => a.dist - b.dist)[0];
  if (!v.zombie && me.infected) return { tag:'BITTEN', cls:'red', p: infLeft() / 300, txt:`Turning in ${fmt(infLeft())}${me.inf_rate === 0 ? ' (paused while moving)' : me.inf_rate === 0.5 ? ' (slowed)' : ''}. Find Military Antivirus.` };
  if (!v.zombie && infPct() >= 85) return { tag:'INFECTION', cls:'red', p: infPct() / 100, txt:`Infection at ${Math.floor(infPct())}%. At 100% you turn. Take Antiviral Pills.` };
  if (v.zombie && mine) return { tag:'SHRIEK', cls:'', p:(mine.left - el) / 120, txt:`Horde called: ${fmt(mine.left - el)} left` };
  if (v.zombie && near) return { tag:'HORDE', cls:'', p:(near.left - el) / 120, txt:`${near.handle} is calling the horde ~${near.dist}m away` };
  if (!v.zombie && bk && bkLeft > 0) return { tag:'BUNKER', cls:'amber', p: 1 - bkLeft / 600, txt:`Bunker build: ${fmt(bkLeft)} remaining` };
  if (crate) return { tag:'SUPPLY', cls:'amber', p: 1 - (crate.lands - el) / 600, txt:`Supply crate lands in ${fmt(crate.lands - el)} · ${crate.dist}m` };
  if (v.zombie && (me.regen || 0) > 0 && v.hp < MAXHP) return { tag:'REGEN', cls:'', txt:'Nocturnal regeneration active (+1%/min)' };
  return null;
}
function banners(){
  if (!data) return;
  const v = V(), me = v.me, z = v.zombie, db = dataBanner();
  $('dataBan').hidden = !db;
  if (db) {
    $('dataBan').className = 'surf ' + (db.cls || '');
    $('dbTag').textContent = db.tag; $('dbTxt').textContent = db.txt;
    $('dbTrk').hidden = db.p == null; if (db.p != null) $('dbBar').style.width = Math.max(0, Math.min(1, db.p)) * 100 + '%';
  }
  $('banners').classList.toggle('up', !db);
  const set = (k, cond, text, cls) => { if (cond) bannerState[k] = { text, cls, persist:true }; else delete bannerState[k]; };
  set('close', !z && (data.others || []).some(o => o.close), 'Zombie in contact range!', 'red');
  set('emp', !z && me.in_emp, me.emp_nvg ? 'EMP fog: your night vision sees through it.' : 'EMP fog: radar cut to 25% and the contact alarm is jammed.', 'blue');
  set('shadow', z && me.in_shadow, 'In a Shadow Alley: invisible to human radar.', 'red');
  set('stun', z && left('stunned') > 0, `Stunned: no bite or shriek for ${fmt(left('stunned'))}.`, 'green');
  set('dis', !z && left('disguised') > 0, `Scent-blocked: zombies see you as one of them (${fmt(left('disguised'))}).`, 'blue');
  set('boost', !z && left('boost') > 0, `Flashlight on: radar doubled (${fmt(left('boost'))}).`, 'blue');
  set('shel', me.sheltered, "You're in your Home Stealth Zone: hidden from everyone.", 'blue');
  set('sup', !z && me.supplies <= 0, "Out of supplies: you can't use items until you search an area.", 'red');
  set('gpsw', fix && fix.acc > 35, 'Weak GPS. Step outside for fights and searching to work.', '');
  if (bannerState.net && Date.now() - bannerState.net.t > 6000) delete bannerState.net;
  drawBanners();
}
function drawBanners(){
  const keys = Object.keys(bannerState).slice(0, 2);
  $('banners').innerHTML = keys.map(k => `<div class="banner ${bannerState[k].cls || ''}">${esc(bannerState[k].text)}</div>`).join('');
}

/* ---------- toasts / alarm / modal / points ---------- */
let toastT;
function toast(msg){ const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3400); }
let alarmT;
function alarm(msg, ms){ $('alarmText').textContent = msg; $('alarm').hidden = false; navigator.vibrate && navigator.vibrate([250,100,250,100,250]);
  clearTimeout(alarmT); alarmT = setTimeout(() => { $('alarm').hidden = true; }, ms || 4500); }
function modal(h, p, btn){
  $('modalBody').innerHTML = `<h2>${esc(h)}</h2><p>${esc(p)}</p><button class="btn" id="mOk">${esc(btn || 'OK')}</button>`;
  $('modal').hidden = false; $('mOk').onclick = () => { $('modal').hidden = true; };
}
function points(line, pts){
  const d = document.createElement('div'); d.className = 'pt';
  d.innerHTML = `<div>${esc(line)}</div><b>+${pts}</b>`;
  $('pts').appendChild(d); setTimeout(() => d.remove(), 2500);
}
function shock(radius, color){
  if (!radius || !fix || !fxLayer) return;
  const c = L.circle([fix.lat, fix.lng], { radius: 1, color: color || '#f59e0b', weight: 2.5, fill:false, opacity:.9, interactive:false }).addTo(fxLayer);
  const t0 = performance.now(), dur = 1400;
  const step = now => { const p = Math.min(1, (now - t0) / dur);
    c.setRadius(Math.max(1, radius * (1 - Math.pow(1 - p, 3)))); c.setStyle({ opacity: .9 * (1 - p) });
    if (p < 1) requestAnimationFrame(step); else fxLayer.removeLayer(c); };
  requestAnimationFrame(step);
}

/* ---------- events ---------- */
function handleEvents(evs){
  for (const e of evs) {
    if (seenEvents.has(e.id)) continue;
    seenEvents.add(e.id);
    const o = e.other || 'someone', i = e.info || {};
    switch (e.kind) {
      case 'bite_warning': if (!e.mine) navigator.vibrate && navigator.vibrate([200,80,200]); break;
      case 'bitten':
        if (e.mine) points(`You infected ${o}`, (i.pts || 300));
        else { modal('Bitten', `${o} bit you. You turn in 5 minutes unless you take Military Antivirus. Pills, cryo cases and EpiPens buy time.`, 'Find a cure'); }
        break;
      case 'interrupted': if (!e.mine) toast(`${o} shoved you: bite locked for ${i.secs}s.`); break;
      case 'cured': if (e.mine && e.other !== data.me.handle) points(`You cured ${o}`, 10); else if (!e.mine) toast(`${o} cured you.`); break;
      case 'hit': if (!e.mine) toast(`${o} hit you for ${i.dmg}. HP ${i.hp}${i.broke && i.broke.length ? ' · your ' + i.broke.map(nm).join(' & ') + ' broke' : ''}`); break;
      case 'killed': if (e.mine) points(`You killed ${o}`, i.pts || 300); break;
      case 'stunned': if (e.mine && i.secs >= 180) points(`You stunned ${o}`, 2); else if (!e.mine) toast(`${o} stunned you for ${i.secs >= 60 ? Math.round(i.secs / 60) + ' min' : i.secs + 's'}.`); break;
      case 'blinded': if (!e.mine) toast('Bear spray! Bite and shriek locked for 5 seconds.'); break;
      case 'mine_boom': toast(`Your claymore went off on ${o}!`); if (i.killed) points(`Your claymore killed ${o}`, 300); break;
      case 'flare_cross': toast('A zombie crossed your road flare!'); navigator.vibrate && navigator.vibrate(200); break;
      case 'scream_near': if (!e.mine) alarm(`Zombie shriek ~${i.dist || '?'} m away. The horde is coming!`, 3500); break;
      case 'bloodline': if (!e.mine) points(`Bloodline: ${i.via} infected ${o}`, 5); break;
      case 'lost_victim': if (!e.mine) toast(`${o} was cured.`); break;
      case 'bunker_hit': if (!e.mine) { toast(`Your bunker is under attack! ${i.hp} HP left.`); navigator.vibrate && navigator.vibrate([150,80,150]); } break;
      case 'bunker_destroyed': if (e.mine) points('You destroyed a bunker', 50); else modal('Bunker destroyed', `${o} tore down your bunker. Everything stashed in it is gone. Build a new one from the Gear tab.`, 'OK'); break;
      case 'meter_turned': modal('Infection took over', 'Your infection meter hit 100% and you turned. Only a Lazarus-X Antidote can bring you back.', 'Hunt'); break;
      case 'new_round': modal(i.wipe ? 'New season' : 'New round', i.wipe ? 'The season ended: your points became XP and all gear and bunkers were wiped. Everyone starts human again.'
        : 'A new 7-day round began. Your points became XP, your carried gear moved into your bunker, and everyone is human again. Bunkers unlock in 6 hours.', 'Go'); break;
    }
  }
}

/* ---------- human actions ---------- */
const ERR = {
  no_supplies:'Out of supplies. Search an area first.', not_infected:"Nobody here needs that.", too_far:'Get closer first.', zombies_cant:"Zombies can't do that.",
  weak_gps:'GPS too weak. Step outside.', target_gps:'Their GPS is too weak right now.', stunned:"You're stunned.", blinded:"You can't see!", down:"You're down.",
  not_target:"That player can't be attacked.", sheltered:"They're in their home zone.", group:"They're in a group of 3+. Bites don't work.",
  cooldown:'Still on cooldown.', destroyed:'Zombies wrecked this stockpile.', too_soon:'Keep holding.', expired:'Too slow. Try again.', no_bite:'Your bite was stopped!',
  not_zombie:'Only zombies can do that.', bad_cache:"That's gone.", battery:'Battery too low. Use batteries or a power bank.', empty:'Nothing in that slot.',
  equipping:'Still equipping.', no_target:'No zombie in contact.', out_of_range:'Out of range.', nothing_to_repair:'Your armor is already in full shape.',
  nothing_to_charge:'Nothing equipped needs charging.', need_pin:'Pick a spot on the map.', pin_too_far:'That spot is more than 200 m away.',
  cant_use:"That can't be used from a quick slot.", pack_full:'Your backpack is full.', too_full:'Too many items for that bag.', bad_index:'Try again.',
  cant_equip:"Can't equip that.", busy:"You're busy with another action.", paused:"You're on safety pause.", paused_t:"They're on safety pause.",
  too_close:"Too close in real life. Back off to at least 25 m.", locked:'Locked out for a moment.', need_antidote:'Zombies need a Lazarus-X Antidote.',
  search_first:'Hold Search for 3 seconds first.', no_sc:'Not enough SC.', near_home:'Too close to your Home Stealth Zone. Build at least 400 m away.',
  not_near:'Go to your bunker first.', bunker_locked:'Bunkers are locked for the first 6 hours of a round.', bunker_full:'Your bunker is full (50 items).',
  full_hp:'Your bunker is already at full HP.', own_bunker:"That's your own bunker.", building:'Your bunker is still being built.', no_bunker:"You don't have a bunker.",
  infected:"You can't build while bitten.", have_bunker:'You already have a bunker.', removed:'That attack no longer exists.', no_channel:'Nothing to finish.'
};
const errMsg = r => (r.error === 'busy' && r.what) ? `Busy: ${r.what}` : (ERR[r.error] || r.error);

async function attack(){
  if (!data) return;
  const w = weapon(); const t = nearestZombie((w.range_m || 15) + 3);
  if (!t) return;
  SFX.play(w.t, 'primary');
  try {
    const r = await rpc('zr_attack', A({ p_target: t.id }));
    if (r.error) { toast(errMsg(r) + (r.error === 'out_of_range' ? ` Range ${r.range} m.` : '')); return; }
    localCdUntil = Date.now() + r.cd * 1000;
    shock(w.ping_r || 15, '#f59e0b');
    const h = r.hits || [];
    if (r.weapon === 'shove') toast(`Shoved ${t.handle}! Their bite is locked for 3s. Break contact!`);
    else toast(h.map(x => x.killed ? `${x.handle} down!` : `${x.handle}: ${x.hp} HP${x.shell ? ' + ' + x.shell : ''}${x.locked ? ` · bite locked ${x.locked}s` : ''}${x.stunned ? ' · stunned' : ''}`).join(' · ') || 'Missed.');
    navigator.vibrate && navigator.vibrate(60);
    heartbeat();
  } catch(e){ toast('Network error.'); }
}
async function useSlot(slot){
  if (!data) return;
  const it = data.me.gear && data.me.gear[slot];
  if (!it) { setTab('gear'); invTab = 'pack'; drawInv(); toast(`Tap an item and choose Equip to fill Item ${slot === 'eq1' ? 1 : 2}.`); return; }
  let extra = {};
  if (it.t === 'antidote') {
    const c = (data.others || []).filter(o => (o.state === 'zombie' || o.state === 'infected') && o.dist <= 20).sort((a,b) => a.dist - b.dist)[0];
    const self = !c && (infPct() > 0 || data.me.infected);
    if (!c && !self) { toast('Lazarus-X: get in contact with a zombie or infected player.'); return; }
    if (!confirm(c ? `Inject ${c.handle} with Lazarus-X? It takes 60 seconds and you must stay in contact.` : 'Inject yourself with Lazarus-X? 60 seconds; resets your infection to 0%.')) return;
    try { const r = await rpc('zr_chan', A({ p_action:'start', p_kind:'antidote', p_ref: c ? c.id : null, p_slot: slot }));
      if (r.error) { toast(errMsg(r)); return; } SFX.play('antidote'); heartbeat(); } catch(_) { toast('Network error.'); }
    return;
  }
  if (it.t === 'antiviral' && !data.me.infected) {
    const c = (data.others || []).filter(o => o.state === 'infected' && o.dist <= 20).sort((a,b) => a.dist - b.dist)[0];
    if (!c) { toast('Military Antivirus: cures a bite. Get in contact with an infected player, or save it for yourself.'); return; }
    extra.p_target = c.id;
  }
  if (it.t === 'drone') { toast('Tap the map where to send the drone (within 200 m).'); pinMode = async ll => { await doUse(slot, { p_lat: ll.lat, p_lng: ll.lng }); }; return; }
  if (it.t === 'claymore' && !confirm('Plant a claymore here? It hits the first zombie within 33 ft, and the blast is heard 400 m away.')) return;
  await doUse(slot, extra);
}
async function doUse(slot, extra){
  const it = data.me.gear && data.me.gear[slot];
  if (it) SFX.play(it.t, 'secondary');
  try {
    const r = await rpc('zr_use', A(Object.assign({ p_slot: slot }, extra)));
    if (r.error) { toast(r.error === 'equipping' ? `Still equipping: ${r.left}s` : errMsg(r)); return; }
    wingBusy[slot] = Date.now() + 1500;
    if (it && CAT[it.t] && it.t !== 'claymore') shock(CAT[it.t].ping_r, '#38bdf8');
    const msg = { boost:'Flashlight on: radar doubled for 3 min.', radio:'Radio scan: zombies within 150 m revealed for 15s.',
      stunned:`Zapped ${r.handle}: stunned for 6 min.`, cryo:'Cryo case on: bite countdown slowed by half for 5 min.',
      repaired:`Patched up your ${r.slot === 'head' ? 'helmet' : 'armor'} (+35).`, charged:'Battery topped up (+50%).',
      sprayed: r.blinded ? `Bear spray! ${r.blinded} zombie${r.blinded > 1 ? 's' : ''} locked out for 5s.` : 'Bear spray. Any bite on you is reset.',
      flare:'Road flare dropped: zombies near it show up for 10 min.', epi:'EpiPen: bite countdown frozen while you keep moving (3 min).',
      pills:'Suppressant Pills: +5 minutes on your bite countdown.', meter:`Antiviral Pills: infection down to ${Math.floor(r.pct)}%.`,
      cured: r.self ? 'Military Antivirus: bite cured!' : 'Military Antivirus: they\'re cured! +10',
      disguised:'Scent-blocker: zombies see you as a zombie for 3 min.', mine:'Claymore planted.', drone:'Drone out: zombies near that spot revealed for 2 min.' }[r.result] || 'Done.';
    toast(msg); heartbeat();
  } catch(e){ toast('Network error.'); }
}
async function toggleLight(){
  try { const r = await rpc('zr_toggle', A()); SFX.play('maglite'); if (r.error) toast(errMsg(r)); else { toast(r.result === 'on' ? 'Light on: you see further, but you\'re easier to spot.' : 'Light off.'); heartbeat(); } }
  catch(e){ toast('Network error.'); }
}
async function togglePause(){
  if (!data) return;
  const on = pausedLeft() <= 0;
  if (on && left('pause_cd') > 0) { toast(`Safety pause is available again in ${fmt(left('pause_cd'))}.`); return; }
  if (on && !confirm('Safety pause for up to 5 minutes? You\'ll be hidden and can\'t act or be attacked. Use it to cross a road or handle something real.')) return;
  try { const r = await rpc('zr_pause', A({ p_on: on })); if (r.error) toast(errMsg(r)); else toast(on ? 'Safety pause on.' : 'Back in the game.'); heartbeat(); }
  catch(_) { toast('Network error.'); }
}
function tapCache(c){
  const name = c.sponsored ? `${c.name} stockpile` : { military:'Military', hunting:'Hunting', common:'Supply' }[c.tier] + ' loot zone';
  if (c.destroyed > 0) toast(`Wrecked by zombies. Back in ${Math.ceil(c.destroyed / 60)} min.`);
  else if (!Z() && c.cooldown > 0) toast(`You searched here. Restocks for you in ${Math.ceil(c.cooldown / 60)} min.`);
  else toast(`${name}, ${Math.round(c.dist)} m away. ${Z() ? 'Get close to smash it.' : 'Stand inside the circle and hold Search.'}`);
}
function tapBag(b){ toast(`A dropped bag with ${b.n} item${b.n > 1 ? 's' : ''}, ${b.dist} m away.${Z() ? '' : ' Stand on it and hold Search.'}`); }
function showLoot(items, head, note){
  const where = { weapon:'equipped as weapon', head:'put on', armor:'put on', eq1:'in Item 1', eq2:'in Item 2', bag:'now your backpack', pack:'in backpack', ground:"no room: left on the ground" };
  openSheet(head, `<div class="sh-sec">${(items || []).map(i => `<p class="r-${rar(i.t)}"><b class="rarc">${esc(nm(i.t))}</b> · ${where[i.where] || i.where}</p>`).join('') || '<p>Empty.</p>'}
    ${note ? `<p>${esc(note)}</p>` : ''}</div><button class="btn" id="lootOk">Got it</button><button class="btn ghost" id="lootGear">Open gear</button>`);
  $('lootOk').onclick = closeSheet; $('lootGear').onclick = () => { closeSheet(); setTab('gear'); };
}
function tapPlayer(o){
  const st = o.state === 'zombie' ? 'Zombie' : o.state === 'infected' ? 'Infected' : 'Human';
  openSheet(o.handle, `<div class="sh-sec"><p><b style="color:var(--tx)">${st}${o.npc ? ' · NPC' : ''}${o.offline ? ' · offline' : ''}</b> · ${esc(title(o))} · ${o.dist} m on radar<br>
      ${o.state === 'zombie' ? `${o.infections} infections${o.hp != null ? ` · ${o.hp} HP${o.shell ? ' + ' + o.shell + ' armor' : ''}` : ''}` : o.cures + ' cures'}</p>
      <p>Radar pins are offset 50–100 m from where people really are.</p></div>
    ${o.npc ? '' : `<div class="menu-grid"><button class="btn ghost" id="pBlock">Block</button><button class="btn ghost" id="pReport">Report</button></div>`}`);
  if (!o.npc) { $('pBlock').onclick = () => blockPlayer(o, null); $('pReport').onclick = () => { const why = prompt('What happened? (optional)'); blockPlayer(o, why || 'reported'); }; }
}
async function blockPlayer(o, report){
  try { await rpc('zr_block', A({ p_target: o.id, p_report: report })); closeSheet(); toast(report ? `Reported and blocked ${o.handle}.` : `Blocked ${o.handle}. You won't see each other.`); heartbeat(); }
  catch(e){ toast('Network error.'); }
}

/* ---------- zombie actions ---------- */
let biting = false, biteRaf = null, biteStart = 0, biteOk = false, biteHold = 5;
function biteTarget(){
  if (!data) return null;
  return (data.others || []).filter(o => o.state === 'human' && !o.infected && o.dist <= 20).sort((a,b) => a.dist - b.dist)[0] || null;
}
async function shriek(){
  if (shriekLeft() > 0) { toast(`Shriek ready in ${Math.ceil(shriekLeft())}s.`); return; }
  SFX.play('shriek');
  try {
    const r = await rpc('zr_scream', A());
    if (r.error) { toast(r.error === 'cooldown' ? `Shriek ready in ${r.left}s.` : errMsg(r)); return; }
    localShriekAt = Date.now(); shock(150, '#f43f5e');
    toast('HORDE SHRIEK! Every zombie nearby sees your sector for 2 minutes.');
    navigator.vibrate && navigator.vibrate([60,40,140]); heartbeat();
  } catch(e){ toast('Network error.'); }
}
async function smash(ref){
  try { const r = await rpc('zr_smash', A({ p_ref: ref }));
    if (r.error) { toast(errMsg(r)); return; }
    points(`You smashed ${r.items} item${r.items > 1 ? 's' : ''}`, r.points); navigator.vibrate && navigator.vibrate(80); heartbeat(); }
  catch(e){ toast('Network error.'); }
}
async function smashBunker(key){
  try { const r = await rpc('zr_smash_bunker', A({ p_key: key }));
    if (r.error) { if (r.error !== 'cooldown') toast(errMsg(r)); return; }
    if (r.result === 'destroyed') points('You destroyed a bunker', 50); else toast(`Bunker hit: ${r.hp} HP left. Keep smashing.`);
    navigator.vibrate && navigator.vibrate(60); heartbeat(); }
  catch(e){ toast('Network error.'); }
}
function setupBite(){
  const btn = $('mainBtn');
  const end = done => { biting = false; cancelAnimationFrame(biteRaf); if (!done && biteOk) toast(`Bite cancelled. Hold for ${biteHold}s.`); biteOk = false; renderControls(); };
  btn.addEventListener('pointerdown', async e => {
    if (!Z()) return;
    e.preventDefault();
    if (btn.disabled || biting) return;
    const t = biteTarget(); if (!t) return;
    biting = true; biteOk = false; biteStart = Date.now(); biteHold = 5;
    $('mainLbl').textContent = 'BITING'; $('mainSub').textContent = t.handle;
    SFX.play('bite');
    try { btn.setPointerCapture(e.pointerId); } catch(_){}
    const anim = () => { const p = Math.min(1, (Date.now() - biteStart) / (biteHold * 1000)); setRing(p); if (p >= 1) { finish(); return; } biteRaf = requestAnimationFrame(anim); };
    setRing(0); biteRaf = requestAnimationFrame(anim);
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
    try { const r = await rpc('zr_bite_finish', A()); if (r.error) toast(errMsg(r)); else { SFX.play('bite'); toast(`You bit ${r.handle}. They turn in 5 minutes unless cured.`); } }
    catch(_) { toast('Network error.'); }
    end(true); heartbeat();
  };
  ['pointerup','pointercancel','pointerleave'].forEach(ev => btn.addEventListener(ev, () => { if (biting && Date.now() - biteStart < biteHold * 1000) end(false); }));
  btn.addEventListener('contextmenu', e => e.preventDefault());
}

/* ---------- debug strip (?debug): local view only ---------- */
function setupDebug(){
  const el = $('dbg'); el.hidden = false;
  const seg = (k, opts) => `<div class="seg" data-k="${k}">${opts.map(([v,l]) => `<button data-v="${v}">${l}</button>`).join('')}</div>`;
  el.innerHTML = `<div class="t"><span>TEST VIEW · ONLY ON THIS PHONE</span><button id="dbgReset" style="color:var(--mut);font-size:8.5px">RESET</button></div>` +
    seg('role', [['human','HUMAN'],['zombie','ZOMBIE']]) + seg('night', [['0','DAY'],['1','NIGHT']]);
  const paint = () => { if (!data) return; const v = V(); const cur = { role: v.zombie ? 'zombie' : 'human', night: v.night ? '1' : '0' };
    el.querySelectorAll('.seg').forEach(s => s.querySelectorAll('button').forEach(b => b.classList.toggle('on', cur[s.dataset.k] === b.dataset.v))); };
  el.querySelectorAll('.seg button').forEach(b => b.onclick = () => { const k = b.parentNode.dataset.k; DBG[k] = k === 'role' ? b.dataset.v : b.dataset.v === '1'; render(); paint(); });
  $('dbgReset').onclick = () => { DBG.role = DBG.night = null; render(); paint(); };
  setInterval(paint, 1000);
}

/* ---------- avatar ---------- */
function avatar(z, f){
  const fill = z ? '#3b1018' : '#2a332e', s = z ? '#9f1239' : '#64748b', p = z ? '#4c1122' : '#27312c';
  const torso = f ? 'M112 118C122 110 136 108 150 108C164 108 178 110 188 118L204 146L210 202L206 256L194 262L190 250L193 202L186 158L180 156L188 244L112 244L120 156L114 158L107 202L110 250L106 262L94 256L90 202L96 146Z'
                  : 'M106 116C116 108 132 106 150 106C168 106 184 108 194 116L212 146L218 202L214 256L202 262L198 250L201 202L193 156L186 152L183 244L117 244L114 152L107 156L99 202L102 250L98 262L86 256L82 202L88 146Z';
  return `<svg class="av" viewBox="0 0 300 500" fill="none">
    <circle cx="150" cy="225" r="126" stroke="${z ? '#3a0f18' : '#242e29'}" stroke-dasharray="3 6"/><circle cx="150" cy="225" r="88" stroke="${z ? '#2c0b12' : '#1e2722'}"/>
    <circle cx="150" cy="68" r="24" fill="${fill}" stroke="${s}" stroke-width="1.5"/>${f ? `<path d="M168 52c14 6 16 30 8 44" stroke="${s}" stroke-width="5" stroke-linecap="round"/>` : ''}
    <rect x="141" y="90" width="18" height="18" rx="4" fill="${fill}"/>
    <path d="${torso}" fill="${fill}" stroke="${s}" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M121 122L179 122L176 196L124 196Z" fill="${p}" stroke="${s}" stroke-width="1.1"/>
    <rect x="115" y="236" width="70" height="12" rx="3" fill="${p}" stroke="${s}" stroke-width="1.2"/>
    <path d="M117 248L183 248L188 338L182 436L191 452L162 452L160 434L156 342L150 282L144 342L140 434L138 452L109 452L118 436L112 338Z" fill="${fill}" stroke="${s}" stroke-width="1.5" stroke-linejoin="round"/>
    ${z ? '<path d="M138 62l6 6M162 62l-6 6M140 80q10-6 20 0" stroke="#f43f5e" stroke-width="2" stroke-linecap="round"/>' : ''}
  </svg>`;
}

/* ---------- gear tab: Gear / Pack / Bunker ---------- */
let invTab = 'gear', dragging = null, bkPage = 0;
const bunkerOpen = () => { const b = data && data.me.bunker; return !!(b && b.near && b.ready <= 0 && b.lock <= 0); };
function openInv(t){ setTab('gear'); invTab = t || 'gear'; drawInv(); }
function closeInv(){ setTab('radar'); }
function invItem(where){
  const me = data.me;
  if (where === 'bag') return me.bag && me.bag !== 'none' ? { t: me.bag } : null;
  if (where === 'z_head') return me.z_head; if (where === 'z_armor') return me.z_armor;
  return (me.gear || {})[where] || null;
}
function slotMeta(it, key){
  const c = CAT[it.t] || {};
  if (key === 'bag') return `<span class="m">${c.cap || data.me.cap} SLOTS</span>`;
  if (c.slot === 'weapon') return `<span class="m">${c.dmg} DMG · ${c.cd}s</span>`;
  if (c.kind === 'head' || c.kind === 'armor') return `<span class="m">${Math.max(0, it.d || 0)}/${key.startsWith('z_') ? (c.carry_hp || c.dur) : c.dur}</span>${durBar(key.startsWith('z_') ? { t: it.t, d: it.d } : it)}`;
  return `<span class="m">${it.b != null ? Math.round(it.b) + '%' : (c.ping_r || 0) + 'm'}</span>${durBar(it)}`;
}
const SLOT_IC = { head:'helm', armor:'vest', weapon:'fist', bag:'bag', eq1:'target', eq2:'target', z_head:'helm', z_armor:'vest' };
function gslot(key, label, tall){
  const it = invItem(key), me = data.me;
  const rdy = (key === 'eq1' || key === 'eq2') && me.eq_ready && me.eq_ready[key] ? Math.max(0, me.eq_ready[key] - el0()) : 0;
  const empty = key === 'weapon' ? 'Bare hands' : key === 'bag' ? 'Pockets · 2' : 'Empty';
  return `<button class="gslot ${tall ? 'tall' : ''} ${it ? 'rs r-' + rar(it.t) : 'empty'}" data-slot="${key}">
    <span class="k">${label}</span>${it ? svg(icFor(it.t)) : svg(SLOT_IC[key], 'ghostic')}
    <span><span class="n">${it ? esc(nm(it.t)) : empty}</span>${it ? (rdy > 0 ? `<span class="m">EQUIPPING ${Math.ceil(rdy)}s</span>` : slotMeta(it, key)) : ''}</span>
    ${it && (key === 'eq1' || key === 'eq2') ? `<span class="qb">x${usesOf(it)}</span>` : ''}</button>`;
}
function drawInv(){
  if (!data || $('inv').hidden) return;
  const v = V(), me = v.me, z = v.zombie;
  if (z && invTab !== 'gear') invTab = 'gear';
  $('invTitle').textContent = z ? 'INHERITED ARMOR' : { gear:'GEAR LOADOUT', pack:'BACKPACK', bunker:'BUNKER' }[invTab];
  $('invSub').textContent = z ? 'ZOMBIES CARRY NOTHING' : me.bunker ? (me.bunker.near ? '● AT YOUR BUNKER' : `● BUNKER ${me.bunker.dist}m AWAY`) : '● NO BUNKER';
  $('invSc').hidden = z; $('invScV').textContent = (me.sc || 0).toLocaleString() + ' SC';
  $('invTabs').hidden = z; $('invZ').hidden = !z;
  $('invTabs').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === invTab));
  $('tabBunker').classList.toggle('off', !!me.bunker && !bunkerOpen());
  const body = $('invBody');
  if (z) {
    const traits = [];
    if (me.z_armor && me.z_armor.t === 'tracksuit') traits.push('Silent sprint');
    if (me.z_armor && me.z_armor.t === 'ghillie') traits.push('Radar stealth');
    body.innerHTML = `<div class="sumrow"><div class="sumb surf">${svg('vest')}<div><div class="k">Total HP</div><div class="v">${Math.round(v.hp) + (me.shell || 0)}</div></div></div>
      <div class="sumb surf">${svg('shield')}<div><div class="k">Armor</div><div class="v">${me.shell || 0}</div></div></div>
      <div class="sumb surf">${svg('w1')}<div><div class="k">Traits</div><div class="v">${traits.length}</div></div></div></div>
      <div id="doll">${avatar(true)}<div class="gcol l">${gslot('z_head','Helmet')}<div style="flex:1"></div></div><div class="gcol r">${gslot('z_armor','Armor')}<div style="flex:1"></div></div></div>
      ${traits.length ? `<div class="traits">${traits.map(t => `<span>${t}</span>`).join('')}</div>` : ''}`;
    $('invFoot').textContent = 'Zombies keep the helmet and armor they wore as a human. It soaks damage until it breaks.';
    body.querySelectorAll('.gslot').forEach(b => b.onclick = () => { const it = invItem(b.dataset.slot); if (it) inspect({ where: b.dataset.slot }); });
    return;
  }
  if (invTab === 'gear') {
    const ring = me.ring || 10, waves = wavesOf(ring);
    body.innerHTML = `<div class="sumrow"><div class="sumb surf">${svg('vest')}<div><div class="k">Total armor</div><div class="v">${armorHp()} HP</div></div></div>
        <div class="sumb surf">${svg('bite')}<div><div class="k">Bite resist</div><div class="v">${(me.bite_time || 5).toFixed(1)}s</div></div></div>
        <div class="sumb surf">${svg('w' + waves)}<div><div class="k">Noise</div><div class="v">${ring}m</div></div></div></div>
      <div id="doll">${avatar(false, !!(profile && profile.gender === 'female'))}
      <div class="gcol l">${gslot('head','Helmet')}${gslot('armor','Armor')}${gslot('eq1','Item 1')}</div>
      <div class="gcol r">${gslot('weapon','Weapon',true)}${gslot('bag','Backpack',true)}${gslot('eq2','Item 2')}</div></div>`;
    $('invFoot').textContent = 'Tap a slot to inspect. Equipping takes 10 seconds and locks your actions.';
    body.querySelectorAll('.gslot').forEach(b => b.onclick = () => {
      const k = b.dataset.slot, it = invItem(k);
      if (it) return inspect({ where:k });
      if (k === 'weapon') return inspect({ where:'weapon' });
      invTab = 'pack'; drawInv(); toast(`Pick an item from your pack and Equip it.`);
    });
  } else if (invTab === 'pack') {
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
      <div class="menu-grid" style="margin-top:8px"><div id="dzEq" class="pk" style="min-height:40px;display:grid;place-items:center"><span class="n">EQUIP ▸</span></div><div id="dzDrop" class="pk" style="min-height:40px;display:grid;place-items:center"><span class="n">DISCARD ▾</span></div></div>`;
    $('invFoot').textContent = 'Tap to inspect, or drag an item onto Equip or Discard.';
    body.querySelectorAll('.pk[data-i]').forEach(b => setupDrag(b, +b.dataset.i));
  } else drawBunkerTab(body);
}
function drawBunkerTab(body){
  const me = data.me, bk = me.bunker;
  if (!bk) {
    body.innerHTML = `<div class="bkempty surf" style="border-radius:16px"><div>${svg('bunker','x').replace('class="x"', 'style="width:46px;height:46px;color:var(--acc)"')}<br><b style="color:var(--tx)">No bunker yet</b><br>
      Stash up to 50 items that survive even if you turn. It has 5,000 HP; zombies can tear it down.<br>Build it where you stand, at least 400 m from your Home Stealth Zone. Others see its marker offset 75–100 m.<br><br>
      <button class="obtn" id="bkBuild" ${me.sc < 100 ? 'disabled' : ''}>Build here · 100 SC</button>${me.sc < 100 ? `<p style="margin-top:8px">You have ${me.sc} SC.</p>` : ''}</div></div>`;
    $('invFoot').textContent = 'One bunker per player. Takes 10 minutes to build.';
    $('bkBuild') && ($('bkBuild').onclick = () => bunkerAct('set', 'Bunker started: ready in 10 minutes.'));
    return;
  }
  const el = el0(), rl = Math.max(0, bk.ready - el), lock = Math.max(0, bk.lock - el);
  const head = `<div class="bkhead surf"><div class="row"><span>BUNKER HP</span><span class="hpv">${bk.hp} / 5000</span></div><div class="trk"><i style="width:${bk.hp / 50}%"></i></div>
    <div class="row" style="font-weight:600;letter-spacing:0;font-size:11.5px;color:var(--mut)"><span>${bk.n}/50 items · ${bk.near ? 'you\'re here' : bk.dist + ' m away'}</span>
    ${bk.hp < 5000 ? `<button class="obtn ghost" id="bkRep" style="width:auto;min-height:30px;font-size:10px;padding:0 10px" ${bk.near ? '' : 'disabled'}>Repair · ${Math.ceil((5000 - bk.hp) / 25)} SC</button>` : ''}</div></div>`;
  if (rl > 0) { body.innerHTML = head + `<div class="bkempty">Under construction<br><b style="font-family:var(--f-mono);font-size:30px;color:var(--acc)">${fmt(rl)}</b></div>`; $('invFoot').textContent = ''; return; }
  if (!bk.near || lock > 0 || !bk.items) {
    body.innerHTML = head + `<div class="bkempty">${svg('lock','x').replace('class="x"', 'style="width:40px;height:40px;color:#f43f5e"')}<br>${lock > 0 ? `Bunkers unlock ${fmt(lock)} into the round.` : 'You must build or return to your bunker to access bunker inventory'}</div>
      <button class="obtn red" id="bkAb" style="min-height:40px;font-size:11px">Abandon bunker</button>`;
    $('invFoot').textContent = '';
    if ($('bkRep')) $('bkRep').onclick = () => bunkerAct('repair', 'Bunker repaired.');
    $('bkAb').onclick = () => { if (confirm('Abandon your bunker? Everything stashed in it is lost.')) bunkerAct('abandon', 'Bunker abandoned.'); };
    return;
  }
  const items = bk.items || [], pages = Math.max(1, Math.ceil(items.length / 12));
  bkPage = Math.min(bkPage, pages - 1);
  let cells = '';
  for (let i = 0; i < 12; i++) {
    const idx = bkPage * 12 + i, it = items[idx];
    cells += it ? `<button class="pk rs r-${rar(it.t)}" data-b="${idx}">${svg(icFor(it.t))}<span><span class="n">${esc(nm(it.t))}</span></span></button>` : `<div class="pk free"><i class="diamond"></i></div>`;
  }
  body.innerHTML = head + `<div class="bkgrid">${cells}</div>
    <div class="bkpg"><button id="bkPrev" ${bkPage ? '' : 'disabled'}>‹</button><span>PAGE ${bkPage + 1}/${pages}</span><button id="bkNext" ${bkPage < pages - 1 ? '' : 'disabled'}>›</button></div>`;
  $('invFoot').textContent = 'Tap a stored item to take or equip it. Stash items from your Gear or Pack.';
  if ($('bkRep')) $('bkRep').onclick = () => bunkerAct('repair', 'Bunker repaired.');
  $('bkPrev').onclick = () => { bkPage--; drawInv(); }; $('bkNext').onclick = () => { bkPage++; drawInv(); };
  body.querySelectorAll('[data-b]').forEach(b => b.onclick = () => {
    const idx = +b.dataset.b, it = items[idx], c = CAT[it.t] || {};
    openSheet(c.name || nm(it.t), `<div class="r-${rar(it.t)}"><span class="rar rarc">${RAR[rar(it.t)]}</span></div><div class="sh-sec"><p>${esc(c.descr || '')}</p></div>
      <div class="menu-grid"><button class="btn" id="bkTake">Take</button><button class="btn ghost" id="bkX">Close</button></div>`);
    $('bkTake').onclick = () => stashAct({ p_action:'take', p_index: idx }, 'Taken from bunker.');
    $('bkX').onclick = closeSheet;
  });
}
async function bunkerAct(a, msg){
  try { const r = await rpc('zr_bunker', A({ p_action: a })); if (r.error) { toast(errMsg(r) + (r.need ? ` Needs ${r.need} SC.` : '')); return; }
    toast(a === 'repair' ? `${msg} ${r.hp} HP (−${r.cost} SC).` : msg); await heartbeat(); drawInv(); } catch(_) { toast('Network error.'); }
}
async function stashAct(args, msg){
  try { const r = await rpc('zr_stash', A(args)); if (r.error) { toast(errMsg(r)); return; } toast(msg); closeSheet(); await heartbeat(); drawInv(); }
  catch(_) { toast('Network error.'); }
}
function setupDrag(el, i){
  let sx, sy, moved = false, ghost = null, over = null;
  const it = () => (data.me.pack || [])[i];
  const zoneAt = (x, y) => { const e = document.elementFromPoint(x, y); return e && e.closest && e.closest('#dzEq,#dzDrop'); };
  el.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; moved = false; dragging = null; try { el.setPointerCapture(e.pointerId); } catch(_){} });
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
  const up = () => {
    if (sx == null) return; sx = null;
    if (ghost) { ghost.remove(); ghost = null; }
    el.style.opacity = '';
    if (!moved) { dragging = null; inspect({ where:'pack', i }); return; }
    const z = over; over = null; dragging = null;
    ['dzEq','dzDrop'].forEach(id => $(id) && $(id).classList.remove('dv','di'));
    if (!z) return;
    const c = CAT[it().t] || {};
    if (z.id === 'dzDrop') invAction({ p_action:'discard', p_from:'pack', p_index:i });
    else if (c.slot === 'eq') pickSlot(i);
    else invAction({ p_action:'equip', p_from:'pack', p_index:i, p_to:null });
  };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}
function inspect(src){
  const me = data.me, z = Z();
  const it = src.where === 'pack' ? (me.pack || [])[src.i] : src.where === 'weapon' && !invItem('weapon') ? { t:'shove' } : invItem(src.where);
  if (!it) return;
  const c = it.t === 'shove' ? SHOVE : (CAT[it.t] || {});
  const r = it.t === 'shove' ? 'industrial' : rar(it.t);
  const lockS = { shove:'3s bite lock', bat:'1.5s bite lock', crowbar:'2s bite lock', shotgun:'3s bite + shriek lock', bearspray:'5s all actions', stungun:'6 min stun' }[it.t];
  let stats = [];
  if (c.slot === 'weapon' || it.t === 'shove') stats = [['Damage', c.dmg || 0], ['Cooldown', (c.cd || 15) + 's'], ['Loudness', `${wavesOf(c.ping_r || 15)} · ${c.ping_r || 15}m`]];
  else if (c.kind === 'head' || c.kind === 'armor') stats = [['Durability', `${Math.max(0, it.d || 0)}/${src.where.startsWith('z_') ? (c.carry_hp || c.dur) : c.dur}`], ['Zombie carry', c.carry_hp || 0], ['Bite time', c.bite_s ? c.bite_s + 's' : '5s']];
  else if (c.slot === 'bag') stats = [['Capacity', (c.cap || 0) + ' slots'], ['Type', 'Backpack'], ['Loudness', it.t === 'rucksack' ? '+15%' : '—']];
  else stats = [['Uses', usesOf(it)], ['Loudness', (c.ping_r || 0) ? `${wavesOf(c.ping_r)} · ${c.ping_r}m` : 'Silent'], [it.b != null ? 'Battery' : 'Lockout', it.b != null ? Math.round(it.b) + '%' : (lockS || '—')]];
  if (lockS && (c.slot === 'weapon' || it.t === 'shove')) stats.push(['Action disable', lockS]);
  let acts = '';
  const atBunker = bunkerOpen();
  if (z || src.where.startsWith('z_') || it.t === 'shove') acts = '';
  else if (src.where === 'pack') acts = `<button class="btn" data-a="equip">${c.slot === 'bag' ? 'Switch bag' : 'Equip (10s)'}</button><button class="btn ghost" data-a="discard">Discard</button>${atBunker ? '<button class="btn ghost" data-a="stash" style="grid-column:span 2">Stash in bunker</button>' : ''}`;
  else {
    if (src.where !== 'bag') acts += `<button class="btn ghost" data-a="unequip">Unequip</button>`;
    if ((it.t === 'aa' || it.t === 'powerbank' || it.t === 'ducttape') && (src.where === 'eq1' || src.where === 'eq2')) acts += `<button class="btn" data-a="use">${it.t === 'ducttape' ? 'Use' : 'Recharge'}</button>`;
    if ((it.t === 'headlamp' || it.t === 'nvg') && src.where === 'head') acts += `<button class="btn ghost" data-a="light">Toggle light</button>`;
    acts += `<button class="btn red" data-a="discard">Discard</button>`;
    if (atBunker && src.where !== 'bag') acts += `<button class="btn ghost" data-a="stash">Stash in bunker</button>`;
  }
  openSheet(c.name || nm(it.t), `
    <div class="r-${r}"><span class="rar rarc">${RAR[r]}</span> <span class="rar" style="color:var(--mut)">· ${esc((c.slot === 'eq' ? 'equip slot' : c.slot || 'melee').toUpperCase())}</span></div>
    <div class="stats">${stats.slice(0, 3).map(([k, val]) => `<div class="stat"><div class="k">${k}</div><div class="v">${esc(val)}</div></div>`).join('')}</div>
    ${stats[3] ? `<p style="margin:0;font-size:12px;color:var(--mut)">Action disable: <b style="color:var(--tx)">${stats[3][1]}</b></p>` : ''}
    ${durOf(it) != null && durOf(it) < 100 ? `<div class="dur ${durOf(it) < 65 ? 'red' : ''}" style="height:5px"><i style="width:${durOf(it)}%"></i></div>` : ''}
    <div class="sh-sec"><p>${esc(c.descr || '')}</p></div>
    ${acts ? `<div class="menu-grid">${acts}</div>` : ''}`);
  $('sheetBody').querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
    const a = b.dataset.a;
    if (a === 'light') return toggleLight();
    if (a === 'use') { closeSheet(); setTab('radar'); return useSlot(src.where); }
    if (a === 'stash') return stashAct(src.where === 'pack' ? { p_action:'put', p_from:'pack', p_index: src.i } : { p_action:'put', p_from: src.where }, 'Stashed in bunker.');
    if (src.where === 'pack') {
      if (a === 'discard') return invAction({ p_action:'discard', p_from:'pack', p_index:src.i });
      if (c.slot === 'eq') return pickSlot(src.i);
      return invAction({ p_action:'equip', p_from:'pack', p_index:src.i, p_to:null });
    }
    invAction({ p_action: a === 'discard' ? 'discard' : 'unequip', p_from: src.where });
  });
}
function pickSlot(i){
  const g = data.me.gear || {}, it = (data.me.pack || [])[i];
  const cell = s => `<button data-s="${s}"><div class="k">Item ${s === 'eq1' ? 1 : 2} · ${s === 'eq1' ? 'left' : 'right'}</div><div class="n">${g[s] ? esc(nm(g[s].t)) + ' <span style="color:var(--mut);font-weight:600">(swap)</span>' : 'Empty'}</div></button>`;
  openSheet(`Equip ${short(it.t)}`, `<div class="sh-sec"><p>Which quick slot? Equipping takes 10 seconds and locks your actions; getting bitten cancels the lock.</p></div><div class="pick2">${cell('eq1')}${cell('eq2')}</div>`);
  $('sheetBody').querySelectorAll('[data-s]').forEach(b => b.onclick = () => invAction({ p_action:'equip', p_from:'pack', p_index:i, p_to:b.dataset.s }));
}
async function invAction(args){
  try {
    const r = await rpc('zr_inv', A(args));
    if (r.error) { toast(errMsg(r)); return; }
    toast({ equipped:'Equipped.', equipping:'Equipping: 10 seconds.', unequipped:'Moved to backpack.', discarded:'Discarded. It\'s in a loot bag nearby for 2 hours.' }[r.result] || 'Done.');
    closeSheet(); await heartbeat(); drawInv();
  } catch(e){ toast('Network error.'); }
}

/* ---------- world & intel tab ---------- */
let worldData = null, worldAt = 0;
async function drawWorld(force){
  const body = $('wBody');
  if (force || Date.now() - worldAt > 15000) {
    try { worldData = await rpc('zr_world', A()); worldAt = Date.now(); } catch(_) { if (!worldData) { body.innerHTML = '<div class="lockv">Could not load world intel.</div>'; return; } }
  }
  const w = worldData; if (!w || tab !== 'world') return;
  const el = (Date.now() - worldAt) / 1000;
  const rLeft = w.round ? (Date.parse(w.round.ends_at) - Date.now()) / 1000 : 0;
  $('wRound').textContent = w.round ? `ROUND ${w.round.n}/12` : 'ROUND —';
  $('wSub').textContent = `${w.season ? w.season.name.toUpperCase() : ''} · ROUND ENDS IN ${dur(rLeft)}`;
  const cards = [];
  (w.crates || []).slice(0, 2).forEach(d => cards.push(`<button class="evc surf" data-ll="${d.lat},${d.lng}">${svg('crate').replace('class="ic"', 'class="ic" style="color:#f59e0b"')}<span class="tx"><b>Supply crate · ${d.dir} ${d.dist}m</b><span>${d.lands - el > 0 ? 'Inbound: military-grade loot' : 'Landed: search it before it\'s gone'}</span></span><span class="cd">${fmt(d.lands - el > 0 ? d.lands - el : d.left - el)}</span></button>`));
  (w.zones || []).filter(z => z.kind === 'emp').slice(0, 1).forEach(z => cards.push(`<button class="evc surf" data-ll="${z.lat},${z.lng}">${svg('emp').replace('class="ic"', 'class="ic" style="color:#a78bfa"')}<span class="tx"><b>EMP fog · ${z.dir} ${z.dist}m</b><span>Drifting storm: radar cut by 75%</span></span><span class="cd">${fmt(z.left - el)}</span></button>`));
  (w.zones || []).filter(z => z.kind !== 'emp').slice(0, 2).forEach(z => cards.push(`<button class="evc surf" data-ll="${z.lat},${z.lng}">${svg(z.kind === 'cdc' ? 'cdc' : 'rad').replace('class="ic"', `class="ic" style="color:${z.kind === 'cdc' ? '#38bdf8' : '#a3e635'}"`)}<span class="tx"><b>${z.kind === 'cdc' ? 'CDC Research Lab' : 'Radiation zone'} · ${z.dir} ${z.dist}m</b><span>${z.kind === 'cdc' ? 'Purges infection while inside' : `Spreading: ${z.r}m wide now`}</span></span><span class="cd">${fmt(z.left - el)}</span></button>`));
  if (w.bunker_lock > el) cards.push(`<div class="evc surf">${svg('lock')}<span class="tx"><b>Bunkers locked</b><span>First 6 hours of the round</span></span><span class="cd">${fmt(w.bunker_lock - el)}</span></div>`);
  if (!cards.length) cards.push(`<div class="evc surf">${svg('crate')}<span class="tx"><b>No events nearby yet</b><span>Supply crates and hazards appear near active players.</span></span></div>`);
  const KN = { explosion:'Explosion', shotgun:'Shotgun blast', rifle:'Rifle fire', carbine:'Automatic fire', scream:'Horde shriek', stungun:'Stun gun', bearspray:'Bear spray' };
  const feed = (w.feed || []).slice(0, 4).map(f => `<div class="fl"><span class="wv3">${svg(f.kind === 'scream' ? 'scream' : 'w3', 'wvic')}</span><span>${KN[f.kind] || 'Loud noise'} · ${f.dir} ${f.dist}m</span><span class="ago">${f.ago < 60 ? f.ago + 's' : Math.round(f.ago / 60) + 'm'} ago</span></div>`).join('') || '<div class="fl"><span>Quiet out there… for now.</span></div>';
  const tot = Math.max(1, w.humans + w.zombies);
  const lb = (h, rows, f) => `<div class="surf"><h5>${h}</h5>${(rows || []).map(r => `<p><span>${esc(r.handle)}</span><b>${f(r.v)}</b></p>`).join('') || '<p><span>—</span></p>'}</div>`;
  $('wBody').innerHTML = `<div class="wsec"><span>Events</span></div>${cards.slice(0, 3).join('')}
    <div class="wsec"><span>Broadcasts</span></div><div class="feed">${feed}</div>
    <div class="wsec"><span>Standings</span><span>nearby</span></div>
    <div class="faction surf"><div class="row"><span style="color:#34d399">${w.humans} HUMANS</span><span style="color:#fb7185">${w.zombies} ZOMBIES</span></div>
      <div class="fbar"><i style="width:${w.humans / tot * 100}%"></i><u style="width:${w.zombies / tot * 100}%"></u></div></div>
    <div class="lb3">${lb('Longest survival', w.surv, dur)}${lb('Most kills', w.kills, x => x)}${lb('Alpha infector', w.alpha, x => x)}</div>`;
  $('wBody').querySelectorAll('[data-ll]').forEach(b => b.onclick = () => { const [la, lo] = b.dataset.ll.split(',').map(Number); setTab('radar'); follow = false; map.setView([la, lo], 17); });
  setTimeout(() => { if (tab === 'world') drawWorld(false); }, 1000);
}

/* ---------- gear menu: leaderboard, settings, profile ---------- */
function openGearMenu(){
  const muted = !!store.get('zr_mute');
  openSheet('Menu', `<div class="srows">
    <button class="srow surf" data-m="st">${svg('user')}<span class="sx"><span class="sk">Profile</span><span class="sv">Level ${levelInfo(data.me.xp).L} · ${data.me.xp || 0} XP · ${data.me.sc || 0} SC</span></span><span class="chev">›</span></button>
    <button class="srow surf" data-m="lb">${svg('radar')}<span class="sx"><span class="sk">Leaderboard</span><span class="sv">Season rankings</span></span><span class="chev">›</span></button>
    <button class="srow surf" data-m="set">${svg('cog')}<span class="sx"><span class="sk">Settings</span><span class="sv">Account, privacy, home zone</span></span><span class="chev">›</span></button>
    <button class="srow surf" data-m="how">${svg('doc')}<span class="sx"><span class="sk">How to play</span><span class="sv">Rules and controls</span></span><span class="chev">›</span></button>
    <button class="srow surf" data-m="snd">${svg(muted ? 'mute' : 'sound')}<span class="sx"><span class="sk">Sound effects</span><span class="sv">${muted ? 'Off' : 'On'}</span></span></button></div>`);
  $('sheetBody').querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
    const m = b.dataset.m;
    if (m === 'how') return showHowTo();
    if (m === 'snd') { if (muted) store.del('zr_mute'); else store.set('zr_mute', 1); return openGearMenu(); }
    closeSheet(); openCmd(m);
  });
}

/* ---------- profile / leaderboard / settings (command screen) ---------- */
let cmdTab = 'st', lbFilter = 'all', standCache = null;
function openCmd(t){
  if (!data) return;
  cmdTab = t || 'st'; $('cmd').hidden = false;
  $('cmdTitle').textContent = { st:'PROFILE', lb:'LEADERBOARD', set:'SETTINGS' }[cmdTab];
  $('cmdTabs').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === cmdTab));
  $('cmdScV').textContent = (data.me.sc || 0).toLocaleString() + ' SC';
  $('cmdSub').textContent = data.me.handle + (data.round ? ` · ROUND ${data.round.n}/12` : '');
  const cb = $('cmdBody'); cb.style.display = ''; cb.style.flexDirection = '';
  if (cmdTab === 'st') drawStandings(); else if (cmdTab === 'lb') drawBoard();
  else { drawSettings(); loadAcct().then(() => { if (cmdTab === 'set' && !$('cmd').hidden) drawSettings(); }); }
}
function closeCmd(){ $('cmd').hidden = true; }
const dur = s => { s = Math.max(0, s | 0); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
async function drawStandings(){
  const body = $('cmdBody');
  const paint = s => {
    const lv = levelInfo(data.me.xp), kd = s.deaths ? (s.kills / s.deaths).toFixed(2) : String(s.kills);
    const tile = (k, v, sub) => `<div class="tile surf"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
    body.innerHTML = `<div class="xpcard surf"><div class="lv">${lv.L}</div><div class="xx"><span>LEVEL ${lv.L} · ${lv.into}/${lv.need} XP to next</span><div class="trk"><i style="width:${lv.p * 100}%"></i></div></div>
        <button class="obtn ghost" id="cvXp" ${data.me.sc > 0 ? '' : 'disabled'}>SC → XP</button></div>
      <div class="tiles">${tile('Sector rank', '#' + s.rank, `of ${s.sector_n} within 5 km`)}${tile('Survival credits', (s.sc || 0).toLocaleString(), 'become XP each round')}
        ${tile('Season horde size', s.horde, 'infections + bloodline')}${tile('Survivors infected', s.infected, `${s.cures} cured by you`)}</div>
      <div class="h4">Career</div>
      <div class="career">${tile('Total horde', s.total_horde)}${tile('Longest survival', dur(s.longest))}${tile('Seasons played', s.seasons)}${tile('K/D', kd, `${s.kills} downs · ${s.deaths} deaths`)}</div>`;
    $('cvXp').onclick = async () => {
      if (!confirm(`Convert ${data.me.sc} SC into XP now? SC is also spent on building and repairing bunkers.`)) return;
      try { const r = await rpc('zr_convert_xp', A()); if (r.error) toast(errMsg(r)); else { points('You converted SC to XP', r.gained); await heartbeat(); drawStandings(); } } catch(_) { toast('Network error.'); }
    };
  };
  if (standCache) paint(standCache); else body.innerHTML = '<div class="lockv">Loading…</div>';
  try { standCache = await rpc('zr_standings', A()); if (cmdTab === 'st' && !$('cmd').hidden) paint(standCache); }
  catch(e){ if (!standCache) body.innerHTML = '<div class="lockv">Could not load your profile.</div>'; }
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
    $('lbFoot').textContent = `${b.humans} humans vs ${b.zombies_n} zombies this season`;
  } catch(e){ $('lbRows').innerHTML = '<div class="lockv">Could not load the leaderboard.</div>'; }
}

/* ---------- settings tab ---------- */
let acct = null, homeShown = false;
async function loadAcct(){
  try { acct = await rpc('zr_account', A()); saveProfile({ email: acct.email, handle: acct.handle, gender: acct.gender, termsVer: acct.terms_ver, termsAt: acct.terms_at }); }
  catch(_) {}
  return acct;
}
const left24 = (iso, hrs) => iso ? Math.max(0, Date.parse(iso) + hrs * 3600e3 - Date.now()) / 1000 : 0;
const hm = s => { s = Math.ceil(s); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.ceil(s % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
function drawSettings(){
  const body = $('cmdBody'), a = acct || {}, p = profile || {};
  const email = a.email || p.email, addr = p.homeLabel;
  const homeCd = a.home ? left24(a.home_set_at, 24) : 0;
  const nameCd = left24(a.name_changed_at, 168);
  const hours = data && data.me.safe_start != null ? (() => { const h = data.me.safe_start, e = (h + 8) % 24, f = x => (x % 12 || 12) + (x < 12 ? 'am' : 'pm'); return `${f(h)} – ${f(e)}`; })() : 'Off';
  const row = (k, icon, label, val, extra) => `<button class="srow surf" data-s="${k}">${svg(icon)}<span class="sx"><span class="sk">${label}</span><span class="sv">${val}</span></span>${extra || '<span class="chev">›</span>'}</button>`;
  const homeVal = !a.home && !p.homeLabel ? 'Not set' : addr ? esc(homeShown ? addr : maskAddr(addr)) : 'Set <small>· address saved on another device</small>';
  body.innerHTML = `<div class="srows">
      ${row('name', 'user', 'Character name', `${esc(a.handle || (data && data.me.handle) || '')}${nameCd > 0 ? ` <small class="cdn">· change in ${hm(nameCd)}</small>` : ''}`)}
      ${row('email', 'mail', 'Login email', esc(maskEmail(email)))}
      ${row('pw', 'key', 'Password', '••••••••••')}
      ${row('home', 'shield', 'Home stealth zone', `${homeVal}${homeCd > 0 ? ` <small class="cdn">· move in ${hm(homeCd)}</small>` : ''}`,
         addr ? `<span class="rev" id="hRev" role="button" aria-label="${homeShown ? 'Hide' : 'Show'} address">${svg(homeShown ? 'eyeoff' : 'eye')}</span>` : undefined)}
      ${row('legal', 'doc', 'Legal', `Accepted ${dateStr(a.terms_at || p.termsAt)} <small>· v${esc(a.terms_ver || p.termsVer || TERMS_VER)}</small>`)}
      ${row('safe', 'clock', 'Safe hours', hours)}
      ${row('how', 'radar', 'How to play', 'Rules and controls')}
    </div>
    <div class="ospacer" style="flex:1;min-height:6px"></div>
    <button class="obtn red" id="sOut">Sign out</button>
    ${DBG ? '<button class="olink" id="sReset" style="margin:8px auto 0;font-size:11px;color:#f59e0b">Reset onboarding (test)</button>' : ''}`;
  body.style.display = 'flex'; body.style.flexDirection = 'column';
  body.querySelectorAll('[data-s]').forEach(b => b.onclick = ev => {
    if (ev.target.closest('#hRev')) { ev.stopPropagation(); homeShown = !homeShown; drawSettings(); return; }
    ({ name: sheetName, email: sheetEmail, pw: sheetPw, home: sheetHome, legal: sheetLegal, safe: sheetSafe, how: showHowTo })[b.dataset.s]();
  });
  $('sOut').onclick = () => { if (confirm('Sign out of Zombie Radius on this phone?')) signOut(); };
  if ($('sReset')) $('sReset').onclick = () => { store.del('zr_seen_howto3'); signOut(); };
}
function signOut(){ store.del('zr_auth'); store.del('zr_profile'); location.href = location.pathname + location.search; }
function setErr(id, t, ok){ const e = $(id); if (e) { e.textContent = t || ''; e.style.color = ok ? '#34d399' : ''; } }
async function doneMsg(msg){ toast(msg); closeSheet(); await loadAcct(); if (!$('cmd').hidden && cmdTab === 'set') drawSettings(); }

function sheetName(){
  const a = acct || {}, cd = left24(a.name_changed_at, 168);
  openSheet('Character name', `
    <div class="sh-sec"><h3>Current</h3><p style="color:var(--tx);font-weight:700;font-size:15px">${esc(a.handle || data.me.handle)}</p></div>
    ${fld('stN', 'New character name', 'text', '', 'maxlength="16" autocomplete="off" autocapitalize="off" spellcheck="false"', { ic:'user', aside:'3–16 · A–Z 0–9 _' })}
    <p class="${cd > 0 ? 'cdn' : 'osub'}" style="margin:0;font-size:12px">${cd > 0 ? `You changed it recently. Next change in ${hm(cd)}.` : 'You can change your name once every 7 days. Your stats and rank stay with you.'}</p>
    <div class="ferr" id="stNE"></div>
    <button class="obtn" id="stNGo" disabled>Update character name</button>`);
  let ok = false;
  const N = $('stN'), go = $('stNGo');
  const chk = debounce(async v => {
    if (!NAME_RE.test(v)) { ok = false; hint('stN', v ? 'Use 3–16 letters, numbers or _' : '', v ? 'bad' : ''); go.disabled = true; return; }
    try { const r = await rpc('zr_check', { p_kind:'name', p_value: v, p_id: auth.id }); if (N.value.trim() !== v) return;
      ok = r.available && v !== (a.handle || data.me.handle); hint('stN', ok ? '✓ Character name available' : r.available ? "That's your current name" : 'Character name taken', ok ? 'ok' : 'bad'); }
    catch(_) { ok = false; }
    go.disabled = !ok || cd > 0;
  }, 400);
  N.addEventListener('input', () => { go.disabled = true; chk(N.value.trim()); });
  go.onclick = async () => {
    if (!confirm(`Change your name to ${N.value.trim()}? You won't be able to change it again for 7 days.`)) return;
    go.disabled = true;
    try { const r = await rpc('zr_set_name', A({ p_name: N.value.trim() }));
      if (r.error) { setErr('stNE', { name_cooldown:`Next change in ${hm(r.secs)}.`, handle_taken:'That name was just taken.', bad_handle:'Use 3–16 letters, numbers or _.', same_name:"That's already your name." }[r.error] || r.error); go.disabled = false; return; }
      auth.handle = r.handle; store.set('zr_auth', auth); saveProfile({ handle: r.handle }); doneMsg(`You're now ${r.handle}.`); heartbeat(); }
    catch(_) { setErr('stNE', 'Network error.'); go.disabled = false; }
  };
}
function sheetEmail(){
  const cur = (acct && acct.email) || (profile && profile.email);
  openSheet('Login email', `
    <div class="sh-sec"><h3>Current</h3><p style="color:var(--tx);font-weight:700;font-size:15px">${esc(maskEmail(cur))}</p></div>
    ${fld('seE', 'New email address', 'email', '', 'autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false"', { ic:'mail' })}
    ${fld('seP', 'Current password', 'password', '', 'autocomplete="current-password" class="pw"', { ic:'key', eye:true, aside:'Required for security' })}
    <div class="ferr" id="seErr"></div>
    <button class="obtn" id="seGo" disabled>Update email</button>`);
  bindEyes($('sheetBody'));
  let ok = false; const E = $('seE'), Pw = $('seP'), go = $('seGo');
  const valid = () => { go.disabled = !(ok && Pw.value.length >= 8); };
  const chk = debounce(async v => {
    if (!EMAIL_RE.test(v)) { ok = false; hint('seE', v ? 'Enter a valid email' : '', v ? 'bad' : ''); valid(); return; }
    try { const r = await rpc('zr_check', { p_kind:'email', p_value: v, p_id: auth.id }); if (E.value.trim() !== v) return;
      ok = r.available && v.toLowerCase() !== (cur || '').toLowerCase();
      hint('seE', ok ? '✓ Email available' : r.available ? "That's your current email" : 'Another account uses this email', ok ? 'ok' : 'bad'); }
    catch(_) { ok = false; }
    valid();
  }, 450);
  E.addEventListener('input', () => { ok = false; valid(); chk(E.value.trim()); }); Pw.addEventListener('input', valid);
  go.onclick = async () => {
    go.disabled = true;
    try { const r = await rpc('zr_set_email', A({ p_email: E.value.trim(), p_password: Pw.value }));
      if (r.error) { setErr('seErr', { bad_password:'Current password is incorrect.', email_taken:'Another account uses this email.', bad_email:'Enter a valid email.' }[r.error] || r.error); go.disabled = false; return; }
      saveProfile({ email: r.email }); doneMsg('Login email updated.'); }
    catch(_) { setErr('seErr', 'Network error.'); go.disabled = false; }
  };
}
function sheetPw(){
  openSheet('Change password', `
    ${fld('spO', 'Current password', 'password', '', 'autocomplete="current-password" class="pw"', { ic:'key', eye:true })}
    ${fld('spN', 'New password', 'password', '', 'autocomplete="new-password" class="pw"', { ic:'key', eye:true })}
    <div style="display:grid;gap:6px;margin-top:-8px">${meterHtml('sp')}</div>
    ${fld('spC', 'Confirm new password', 'password', '', 'autocomplete="new-password" class="pw"', { ic:'key', eye:true })}
    <div class="ferr" id="spErr"></div>
    <button class="obtn" id="spGo" disabled>Update password</button>`);
  bindEyes($('sheetBody'));
  const O = $('spO'), N = $('spN'), C = $('spC'), go = $('spGo');
  const v = () => { const i = paintMeter('sp', N.value);
    if (C.value) hint('spC', N.value === C.value ? '✓ Passwords match' : 'Passwords do not match', N.value === C.value ? 'ok' : 'bad'); else hint('spC', '');
    go.disabled = !(O.value && i.ok && N.value === C.value); };
  [O, N, C].forEach(x => x.addEventListener('input', v)); v();
  go.onclick = async () => {
    go.disabled = true;
    try { const r = await rpc('zr_set_password', A({ p_old: O.value, p_new: N.value }));
      if (r.error) { setErr('spErr', { bad_password:'Current password is incorrect.', weak_password:'New password needs 8+ characters, 1 uppercase letter and 1 number.' }[r.error] || r.error); go.disabled = false; return; }
      doneMsg('Password updated.'); }
    catch(_) { setErr('spErr', 'Network error.'); go.disabled = false; }
  };
}
function sheetHome(){
  const a = acct || {}, cd = a.home ? left24(a.home_set_at, 24) : 0, addr = profile && profile.homeLabel;
  let pick = null, shown = false;
  openSheet('Home stealth zone', `
    <div class="sh-sec" style="padding:8px 12px"><h3>Current</h3><div style="display:flex;align-items:center;gap:8px"><p style="color:var(--tx);font-weight:700;font-size:14px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" id="shCur">${addr ? esc(maskAddr(addr)) : a.home ? 'Set (address saved on another device)' : 'Not set'}</p>
      ${addr ? `<button class="eye" style="position:static" id="shRev" aria-label="Show address">${svg('eye')}</button>` : ''}</div></div>
    ${addrBlock('sh', null)}
    <p style="margin:0;font-size:12px;color:#a7c4b8;line-height:1.38">Your new zone hides every entry and exit at your new home from other players. Only the stealth circle is saved; the address stays on this phone.</p>
    <p class="cdn" style="margin:0">${cd > 0 ? `RELOCATION COOLDOWN · ${hm(cd)} LEFT` : 'You can move your zone once every 24 hours.'}</p>
    <div class="ferr" id="shErr"></div>
    <button class="obtn" id="shGo" disabled>Save new home perimeter</button>`);
  if ($('shRev')) $('shRev').onclick = () => { shown = !shown; $('shCur').textContent = shown ? addr : maskAddr(addr); $('shRev').innerHTML = svg(shown ? 'eyeoff' : 'eye'); };
  if (obMap) { try { obMap.remove(); } catch(e){} obMap = null; }
  bindAddr('sh', null, h => { pick = h; $('shGo').disabled = !h || cd > 0; });
  $('shGo').onclick = async () => {
    $('shGo').disabled = true;
    try { const r = await rpc('zr_set_home2', A({ p_lat: pick.lat, p_lng: pick.lng }));
      if (r.error) { setErr('shErr', r.error === 'home_cooldown' ? `You can move it again in ${hm(r.secs)}.` : 'Pick a valid spot.'); return; }
      saveProfile({ homeLabel: pick.label || null }); doneMsg('Home stealth perimeter saved.'); heartbeat(); }
    catch(_) { setErr('shErr', 'Network error.'); $('shGo').disabled = false; }
  };
}
function sheetLegal(){
  const at = (acct && acct.terms_at) || (profile && profile.termsAt);
  openSheet('Legal', `<div class="sh-sec"><p>You accepted version <b style="color:var(--tx)">${esc((acct && acct.terms_ver) || (profile && profile.termsVer) || TERMS_VER)}</b> on ${dateStr(at)}.</p></div>
    <button class="obtn ghost" data-doc="terms">${svg('doc')} Terms of Service</button><button class="obtn ghost" data-doc="privacy">${svg('doc')} Privacy Policy</button>`);
  $('sheetBody').querySelectorAll('[data-doc]').forEach(b => b.onclick = () => openLegal(b.dataset.doc));
}
function sheetSafe(){
  const me = data.me;
  const hours = ['<option value="">Off</option>'].concat([...Array(24).keys()].map(h => {
    const l = (h % 12 || 12) + (h < 12 ? 'am' : 'pm'), e = ((h + 8) % 24), el = (e % 12 || 12) + (e < 12 ? 'am' : 'pm');
    return `<option value="${h}" ${me.safe_start === h ? 'selected' : ''}>${l} – ${el}</option>`;
  })).join('');
  openSheet('Safe hours', `<div class="sh-sec"><p>Pick an 8-hour window, like overnight, when your supplies don't drain while you're away.</p></div>
    <label class="ofld"><span class="olbl">Window</span><span class="oin"><select id="mSafe">${hours}</select></span></label>`);
  $('mSafe').onchange = async e => {
    const v = e.target.value === '' ? null : parseInt(e.target.value, 10);
    try { await rpc('zr_set_safe', A({ p_start: v })); data.me.safe_start = v; toast(v == null ? 'Safe hours off.' : 'Safe hours saved.'); closeSheet(); if (cmdTab === 'set') drawSettings(); }
    catch(_) { toast('Network error.'); }
  };
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
    <li><b>Radar pins are offset.</b> Everyone shows 50–100 m from where they really are, drifting slowly. Fights happen on screen: get your ring onto their pip. You're never meant to approach anyone in real life.</li>
    <li><b style="color:#10b981">Survivors</b> earn 1 SC every 5 seconds online, 300 per kill and 50 per mile. Stand in a loot zone and hold <b>Search</b> for gear. Item 1 and 2 sit beside your weapon.</li>
    <li><b>Infection</b> rises 15% a day for everyone. Antiviral Pills lower it; at 100% you turn. A bite starts a 5-minute countdown; Military Antivirus cures it.</li>
    <li><b style="color:#f43f5e">Zombies</b> hold Bite when their ring touches a human pip and Shriek to call the horde (45s cooldown). Shoves, spray and melee lock your bite briefly. Only Lazarus-X cures a zombie.</li>
    <li><b>Bunkers</b> (Gear › Bunker) store 50 items through a round, even if you turn. Zombies can smash them (5,000 HP).</li>
    <li><b>Rounds</b> last 7 days: points become XP, carried gear moves into your bunker and everyone starts human. 12 rounds make a season, then everything is wiped.</li>
    <li><b>Map hazards:</b> zombies in a Shadow Alley are invisible to radar unless you shine a headlamp or drop a flare. EMP fog cuts radar by 75% (night vision sees through). Bitten humans leave a blood trail zombies can follow for 2 minutes.</li>
    <li>Use the <b>pause</b> button to cross a road or handle anything real. Your home zone always hides you.</li>
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
loadCatalog().finally(async () => {
  if (!(auth && auth.id)) return showOnb('boot');
  if (profile && profile.onboarded && profile.email) return startLocation();
  try {
    const a = await rpc('zr_account', A());
    if (a.email) { saveProfile({ email: a.email, handle: a.handle, gender: a.gender, onboarded: true, termsVer: a.terms_ver, termsAt: a.terms_at }); return startLocation(); }
    OB.claim = { id: auth.id, secret: auth.secret }; OB.handle = a.handle || ''; showOnb('claim');
  } catch (e) {
    if (/bad_auth/.test(e.message)) { store.del('zr_auth'); auth = null; showOnb('boot'); } else startLocation();
  }
});
})();
