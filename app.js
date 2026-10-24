/* ============ PENGATURAN ============ */
// Ganti dengan URL Web App Google Apps Script Anda (berakhiran /exec)
const API_URL = 'https://script.google.com/macros/s/AKfycbybZI36ggk5mquxQA_syc5QhuMIUhf3HRalxxExAMVkOi17E2xeZbrn_vuGtB11Gd-YUQ/exec';
const PER_PAGE = 8;
const CACHE_KEY = 'catatan_keuangan_cache_v1';
const PDF_LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js'
];
const LABEL = { pemasukan: 'Pemasukkan', pengeluaran: 'Pengeluaran' };

/* ============ STATE ============ */
let data = [];                                   // {id, tanggal, jenis, judul, detail, nominal}
let q = '';                                      // kata kunci
const range = { trx: { dari: '', sampai: '' }, shopee: { dari: '', sampai: '' } };
const page = { trx: 1, shopee: 1 };
let editingId = null;
let formMode = 'trx';                            // 'trx' | 'shopee'
let rangeTarget = 'trx';

/* ============ UTIL ============ */
const $ = id => document.getElementById(id);

function rp(n) {
  n = Number(n) || 0;
  return (n < 0 ? '-' : '') + 'Rp ' + Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function tglKecil(s) {                            // 2026-10-24 -> 24/10/26
  if (!s) return '';
  const p = s.split('-');
  return p[2] + '/' + p[1] + '/' + p[0].slice(2);
}
function tglPdf(s) {                              // 2026-10-24 -> 24/10/2026
  if (!s) return '';
  const p = s.split('-');
  return p[2] + '/' + p[1] + '/' + p[0];
}
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
}

/* ============ DATA ============ */
function inRange(r, rg) {
  return (!rg.dari || r.tanggal >= rg.dari) && (!rg.sampai || r.tanggal <= rg.sampai);
}
function matchQ(r) {
  if (!q) return true;
  const teks = (r.judul + ' ' + (r.jenis === 'shopee' ? '' : LABEL[r.jenis] + ' ' + r.detail)).toLowerCase();
  return teks.indexOf(q) > -1;
}
function rowsOf(kind, useQ) {
  return data.filter(r =>
    (kind === 'shopee' ? r.jenis === 'shopee' : r.jenis !== 'shopee') &&
    inRange(r, range[kind]) && (!useQ || matchQ(r)));
}
function byNewest(list) {
  return list.slice().reverse().sort((a, b) => (a.tanggal < b.tanggal ? 1 : a.tanggal > b.tanggal ? -1 : 0));
}
function sum(list) { return list.reduce((t, r) => t + (Number(r.nominal) || 0), 0); }

function saveCache() { try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) {} }
function readCache() {
  try { const c = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]'); if (Array.isArray(c)) data = c; } catch (e) {}
}

async function api(payload) {
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'Gagal');
  return j;
}
async function loadData() {
  if (API_URL.indexOf('GANTI_') === 0) { toast('Isi API_URL di app.js dulu'); return; }
  try {
    const r = await fetch(API_URL + '?action=list');
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Gagal');
    data = j.data;
    saveCache();
    render();
  } catch (e) {
    toast('Gagal memuat data. Periksa koneksi.');
  }
}

/* ============ RENDER ============ */
function render() {
  // kartu: total dari seluruh data
  const tM = sum(data.filter(r => r.jenis === 'pemasukan'));
  const tK = sum(data.filter(r => r.jenis === 'pengeluaran'));
  const tS = sum(data.filter(r => r.jenis === 'shopee'));
  $('vTotal').textContent = rp(tM - tK);
  $('vMasuk').textContent = rp(tM);
  $('vKeluar').textContent = rp(tK);
  $('vShopee').textContent = rp(tS);

  renderTable('trx');
  renderTable('shopee');
  ['trx', 'shopee'].forEach(k => {
    const g = range[k];
    $(k === 'trx' ? 'rpTrx' : 'rpShopee').textContent = (g.dari || g.sampai)
      ? (g.dari ? tglKecil(g.dari) : '...') + ' - ' + (g.sampai ? tglKecil(g.sampai) : '...')
      : 'Pilih rentang waktu';
  });
}

