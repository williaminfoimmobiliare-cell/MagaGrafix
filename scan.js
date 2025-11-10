/* ===== MagaGrafix — scan.js (v3) ===== */

/* 🔧 COPIA QUI GLI STESSI VALORI DELLA TUA APP */
const LS_KEY = 'magagrafix_lite_v1';
const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbz56TTVE4VR9Hpi1rKaDmyvgHHF5CHqpnm_PojISTA1PgMijXCSj2oFNVXnyhNgLP4w/exec';
const WRITE_KEY = ''; // se in Code.gs l'hai lasciata vuota, resta vuota

/* --- Stato locale --- */
let store = { version:1, lastWriteTs:Date.now(), items:[], transactions:[], snapshots:[], logoDataUrl:'', companyName:'' };
let currentType = 'OUT'; // default

/* --- Utils --- */
const $ = (sel, req=false) => {
  const el = document.querySelector(sel);
  if (!el && req) console.error('Elemento mancante:', sel);
  return el;
};
const on = (sel, event, handler) => {
  const el = $(sel);
  if (el) el.addEventListener(event, handler);
  else console.warn('Listener non applicato (manca):', sel);
};
const fmt = n => Number(n||0).toLocaleString('it-IT',{minimumFractionDigits:2, maximumFractionDigits:2});
const beep = (ok=true)=>{
  const st = $('#soundToggle'); if (!st || !st.checked) return;
  const ctx = new (window.AudioContext||window.webkitAudioContext)();
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type='sine'; o.frequency.value = ok? 880 : 220;
  o.connect(g); g.connect(ctx.destination);
  g.gain.value=0.06; o.start();
  setTimeout(()=>{o.stop();ctx.close();}, ok?120:250);
};
const setSync = (txt,kind='info')=>{
  const el = $('#syncStatus'); if (!el) return;
  el.textContent = `Sync: ${txt}`;
  el.style.color = kind==='ok' ? '#10b981' : kind==='err' ? '#ef4444' : '#94a3b8';
};
const uid = () => 'TX' + Date.now() + Math.floor(Math.random()*999);

function loadStore(){
  try{ const raw = localStorage.getItem(LS_KEY); if (raw) store = JSON.parse(raw); }catch(e){}
}
function saveStore(){
  store.version = (store.version||0)+1;
  store.lastWriteTs = Date.now();
  localStorage.setItem(LS_KEY, JSON.stringify(store));
  scheduleSync();
}

function mergeStores(local, remote){
  const out = { version:Math.max(local.version||0, remote.version||0),
    lastWriteTs:Math.max(local.lastWriteTs||0, remote.lastWriteTs||0),
    items:[], transactions:[], snapshots:[], logoDataUrl:'', companyName:'' };

  const bySku = new Map(); (remote.items||[]).forEach(i=>bySku.set(i.sku,i));
  (local.items||[]).forEach(i=>{
    const r=bySku.get(i.sku);
    if(!r){bySku.set(i.sku,i);return;}
    bySku.set(i.sku,(i.updatedAt||0)>=(r.updatedAt||0)?i:r);
  });
  out.items=[...bySku.values()];

  const byId=new Map(); (remote.transactions||[]).forEach(t=>byId.set(t.id,t));
  (local.transactions||[]).forEach(t=>{
    const r=byId.get(t.id);
    if(!r){byId.set(t.id,t);return;}
    const lt=t.updatedAt||t.ts||0, rt=r.updatedAt||r.ts||0;
    byId.set(t.id, lt>=rt?t:r);
  });
  out.transactions=[...byId.values()].sort((a,b)=>(a.ts||0)-(b.ts||0));

  if ((local.lastWriteTs||0) >= (remote.lastWriteTs||0)){
    out.logoDataUrl = local.logoDataUrl||''; out.companyName = local.companyName||'';
  } else { out.logoDataUrl = remote.logoDataUrl||''; out.companyName = remote.companyName||''; }

  out.version=(out.version||0)+1; out.lastWriteTs=Date.now(); return out;
}

