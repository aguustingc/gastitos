/* ============================================================
   GASTITOS — app.js
   PWA offline, 100% local. Sin dependencias.
   ============================================================ */

/* ---------- IndexedDB wrapper ---------- */

const DB_NAME = 'gastitos';
const DB_VERSION = 1;

const DB = {
  _db: null,
  async open(){
    if (this._db) return this._db;
    this._db = await new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (!db.objectStoreNames.contains('config'))       db.createObjectStore('config',       { keyPath: 'key' });
        if (!db.objectStoreNames.contains('categorias'))   db.createObjectStore('categorias',   { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('gastos'))      { const s = db.createObjectStore('gastos', { keyPath: 'id', autoIncrement: true }); s.createIndex('fecha', 'fecha'); s.createIndex('mes', 'mes'); }
        if (!db.objectStoreNames.contains('planes'))       db.createObjectStore('planes',       { keyPath: 'mes' });
        if (!db.objectStoreNames.contains('movimientos')) { const s = db.createObjectStore('movimientos', { keyPath: 'id', autoIncrement: true }); s.createIndex('mes', 'mes'); }
        if (!db.objectStoreNames.contains('recurrentes'))  db.createObjectStore('recurrentes',  { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    return this._db;
  },
  async tx(stores, mode='readonly'){
    const db = await this.open();
    return db.transaction(stores, mode);
  },
  _pr(req){ return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); },
  async getAll(store, indexName, range){
    const t = await this.tx(store); const s = t.objectStore(store);
    const src = indexName ? s.index(indexName) : s;
    return this._pr(src.getAll(range));
  },
  async get(store, key){
    const t = await this.tx(store); return this._pr(t.objectStore(store).get(key));
  },
  async put(store, val){
    const t = await this.tx(store, 'readwrite'); return this._pr(t.objectStore(store).put(val));
  },
  async add(store, val){
    const t = await this.tx(store, 'readwrite'); return this._pr(t.objectStore(store).add(val));
  },
  async del(store, key){
    const t = await this.tx(store, 'readwrite'); return this._pr(t.objectStore(store).delete(key));
  },
  async clear(store){
    const t = await this.tx(store, 'readwrite'); return this._pr(t.objectStore(store).clear());
  }
};

/* ---------- Categorías por defecto ---------- */

const DEFAULT_CATS = [
  { nombre: 'Supermercado',    color: '#4FA095', icono: '🛒', orden: 1 },
  { nombre: 'Comer afuera',    color: '#C9852E', icono: '🍔', orden: 2 },
  { nombre: 'Transporte',      color: '#7D8471', icono: '🚌', orden: 3 },
  { nombre: 'Servicios',       color: '#9AA89C', icono: '💡', orden: 4 },
  { nombre: 'Salud',           color: '#C0392B', icono: '💊', orden: 5 },
  { nombre: 'Entretenimiento', color: '#9568C9', icono: '🎬', orden: 6 },
  { nombre: 'Compras',         color: '#E29BB3', icono: '🛍️', orden: 7 },
  { nombre: 'Educación',       color: '#A8735A', icono: '📚', orden: 8 },
  { nombre: 'Otros',           color: '#7A8079', icono: '📦', orden: 99 }
];

async function ensureSeed(){
  const cats = await DB.getAll('categorias');
  if (cats.length === 0){
    for (const c of DEFAULT_CATS) await DB.add('categorias', c);
  }
  const cur = await DB.get('config', 'currency');
  if (!cur) await DB.put('config', { key: 'currency', value: '$' });
  const loc = await DB.get('config', 'locale');
  if (!loc) await DB.put('config', { key: 'locale', value: 'es-AR' });
}

/* ---------- Helpers ---------- */

const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const state = {
  view: 'hoy',
  mes: monthKey(new Date()),
  filterCat: null,
  searchQuery: '',
  cats: [], catsById: {},
  planActual: null,
  currency: '$', locale: 'es-AR',
  reminder: { enabled: false, hour: 20, dismissed: '' },
  notifiedToday: '',
  insightsTab: 'gastos',
  onboardDismissed: false
};

function monthKey(d){ const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); return `${y}-${m}`; }
function isoDate(d){ const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const day = String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
function parseISO(s){ const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); }
function monthLabel(mes){
  const [y,m] = mes.split('-').map(Number);
  const dt = new Date(y, m-1, 1);
  return dt.toLocaleDateString(state.locale, { month: 'long', year: 'numeric' });
}
function monthShort(mes){
  const [y,m] = mes.split('-').map(Number);
  return new Date(y, m-1, 1).toLocaleDateString(state.locale, { month: 'short' });
}
function shiftMonth(mes, delta){
  const [y,m] = mes.split('-').map(Number);
  const dt = new Date(y, m-1 + delta, 1);
  return monthKey(dt);
}
function daysInMonth(mes){
  const [y,m] = mes.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
function todayISO(){ return isoDate(new Date()); }
function todayLabel(){ return new Date().toLocaleDateString(state.locale, { weekday: 'long', day: 'numeric', month: 'long' }); }

function formatMoney(n, opts={}){
  const showDec = opts.showDec ?? (Math.abs(n) < 10000);
  const cents = Math.abs(Math.round((n - Math.trunc(n)) * 100));
  const intPart = Math.trunc(n).toLocaleString(state.locale, { maximumFractionDigits: 0 });
  const sign = n < 0 ? '-' : '';
  if (showDec) return `${sign}${intPart},${String(cents).padStart(2,'0')}`;
  return `${sign}${intPart}`;
}
function fm(n, opts){ return `${state.currency} ${formatMoney(n, opts)}`; }

function money(n, big=false){
  const negative = n < 0;
  const abs = Math.abs(n);
  const int = Math.trunc(abs).toLocaleString(state.locale);
  const cents = Math.round((abs - Math.trunc(abs)) * 100);
  if (big){
    return `<span class="cur">${state.currency}</span>${negative ? '−' : ''}${int}<span class="cents">,${String(cents).padStart(2,'0')}</span>`;
  }
  return `${state.currency} ${negative ? '−' : ''}${int},${String(cents).padStart(2,'0')}`;
}

// Money compacto sin decimales, para celdas chicas
function moneyC(n){
  const negative = n < 0;
  const abs = Math.abs(n);
  const int = Math.round(abs).toLocaleString(state.locale);
  return `${state.currency} ${negative ? '−' : ''}${int}`;
}

function ordinal(n){ return n; } // reservado
function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }

// Badge circular con ícono de categoría (color de fondo suave + emoji)
function catBadge(c, size){
  if (!c) return `<span class="cicon${size==='sm'?' sm':''}" style="background:#7A807933">📦</span>`;
  return `<span class="cicon${size==='sm'?' sm':''}" style="background:${c.color}33">${c.icono || '•'}</span>`;
}

/* ---------- Teclado numérico reutilizable ---------- */

// Formatea un "raw" (dígitos + opcional coma decimal, sin separador de miles)
// agregando puntos cada 3 dígitos en la parte entera, para mostrar mientras se tipea.
function formatRawForDisplay(raw){
  if (!raw) return '0';
  const [intPartRaw, decPart] = raw.split(',');
  const intDigits = (intPartRaw || '').replace(/\D/g, '');
  const formattedInt = intDigits === '' ? '0' : intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decPart !== undefined ? `${formattedInt},${decPart}` : formattedInt;
}

function keypadHtml(id, currency, initialValue){
  const initRaw = initialValue ? String(initialValue).replace('.', ',') : '';
  return `
    <div class="keypad-display" id="${id}-display">
      <span class="cur">${currency}</span><span class="val" data-raw="${esc(initRaw)}">${esc(formatRawForDisplay(initRaw))}</span>
    </div>
    <div class="keypad-grid" id="${id}-grid">
      ${['1','2','3','4','5','6','7','8','9',',','0','⌫'].map(k =>
        `<button type="button" class="${(k===','||k==='⌫') ? 'op' : ''}" data-k="${k}">${k}</button>`
      ).join('')}
    </div>
  `;
}

function wireKeypad(root, id, onChange){
  const valEl = root.querySelector(`#${id}-display .val`);
  let raw = valEl.dataset.raw || '';
  const render = () => {
    valEl.textContent = formatRawForDisplay(raw);
    onChange(Number(raw.replace(',', '.')) || 0);
  };
  $$(`#${id}-grid button`, root).forEach(btn => {
    btn.onclick = () => {
      const k = btn.dataset.k;
      if (k === '⌫'){ raw = raw.slice(0, -1); }
      else if (k === ','){ if (raw === '') raw = '0,'; else if (!raw.includes(',')) raw += ','; }
      else {
        if (raw.includes(',') && raw.split(',')[1].length >= 2) return;
        raw = (raw === '0' || raw === '') ? k : raw + k;
        if (raw.replace(',', '').length > 10) return;
      }
      render();
    };
  });
  render();
  return { getValue: () => Number(raw.replace(',', '.')) || 0 };
}

/* ---------- Cargar cache global ---------- */

async function refreshCats(){
  state.cats = (await DB.getAll('categorias')).sort((a,b) => (a.orden||99) - (b.orden||99));
  state.catsById = Object.fromEntries(state.cats.map(c => [c.id, c]));
}

async function loadPlan(mes){
  const p = await DB.get('planes', mes);
  if (p) return p;
  // Auto: intentar copiar del mes anterior
  const prev = await DB.get('planes', shiftMonth(mes, -1));
  if (prev) return { ...prev, mes, _fromPrev: true };
  return { mes, salario: 0, pctAhorro: 20, pctInversion: 10, limites: {} };
}

async function gastosDelMes(mes){
  const all = await DB.getAll('gastos', 'mes', IDBKeyRange.only(mes));
  return all.sort((a,b) => a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : (b.id - a.id));
}

async function movimientosDelMes(mes){
  return (await DB.getAll('movimientos', 'mes', IDBKeyRange.only(mes))).sort((a,b) => a.fecha < b.fecha ? 1 : -1);
}

// Recurrentes de ese mes que todavía no se cargaron como gasto (nota "rec:<id>").
async function getPendingRecurrentes(mes){
  const rec = await DB.getAll('recurrentes');
  if (rec.length === 0) return [];
  const gs = await gastosDelMes(mes);
  const appliedKeys = new Set(gs.filter(g => g.nota).map(g => g.nota));
  return rec.filter(r => !appliedKeys.has(`rec:${r.id}`));
}

// Carga como gasto cada recurrente que todavía no esté aplicado ese mes.
// Devuelve cuántos se agregaron. Compartida entre el chip de Hoy y el sheet de Recurrentes.
async function applyRecurrentes(mes){
  const pending = await getPendingRecurrentes(mes);
  const dim = daysInMonth(mes);
  for (const r of pending){
    const day = Math.min(r.dia || 1, dim);
    const fecha = `${mes}-${String(day).padStart(2,'0')}`;
    await DB.add('gastos', { fecha, mes, monto: r.monto, categoriaId: r.categoriaId, nota: `rec:${r.id}`, createdAt: Date.now() });
  }
  return pending.length;
}

/* ---------- Helpers de features nuevas ---------- */

async function getTopCategories(n){
  // Contar frecuencia por categoría en el mes actual, si vacío usar todo el histórico
  let gastos = await gastosDelMes(state.mes);
  if (gastos.length === 0) gastos = await DB.getAll('gastos');
  const counts = {};
  gastos.forEach(g => { counts[g.categoriaId] = (counts[g.categoriaId] || 0) + 1; });
  const ranked = state.cats
    .filter(c => counts[c.id] > 0)
    .sort((a,b) => counts[b.id] - counts[a.id])
    .slice(0, n);
  // Fallback: si no hay historial, primeras n categorías
  if (ranked.length === 0) return state.cats.slice(0, n);
  return ranked;
}

function computeAlerts(gastos, plan){
  if (!plan.limites) return [];
  const byCat = {};
  gastos.forEach(g => { byCat[g.categoriaId] = (byCat[g.categoriaId] || 0) + g.monto; });
  const alerts = [];
  for (const c of state.cats){
    const limite = plan.limites[c.id];
    if (!limite) continue;
    const gastado = byCat[c.id] || 0;
    const usage = gastado / limite;
    if (usage >= 0.8){
      alerts.push({ cat: c, gastado, limite, usage, status: usage >= 1 ? 'over' : 'warn' });
    }
  }
  return alerts.sort((a,b) => b.usage - a.usage);
}

function catStatus(catId, gastos, plan){
  const limite = plan.limites?.[catId];
  if (!limite) return 'none';
  const gastado = gastos.filter(g => g.categoriaId === catId).reduce((s,g) => s+g.monto, 0);
  const usage = gastado / limite;
  if (usage >= 1) return 'over';
  if (usage >= 0.8) return 'warn';
  return 'ok';
}

// Proyección de cierre de mes a partir del ritmo de gasto diario hasta hoy.
function projectSpend(totalGastado, dayOfMonth, dim, disponible){
  const avgPerDay = totalGastado / dayOfMonth;
  const projected = avgPerDay * dim;
  return { projected, overBudget: disponible > 0 && projected > disponible };
}

async function loadReminderConfig(){
  const rem = await DB.get('config', 'reminder');
  if (rem && rem.value) state.reminder = Object.assign(state.reminder, rem.value);
}

async function saveReminderConfig(){
  await DB.put('config', { key: 'reminder', value: state.reminder });
}

function shouldShowReminder(gastos){
  const r = state.reminder;
  if (!r.enabled) return false;
  const today = todayISO();
  if (r.dismissed === today) return false;
  if (new Date().getHours() < (r.hour || 20)) return false;
  const hoyGastos = gastos.filter(g => g.fecha === today);
  return hoyGastos.length === 0;
}

async function tryNotify(msg){
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  const today = todayISO();
  if (state.notifiedToday === today) return;
  state.notifiedToday = today;
  try {
    new Notification('Gastitos', { body: msg, icon: 'icon.svg', tag: 'gastitos-daily' });
  } catch {}
}

/* ---------- Router / render ---------- */

async function nav(view){
  state.view = view;
  closeSheet();
  $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.nav === view));
  await render();
}