function renderTable(kind) {
  const isShopee = kind === 'shopee';
  const rows = byNewest(rowsOf(kind, true));
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  if (page[kind] > pages) page[kind] = pages;
  const start = (page[kind] - 1) * PER_PAGE;
  let html = '';
  for (let i = 0; i < PER_PAGE; i++) {
    const r = rows[start + i];
    const no = '<td class="no">' + (start + i + 1) + '.</td>';
    if (!r) { html += '<tr>' + no + '<td></td>' + (isShopee ? '' : '<td class="rin"></td>') + '<td></td></tr>'; continue; }
    html += '<tr class="has" data-id="' + esc(r.id) + '">' + no + '<td>' + esc(r.judul) + '</td>' +
      (isShopee ? '' : '<td class="rin ' + (r.jenis === 'pemasukan' ? 'in' : 'out') + '">' + LABEL[r.jenis] + '</td>') +
      '<td class="nom">' + rp(r.nominal) + '</td></tr>';
  }
  $(isShopee ? 'bodyShopee' : 'bodyTrx').innerHTML = html;

  const cur = page[kind];
  const first = Math.max(1, Math.min(cur - 1, pages - 2));
  const last = Math.min(pages, first + 2);
  let p = '<button class="nav" data-go="prev"' + (cur <= 1 ? ' disabled' : '') + '>Sebelum</button>';
  for (let n = first; n <= last; n++) p += '<button class="num' + (n === cur ? ' on' : '') + '" data-go="' + n + '">' + n + '</button>';
  p += '<button class="nav" data-go="next"' + (cur >= pages ? ' disabled' : '') + '>Sesudah</button>';
  $(isShopee ? 'pagerShopee' : 'pagerTrx').innerHTML = p;
}

function pagerClick(kind) {
  return e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const g = b.dataset.go;
    page[kind] = g === 'prev' ? page[kind] - 1 : g === 'next' ? page[kind] + 1 : Number(g);
    renderTable(kind);
  };
}
function rowClick(e) {
  const tr = e.target.closest('tr.has');
  const item = tr && data.find(r => r.id === tr.dataset.id);
  if (item) openForm(item.jenis === 'shopee' ? 'shopee' : 'trx', item);
}

