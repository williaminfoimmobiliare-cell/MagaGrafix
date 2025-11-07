/* =========================================
   MagaGrafix — script.js (v8 robust sync)
   ========================================= */

/* ---- CONFIG ---- */
const LS_KEY = 'magagrafix_app_v8';
const LOW_STOCK_THRESHOLD = 4;
// ⚠️ INCOLLA QUI L'URL DELLA TUA WEB APP (Apps Script → Deploy → Web app)
const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbzQtjEOgy1pA7RvRBU4R70bLBz6tOwJ0u74aXoZXwn9Dp0ahZt6Cey8ql9ez5Qp1Hcd/exec';
// (facoltativo) se in Code.gs usi una chiave ?key=... , mettila qui:
const WRITE_KEY = ''; // es. 'mia-chiave' oppure '' se non usi la chiave

/* ---- THEME ---- */
const THEME_KEY = 'magagrafix_theme';
function applyTheme(theme){
  const root = document.documentElement;
  if (theme === 'light'){ root.classList.add('theme-light'); root.classList.remove('theme-dark'); }
  else { root.classList.add('theme-dark'); root.classList.remove('theme-light'); }
  localStorage.setItem(THEME_KEY, theme);
}
function initTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') applyTheme(saved);
  else {
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    applyTheme(prefersLight ? 'light' : 'dark');
  }
}

/* ---- DATA ---- */
let store = {
  version: 1,
  lastWriteTs: Date.now(),
  items: [],
  transactions: [],
  snapshots: [],
  logoDataUrl: '',
  companyName: ''
};

/* ---- INIT ---- */
window.addEventListener('load', async () => {
  initTheme();
  loadStore();

  const companyInput = document.getElementById('companyName');
  if (companyInput){
    companyInput.value = store.companyName || '';
    companyInput.addEventListener('input', () => {
      store.companyName = companyInput.value || '';
      saveStore();
    });
  }

  await loadFromDrive(); // tenta il primo pull
  renderAll();
  bindEvents();
});

/* ---- LOCAL STORAGE ---- */
function loadStore(){
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return;
  try { store = JSON.parse(raw); } catch(e){ console.error(e); }
}
function saveStore(){
  store.version = (store.version || 0) + 1;
  store.lastWriteTs = Date.now();
  localStorage.setItem(LS_KEY, JSON.stringify(store));
  scheduleSync();
}

/* ---- SYNC ---- */
let syncTimer = null;
let syncing = false;
let autoSyncInterval = null;

function setSyncBadge(text, kind='info'){
  const el = document.getElementById('syncStatus');
  if (!el) return;
  el.textContent = `Sync: ${text}`;
  el.style.color = (kind==='ok') ? '#10b981' : (kind==='warn') ? '#f59e0b' : (kind==='err') ? '#ef4444' : '';
}

function scheduleSync(){
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncToDrive, 700);
}