async function render(){
  const root = $('#app');
  root.innerHTML = '';
  await refreshCats();
  state.planActual = await loadPlan(state.mes);
  if (state.view === 'hoy')      root.appendChild(await viewHoy());
  else if (state.view === 'plan')root.appendChild(await viewPlan());
  else if (state.view === 'gastos') root.appendChild(await viewGastos());
  else if (state.view === 'insights') root.appendChild(await viewInsights());
}

/* ==============================================================
   VIEWS
   ============================================================== */

/* ---------- HOY ---------- */

function viewOnboarding(){
  const el = document.createElement('div');
  el.className = 'view onboard';
  el.innerHTML = `
    <div class="oemoji">🌱</div>
    <h2>¿Cuánto ganás<br>este mes?</h2>
    <p>Con esto armamos tu plan: cuánto destinás a ahorro,<br>inversión y cuánto te queda para gastar.</p>
    ${keypadHtml('ob-kp', state.currency, '')}
    <button class="ob-cta" id="ob-cta">Empezar</button>
    <button class="ob-skip" id="ob-skip">Prefiero configurarlo después</button>
  `;
  const kp = wireKeypad(el, 'ob-kp', () => {});
  el.querySelector('#ob-cta').onclick = async () => {
    const sal = kp.getValue();
    if (!sal || sal <= 0){ toast('Ingresá un monto'); return; }
    await DB.put('planes', { mes: state.mes, salario: sal, pctAhorro: 20, pctInversion: 10, limites: {} });
    toast('¡Listo! Ya podés registrar gastos');
    render();
  };
  el.querySelector('#ob-skip').onclick = () => {
    state.onboardDismissed = true;
    render();
  };
  return el;
}

async function viewHoy(){
  const plan = state.planActual;
  if (!plan.salario && !state.onboardDismissed){
    return viewOnboarding();
  }

  const el = document.createElement('div');
  el.className = 'view';
  const mes = state.mes;
  const gastos = await gastosDelMes(mes);
  const movs = await movimientosDelMes(mes);

  const totalGastado = gastos.reduce((s,g) => s + g.monto, 0);
  const totalAhorrado = movs.filter(m => m.tipo === 'ahorro').reduce((s,m) => s + m.monto, 0);
  const totalInvertido = movs.filter(m => m.tipo === 'inversion').reduce((s,m) => s + m.monto, 0);
  const metaAhorro = plan.salario * (plan.pctAhorro/100);
  const metaInv    = plan.salario * (plan.pctInversion/100);
  const disponible = plan.salario - metaAhorro - metaInv;
  const restante   = disponible - totalGastado;

  const dim = daysInMonth(mes);
  const today = new Date();
  const isCurrentMonth = mes === monthKey(today);
  const dayOfMonth = isCurrentMonth ? today.getDate() : dim;
  const pctMonth = Math.min(1, dayOfMonth / dim);
  const pctSpent = disponible > 0 ? totalGastado / disponible : 0;
  const spentClass = pctSpent > 1 ? 'over' : (pctSpent > 0.9 ? 'warn' : '');
  const proj = (plan.salario > 0 && isCurrentMonth && totalGastado > 0 && dayOfMonth < dim)
    ? projectSpend(totalGastado, dayOfMonth, dim, disponible) : null;

  const alerts = computeAlerts(gastos, plan);
  const topCats = await getTopCategories(4);
  const showReminder = shouldShowReminder(gastos);
  if (showReminder) tryNotify('¿Cargaste tus gastos de hoy?');
  const pendingRec = await getPendingRecurrentes(mes);

  el.innerHTML = `
    <header class="hoy-head">
      <div>
        <div class="eyebrow">Gastitos</div>
        <div class="hoy-date">${esc(todayLabel())}</div>
      </div>
      <button class="hoy-cog" aria-label="Ajustes" data-open="settings">⚙</button>
    </header>

    <section class="balance">
      <div class="eyebrow">${plan.salario > 0 ? 'Disponible del mes' : 'Gastado este mes'}</div>
      <div class="display ${plan.salario > 0 && restante < 0 ? 'neg' : ''}">${money(plan.salario > 0 ? restante : totalGastado, true)}</div>
      <div class="balance-meta">
        <div class="cell"><div class="k">Gastado</div><div class="v">${moneyC(totalGastado)}</div></div>
        <div class="cell"><div class="k">Ahorro</div><div class="v">${moneyC(totalAhorrado)}</div></div>
        <div class="cell"><div class="k">Inversión</div><div class="v">${moneyC(totalInvertido)}</div></div>
      </div>
      ${plan.salario > 0 ? `
      <div class="progress-line" aria-hidden="true">
        <div class="fill ${spentClass}" style="width:${Math.min(100, pctSpent*100)}%"></div>
        <div class="tick" style="left:${pctMonth*100}%" data-label="hoy"></div>
      </div>` : ''}
      ${proj ? `
      <div class="projection ${proj.overBudget ? 'over' : ''}">
        <span class="ic" aria-hidden="true">${proj.overBudget ? '⚠' : '↗'}</span>
        <span>A este ritmo vas a terminar gastando <b>${money(proj.projected)}</b>${proj.overBudget ? ` — ${money(proj.projected - disponible)} más de lo disponible` : ''}</span>
      </div>` : ''}
    </section>

    ${showReminder ? `
    <div class="reminder-chip" id="reminder-chip">
      <span class="txt">¿Cargaste tus gastos de hoy?</span>
      <button class="close" data-dismiss-reminder aria-label="Descartar">×</button>
    </div>` : ''}

    ${pendingRec.length > 0 ? `
    <div class="pending-chip" id="pending-chip">
      <span class="txt">Tenés <b>${pendingRec.length}</b> recurrente${pendingRec.length>1?'s':''} de ${esc(monthShort(mes).replace('.',''))} sin aplicar</span>
      <button class="apply" data-apply-recurrentes>Aplicar</button>
    </div>` : ''}

    ${alerts.length > 0 ? `
    <section class="alerts">
      <div class="alert-head ${alerts.some(a => a.status==='over') ? 'over' : ''}">${alerts.some(a => a.status==='over') ? 'Te pasaste en' : 'Ojo con'}</div>
      ${alerts.map(a => `<div class="alert-row ${a.status}">
        ${catBadge(a.cat, 'sm')}
        <span>${esc(a.cat.nombre)}</span>
        <span class="pct">${Math.round(a.usage*100)}%</span>
      </div>`).join('')}
    </section>` : ''}

    <button class="big-action" data-open="add-gasto">
      <span class="lbl">Registrar gasto</span>
      <span class="plus" aria-hidden="true">+</span>
    </button>

    ${topCats.length > 0 ? `
    <div class="quick-actions-label">De una</div>
    <div class="quick-actions">
      ${topCats.map(c => `<button class="qchip" data-quickcat="${c.id}">${catBadge(c, 'sm')}${esc(c.nombre)}<span class="plus">+</span></button>`).join('')}
    </div>` : ''}

    <div class="section-head">
      <h3>Últimos movimientos</h3>
      <a class="link" href="#gastos" data-nav="gastos">Ver todo</a>
    </div>
    <div class="recent">
      ${gastos.length === 0 ? '<div class="empty">Todavía no cargaste ningún gasto este mes.<button class="empty-cta" data-open="add-gasto">+ Registrar el primero</button></div>' :
        gastos.slice(0, 6).map(g => {
          const c = state.catsById[g.categoriaId];
          return `<div class="recent-row">
            <div class="rl">
              ${catBadge(c, 'sm')}
              <span class="cat">${esc(c?.nombre || 'Sin categoría')}</span>
              ${g.nota ? `<span class="note">· ${esc(g.nota)}</span>` : ''}
            </div>
            <span class="amt">${money(g.monto)}</span>
          </div>`;
        }).join('')}
    </div>
  `;

  // Handlers para features v2
  $$('[data-quickcat]', el).forEach(b => b.onclick = () => openAddGasto(null, Number(b.dataset.quickcat)));
  const dismissBtn = el.querySelector('[data-dismiss-reminder]');
  if (dismissBtn) dismissBtn.onclick = async () => {
    state.reminder.dismissed = todayISO();
    await saveReminderConfig();
    render();
  };
  const applyBtn = el.querySelector('[data-apply-recurrentes]');
  if (applyBtn) applyBtn.onclick = async () => {
    const added = await applyRecurrentes(mes);
    toast(added ? `${added} recurrente${added>1?'s':''} aplicado${added>1?'s':''}` : 'Ya estaban aplicados');
    render();
  };

  return el;
}

