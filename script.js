/* ===============================
   SCRIPT — MagaGrafix Gestionale (v5, CORS fix)
   =============================== */

/* ---- CONFIG ---- */
const LS_KEY = 'magagrafix_app_v5';
const LOW_STOCK_THRESHOLD = 4;
// INCOLLA QUI IL TUO URL DI APPS SCRIPT (Deploy > Web app)
const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbxkecv4EPEFDf0-48OOSOzetXVE6LrQyBk6cAqEALtK3P5vrJ7LJMnFPb-cL4X4c_SF/exec';

/* ---- DATA ---- */
let store = {
  items: [],
  transactions: [],
  snapshots: [],
  logoDataUrl: '',
  companyName: ''
};

/* ---- INIT ---- */
window.addEventListener('load', async () => {
  loadStore();

  // bind companyName al volo
  const companyInput = document.getElementById('companyName');
  if (companyInput) {
    companyInput.value = store.companyName || '';
    companyInput.addEventListener('input', () => {
      store.companyName = companyInput.value || '';
      saveStore();
    });
  }

  // prova a caricare lo stato centrale da Drive
  await loadFromDrive();
  renderAll();
  bindEvents();
});

/* ---- LOCAL STORAGE ---- */
function loadStore() {
  const raw = localStorage.getItem(LS_KEY);
  if (raw) {
    try { store = JSON.parse(raw); } catch (e) { console.error(e); }
  }
}
function saveStore() {
  localStorage.setItem(LS_KEY, JSON.stringify(store));
  scheduleSync(); // debounce per non tempestare il server
}

/* ---- DRIVE SYNC ---- */
let syncTimer = null;
let autoSyncInterval = null;

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncToDrive, 800);
}

// ✅ POST “semplice” (no preflight CORS)
async function syncToDrive() {
  if (!WEBAPP_URL) return;
  try {
    const body = new URLSearchParams();
    body.set('action', 'save');
    body.set('data', JSON.stringify(store)); // JSON come stringa

    const res = await fetch(WEBAPP_URL, {
      method: 'POST',
      body // niente headers ⇒ niente preflight
    });

    const txt = await res.text();
    console.log('✅ Dati salvati su Drive:', txt);
  } catch (err) {
    console.error('❌ Errore salvataggio su Drive:', err);
  }
}

async function loadFromDrive() {
  if (!WEBAPP_URL) return;
  try {
    const res = await fetch(WEBAPP_URL + '?action=load');
    const data = await res.json();
    if (data && data.items) {
      store = data;
      localStorage.setItem(LS_KEY, JSON.stringify(store));
      const companyInput = document.getElementById('companyName');
      if (companyInput) companyInput.value = store.companyName || '';
      console.log('✅ Dati caricati da Drive');
    } else {
      console.warn('⚠️ Nessun dato valido su Drive (inizializzo).');
    }
  } catch (err) {
    console.error('❌ Errore caricamento da Drive:', err);
  }
}

/* ---- UTILS ---- */
const uid = () => 'TX' + Date.now() + Math.floor(Math.random() * 999);
const fmt = n => Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const findItem = sku => store.items.find(i => i.sku === sku);

/* ---- EVENTS ---- */
function bindEvents() {
  // Item
  document.getElementById('addItemBtn').onclick = addOrUpdateItem;
  document.getElementById('clearItemBtn').onclick = clearItemForm;

  // Transazioni
  document.getElementById('addTxBtn').onclick = addTransaction;
  document.getElementById('clearTxBtn').onclick = clearTxForm;

  // Grafici / PDF
  document.getElementById('filterChartBtn').onclick = refreshCharts;
  document.getElementById('downloadChartBtn').onclick = exportPeriodPDF;
  document.getElementById('exportPdfBtn').onclick = exportFullPDF;

  // Logo
  document.getElementById('removeLogoBtn').onclick = removeLogo;
  document.getElementById('logoFile').onchange = loadLogo;

  // Sync manuale
  const syncNowBtn = document.getElementById('syncNowBtn');
  if (syncNowBtn) syncNowBtn.onclick = async () => {
    await syncToDrive();
    await loadFromDrive();
    renderAll();
  };

  // Export / Import JSON
  const exportBtn = document.getElementById('exportJsonBtn');
  const importBtn = document.getElementById('importJsonBtn');
  const fileInput = document.getElementById('jsonFileInput');
  if (exportBtn) exportBtn.onclick = exportJSON;
  if (importBtn) importBtn.onclick = () => fileInput.click();
  if (fileInput) fileInput.onchange = importJSON;

  // AutoSync 30s
  const autoToggle = document.getElementById('autoSyncToggle');
  if (autoToggle) {
    autoToggle.addEventListener('change', () => {
      if (autoToggle.checked) {
        if (autoSyncInterval) clearInterval(autoSyncInterval);
        autoSyncInterval = setInterval(async () => {
          await syncToDrive();
          await loadFromDrive();
          renderAll();
        }, 30000);
      } else {
        clearInterval(autoSyncInterval);
        autoSyncInterval = null;
      }
    });
  }
}