// POST “semplice” (no CORS preflight) + retry leggero
async function syncToDrive(){
  if (!WEBAPP_URL || syncing) return;
  try{
    syncing = true;
    setSyncBadge('invio…','info');

    const body = new URLSearchParams();
    body.set('action','save');
    body.set('data', JSON.stringify(store));
    if (WRITE_KEY) body.set('key', WRITE_KEY);

    let res = await fetch(WEBAPP_URL, { method:'POST', body });
    if (!res.ok) {
      // piccolo retry una volta
      await new Promise(r=>setTimeout(r, 600));
      res = await fetch(WEBAPP_URL, { method:'POST', body });
    }
    const txt = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} ${txt}`);
    setSyncBadge('ok','ok');
    console.log('✅ Dati salvati su Drive');
  }catch(err){
    console.error('❌ Errore salvataggio su Drive:', err);
    setSyncBadge('errore','err');
  }finally{
    syncing = false;
  }
}

// GET + merge (non sovrascrive in blocco) + key opzionale
async function loadFromDrive(){
  if (!WEBAPP_URL || syncing) return;
  try{
    setSyncBadge('lettura…','info');
    const url = new URL(WEBAPP_URL);
    url.searchParams.set('action','load');
    if (WRITE_KEY) url.searchParams.set('key', WRITE_KEY);

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const remote = await res.json();

    if (!remote || typeof remote !== 'object' || !Array.isArray(remote.items)) {
      console.warn('⚠️ Dati remoti non validi');
      setSyncBadge('dati non validi','warn');
      return;
    }
    const merged = mergeStores(store, remote);
    store = merged;
    localStorage.setItem(LS_KEY, JSON.stringify(store));

    const companyInput = document.getElementById('companyName');
    if (companyInput) companyInput.value = store.companyName || '';

    setSyncBadge('ok','ok');
    console.log('✅ Merge con Drive completato (v' + store.version + ')');
  }catch(err){
    console.error('❌ Errore caricamento/merge da Drive:', err);
    setSyncBadge('errore','err');
  }
}

/* ---- MERGE ENGINE ---- */
function mergeStores(local, remote){
  const out = {
    version: Math.max(local.version || 0, remote.version || 0),
    lastWriteTs: Math.max(local.lastWriteTs || 0, remote.lastWriteTs || 0),
    items: [], transactions: [], snapshots: [],
    logoDataUrl: '', companyName: ''
  };

  // Items per SKU → updatedAt più recente
  const bySku = new Map();
  (remote.items || []).forEach(it => bySku.set(it.sku, it));
  (local.items || []).forEach(it => {
    const r = bySku.get(it.sku);
    if (!r){ bySku.set(it.sku, it); return; }
    bySku.set(it.sku, (it.updatedAt||0) >= (r.updatedAt||0) ? it : r);
  });
  out.items = Array.from(bySku.values());

  // Transactions per id → updatedAt (fallback ts)
  const byId = new Map();
  (remote.transactions || []).forEach(t => byId.set(t.id, t));
  (local.transactions || []).forEach(t => {
    const r = byId.get(t.id);
    if (!r){ byId.set(t.id, t); return; }
    const lt = t.updatedAt || t.ts || 0;
    const rt = r.updatedAt || r.ts || 0;
    byId.set(t.id, lt >= rt ? t : r);
  });
  out.transactions = Array.from(byId.values()).sort((a,b)=>(a.ts||0)-(b.ts||0));

  // Logo / companyName: fonte più recente
  if ((local.lastWriteTs||0) >= (remote.lastWriteTs||0)){
    out.logoDataUrl = local.logoDataUrl || '';
    out.companyName = local.companyName || '';
  } else {
    out.logoDataUrl = remote.logoDataUrl || '';
    out.companyName = remote.companyName || '';
  }

  out.version = (out.version||0) + 1;
  out.lastWriteTs = Date.now();
  return out;
}

/* ---- UTILS ---- */
const uid = () => 'TX' + Date.now() + Math.floor(Math.random()*999);
const fmt = n => Number(n||0).toLocaleString('it-IT',{minimumFractionDigits:2, maximumFractionDigits:2});
const findItem = sku => store.items.find(i => i.sku === sku);

/* Mobile cards: data-label sui TD */
function decorateTablesForMobile(){
  ['inventoryTable','transactionsTable'].forEach(id=>{
    const table = document.getElementById(id);
    if (!table) return;
    const heads = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
    table.querySelectorAll('tbody tr').forEach(tr=>{
      [...tr.children].forEach((td,i)=> td.setAttribute('data-label', heads[i] || ''));
    });
  });
}

/* ---- EVENTS ---- */
function bindEvents(){
  // Item
  document.getElementById('addItemBtn').onclick = addOrUpdateItem;
  document.getElementById('clearItemBtn').onclick = clearItemForm;

  // Tx
  document.getElementById('addTxBtn').onclick = addTransaction;
  document.getElementById('clearTxBtn').onclick = clearTxForm;

  // Charts / PDF
  document.getElementById('filterChartBtn').onclick = refreshCharts;
  document.getElementById('downloadChartBtn').onclick = exportPeriodPDF;
  document.getElementById('exportPdfBtn').onclick = exportFullPDF;

  // Logo
  document.getElementById('removeLogoBtn').onclick = removeLogo;
  document.getElementById('logoFile').onchange = loadLogo;

  // Sync manuale
  const syncNowBtn = document.getElementById('syncNowBtn');
  if (syncNowBtn) syncNowBtn.onclick = async ()=>{
    await syncToDrive();
    await new Promise(r=>setTimeout(r, 1000));
    await loadFromDrive();
    renderAll();
  };

  // Export/Import
  const exportBtn = document.getElementById('exportJsonBtn');
  const importBtn = document.getElementById('importJsonBtn');
  const fileInput = document.getElementById('jsonFileInput');
  if (exportBtn) exportBtn.onclick = exportJSON;
  if (importBtn) importBtn.onclick = ()=> fileInput.click();
  if (fileInput) fileInput.onchange = importJSON;

  // AutoSync 30s (pull)
  const autoToggle = document.getElementById('autoSyncToggle');
  if (autoToggle){
    autoToggle.addEventListener('change', ()=>{
      if (autoToggle.checked){
        if (autoSyncInterval) clearInterval(autoSyncInterval);
        autoSyncInterval = setInterval(async ()=>{
          await loadFromDrive();
          renderAll();
        }, 30000);
      } else {
        clearInterval(autoSyncInterval);
        autoSyncInterval = null;
      }
    });
  }

  // Tema
  const themeBtn = document.getElementById('themeToggleBtn');
  if (themeBtn){
    themeBtn.onclick = ()=>{
      const cur = localStorage.getItem(THEME_KEY) || 'dark';
      applyTheme(cur === 'dark' ? 'light' : 'dark');
      refreshCharts(); // ricalibra colori etichette
    };
  }

  // Menu mobile
  const menuBtn = document.getElementById('menuToggle');
  const menuPanel = document.getElementById('menuPanel');
  if (menuBtn && menuPanel){
    menuBtn.onclick = ()=> menuPanel.classList.toggle('open');
    document.addEventListener('click', e=>{
      if (!menuPanel.contains(e.target) && e.target !== menuBtn){
        menuPanel.classList.remove('open');
      }
    });
  }
}

/* ---- ITEM MANAGEMENT ---- */
function addOrUpdateItem(){
  const sku = document.getElementById('sku').value.trim();
  const name = document.getElementById('name').value.trim();
  const position = document.getElementById('position').value.trim();
  const stockInit = Number(document.getElementById('stockInit').value || 0);
  const costPrice = Number(document.getElementById('costPrice').value || 0);
  const sellPrice = Number(document.getElementById('sellPrice').value || 0);
  if (!sku || !name){ alert('Inserisci SKU e nome.'); return; }

  let item = findItem(sku);
  const now = Date.now();
  if (item){
    item.name = name; item.position = position;
    item.stockInit = stockInit; item.costPrice = costPrice; item.sellPrice = sellPrice;
    item.updatedAt = now;
  } else {
    store.items.push({ sku, name, position, stockInit, costPrice, sellPrice, updatedAt: now });
  }

  saveStore();
  renderInventory();
  populateSkuSelect();
  clearItemForm();
}

function clearItemForm(){
  ['sku','name','position','stockInit','costPrice','sellPrice'].forEach(id=>{
    const el = document.getElementById(id); if (el) el.value = '';
  });
}

function deleteItem(sku){
  if (!confirm('Eliminare definitivamente questo articolo?')) return;
  store.items = store.items.filter(i=>i.sku !== sku);
  store.transactions = store.transactions.filter(t=>t.sku !== sku);
  saveStore();
  renderAll();
}

function editItem(sku){
  const it = findItem(sku); if (!it) return;
  document.getElementById('sku').value = it.sku;
  document.getElementById('name').value = it.name;
  document.getElementById('position').value = it.position;
  document.getElementById('stockInit').value = it.stockInit;
  document.getElementById('costPrice').value = it.costPrice;
  document.getElementById('sellPrice').value = it.sellPrice;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---- TRANSACTIONS ---- */
function addTransaction(){
  const sku = document.getElementById('txSku').value;
  const type = document.getElementById('txType').value;
  const qty = Number(document.getElementById('txQty').value || 0);
  const price = Number(document.getElementById('txSellPrice').value || 0);
  if (!sku || qty <= 0){ alert('Compila tutti i campi.'); return; }

  const now = Date.now();
  store.transactions.push({
    id: uid(), ts: now, sku, type, qty, price,
    confirmed: type !== 'OUT', updatedAt: now
  });

  saveStore();
  renderAll();
  clearTxForm();
}

function clearTxForm(){
  document.getElementById('txSku').value = '';
  document.getElementById('txQty').value = 1;
  document.getElementById('txSellPrice').value = '';
}

function confirmTx(id){
  const t = store.transactions.find(x=>x.id===id);
  if (!t) return;
  if (t.type === 'OUT'){
    const newP = prompt('Conferma/modifica prezzo vendita (€)', t.price);
    if (newP !== null) t.price = Number(newP);
  }
  t.confirmed = true; t.updatedAt = Date.now();
  saveStore();
  renderTransactions();
}

/* ---- RENDER ---- */
function renderAll(){
  renderInventory();
  renderTransactions();
  populateSkuSelect();
  refreshCharts();
  decorateTablesForMobile();
}

function populateSkuSelect(){
  const sel = document.getElementById('txSku');
  sel.innerHTML = '<option value="">-- seleziona SKU --</option>';
  store.items.forEach(i=>{
    const o = document.createElement('option');
    o.value = i.sku; o.textContent = `${i.sku} — ${i.name}`;
    sel.appendChild(o);
  });
}

function renderInventory(){
  const tbody = document.querySelector('#inventoryTable tbody');
  tbody.innerHTML = '';
  store.items.forEach(i=>{
    const stock = calcStock(i.sku);
    const val = stock * i.costPrice;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i.sku}</td>
      <td>${i.name}</td>
      <td>${i.position}</td>
      <td>${stock}</td>
      <td>${fmt(i.costPrice)}</td>
      <td>${fmt(val)}</td>
      <td>
        <button onclick="editItem('${i.sku}')">✏️</button>
        <button onclick="deleteItem('${i.sku}')" class="ghost">🗑️</button>
      </td>`;
    tbody.appendChild(tr);
  });
  lowStockAlert();
  decorateTablesForMobile();
}