/* ---------- PLAN ---------- */

async function viewPlan(){
  const el = document.createElement('div');
  el.className = 'view';
  const mes = state.mes;
  const plan = state.planActual;
  const isFromPrev = plan._fromPrev;
  const isSaved = !isFromPrev && (await DB.get('planes', mes));

  const disponible = plan.salario - plan.salario * (plan.pctAhorro/100) - plan.salario * (plan.pctInversion/100);
  const gastosMes = await gastosDelMes(mes);
  const hasLimits = plan.limites && Object.keys(plan.limites).length > 0;

  el.innerHTML = `
    <div class="hoy-head" style="padding-top:6px;">
      <div>
        <div class="eyebrow">Plan mensual</div>
      </div>
      <button class="hoy-cog" aria-label="Ajustes" data-open="settings">⚙</button>
    </div>
    <div class="month-nav">
      <button class="arr" data-mes-prev>‹</button>
      <h2>${esc(monthLabel(mes))}</h2>
      <button class="arr" data-mes-next>›</button>
    </div>

    <section class="plan-block">
      <div class="k">Salario del mes</div>
      <div class="input-inline">
        <span class="cur">${state.currency}</span>
        <input type="number" inputmode="decimal" step="0.01" min="0" id="pl-salario" value="${plan.salario || ''}" placeholder="0" />
      </div>
    </section>

    <section class="plan-block">
      <div class="k">Distribución</div>
      <div class="pct-pair">
        <div class="cell">
          <div class="k">Ahorro</div>
          <div class="row"><input type="number" inputmode="decimal" min="0" max="100" id="pl-ahorro" value="${plan.pctAhorro || 0}" /><span class="sym">%</span></div>
          <div class="hint" id="pl-ahorro-h">${money(plan.salario * (plan.pctAhorro/100))}</div>
        </div>
        <div class="cell">
          <div class="k">Inversión</div>
          <div class="row"><input type="number" inputmode="decimal" min="0" max="100" id="pl-inv" value="${plan.pctInversion || 0}" /><span class="sym">%</span></div>
          <div class="hint" id="pl-inv-h">${money(plan.salario * (plan.pctInversion/100))}</div>
        </div>
      </div>
      <div class="pct-pair" style="margin-top:14px;">
        <div class="cell">
          <div class="k">Disponible para gastar</div>
          <div class="hint" id="pl-disp" style="font-size:15px; color:var(--ink);">${money(disponible)}</div>
        </div>
      </div>
    </section>

    <div class="section-head">
      <h3>Límites por categoría</h3>
      <button class="link" data-open="cats" id="pl-editcats" style="${hasLimits ? '' : 'display:none;'}">Editar categorías</button>
    </div>
    <div class="limits-toggle-row">
      <span class="txt">Poner tope de gasto por categoría (opcional)</span>
      <button class="toggle ${hasLimits ? 'on' : ''}" id="pl-limits-toggle" aria-label="Activar límites por categoría"></button>
    </div>
    <div id="plan-limits" style="${hasLimits ? '' : 'display:none;'}">
      ${state.cats.map(c => {
        const monto = plan.limites?.[c.id] ?? '';
        const pctRef = (monto && disponible > 0) ? Math.round((monto/disponible)*100) : null;
        const st = catStatus(c.id, gastosMes, plan);
        return `<div class="cat-limit ${st === 'over' ? 'over' : (st === 'warn' ? 'warn' : '')}">
          ${catBadge(c)}
          <span class="cname">${esc(c.nombre)}${pctRef !== null ? `<span class="cpct">≈ ${pctRef}% del disponible</span>` : ''}</span>
          <span class="cright">
            <span class="sym">${state.currency}</span>
            <input type="number" inputmode="decimal" min="0" data-lim="${c.id}" value="${monto}" placeholder="—" />
          </span>
        </div>`;
      }).join('')}
    </div>

    <div class="plan-actions">
      <button class="chip solid" id="pl-save">Guardar plan</button>
      ${isFromPrev ? '<span class="chip mint">Copiado del mes anterior</span>' : ''}
      ${isSaved ? '<button class="chip danger" id="pl-clear">Borrar plan del mes</button>' : ''}
    </div>
  `;

  // handlers
  el.querySelector('[data-mes-prev]').onclick = () => { state.mes = shiftMonth(state.mes, -1); render(); };
  el.querySelector('[data-mes-next]').onclick = () => { state.mes = shiftMonth(state.mes, 1); render(); };

  const upd = () => {
    const sal = Number($('#pl-salario', el).value) || 0;
    const pa  = Number($('#pl-ahorro', el).value) || 0;
    const pi  = Number($('#pl-inv', el).value) || 0;
    $('#pl-ahorro-h', el).innerHTML = money(sal * pa/100);
    $('#pl-inv-h', el).innerHTML = money(sal * pi/100);
    $('#pl-disp', el).innerHTML = money(sal - sal*pa/100 - sal*pi/100);
  };
  ['pl-salario','pl-ahorro','pl-inv'].forEach(id => $('#'+id, el).addEventListener('input', upd));

  const limitsToggle = $('#pl-limits-toggle', el);
  const limitsBlock = $('#plan-limits', el);
  const editCatsLink = $('#pl-editcats', el);
  limitsToggle.onclick = () => {
    const on = !limitsToggle.classList.contains('on');
    limitsToggle.classList.toggle('on', on);
    limitsBlock.style.display = on ? '' : 'none';
    editCatsLink.style.display = on ? '' : 'none';
  };

  el.querySelector('#pl-save').onclick = async () => {
    const sal = Number($('#pl-salario', el).value) || 0;
    const pa  = Number($('#pl-ahorro', el).value) || 0;
    const pi  = Number($('#pl-inv', el).value) || 0;
    const lims = {};
    $$('[data-lim]', el).forEach(inp => {
      const v = Number(inp.value);
      if (!isNaN(v) && inp.value !== '') lims[inp.dataset.lim] = v;
    });
    await DB.put('planes', { mes, salario: sal, pctAhorro: pa, pctInversion: pi, limites: lims });
    toast('Plan guardado');
    render();
  };
  const clr = el.querySelector('#pl-clear');
  if (clr) clr.onclick = async () => {
    const ok = await openConfirm('¿Borrar el plan de este mes? Esta acción no se puede deshacer.', { title: '¿Borrar plan?' });
    if (!ok) return;
    await DB.del('planes', mes);
    toast('Plan eliminado');
    render();
  };

  return el;
}

/* ---------- GASTOS ---------- */