/* ============ FORM POPUP ============ */
function formatNominal() {
  const el = $('fNominal');
  el.value = el.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
function openForm(mode, item) {
  formMode = mode;
  editingId = item ? item.id : null;
  const shopee = mode === 'shopee';
  $('formTitle').textContent = (item ? 'Ubah ' : 'Tambah ') + (shopee ? 'pemasukkan Shopee' : 'transaksi');
  $('rowJenis').hidden = shopee;
  $('lJudul').textContent = shopee ? 'Pembeli' : 'Transaksi';
  $('fJenis').value = item && !shopee ? item.jenis : 'pengeluaran';
  $('fTanggal').value = item ? item.tanggal : todayStr();
  $('fJudul').value = item ? item.judul : '';
  $('fNominal').value = item ? String(item.nominal) : '';
  formatNominal();
  $('btnHapus').hidden = !item;
  $('modal').hidden = false;
}
function closeForm() { $('modal').hidden = true; editingId = null; }

function saveForm() {
  const jenis = formMode === 'shopee' ? 'shopee' : $('fJenis').value;
  const tanggal = $('fTanggal').value;
  const judul = $('fJudul').value.trim();
  const nominal = Number($('fNominal').value.replace(/\D/g, ''));
  if (!tanggal) { toast('Isi tanggalnya dulu'); return; }
  if (!judul) { toast('Isi ' + $('lJudul').textContent.toLowerCase() + ' dulu'); return; }
  if (!nominal) { toast('Isi nominal lebih dari 0'); return; }

  const old = editingId ? data.find(r => r.id === editingId) : null;
  const item = {
    id: editingId || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
    tanggal, jenis, judul, detail: old ? old.detail : '', nominal
  };
  const isEdit = !!old;
  if (isEdit) data[data.indexOf(old)] = item; else data.push(item);
  saveCache();
  closeForm();
  render();
  api({ action: isEdit ? 'edit' : 'add', item })
    .then(() => toast('Tersimpan'))
    .catch(() => { toast('Gagal menyimpan. Memuat ulang data...'); loadData(); });
}

function deleteForm() {
  if (!editingId || !confirm('Hapus data ini?')) return;
  const id = editingId;
  data = data.filter(r => r.id !== id);
  saveCache();
  closeForm();
  render();
  api({ action: 'delete', id })
    .then(() => toast('Terhapus'))
    .catch(() => { toast('Gagal menghapus. Memuat ulang data...'); loadData(); });
}

/* ============ RENTANG WAKTU (per tabel) ============ */
function openRange(kind) {
  rangeTarget = kind;
  $('rangeTitle').textContent = kind === 'shopee' ? 'Rentang waktu Shopee' : 'Rentang waktu transaksi';
  $('rDari').value = range[kind].dari;
  $('rSampai').value = range[kind].sampai;
  $('rangeModal').hidden = false;
}
function applyRange() {
  let d = $('rDari').value, s = $('rSampai').value;
  if (d && s && d > s) { const t = d; d = s; s = t; }
  range[rangeTarget] = { dari: d, sampai: s };
  page[rangeTarget] = 1;
  $('rangeModal').hidden = true;
  render();
}
function resetRange() { $('rDari').value = ''; $('rSampai').value = ''; applyRange(); }

/* ============ KATA KUNCI ============ */
let qTimer;
function applyQ() {
  q = $('q').value.trim().toLowerCase();
  page.trx = 1; page.shopee = 1;
  renderTable('trx'); renderTable('shopee');
}

/* ============ DOWNLOAD REKAP (PDF) ============ */
function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => fail(new Error(src));
    document.head.appendChild(s);
  });
}
function periodeText(g) {
  return (g.dari || g.sampai) ? ' (' + (g.dari ? tglPdf(g.dari) : 'awal') + ' - ' + (g.sampai ? tglPdf(g.sampai) : 'sekarang') + ')' : '';
}
async function downloadRekap() {
  const btn = $('btnRekap');
  btn.disabled = true;
  btn.textContent = 'Menyiapkan...';
  try {
    if (!window.jspdf) { await loadScript(PDF_LIBS[0]); await loadScript(PDF_LIBS[1]); }
    const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
    const asc = l => l.slice().sort((a, b) => (a.tanggal > b.tanggal ? 1 : a.tanggal < b.tanggal ? -1 : 0));
    const trx = asc(rowsOf('trx', false));
    const masuk = trx.filter(r => r.jenis === 'pemasukan');
    const keluar = trx.filter(r => r.jenis === 'pengeluaran');
    const shopee = asc(rowsOf('shopee', false));
    const tM = sum(masuk), tK = sum(keluar), tS = sum(shopee);

    doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
    doc.text('Rekap Catatan Keuangan', 40, 48);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text('Dicetak: ' + tglPdf(todayStr()), 40, 66);

    doc.autoTable({
      startY: 80,
      head: [['Ringkasan', 'Nominal']],
      body: [['Pemasukkan', rp(tM)], ['Pengeluaran', rp(tK)], ['Total Saldo', rp(tM - tK)], ['Shopee', rp(tS)]],
      theme: 'grid', styles: { fontSize: 10 },
      headStyles: { fillColor: [200, 93, 150] },
      columnStyles: { 1: { halign: 'right' } },
      margin: { left: 40, right: 40 }
    });

    function section(judul, rows, color, total) {
      let y = doc.lastAutoTable.finalY + 22;
      if (y > 760) { doc.addPage(); y = 50; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
      doc.text(judul, 40, y);
      if (!rows.length) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
        doc.text('Tidak ada data.', 40, y + 16);
        doc.lastAutoTable.finalY = y + 16;
        return;
      }
      doc.autoTable({
        startY: y + 8,
        head: [['Tanggal', judul.indexOf('Shopee') > -1 ? 'Pembeli' : 'Transaksi', 'Nominal']],
        body: rows.map(r => [tglPdf(r.tanggal), r.judul, rp(r.nominal)]),
        foot: [['Total', '', rp(total)]],
        showFoot: 'lastPage', theme: 'grid', styles: { fontSize: 9 },
        headStyles: { fillColor: color },
        footStyles: { fillColor: [245, 235, 240], textColor: 20 },
        columnStyles: { 2: { halign: 'right' } },
        margin: { left: 40, right: 40 }
      });
    }
    section('Pemasukkan' + periodeText(range.trx), masuk, [143, 155, 199], tM);
    section('Pengeluaran' + periodeText(range.trx), keluar, [217, 139, 168], tK);
    section('Pemasukkan Shopee' + periodeText(range.shopee), shopee, [161, 191, 220], tS);

    doc.save('rekap-keuangan-' + todayStr() + '.pdf');
  } catch (e) {
    toast('Gagal membuat PDF. Periksa koneksi internet.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Download Rekap';
  }
}

/* ============ EVENT ============ */
$('pagerTrx').addEventListener('click', pagerClick('trx'));
$('pagerShopee').addEventListener('click', pagerClick('shopee'));
$('bodyTrx').addEventListener('click', rowClick);
$('bodyShopee').addEventListener('click', rowClick);

$('addTrx').addEventListener('click', () => openForm('trx', null));
$('addShopee').addEventListener('click', () => openForm('shopee', null));
$('fNominal').addEventListener('input', formatNominal);
$('btnSimpan').addEventListener('click', saveForm);
$('btnBatal').addEventListener('click', closeForm);
$('btnHapus').addEventListener('click', deleteForm);
$('modal').addEventListener('click', e => { if (e.target === $('modal')) closeForm(); });

$('q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(applyQ, 150); });
$('q').addEventListener('keydown', e => { if (e.key === 'Enter') { applyQ(); $('q').blur(); } });
$('searchBtn').addEventListener('click', () => { applyQ(); $('q').blur(); });

$('rpTrx').addEventListener('click', () => openRange('trx'));
$('pbTrx').addEventListener('click', () => openRange('trx'));
$('rpShopee').addEventListener('click', () => openRange('shopee'));
$('pbShopee').addEventListener('click', () => openRange('shopee'));
$('rTerapkan').addEventListener('click', applyRange);
$('rReset').addEventListener('click', resetRange);
$('rBatal').addEventListener('click', () => { $('rangeModal').hidden = true; });
$('rangeModal').addEventListener('click', e => { if (e.target === $('rangeModal')) $('rangeModal').hidden = true; });

$('btnRekap').addEventListener('click', downloadRekap);

/* ============ MULAI ============ */
readCache();
render();
loadData();