function calcStock(sku){
  const item = findItem(sku); if (!item) return 0;
  let stock = item.stockInit || 0;
  store.transactions.filter(t=>t.sku===sku).forEach(t=>{
    if (t.type === 'IN') stock += t.qty;
    if (t.type === 'OUT' || t.type === 'ROTTURA') stock -= t.qty;
  });
  return stock;
}

function renderTransactions(){
  const tbody = document.querySelector('#transactionsTable tbody');
  tbody.innerHTML = '';
  store.transactions.slice().reverse().forEach(t=>{
    const d = new Date(t.ts).toLocaleString('it-IT');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${d}</td>
      <td>${t.sku}</td>
      <td>${t.type}</td>
      <td>${t.qty}</td>
      <td>${fmt(t.price)}</td>
      <td>${t.confirmed ? '✅' : '❌'}</td>
      <td><button onclick="confirmTx('${t.id}')">Conferma</button></td>`;
    tbody.appendChild(tr);
  });
  decorateTablesForMobile();
}

/* ---- ALERT ---- */
function lowStockAlert(){
  const low = store.items.filter(i => calcStock(i.sku) <= LOW_STOCK_THRESHOLD);
  const bar = document.getElementById('alertLow');
  if (low.length){
    bar.textContent = '⚠️ Scorte basse: ' + low.map(i => `${i.sku} (${calcStock(i.sku)})`).join(', ');
    bar.classList.remove('hidden');
  } else bar.classList.add('hidden');
}

/* ---- CHARTS ---- */
let trendChart, pieChart;

function cssVar(name){
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '';
}

function refreshCharts(){
  const from = document.getElementById('fromDate').value
    ? new Date(document.getElementById('fromDate').value).getTime() : 0;
  const to = document.getElementById('toDate').value
    ? new Date(document.getElementById('toDate').value).getTime() : Date.now();

  const labelColor = cssVar('--chart-label-color') || '#ffffff';

  // saldo giornaliero
  const daily = {};
  store.transactions.forEach(t=>{
    if (t.ts >= from && t.ts <= to){
      const day = new Date(t.ts).toISOString().split('T')[0];
      daily[day] = daily[day] || 0;
      if (t.type === 'IN') daily[day] += t.qty;
      if (t.type === 'OUT' || t.type === 'ROTTURA') daily[day] -= t.qty;
    }
  });
  const labels = Object.keys(daily).sort();
  const data = labels.map(l => daily[l]);

  if (trendChart) trendChart.destroy();
  trendChart = new Chart(document.getElementById('trendChart'), {
    type: 'line',
    data: { labels, datasets: [{ label: 'Stock giornaliero', data, borderColor: '#1E90FF', backgroundColor: 'rgba(30,144,255,0.2)', tension: 0.3, fill: true }] },
    options: {
      plugins: { legend: { labels: { color: labelColor } } },
      scales: { x: { ticks: { color: labelColor } }, y: { ticks: { color: labelColor } } }
    }
  });

  // costi/vendite/profitto
  let inVal = 0, outVal = 0;
  store.transactions.forEach(t=>{
    if (t.ts >= from && t.ts <= to){
      const item = findItem(t.sku); if (!item) return;
      if (t.type === 'IN' || t.type === 'ROTTURA') inVal += t.qty * item.costPrice;
      if (t.type === 'OUT') outVal += t.qty * t.price;
    }
  });
  const profit = outVal - inVal;

  if (pieChart) pieChart.destroy();
  pieChart = new Chart(document.getElementById('pieChart'), {
    type: 'pie',
    data: { labels: ['Entrate (costi)', 'Uscite (vendite)', 'Guadagno netto'], datasets: [{ data: [inVal, outVal, profit], backgroundColor: ['#94a3b8','#3b82f6','#10b981'] }] },
    options: { plugins: { legend: { labels: { color: labelColor, font: { size: 14 } } } } }
  });
}

/* ---- LOGO ---- */
function loadLogo(e){
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => { store.logoDataUrl = ev.target.result; saveStore(); };
  reader.readAsDataURL(file);
}
function removeLogo(){ store.logoDataUrl = ''; saveStore(); }

/* ---- PDF ---- */
async function exportFullPDF(){
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p','pt','a4');
  const logo = store.logoDataUrl;
  const name = store.companyName || 'MagaGrafix';

  pdf.setFont('helvetica','bold'); pdf.setFontSize(20);
  pdf.text(name, 40, 50);
  if (logo) pdf.addImage(logo, 'PNG', 450, 20, 100, 60);

  pdf.text('Inventario', 40, 100);
  let y = 120;
  store.items.forEach(i=>{
    const s = calcStock(i.sku);
    pdf.setFontSize(10);
    pdf.text(`${i.sku} — ${i.name} (${i.position}) | Stock: ${s} | Costo: €${fmt(i.costPrice)} | Valore: €${fmt(s * i.costPrice)}`, 40, y);
    y += 16; if (y > 750){ pdf.addPage(); y = 40; }
  });
  pdf.save('magagrafix_inventario.pdf');
}

async function exportPeriodPDF(){
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p','pt','a4');
  const from = document.getElementById('fromDate').value || 'inizio';
  const to = document.getElementById('toDate').value || 'oggi';
  pdf.setFont('helvetica','bold'); pdf.text(`Periodo: ${from} - ${to}`, 40, 50);
  const canvas = document.getElementById('trendChart');
  const img = canvas.toDataURL('image/png', 1.0);
  pdf.addImage(img, 'PNG', 40, 70, 500, 300);
  pdf.save(`magagrafix_periodo_${from}_${to}.pdf`);
}

/* ---- JSON I/O ---- */
function exportJSON(){
  const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'magagrafix_store_backup.json';
  a.click(); URL.revokeObjectURL(a.href);
}
function importJSON(ev){
  const file = ev.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e=>{
    try{
      const obj = JSON.parse(e.target.result);
      if (obj && typeof obj === 'object'){
        store = Object.assign(
          { version:(store.version||1), lastWriteTs:Date.now(), items:[], transactions:[], snapshots:[], logoDataUrl:'', companyName:'' },
          obj
        );
        const now = Date.now();
        store.items.forEach(i=>{ if (!i.updatedAt) i.updatedAt = now; });
        store.transactions.forEach(t=>{ if (!t.updatedAt) t.updatedAt = t.ts || now; });

        saveStore(); renderAll();
        syncToDrive();
      } else alert('JSON non valido.');
    }catch(err){
      alert('Errore nel parsing del JSON.'); console.error(err);
    }
    ev.target.value = '';
  };
  reader.readAsText(file, 'utf-8');
}