async function viewGastos(){
  const el = document.createElement('div');
  el.className = 'view';
  const gastos = await gastosDelMes(state.mes);
  let filtered = state.filterCat ? gastos.filter(g => g.categoriaId === state.filterCat) : gastos;
  const q = (state.searchQuery || '').trim().toLowerCase();
  if (q){
    filtered = filtered.filter(g => (g.nota || '').toLowerCase().includes(q));
  }
  const total = filtered.reduce((s,g) => s + g.monto, 0);

  // agrupar por día
  const groups = {};
  filtered.forEach(g => { (groups[g.fecha] ||= []).push(g); });

  el.innerHTML = `
    <div class="hoy-head" style="padding-top:6px;">
      <div>
        <div class="eyebrow">Gastos</div>
        <div class="hoy-date">${q ? `${filtered.length} resultado${filtered.length!==1?'s':''} · ${money(total)}` : `Total del mes · ${money(total)}`}</div>
      </div>
      <button class="hoy-cog" aria-label="Agregar" data-open="add-gasto">+</button>
    </div>

    <div class="month-nav" style="margin-top:14px;">
      <button class="arr" data-mes-prev>‹</button>
      <h2>${esc(monthLabel(state.mes))}</h2>
      <button class="arr" data-mes-next>›</button>
    </div>

    <div class="search-bar">
      <span class="icon" aria-hidden="true">⌕</span>
      <input type="text" id="g-search" placeholder="Buscar por nota…" value="${esc(state.searchQuery || '')}" />
      ${state.searchQuery ? '<button class="clear" data-clear-search aria-label="Limpiar">×</button>' : ''}
    </div>

    <div class="filters">
      <button class="fchip ${!state.filterCat ? 'on':''}" data-fcat="0">Todas</button>
      ${state.cats.map(c => `<button class="fchip ${state.filterCat===c.id?'on':''}" data-fcat="${c.id}">${catBadge(c, 'sm')}${esc(c.nombre)}</button>`).join('')}
    </div>

    ${filtered.length === 0 ? `<div class="empty">${q ? 'Nada coincide con esa búsqueda.' : 'No hay gastos para mostrar.'}${q ? '' : '<button class="empty-cta" data-open="add-gasto">+ Registrar el primero</button>'}</div>` :
      Object.keys(groups).sort((a,b) => b.localeCompare(a)).map(fecha => {
        const dt = parseISO(fecha);
        const label = dt.toLocaleDateString(state.locale, { weekday: 'long', day: 'numeric', month: 'long' });
        const dayTot = groups[fecha].reduce((s,g) => s + g.monto, 0);
        return `<section class="day-group">
          <div class="day-head"><span class="dl">${esc(label)}</span><span class="dt">${money(dayTot)}</span></div>
          ${groups[fecha].map(g => {
            const c = state.catsById[g.categoriaId];
            return `<div class="gasto-row">
              ${catBadge(c)}
              <button class="col-btn" data-edit="${g.id}">
                <div class="cat">${esc(c?.nombre || 'Sin categoría')}</div>
                ${g.nota ? `<div class="note">${esc(g.nota)}</div>` : ''}
              </button>
              <button class="amt-btn" data-edit-monto="${g.id}">${money(g.monto)}</button>
            </div>`;
          }).join('')}
        </section>`;
      }).join('')}
  `;

  el.querySelector('[data-mes-prev]').onclick = () => { state.mes = shiftMonth(state.mes, -1); render(); };
  el.querySelector('[data-mes-next]').onclick = () => { state.mes = shiftMonth(state.mes, 1); render(); };
  $$('[data-fcat]', el).forEach(b => b.onclick = () => {
    const id = Number(b.dataset.fcat);
    state.filterCat = id === 0 ? null : id;
    render();
  });
  $$('[data-edit]', el).forEach(b => b.onclick = () => openAddGasto(Number(b.dataset.edit)));

  // Búsqueda (debounced)
  const searchInput = $('#g-search', el);
  let searchT;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchT);
    searchT = setTimeout(() => {
      state.searchQuery = searchInput.value;
      render();
      const inp = $('#g-search'); if (inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }, 220);
  });
  const clr = el.querySelector('[data-clear-search]');
  if (clr) clr.onclick = () => { state.searchQuery = ''; render(); };

  // Edición inline del monto
  $$('[data-edit-monto]', el).forEach(btn => btn.onclick = (e) => {
    e.stopPropagation();
    startInlineEditMonto(Number(btn.dataset.editMonto), btn);
  });

  return el;
}

async function startInlineEditMonto(gastoId, btnEl){
  const g = await DB.get('gastos', gastoId);
  if (!g) return;
  const input = document.createElement('input');
  input.type = 'number';
  input.step = '0.01';
  input.min = '0';
  input.inputMode = 'decimal';
  input.className = 'amt-input';
  input.value = g.monto;
  const parent = btnEl.parentNode;
  parent.replaceChild(input, btnEl);
  input.focus();
  input.select();
  let done = false;
  const save = async () => {
    if (done) return; done = true;
    const val = Number(input.value);
    if (val > 0 && val !== g.monto){
      g.monto = val;
      await DB.put('gastos', g);
      toast('Actualizado');
    }
    render();
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter'){ e.preventDefault(); input.blur(); }
    if (e.key === 'Escape'){ done = true; render(); }
  });
}

/* ---------- INSIGHTS ---------- */

async function viewInsights(){
  const el = document.createElement('div');
  el.className = 'view';
  const tab = state.insightsTab;

  el.innerHTML = `
    <div class="hoy-head" style="padding-top:6px;">
      <div>
        <div class="eyebrow">Reportes</div>
        <div class="hoy-date">${tab === 'ahorro' ? 'Acumulado histórico' : 'Comportamiento de tus gastos'}</div>
      </div>
      <button class="hoy-cog" aria-label="${tab === 'ahorro' ? 'Agregar' : 'Ajustes'}" data-open="${tab === 'ahorro' ? 'add-mov' : 'settings'}">${tab === 'ahorro' ? '+' : '⚙'}</button>
    </div>

    <div class="month-nav" style="margin-top:14px;">
      <button class="arr" data-mes-prev>‹</button>
      <h2>${esc(monthLabel(state.mes))}</h2>
      <button class="arr" data-mes-next>›</button>
    </div>

    <div class="subtabs">
      <button class="${tab==='gastos'?'on':''}" data-itab="gastos">Gastos</button>
      <button class="${tab==='ahorro'?'on':''}" data-itab="ahorro">Ahorro</button>
    </div>

    <div id="insights-body"></div>
  `;

  el.querySelector('[data-mes-prev]').onclick = () => { state.mes = shiftMonth(state.mes, -1); render(); };
  el.querySelector('[data-mes-next]').onclick = () => { state.mes = shiftMonth(state.mes, 1); render(); };
  $$('[data-itab]', el).forEach(b => b.onclick = () => { state.insightsTab = b.dataset.itab; render(); });

  const body = $('#insights-body', el);
  if (tab === 'ahorro') body.appendChild(await insightsAhorroBlock());
  else body.appendChild(await insightsGastosBlock());

  return el;
}

async function insightsGastosBlock(){
  const el = document.createElement('div');
  const gastos = await gastosDelMes(state.mes);
  const total = gastos.reduce((s,g) => s + g.monto, 0);

  const byCat = {};
  gastos.forEach(g => { byCat[g.categoriaId] = (byCat[g.categoriaId] || 0) + g.monto; });
  const catData = state.cats
    .map(c => ({ ...c, monto: byCat[c.id] || 0, pct: total > 0 ? (byCat[c.id] || 0)/total : 0 }))
    .filter(c => c.monto > 0)
    .sort((a,b) => b.monto - a.monto);

  const dim = daysInMonth(state.mes);
  const perDay = new Array(dim).fill(0);
  gastos.forEach(g => { const d = parseISO(g.fecha).getDate(); perDay[d-1] += g.monto; });

  // Rango dinámico para "Ritmo diario": si el mes está en curso, solo hasta hoy
  // (los días futuros todavía no pasaron, no tiene sentido dejarles un hueco vacío).
  // Si es un mes ya cerrado, se muestran todos sus días.
  const isCurrentMonth = state.mes === monthKey(new Date());
  const renderDim = isCurrentMonth ? Math.min(dim, new Date().getDate()) : dim;
  const perDayRender = perDay.slice(0, renderDim);

  const history = [];
  for (let i = 5; i >= 0; i--){
    const m = shiftMonth(state.mes, -i);
    const gs = await gastosDelMes(m);
    history.push({ mes: m, total: gs.reduce((s,g) => s + g.monto, 0) });
  }

  el.innerHTML = `
    <section class="insights-tot" style="margin-top:18px;">
      <div class="eyebrow">Total gastado</div>
      <div class="display">${money(total, true)}</div>
      ${(() => {
        const prev = history[history.length - 2];
        if (!prev || prev.total === 0) return '';
        const diff = total - prev.total;
        const pct = Math.round(Math.abs(diff / prev.total) * 100);
        const dir = diff > 0 ? 'up' : (diff < 0 ? 'down' : 'flat');
        const arrow = diff > 0 ? '↑' : (diff < 0 ? '↓' : '·');
        const label = diff > 0 ? 'más' : (diff < 0 ? 'menos' : 'igual');
        return `<div class="compare ${dir}">
          <span class="arrow">${arrow}</span>
          <span>${money(Math.abs(diff))} ${label} (${pct}%)</span>
          <span class="from">vs ${esc(monthShort(prev.mes).replace('.',''))}</span>
        </div>`;
      })()}
    </section>

    <section class="chart-block">
      <h4>Por categoría</h4>
      ${catData.length === 0 ? '<div class="empty">Sin datos.</div>' : `
      <div class="cat-bars-scroll">
        ${catData.map(c => catBarItemHtml(c, catData[0].monto)).join('')}
      </div>`}
    </section>

    <section class="chart-block">
      <h4>Ritmo diario</h4>
      <canvas class="cnv" id="ch-bars" width="600" height="240" role="img" aria-label="${esc(ritmoDiarioSummary(perDayRender))}"></canvas>
      <ul class="sr-only">${perDayRender.map((v,i) => `<li>Día ${i+1}: ${money(v)}</li>`).join('')}</ul>
      <div class="daybar-info" id="daybar-info"><span class="hint">Tocá un día para ver el detalle</span></div>
    </section>

    <section class="chart-block" style="border-bottom:0;">
      <h4>Últimos 6 meses</h4>
      <canvas class="cnv" id="ch-hist" width="600" height="240" role="img" aria-label="${esc(historicoSummary(history))}"></canvas>
      <ul class="sr-only">${history.map(h => `<li>${esc(monthLabel(h.mes))}: ${money(h.total)}</li>`).join('')}</ul>
      <div class="daybar-info" id="hist-info"><span class="hint">Tocá un mes para ver el detalle</span></div>
    </section>
  `;

  requestAnimationFrame(() => {
    const barsCanvas = $('#ch-bars', el);
    let selectedIdx = -1;
    let geo = drawBars(barsCanvas, perDayRender, renderDim, { selectedIdx });

    // Click sobre una barra del ritmo diario: resalta esa barra (el resto se
    // atenúa) y muestra el gasto de ese día. Filtro local a este gráfico,
    // no afecta ningún otro dato ni vista de la app. Click de nuevo = deselecciona.
    const info = $('#daybar-info', el);
    barsCanvas.onclick = (e) => {
      const rect = barsCanvas.getBoundingClientRect();
      const xCss = e.clientX - rect.left;
      const idx = Math.min(geo.dim - 1, Math.max(0, Math.floor((xCss - geo.padL) / geo.bw)));
      if (selectedIdx === idx){
        selectedIdx = -1;
        info.innerHTML = `<span class="hint">Tocá un día para ver el detalle</span>`;
      } else {
        selectedIdx = idx;
        const day = idx + 1;
        const val = perDayRender[idx];
        const fecha = `${state.mes}-${String(day).padStart(2,'0')}`;
        const label = parseISO(fecha).toLocaleDateString(state.locale, { weekday: 'long', day: 'numeric', month: 'long' });
        info.innerHTML = `<span class="d">${esc(label)}</span><span class="v">${money(val)}</span>`;
      }
      geo = drawBars(barsCanvas, perDayRender, renderDim, { selectedIdx });
    };

    // Mismo patrón de click-para-detalle que "Ritmo diario", para que los dos
    // gráficos de canvas se comporten igual (antes sólo uno de los dos era interactivo).
    const histCanvas = $('#ch-hist', el);
    let selectedHistIdx = -1;
    let histGeo = drawHist(histCanvas, history, { selectedIdx: selectedHistIdx });
    const histInfo = $('#hist-info', el);
    histCanvas.onclick = (e) => {
      const rect = histCanvas.getBoundingClientRect();
      const xCss = e.clientX - rect.left;
      const idx = Math.min(history.length - 1, Math.max(0, Math.floor((xCss - histGeo.padL) / histGeo.bw)));
      if (selectedHistIdx === idx){
        selectedHistIdx = -1;
        histInfo.innerHTML = `<span class="hint">Tocá un mes para ver el detalle</span>`;
      } else {
        selectedHistIdx = idx;
        const h = history[idx];
        histInfo.innerHTML = `<span class="d">${esc(monthLabel(h.mes))}</span><span class="v">${money(h.total)}</span>`;
      }
      histGeo = drawHist(histCanvas, history, { selectedIdx: selectedHistIdx });
    };
  });

  return el;
}