/* ---- ITEM MANAGEMENT ---- */
function addOrUpdateItem() {
  const sku = document.getElementById('sku').value.trim();
  const name = document.getElementById('name').value.trim();
  const position = document.getElementById('position').value.trim();
  const stockInit = Number(document.getElementById('stockInit').value || 0);
  const costPrice = Number(document.getElementById('costPrice').value || 0);
  const sellPrice = Number(document.getElementById('sellPrice').value || 0);
  if (!sku || !name) { alert('Inserisci SKU e nome.'); return; }

  let item = findItem(sku);
  if (item) {
    item.name = name;
    item.position = position;
    item.stockInit = stockInit;
    item.costPrice = costPrice;
    item.sellPrice = sellPrice;
  } else {
    store.items.push({ sku, name, position, stockInit, costPrice, sellPrice });
  }

  saveStore();
  renderInventory();
  populateSkuSelect();
  clearItemForm();
}

function clearItemForm() {
  ['sku', 'name', 'position', 'stockInit', 'costPrice', 'sellPrice'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function deleteItem(sku) {
  if (!confirm('Eliminare definitivamente questo articolo?')) return;
  store.items = store.items.filter(i => i.sku !== sku);
  store.transactions = store.transactions.filter(t => t.sku !== sku);
  saveStore();
  renderAll();
}

function editItem(sku) {
  const it = findItem(sku);
  if (!it) return;
  document.getElementById('sku').value = it.sku;
  document.getElementById('name').value = it.name;
  document.getElementById('position').value = it.position;
  document.getElementById('stockInit').value = it.stockInit;
  document.getElementById('costPrice').value = it.costPrice;
  document.getElementById('sellPrice').value = it.sellPrice;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---- TRANSACTIONS ---- */
function addTransaction() {
  const sku = document.getElementById('txSku').value;
  const type = document.getElementById('txType').value;
  const qty = Number(document.getElementById('txQty').value || 0);
  const price = Number(document.getElementById('txSellPrice').value || 0);
  if (!sku || qty <= 0) { alert('Compila tutti i campi.'); return; }

  store.transactions.push({
    id: uid(),
    ts: Date.now(),
    sku,
    type,
    qty,
    price,
    confirmed: type !== 'OUT'
  });

  saveStore();
  renderAll();
  clearTxForm();
}

function clearTxForm() {
  document.getElementById('txSku').value = '';
  document.getElementById('txQty').value = 1;
  document.getElementById('txSellPrice').value = '';
}

function confirmTx(id) {
  const t = store.transactions.find(x => x.id === id);
  if (!t) return;
  if (t.type === 'OUT') {
    const newP = prompt('Conferma/modifica prezzo vendita (€)', t.price);
    if (newP !== null) t.price = Number(newP);
  }
  t.confirmed = true;
  saveStore();
  renderTransactions();
}

/* ---- RENDER ---- */
function renderAll() {
  renderInventory();
  renderTransactions();
  populateSkuSelect();
  refreshCharts();
}

function populateSkuSelect() {
  const sel = document.getElementById('txSku');
  sel.innerHTML = '<option value="">-- seleziona SKU --</option>';
  store.items.forEach(i => {
    const o = document.createElement('option');
    o.value = i.sku;
    o.textContent = `${i.sku} — ${i.name}`;
    sel.appendChild(o);
  });
}

function renderInventory() {
  const tbody = document.querySelector('#inventoryTable tbody');
  tbody.innerHTML = '';
  store.items.forEach(i => {
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
      </td>
    `;
    tbody.appendChild(tr);
  });
  lowStockAlert();
}

function calcStock(sku) {
  const item = findItem(sku);
  if (!item) return 0;
  let stock = item.stockInit || 0;
  store.transactions.filter(t => t.sku === sku).forEach(t => {
    if (t.type === 'IN') stock += t.qty;
    if (t.type === 'OUT' || t.type === 'ROTTURA') stock -= t.qty;
  });
  return stock;
}

function renderTransactions() {
  const tbody = document.querySelector('#transactionsTable tbody');
  tbody.innerHTML = '';
  store.transactions.slice().reverse().forEach(t => {
    const d = new Date(t.ts).toLocaleString('it-IT');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${d}</td>
      <td>${t.sku}</td>
      <td>${t.type}</td>
      <td>${t.qty}</td>
      <td>${fmt(t.price)}</td>
      <td>${t.confirmed ? '✅' : '❌'}</td>
      <td><button onclick="confirmTx('${t.id}')">Conferma</button></td>
    `;
    tbody.appendChild(tr);
  });
}

/* ---- ALERT ---- */
function lowStockAlert() {
  const low = store.items.filter(i => calcStock(i.sku) <= LOW_STOCK_THRESHOLD);
  const bar = document.getElementById('alertLow');
  if (low.length) {
    bar.textContent = '⚠️ Scorte basse: ' + low.map(i => `${i.sku} (${calcStock(i.sku)})`).join(', ');
    bar.classList.remove('hidden');
  } else bar.classList.add('hidden');
}

/* ---- CHARTS ---- */
let trendChart, pieChart;

function refreshCharts() {
  const from = document.getElementById('fromDate').value
    ? new Date(document.getElementById('fromDate').value).getTime()
    : 0;
  const to = document.getElementById('toDate').value
    ? new Date(document.getElementById('toDate').value).getTime()
    : Date.now();

  // andamento giornaliero (saldo)
  const daily = {};
  store.transactions.forEach(t => {
    if (t.ts >= from && t.ts <= to) {
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
    data: {
      labels,
      datasets: [{
        label: 'Stock giornaliero',
        data,
        borderColor: '#ff8c1a',
        backgroundColor: 'rgba(255,140,26,0.25)',
        tension: 0.3,
        fill: true
      }]
    },
    options: {
      plugins: { legend: { labels: { color: '#fff' } } },
      scales: { x: { ticks: { color: '#fff' } }, y: { ticks: { color: '#fff' } } }
    }
  });

  // torta costi/vendite/profitto
  let inVal = 0, outVal = 0;
  store.transactions.forEach(t => {
    if (t.ts >= from && t.ts <= to) {
      const item = findItem(t.sku); if (!item) return;
      if (t.type === 'IN' || t.type === 'ROTTURA') inVal += t.qty * item.costPrice;
      if (t.type === 'OUT') outVal += t.qty * t.price;
    }
  });
  const profit = outVal - inVal;

  if (pieChart) pieChart.destroy();
  pieChart = new Chart(document.getElementById('pieChart'), {
    type: 'pie',
    data: {
      labels: ['Entrate (costi)', 'Uscite (vendite)', 'Guadagno netto'],
      datasets: [{ data: [inVal, outVal, profit], backgroundColor: ['#ff8c1a', '#45a29e', '#66fcf1'] }]
    },
    options: { plugins: { legend: { labels: { color: '#fff', font: { size: 14 } } } } }
  });
}

/* ---- LOGO ---- */
function loadLogo(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => { store.logoDataUrl = ev.target.result; saveStore(); };
  reader.readAsDataURL(file);
}
function removeLogo() { store.logoDataUrl = ''; saveStore(); }

/* ---- PDF ---- */
async function exportFullPDF() {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'pt', 'a4');
  const logo = store.logoDataUrl;
  const name = store.companyName || 'MagaGrafix';

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(20);
  pdf.text(name, 40, 50);
  if (logo) pdf.addImage(logo, 'PNG', 450, 20, 100, 60);

  pdf.text('Inventario', 40, 100);
  let y = 120;
  store.items.forEach(i => {
    const s = calcStock(i.sku);
    pdf.setFontSize(10);
    pdf.text(
      `${i.sku} — ${i.name} (${i.position}) | Stock: ${s} | Costo: €${fmt(i.costPrice)} | Valore: €${fmt(s * i.costPrice)}`,
      40, y
    );
    y += 16;
    if (y > 750) { pdf.addPage(); y = 40; }
  });

  pdf.save('magagrafix_inventario.pdf');
}

async function exportPeriodPDF() {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'pt', 'a4');
  const from = document.getElementById('fromDate').value || 'inizio';
  const to = document.getElementById('toDate').value || 'oggi';
  pdf.setFont('helvetica', 'bold');
  pdf.text(`Periodo: ${from} - ${to}`, 40, 50);
  const canvas = document.getElementById('trendChart');
  const img = canvas.toDataURL('image/png', 1.0);
  pdf.addImage(img, 'PNG', 40, 70, 500, 300);
  pdf.save(`magagrafix_periodo_${from}_${to}.pdf`);
}

/* ---- JSON IMPORT/EXPORT ---- */
function exportJSON() {
  const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'magagrafix_store_backup.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importJSON(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const obj = JSON.parse(e.target.result);
      if (obj && typeof obj === 'object') {
        store = Object.assign(
          { items: [], transactions: [], snapshots: [], logoDataUrl: '', companyName: '' },
          obj
        );
        saveStore();
        renderAll();
        // dopo import, scrivo subito su Drive
        syncToDrive();
      } else {
        alert('JSON non valido.');
      }
    } catch (err) {
      alert('Errore nel parsing del JSON.');
      console.error(err);
    }
    ev.target.value = '';
  };
  reader.readAsText(file, 'utf-8');
}