/* --- Sync --- */
let syncTimer=null, syncing=false;
function scheduleSync(){ clearTimeout(syncTimer); syncTimer=setTimeout(syncToDrive,600); }
async function syncToDrive(){
  if (!WEBAPP_URL || syncing) return;
  try{
    syncing=true; setSync('invio…');
    const body = new URLSearchParams();
    body.set('action','save'); body.set('data', JSON.stringify(store));
    if (WRITE_KEY) body.set('key', WRITE_KEY);
    let res = await fetch(WEBAPP_URL, { method:'POST', body });
    if (!res.ok){ await new Promise(r=>setTimeout(r,700)); res = await fetch(WEBAPP_URL, { method:'POST', body }); }
    const txt = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} ${txt}`);
    setSync('ok','ok');
  }catch(e){ console.error(e); setSync('errore','err'); }
  finally{ syncing=false; }
}
async function loadFromDrive(){
  if (!WEBAPP_URL || syncing) return;
  try{
    setSync('lettura…');
    const url = new URL(WEBAPP_URL);
    url.searchParams.set('action','load');
    if (WRITE_KEY) url.searchParams.set('key', WRITE_KEY);
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const remote = await res.json();
    if (!remote || !Array.isArray(remote.items)) { setSync('dati non validi'); return; }
    store = mergeStores(store, remote);
    localStorage.setItem(LS_KEY, JSON.stringify(store));
    setSync('ok','ok');
  }catch(e){ console.error(e); setSync('errore','err'); }
}

/* --- Logica scanner --- */
function setLast(html, ok){
  const box = $('#lastMsg'); if(!box) return;
  box.innerHTML = html;
  box.className = `small ${ok?'ok':'err'}`;
}
function findByBarcode(code){
  const c = String(code||'').trim();
  if (!c) return null;
  return store.items.find(i => (i.barcode && i.barcode===c) || i.sku===c) || null;
}
function ensureBarcodeField(){
  store.items.forEach(i => { if (typeof i.barcode === 'undefined') i.barcode = ''; });
}
function addTx(sku, type, qty, price){
  const now = Date.now();
  store.transactions.push({
    id: uid(), ts: now, sku, type, qty: Number(qty||1), price: Number(price||0),
    confirmed: type !== 'OUT', updatedAt: now
  });
  saveStore();
}
function handleScan(code){
  const qtyEl = $('#qty', true); const priceEl = $('#price', true);
  const qty = Math.max(1, Number(qtyEl?.value||1));
  const price = Number(priceEl?.value||0);
  const it = findByBarcode(code);

  if (!it){
    setLast(`❓ Barcode <b>${code}</b> non trovato. Associalo a uno SKU qui sotto.`, false);
    const ub = $('#unknownBarcode'); if (ub) ub.value = code;
    beep(false);
    return;
  }

  addTx(it.sku, currentType, qty, price);
  setLast(`✅ ${currentType} — ${it.sku} <b>${it.name||''}</b> × <b>${qty}</b> ${currentType==='OUT' && price? `(€${fmt(price)})` : ''}`, true);
  const ac = $('#autoConfirm');
  const si = $('#scanInput');
  if (ac && ac.checked && si) si.value = '';
  beep(true);
}

/* --- Associazione barcode↔SKU --- */
function assignBarcode(){
  const code = $('#unknownBarcode')?.value.trim();
  const sku  = $('#assignSku')?.value.trim();
  if (!code || !sku){ setLast('Compila barcode e SKU per associare.', false); beep(false); return; }

  let it = store.items.find(i=>i.sku===sku);
  const now = Date.now();

  if (!it){
    it = { sku, name: sku, position:'', stockInit:0, costPrice:0, sellPrice:0, updatedAt: now, barcode: code };
    store.items.push(it);
  } else {
    it.barcode = code; it.updatedAt = now;
  }

  saveStore();
  setLast(`🔗 Associato barcode <b>${code}</b> a SKU <b>${sku}</b>. Ora puoi scansionare direttamente.`, true);
  const as = $('#assignSku'); if (as) as.value = '';
  const si = $('#scanInput'); if (si) si.focus();
}

/* --- UI --- */
function bindUI(){
  // carica/sync iniziale
  loadStore(); ensureBarcodeField(); loadFromDrive();

  // focus permanente
  const input = $('#scanInput', true);
  if (input){
    input.addEventListener('blur', ()=> setTimeout(()=> input.focus(), 50) );
    input.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter'){
        const code = input.value.trim();
        if (code){ handleScan(code); }
        const ac = $('#autoConfirm');
        if (!ac || !ac.checked) input.select(); else input.value = '';
      }
      if (e.key === '1') currentType='IN';
      if (e.key === '2') currentType='OUT';
      if (e.key === '3') currentType='ROTTURA';
      if (e.key === '+'){ e.preventDefault(); const q=$('#qty'); if(q) q.value = Math.max(1, Number(q.value||1)+1); }
      if (e.key === '-'){ e.preventDefault(); const q=$('#qty'); if(q) q.value = Math.max(1, Number(q.value||1)-1); }
    });
  }

  // bottoni tipo
  on('#btnTypeIN','click', ()=>{ currentType='IN'; setLast(`Tipo selezionato: <b>${currentType}</b>`, true); input?.focus(); });
  on('#btnTypeOUT','click', ()=>{ currentType='OUT'; setLast(`Tipo selezionato: <b>${currentType}</b>`, true); input?.focus(); });
  on('#btnTypeROTTURA','click', ()=>{ currentType='ROTTURA'; setLast(`Tipo selezionato: <b>${currentType}</b>`, true); input?.focus(); });

  // qty e comandi
  on('#qtyPlus','click', ()=>{ const q=$('#qty'); if(q) q.value = Math.max(1, Number(q.value||1)+1); });
  on('#qtyMinus','click', ()=>{ const q=$('#qty'); if(q) q.value = Math.max(1, Number(q.value||1)-1); });
  on('#confirmBtn','click', ()=>{ const si=$('#scanInput'); if(si && si.value.trim()) handleScan(si.value.trim()); });
  on('#syncBtn','click', async()=>{ await syncToDrive(); await new Promise(r=>setTimeout(r,600)); await loadFromDrive(); setLast('🔄 Sync completato', true); });

  // associazione
  on('#assignBtn','click', assignBarcode);
}

window.addEventListener('load', bindUI);