// Item del gráfico de barras horizontal-scrolleable "Por categoría".
// Barras ordenadas de mayor a menor; las primeras 5 se ven sin scrollear,
// el resto aparece deslizando el contenedor hacia la derecha.
function catBarItemHtml(c, maxMonto){
  const pctHeight = maxMonto > 0 ? Math.max(4, Math.round((c.monto / maxMonto) * 100)) : 0;
  return `
    <div class="cat-bar-item">
      <div class="cat-bar-amt">${moneyC(c.monto)}</div>
      <div class="cat-bar-track">
        <div class="cat-bar-fill" style="height:${pctHeight}%; background:${c.color};"></div>
      </div>
      <div class="cat-bar-cat">
        ${catBadge(c, 'sm')}
        <span class="cat-bar-name">${esc(c.nombre)}</span>
      </div>
      <div class="cat-bar-pct">${Math.round(c.pct*100)}%</div>
    </div>
  `;
}

// Barra horizontal de Ahorro/Inversión con línea de objetivo (meta del mes).
// Si "actual" supera "meta", la barra queda más larga que la línea — está bien,
// la línea se lee dentro del relleno como "acá era el objetivo".
function goalBarHtml({ label, icon, actual, meta, maxScale, colorClass }){
  const fillPct = maxScale > 0 ? Math.min(100, (actual / maxScale) * 100) : 0;
  const goalPct = meta > 0 ? Math.min(100, (meta / maxScale) * 100) : null;
  const reached = meta > 0 && actual >= meta;
  return `
    <div class="goal-row">
      <div class="goal-icon">${icon}</div>
      <div class="goal-body">
        <div class="goal-head">
          <span class="goal-label">${esc(label)}</span>
          <span class="goal-val">${money(actual)}${meta > 0 ? ` <span class="of">/ ${money(meta)}</span>` : ''}${reached ? ' <span class="ok">✓</span>' : ''}</span>
        </div>
        <div class="goal-track">
          <div class="goal-fill ${colorClass}" style="width:${fillPct}%"></div>
          ${goalPct !== null ? `<div class="goal-line" style="left:${goalPct}%" title="Objetivo: ${money(meta)}"></div>` : ''}
        </div>
      </div>
    </div>
  `;
}

async function insightsAhorroBlock(){
  const el = document.createElement('div');
  const plan = state.planActual;
  const movs = await movimientosDelMes(state.mes);

  const ahorroMes = movs.filter(m => m.tipo === 'ahorro').reduce((s,m) => s + m.monto, 0);
  const invMes    = movs.filter(m => m.tipo === 'inversion').reduce((s,m) => s + m.monto, 0);
  const metaAh    = plan.salario * (plan.pctAhorro/100);
  const metaInv   = plan.salario * (plan.pctInversion/100);

  const allMovs = await DB.getAll('movimientos');
  const totAh = allMovs.filter(m => m.tipo === 'ahorro').reduce((s,m) => s + m.monto, 0);
  const totInv = allMovs.filter(m => m.tipo === 'inversion').reduce((s,m) => s + m.monto, 0);
  const totAcum = totAh + totInv;

  // Escala común para ambas barras, para que Ahorro e Inversión sean comparables
  // entre sí. 1.15x del mayor valor en juego, para dejarle aire a la línea objetivo
  // (y a la propia barra, si se superó la meta).
  const scaleBase = Math.max(metaAh, metaInv, ahorroMes, invMes, 1);
  const maxScale = scaleBase * 1.15;

  el.innerHTML = `
    <section class="ah-hero" style="margin-top:18px;">
      <div class="eyebrow">Total acumulado</div>
      <div class="display">${money(totAcum, true)}</div>
    </section>

    <div class="section-head">
      <h3>Metas de ${esc(monthShort(state.mes))}</h3>
      <button class="link" data-open="add-mov">+ Aporte</button>
    </div>
    <div class="ah-goals">
      ${goalBarHtml({ label: 'Ahorro', icon: '💵', actual: ahorroMes, meta: metaAh, maxScale, colorClass: 'ahorro' })}
      ${goalBarHtml({ label: 'Inversión', icon: '📈', actual: invMes, meta: metaInv, maxScale, colorClass: 'inversion' })}
    </div>

    <div class="section-head">
      <h3>Movimientos del mes</h3>
    </div>
    ${movs.length === 0 ? '<div class="empty">Sin movimientos este mes.<button class="empty-cta" data-open="add-mov">+ Primer aporte</button></div>' :
      movs.map(m => `<button class="mov-row" data-mov="${m.id}" style="width:100%; text-align:left;">
        <span class="cd" style="background:${m.tipo === 'ahorro' ? 'var(--teal)' : 'var(--navy)'}"></span>
        <span>
          <div class="tag">${m.tipo}</div>
          <div class="instr">${esc(m.instrumento || (m.tipo === 'ahorro' ? 'Aporte a ahorro' : 'Aporte a inversión'))}</div>
        </span>
        <span class="amt ${m.tipo === 'inversion' ? 'inv' : ''}">${money(m.monto)}</span>
      </button>`).join('')}
  `;

  $$('[data-mov]', el).forEach(b => b.onclick = () => openAddMov(Number(b.dataset.mov)));

  return el;
}

/* ==============================================================
   SHEETS (modales)
   ============================================================== */

function openSheet(title, bodyHtml, onMount){
  const sh = $('#sheet');
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = bodyHtml;
  sh.classList.add('open');
  sh.setAttribute('aria-hidden', 'false');
  if (onMount) onMount($('#sheet-body'));
}
function closeSheet(){
  const sh = $('#sheet');
  sh.classList.remove('open');
  sh.setAttribute('aria-hidden', 'true');
}
$$('[data-sheet-close]', document).forEach(b => b.onclick = closeSheet);

/* ---------- Confirm dialog (reemplaza confirm() nativo) ---------- */

// Diálogo de confirmación propio, coherente con el resto del sistema de sheets.
// Devuelve una Promise<boolean> — se resuelve en true si el usuario confirma.
function openConfirm(message, opts={}){
  const { title = 'Confirmar', confirmLabel = 'Eliminar' } = opts;
  return new Promise((resolve) => {
    const dlg = $('#confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-msg').textContent = message;
    const okBtn = $('#confirm-ok');
    const cancelBtn = $('#confirm-cancel');
    okBtn.textContent = confirmLabel;
    dlg.classList.add('open');
    dlg.setAttribute('aria-hidden', 'false');
    let done = false;
    const finish = (val) => {
      if (done) return; done = true;
      dlg.classList.remove('open');
      dlg.setAttribute('aria-hidden', 'true');
      okBtn.onclick = null; cancelBtn.onclick = null;
      $$('[data-confirm-cancel]', dlg).forEach(b => b.onclick = null);
      resolve(val);
    };
    okBtn.onclick = () => finish(true);
    cancelBtn.onclick = () => finish(false);
    $$('[data-confirm-cancel]', dlg).forEach(b => b.onclick = () => finish(false));
  });
}

/* ---------- Sheet: agregar/editar gasto ---------- */

async function openAddGasto(editId, preselectCatId){
  let g = { fecha: todayISO(), monto: '', categoriaId: preselectCatId || state.cats[0]?.id || 1, nota: '' };
  if (editId){
    const existing = await DB.get('gastos', editId);
    if (existing) g = existing;
  }
  const body = `
    <div class="form-row" style="border-bottom:0;">
      ${keypadHtml('ag-kp', state.currency, g.monto)}
    </div>
    <div class="form-row">
      <div class="k">Categoría</div>
      <div class="cat-picker" id="ag-cats">
        ${state.cats.map(c => `<button class="cchip ${c.id === g.categoriaId ? 'on':''}" data-catid="${c.id}">${catBadge(c, 'sm')}${esc(c.nombre)}</button>`).join('')}
      </div>
    </div>
    <div class="form-row">
      <div class="k">Fecha</div>
      <div class="v"><input type="date" id="ag-fecha" value="${g.fecha}" /></div>
    </div>
    <div class="form-row">
      <div class="k">Nota (opcional)</div>
      <div class="v"><textarea id="ag-nota" rows="2" placeholder="Ej: café con Ana">${esc(g.nota || '')}</textarea></div>
    </div>
    <div class="sheet-cta">
      ${editId ? '<button class="btn danger" id="ag-del">Eliminar</button>' : ''}
      <button class="btn primary" id="ag-save">${editId ? 'Guardar cambios' : 'Registrar gasto'}</button>
    </div>
  `;
  openSheet(editId ? 'Editar gasto' : 'Nuevo gasto', body, (root) => {
    let selCat = g.categoriaId;
    $$('[data-catid]', root).forEach(b => b.onclick = () => {
      selCat = Number(b.dataset.catid);
      $$('[data-catid]', root).forEach(x => x.classList.toggle('on', Number(x.dataset.catid) === selCat));
    });
    const kp = wireKeypad(root, 'ag-kp', () => {});
    $('#ag-save', root).onclick = async () => {
      const monto = kp.getValue();
      const fecha = $('#ag-fecha', root).value;
      const nota = $('#ag-nota', root).value.trim();
      if (!monto || monto <= 0){ toast('Ingresá un monto'); return; }
      if (!fecha){ toast('Elegí una fecha'); return; }
      const mes = fecha.slice(0,7);
      const record = { fecha, mes, monto, categoriaId: selCat, nota, createdAt: Date.now() };
      if (editId){ record.id = editId; await DB.put('gastos', record); toast('Gasto actualizado'); }
      else { await DB.add('gastos', record); toast('Gasto registrado'); }
      closeSheet();
      render();
    };
    const del = $('#ag-del', root);
    if (del) del.onclick = async () => {
      const ok = await openConfirm('¿Eliminar este gasto? Esta acción no se puede deshacer.', { title: '¿Eliminar gasto?' });
      if (!ok) return;
      await DB.del('gastos', editId);
      toast('Gasto eliminado');
      closeSheet();
      render();
    };
  });
}

/* ---------- Sheet: aporte ahorro / inversión ---------- */

async function openAddMov(editId){
  let m = { fecha: todayISO(), monto: '', tipo: 'ahorro', instrumento: '', nota: '' };
  if (editId){
    const ex = await DB.get('movimientos', editId);
    if (ex) m = ex;
  }
  const body = `
    <div class="form-row">
      <div class="k">Tipo</div>
      <div class="type-toggle" id="mv-type">
        <button data-t="ahorro" class="${m.tipo==='ahorro'?'on':''}">Ahorro</button>
        <button data-t="inversion" class="${m.tipo==='inversion'?'on':''}">Inversión</button>
      </div>
    </div>
    <div class="form-row" style="border-bottom:0;">
      ${keypadHtml('mv-kp', state.currency, m.monto)}
    </div>
    <div class="form-row">
      <div class="k">Instrumento (opcional)</div>
      <div class="v"><input type="text" id="mv-inst" value="${esc(m.instrumento || '')}" placeholder="Caja de ahorro, plazo fijo, MEP…" /></div>
    </div>
    <div class="form-row">
      <div class="k">Fecha</div>
      <div class="v"><input type="date" id="mv-fecha" value="${m.fecha}" /></div>
    </div>
    <div class="sheet-cta">
      ${editId ? '<button class="btn danger" id="mv-del">Eliminar</button>' : ''}
      <button class="btn primary" id="mv-save">${editId ? 'Guardar' : 'Registrar'}</button>
    </div>
  `;
  openSheet(editId ? 'Editar aporte' : 'Nuevo aporte', body, (root) => {
    let tipo = m.tipo;
    $$('#mv-type button', root).forEach(b => b.onclick = () => {
      tipo = b.dataset.t;
      $$('#mv-type button', root).forEach(x => x.classList.toggle('on', x.dataset.t === tipo));
    });
    const kp = wireKeypad(root, 'mv-kp', () => {});
    $('#mv-save', root).onclick = async () => {
      const monto = kp.getValue();
      const fecha = $('#mv-fecha', root).value;
      const instrumento = $('#mv-inst', root).value.trim();
      if (!monto || monto <= 0){ toast('Ingresá un monto'); return; }
      const record = { fecha, mes: fecha.slice(0,7), monto, tipo, instrumento };
      if (editId){ record.id = editId; await DB.put('movimientos', record); toast('Aporte actualizado'); }
      else { await DB.add('movimientos', record); toast('Aporte registrado'); }
      closeSheet();
      render();
    };
    const del = $('#mv-del', root);
    if (del) del.onclick = async () => {
      const ok = await openConfirm('¿Eliminar este aporte? Esta acción no se puede deshacer.', { title: '¿Eliminar aporte?' });
      if (!ok) return;
      await DB.del('movimientos', editId);
      toast('Aporte eliminado');
      closeSheet();
      render();
    };
  });
}

/* ---------- Sheet: categorías ---------- */

async function openCatsEditor(){
  const rows = state.cats.map(c => `
    <div class="row" data-cid="${c.id}">
      <input type="color" value="${c.color}" data-k="color" />
      <input type="text" class="icon-in" value="${esc(c.icono || '')}" maxlength="2" data-k="icono" placeholder="🔖" />
      <input type="text" value="${esc(c.nombre)}" data-k="nombre" />
      <button class="rem" data-del="${c.id}" aria-label="Eliminar">×</button>
    </div>
  `).join('');
  const body = `
    <div class="cats-editor" id="cats-list">${rows}</div>
    <button class="add" id="cat-add">+ Nueva categoría</button>
    <div class="sheet-cta">
      <button class="btn primary" id="cats-save">Guardar cambios</button>
    </div>
  `;
  openSheet('Categorías', body, (root) => {
    $('#cat-add', root).onclick = () => {
      const list = $('#cats-list', root);
      const div = document.createElement('div');
      div.className = 'row';
      div.dataset.cid = 'new';
      div.innerHTML = `
        <input type="color" value="#9AA89C" data-k="color" />
        <input type="text" class="icon-in" maxlength="2" data-k="icono" placeholder="🔖" />
        <input type="text" placeholder="Nueva categoría" data-k="nombre" />
        <button class="rem" data-del="new" aria-label="Eliminar">×</button>
      `;
      list.appendChild(div);
      div.querySelector('[data-k="nombre"]').focus();
      div.querySelector('[data-del]').onclick = () => div.remove();
    };
    $$('[data-del]', root).forEach(b => b.onclick = () => b.closest('.row').remove());

    $('#cats-save', root).onclick = async () => {
      const existingIds = new Set();
      const rows = $$('#cats-list .row', root);
      let orden = 1;
      for (const r of rows){
        const nombre = r.querySelector('[data-k="nombre"]').value.trim();
        const color  = r.querySelector('[data-k="color"]').value;
        const icono  = r.querySelector('[data-k="icono"]').value.trim() || '🔖';
        if (!nombre) continue;
        const cid = r.dataset.cid;
        if (cid === 'new'){
          await DB.add('categorias', { nombre, color, icono, orden });
        } else {
          const id = Number(cid);
          existingIds.add(id);
          await DB.put('categorias', { id, nombre, color, icono, orden });
        }
        orden++;
      }
      // borrar las que ya no están
      for (const c of state.cats){
        if (!existingIds.has(c.id) && rows.some(r => Number(r.dataset.cid) === c.id) === false){
          // solo si estaba en el original y ahora no
          const stillHere = rows.some(r => Number(r.dataset.cid) === c.id);
          if (!stillHere) await DB.del('categorias', c.id);
        }
      }
      toast('Categorías actualizadas');
      closeSheet();
      render();
    };
  });
}

/* ---------- Sheet: settings + backup + recurrentes ---------- */

async function openSettings(){
  const hours = Array.from({length: 24}, (_, i) => i);
  const canNotify = ('Notification' in window);
  const notifStatus = canNotify ? Notification.permission : 'unsupported';
  const body = `
    <div class="reminder-config">
      <div class="top">
        <div>
          <div class="lbl">Recordatorio diario</div>
          <div class="sub" style="font-size:12px; color:var(--ink-50); margin-top:2px;">Te aviso si aún no cargaste gastos hoy.</div>
        </div>
        <button class="toggle ${state.reminder.enabled ? 'on' : ''}" id="rem-toggle" aria-label="Activar recordatorio"></button>
      </div>
      <div class="hour" id="rem-hour-row" style="${state.reminder.enabled ? '' : 'display:none;'}">
        <span class="k">a partir de las</span>
        <select id="rem-hour">
          ${hours.map(h => `<option value="${h}" ${state.reminder.hour === h ? 'selected' : ''}>${String(h).padStart(2,'0')}:00</option>`).join('')}
        </select>
      </div>
      ${canNotify && state.reminder.enabled && notifStatus !== 'granted' ? `
      <div class="permit" id="rem-permit-wrap">
        Solo verás el chip dentro de la app. <button class="btn-permit" id="rem-permit">Activar notificaciones nativas</button>
      </div>` : ''}
      ${canNotify && notifStatus === 'granted' ? '<div class="permit" style="color:var(--teal);">Notificaciones activadas ✓</div>' : ''}
    </div>
    <div class="settings-row" data-go="cats"><div><div class="lbl">Categorías</div><div class="sub">Nombres y colores</div></div><span class="go">Editar ›</span></div>
    <div class="settings-row" data-go="rec"><div><div class="lbl">Gastos recurrentes</div><div class="sub">Se aplican con un toque al empezar el mes</div></div><span class="go">Configurar ›</span></div>
    <div class="settings-row" data-go="export"><div><div class="lbl">Exportar backup</div><div class="sub">Guardá tus datos en un archivo JSON</div></div><span class="go">Descargar ›</span></div>
    <div class="settings-row" data-go="import"><div><div class="lbl">Importar backup</div><div class="sub">Suma los datos de un archivo JSON a los actuales</div></div><span class="go">Elegir ›</span></div>
    <div class="settings-row" data-go="wipe"><div><div class="lbl" style="color:var(--danger);">Borrar todos los datos</div><div class="sub">Esta acción no se puede deshacer</div></div><span class="go" style="color:var(--danger);">Borrar ›</span></div>
    <input type="file" id="import-file" accept="application/json" style="display:none" />
    <div style="padding:24px 0 4px; text-align:center; color:var(--ink-50); font-size:11px;">Gastitos · versión 1.2 · datos locales</div>
  `;
  openSheet('Ajustes', body, (root) => {
    const toggle = $('#rem-toggle', root);
    const hourRow = $('#rem-hour-row', root);
    const hourSel = $('#rem-hour', root);
    toggle.onclick = async () => {
      state.reminder.enabled = !state.reminder.enabled;
      toggle.classList.toggle('on', state.reminder.enabled);
      hourRow.style.display = state.reminder.enabled ? '' : 'none';
      await saveReminderConfig();
    };
    hourSel.onchange = async () => {
      state.reminder.hour = Number(hourSel.value);
      await saveReminderConfig();
    };
    const permit = $('#rem-permit', root);
    if (permit) permit.onclick = async () => {
      try {
        const r = await Notification.requestPermission();
        if (r === 'granted') toast('Notificaciones activadas');
        else toast('Permiso denegado');
      } catch { toast('No se pudo activar'); }
      closeSheet(); setTimeout(openSettings, 200);
    };

    root.querySelector('[data-go="cats"]').onclick = () => { closeSheet(); setTimeout(openCatsEditor, 200); };
    root.querySelector('[data-go="rec"]').onclick  = () => { closeSheet(); setTimeout(openRecurrentes, 200); };
    root.querySelector('[data-go="export"]').onclick = doExport;
    root.querySelector('[data-go="import"]').onclick = () => $('#import-file', root).click();
    $('#import-file', root).onchange = (e) => doImport(e.target.files[0]);
    root.querySelector('[data-go="wipe"]').onclick = async () => {
      const ok1 = await openConfirm('Se van a borrar todos tus gastos, planes, aportes y categorías. Es irreversible.', { title: '¿Borrar todos los datos?' });
      if (!ok1) return;
      const ok2 = await openConfirm('Última confirmación: esto no se puede deshacer.', { title: 'Confirmá de nuevo', confirmLabel: 'Sí, borrar todo' });
      if (!ok2) return;
      for (const s of ['config','categorias','gastos','planes','movimientos','recurrentes']) await DB.clear(s);
      await ensureSeed();
      state.reminder = { enabled: false, hour: 20, dismissed: '' };
      closeSheet();
      toast('Datos borrados');
      state.mes = monthKey(new Date());
      render();
    };
  });
}

/* ---------- Sheet: recurrentes ---------- */

async function openRecurrentes(){
  const list = await DB.getAll('recurrentes');
  const body = `
    <div id="rec-list">
      ${list.length === 0 ? '<div class="empty">Todavía no hay recurrentes.</div>' :
        list.map(r => {
          const c = state.catsById[r.categoriaId];
          return `<div class="rec-row" data-rec="${r.id}">
            ${catBadge(c, 'sm')}
            <span class="nm">${esc(r.nombre)} <span style="color:var(--ink-50); font-size:12px;">· día ${r.dia}</span></span>
            <span class="amt">${money(r.monto)}</span>
            <button class="rem" data-del="${r.id}" aria-label="Eliminar">×</button>
          </div>`;
        }).join('')}
    </div>
    <button class="add" id="rec-add" style="color:var(--teal); font-size:13px; font-weight:600; margin-top:14px;">+ Nuevo recurrente</button>
    <div class="sheet-cta">
      <button class="btn primary" id="rec-apply">Aplicar al mes actual</button>
    </div>
    <div style="font-size:12px; color:var(--ink-50); margin-top:12px; text-align:center;">
      Aplicar carga estos gastos en <strong>${esc(monthLabel(state.mes))}</strong> si aún no están.
    </div>
  `;
  openSheet('Gastos recurrentes', body, (root) => {
    $$('[data-del]', root).forEach(b => b.onclick = async () => {
      const ok = await openConfirm('¿Eliminar este recurrente? Esta acción no se puede deshacer.', { title: '¿Eliminar recurrente?' });
      if (!ok) return;
      await DB.del('recurrentes', Number(b.dataset.del));
      closeSheet(); setTimeout(openRecurrentes, 150);
    });
    $('#rec-add', root).onclick = () => openRecEditor(null);
    $('#rec-apply', root).onclick = async () => {
      const added = await applyRecurrentes(state.mes);
      toast(added ? `${added} recurrente${added>1?'s':''} aplicado${added>1?'s':''}` : 'Ya estaban aplicados');
      closeSheet();
      render();
    };
  });
}

async function openRecEditor(id){
  let r = { nombre: '', monto: '', categoriaId: state.cats[0]?.id, dia: 1 };
  if (id){ const e = await DB.get('recurrentes', id); if (e) r = e; }
  const body = `
    <div class="form-row"><div class="k">Nombre</div><div class="v"><input type="text" id="re-nom" value="${esc(r.nombre)}" placeholder="Alquiler, Netflix…" /></div></div>
    <div class="form-row"><div class="k">Monto</div><div class="v money-input"><span class="cur">${state.currency}</span><input type="number" inputmode="decimal" step="0.01" min="0" id="re-monto" value="${r.monto || ''}" /></div></div>
    <div class="form-row"><div class="k">Categoría</div>
      <div class="cat-picker" id="re-cats">${state.cats.map(c => `<button class="cchip ${c.id === r.categoriaId?'on':''}" data-catid="${c.id}">${catBadge(c, 'sm')}${esc(c.nombre)}</button>`).join('')}</div>
    </div>
    <div class="form-row"><div class="k">Día del mes</div><div class="v"><input type="number" min="1" max="31" id="re-dia" value="${r.dia}" /></div></div>
    <div class="sheet-cta">
      <button class="btn primary" id="re-save">Guardar</button>
    </div>
  `;
  openSheet(id ? 'Editar recurrente' : 'Nuevo recurrente', body, (root) => {
    let sel = r.categoriaId;
    $$('[data-catid]', root).forEach(b => b.onclick = () => {
      sel = Number(b.dataset.catid);
      $$('[data-catid]', root).forEach(x => x.classList.toggle('on', Number(x.dataset.catid) === sel));
    });
    $('#re-save', root).onclick = async () => {
      const nombre = $('#re-nom', root).value.trim();
      const monto  = Number($('#re-monto', root).value);
      const dia    = Math.max(1, Math.min(31, Number($('#re-dia', root).value) || 1));
      if (!nombre || !monto){ toast('Falta nombre o monto'); return; }
      const rec = { nombre, monto, categoriaId: sel, dia };
      if (id){ rec.id = id; await DB.put('recurrentes', rec); }
      else { await DB.add('recurrentes', rec); }
      toast('Guardado');
      closeSheet(); setTimeout(openRecurrentes, 150);
    };
  });
}

/* ---------- Export / Import ---------- */

async function doExport(){
  const dump = {
    _app: 'gastitos', _version: 1, _exportedAt: new Date().toISOString(),
    config:       await DB.getAll('config'),
    categorias:   await DB.getAll('categorias'),
    gastos:       await DB.getAll('gastos'),
    planes:       await DB.getAll('planes'),
    movimientos:  await DB.getAll('movimientos'),
    recurrentes:  await DB.getAll('recurrentes')
  };
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `gastitos-backup-${todayISO()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Backup descargado');
}

// Importar SUMA al historial actual, nunca lo reemplaza. Para no duplicar al
// re-importar el mismo backup dos veces, cada store define su propia noción
// de "mismo registro" y lo omite si ya existe (ver mergeImport()).
async function doImport(file){
  if (!file) return;
  let data;
  try {
    const text = await file.text();
    data = JSON.parse(text);
    if (data._app !== 'gastitos') throw new Error('no es un backup de Gastitos');
  } catch (e){
    toast('No pude leer ese archivo (' + e.message + ')');
    return;
  }

  const nGastos = (data.gastos || []).length;
  const nMovs = (data.movimientos || []).length;
  const nCats = (data.categorias || []).length;
  const nRecs = (data.recurrentes || []).length;
  const fechas = (data.gastos || []).map(g => g.fecha).sort();
  const rango = fechas.length ? `del ${fechas[0]} al ${fechas[fechas.length-1]}` : '';

  const body = `
    <div class="import-preview">
      <div class="ip-row"><span>Gastos</span><b>${nGastos}</b></div>
      <div class="ip-row"><span>Aportes de ahorro/inversión</span><b>${nMovs}</b></div>
      <div class="ip-row"><span>Categorías</span><b>${nCats}</b></div>
      <div class="ip-row"><span>Recurrentes</span><b>${nRecs}</b></div>
      ${rango ? `<div class="ip-row"><span>Rango de fechas</span><b>${esc(rango)}</b></div>` : ''}
    </div>
    <p class="ip-note">Esto se <strong>suma</strong> a tus datos actuales — no se borra nada. Si un gasto tiene la misma fecha, categoría y monto que uno que ya tenés, se omite para no duplicarlo.</p>
    <div class="sheet-cta">
      <button class="btn ghost" id="ip-cancel">Cancelar</button>
      <button class="btn primary" id="ip-ok">Importar</button>
    </div>
  `;
  openSheet('Importar backup', body, (root) => {
    $('#ip-cancel', root).onclick = closeSheet;
    $('#ip-ok', root).onclick = async () => {
      const result = await mergeImport(data);
      await ensureSeed();
      toast(`Importado: ${result.addedGastos} gastos nuevos${result.dupGastos ? `, ${result.dupGastos} duplicados omitidos` : ''}`);
      closeSheet();
      render();
    };
  });
}

// Fusiona un dump exportado con los datos actuales. Las categorías se emparejan
// por nombre (no por id: dos exports en momentos distintos pueden traer ids que
// ya no corresponden a la misma categoría acá) y se arma un mapa de ids viejos →
// ids reales para remapear categoriaId en gastos y recurrentes.
async function mergeImport(data){
  const existingCats = await DB.getAll('categorias');
  const catByName = new Map(existingCats.map(c => [c.nombre.trim().toLowerCase(), c]));
  const idMap = {};
  for (const c of (data.categorias || [])){
    const key = (c.nombre || '').trim().toLowerCase();
    if (!key) continue;
    if (catByName.has(key)){
      idMap[c.id] = catByName.get(key).id;
    } else {
      const newId = await DB.add('categorias', { nombre: c.nombre, color: c.color, icono: c.icono, orden: c.orden });
      idMap[c.id] = newId;
      catByName.set(key, { id: newId, nombre: c.nombre });
    }
  }
  const remapCat = (id) => idMap[id] ?? id;

  const existingGastos = await DB.getAll('gastos');
  const gastoKey = (g) => `${g.fecha}|${g.categoriaId}|${g.monto}`;
  const gastoKeys = new Set(existingGastos.map(gastoKey));
  let addedGastos = 0, dupGastos = 0;
  for (const g of (data.gastos || [])){
    const rec = { fecha: g.fecha, mes: g.mes || g.fecha.slice(0,7), monto: g.monto, categoriaId: remapCat(g.categoriaId), nota: g.nota || '', createdAt: g.createdAt || Date.now() };
    const key = gastoKey(rec);
    if (gastoKeys.has(key)){ dupGastos++; continue; }
    gastoKeys.add(key);
    await DB.add('gastos', rec);
    addedGastos++;
  }

  const existingMovs = await DB.getAll('movimientos');
  const movKey = (m) => `${m.fecha}|${m.tipo}|${m.monto}`;
  const movKeys = new Set(existingMovs.map(movKey));
  let addedMovs = 0;
  for (const m of (data.movimientos || [])){
    const rec = { fecha: m.fecha, mes: m.mes || m.fecha.slice(0,7), monto: m.monto, tipo: m.tipo, instrumento: m.instrumento || '' };
    const key = movKey(rec);
    if (movKeys.has(key)) continue;
    movKeys.add(key);
    await DB.add('movimientos', rec);
    addedMovs++;
  }

  // Planes: nunca se pisa uno existente — si ese mes ya tiene plan, se conserva el actual.
  let addedPlanes = 0;
  for (const p of (data.planes || [])){
    const existing = await DB.get('planes', p.mes);
    if (existing) continue;
    await DB.put('planes', p);
    addedPlanes++;
  }

  const existingRecs = await DB.getAll('recurrentes');
  const recKey = (r) => `${(r.nombre||'').trim().toLowerCase()}|${r.monto}|${r.dia}`;
  const recKeys = new Set(existingRecs.map(recKey));
  let addedRecs = 0;
  for (const r of (data.recurrentes || [])){
    const rec = { nombre: r.nombre, monto: r.monto, categoriaId: remapCat(r.categoriaId), dia: r.dia };
    const key = recKey(rec);
    if (recKeys.has(key)) continue;
    recKeys.add(key);
    await DB.add('recurrentes', rec);
    addedRecs++;
  }

  return { addedGastos, dupGastos, addedMovs, addedPlanes, addedRecs };
}

/* ==============================================================
   CANVAS CHARTS
   ============================================================== */

function setupCanvas(canvas){
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const cssW = rect.width || canvas.width;
  // El height attribute se pisa más abajo con el alto en píxeles de dispositivo,
  // así que lo guardamos una sola vez en un dataset: si lo releyéramos del
  // attribute en cada llamada, cada redraw multiplicaría el alto por el dpr
  // de nuevo (el canvas crecía sin parar al clickear una barra).
  if (!canvas.dataset.cssH) canvas.dataset.cssH = canvas.getAttribute('height') || '240';
  const cssH = Number(canvas.dataset.cssH) || 240;
  canvas.style.height = cssH + 'px';
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { ctx, w: cssW, h: cssH };
}

function drawBars(canvas, values, dim, opts={}){
  const { selectedIdx = -1 } = opts;
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const padL = 4, padR = 4, padT = 22, padB = 22;
  const cw = w - padL - padR;
  const ch = h - padT - padB;
  const max = Math.max(1, ...values);
  const bw = cw / dim;
  const today = new Date();
  const todayD = (monthKey(today) === state.mes) ? today.getDate() : -1;
  const hasSelection = selectedIdx !== -1;

  // baseline
  ctx.strokeStyle = '#17332A29'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padL, padT + ch); ctx.lineTo(padL + cw, padT + ch); ctx.stroke();

  for (let i = 0; i < dim; i++){
    const v = values[i];
    const barH = (v / max) * ch;
    const x = padL + i * bw + 1;
    const y = padT + ch - barH;
    const isDimmed = hasSelection && i !== selectedIdx;
    ctx.fillStyle = isDimmed ? '#17332A22' : ((i+1) === todayD ? '#17332A' : (v > 0 ? '#4FA095' : '#BAD1C2'));
    ctx.fillRect(x, y, Math.max(1, bw - 2), Math.max(barH, v > 0 ? 2 : 0));
  }

  // Valor del gasto más alto del mes, como referencia para leer el resto de las barras.
  const maxVal = Math.max(...values);
  if (maxVal > 0){
    const maxIdx = values.indexOf(maxVal);
    const xLabel = padL + (maxIdx + 0.5) * bw;
    const yTop = padT + ch - (maxVal / max) * ch;
    ctx.fillStyle = (hasSelection && maxIdx !== selectedIdx) ? '#17332A55' : '#17332A';
    ctx.font = '600 10px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(moneyC(maxVal), xLabel, Math.max(10, yTop - 6));
  }

  // etiquetas de días en el eje horizontal: primero, último, y algunos intermedios
  // cada 10 días — se ajustan solas al rango de días que se esté mostrando.
  const labelDays = new Set([1, dim]);
  for (let d = 10; d < dim; d += 10) labelDays.add(d);
  ctx.fillStyle = '#17332A66';
  ctx.font = '500 10px system-ui';
  ctx.textAlign = 'center';
  [...labelDays].sort((a,b) => a-b).forEach(d => {
    const x = padL + (d - 0.5) * bw;
    ctx.fillText(String(d), x, h - 6);
  });

  // Geometría del gráfico, para poder mapear clicks a un día específico.
  return { padL, bw, dim, padT, ch };
}

function drawHist(canvas, hist, opts={}){
  const { selectedIdx = -1 } = opts;
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const padL = 8, padR = 8, padT = 20, padB = 30;
  const cw = w - padL - padR;
  const ch = h - padT - padB;
  const max = Math.max(1, ...hist.map(x => x.total));
  const n = hist.length;
  const bw = cw / n;
  const hasSelection = selectedIdx !== -1;

  // baseline
  ctx.strokeStyle = '#17332A29'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padL, padT + ch); ctx.lineTo(padL + cw, padT + ch); ctx.stroke();

  hist.forEach((d, i) => {
    const barH = (d.total / max) * ch;
    const x = padL + i * bw + bw*0.15;
    const y = padT + ch - barH;
    const isCur = d.mes === state.mes;
    const isDimmed = hasSelection && i !== selectedIdx;
    ctx.fillStyle = isDimmed ? '#17332A22' : (isCur ? '#17332A' : '#BAD1C2');
    ctx.fillRect(x, y, bw*0.7, Math.max(barH, 2));

    // label mes
    ctx.fillStyle = isDimmed ? '#17332A55' : (isCur ? '#17332A' : '#17332A66');
    ctx.font = '500 10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(monthShort(d.mes).replace('.', ''), x + bw*0.35, h - 14);

    // valor
    if (d.total > 0){
      ctx.font = '500 10px ui-monospace, Menlo, monospace';
      ctx.fillStyle = isDimmed ? '#17332A55' : (isCur ? '#17332A' : '#17332A66');
      ctx.fillText(formatMoney(d.total, { showDec: false }), x + bw*0.35, y - 6);
    }
  });

  return { padL, bw };
}

// Resúmenes textuales de los gráficos de canvas, para lectores de pantalla
// (el canvas no expone nada por sí solo — ver también la <ul class="sr-only"> con el detalle).
function ritmoDiarioSummary(perDayRender){
  if (perDayRender.length === 0 || perDayRender.every(v => v === 0)) return 'Ritmo diario de gastos: todavía sin gastos este mes.';
  const max = Math.max(...perDayRender);
  const maxDay = perDayRender.indexOf(max) + 1;
  const total = perDayRender.reduce((s,v) => s+v, 0);
  return `Ritmo diario de gastos del mes. Total hasta hoy: ${fm(total)}. Día de mayor gasto: día ${maxDay}, con ${fm(max)}.`;
}
function historicoSummary(history){
  const withData = history.filter(h => h.total > 0);
  if (withData.length === 0) return 'Histórico de los últimos 6 meses: sin datos.';
  const parts = history.map(h => `${monthShort(h.mes).replace('.','')}: ${fm(h.total)}`);
  return `Histórico de gasto de los últimos 6 meses. ${parts.join(', ')}.`;
}

/* ==============================================================
   Toast
   ============================================================== */

let toastT;
function toast(msg){
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>`;
  t.classList.remove('on'); void t.offsetWidth; t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), 1700);
}

/* ==============================================================
   Bootstrap
   ============================================================== */

async function init(){
  await ensureSeed();
  const cur = await DB.get('config', 'currency');
  const loc = await DB.get('config', 'locale');
  if (cur?.value) state.currency = cur.value;
  if (loc?.value) state.locale = loc.value;
  await loadReminderConfig();

  // Delegación global para data-open y data-nav en anchors
  document.body.addEventListener('click', (e) => {
    const openEl = e.target.closest('[data-open]');
    if (openEl){
      e.preventDefault();
      const kind = openEl.dataset.open;
      if (kind === 'add-gasto') openAddGasto();
      else if (kind === 'add-mov') openAddMov();
      else if (kind === 'settings') openSettings();
      else if (kind === 'cats') openCatsEditor();
      return;
    }
    const navEl = e.target.closest('a[data-nav]');
    if (navEl){ e.preventDefault(); nav(navEl.dataset.nav); }
  });

  $$('#nav button').forEach(b => b.onclick = () => nav(b.dataset.nav));

  await render();

  if ('serviceWorker' in navigator && location.protocol !== 'file:'){
    try { await navigator.serviceWorker.register('./sw.js'); } catch {}
  }
}

init();
