import * as db from './db.js';
import * as engine from './engine.js';

let currentMonth = new Date();
let selectedFlow = 'none';
let selectedSymptoms = new Set();
let selectedMoods = new Set();

/* ---------- Utilidades de DOM ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

/* ---------- Chips ---------- */
function bindChips(containerSel, opts = {}) {
  const container = $(containerSel);
  container.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const value = chip.dataset.value;

    if (opts.single) {
      container.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      opts.onChange(value);
    } else {
      chip.classList.toggle('active');
      const set = opts.set;
      set.has(value) ? set.delete(value) : set.add(value);
      opts.onChange([...set]);
    }
  });
}

function resetChips(containerSel, single, values) {
  const container = $(containerSel);
  container.querySelectorAll('.chip').forEach((c) => {
    c.classList.toggle(
      'active',
      single ? c.dataset.value === values : values.includes(c.dataset.value)
    );
  });
}

/* ---------- Resumen superior ---------- */
function renderSummary(status) {
  const el = $('#summary');
  const confLabel = { high: 'alta', medium: 'media', low: 'baja' }[status.confidence || 'low'];
  el.innerHTML = `
    <div class="summary-card">
      <span class="phase">${status.phase}</span>
      <p>${status.message}</p>
      ${status.confidence ? `<small>Confianza: ${confLabel}</small>` : ''}
      ${
        status.fertileStart
          ? `<small>Ventana fértil: ${status.fertileStart} → ${status.fertileEnd}</small>`
          : ''
      }
    </div>
  `;
}

/* ---------- Calendario ---------- */
function renderCalendar(dayStates) {
  const grid = $('#calendar');
  const label = $('#month-label');
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const monthNames = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  label.textContent = `${monthNames[month]} ${year}`;

  const first = new Date(year, month, 1);
  const startDay = (first.getDay() + 6) % 7; // lunes=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const weekdays = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  let html = weekdays.map((w) => `<div class="weekday">${w}</div>`).join('');
  for (let i = 0; i < startDay; i++) html += `<div class="day empty"></div>`;

  const todayISO = engine.toISO(new Date());
  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(Date.UTC(year, month, d, 12));
    const iso = dt.toISOString().slice(0, 10);
    const state = dayStates[iso] || {};
    const classes = ['day'];
    if (state.period) classes.push('period');
    if (state.predicted) classes.push('predicted');
    if (state.fertile) classes.push('fertile');
    if (iso === todayISO) classes.push('today');
    html += `<div class="${classes.join(' ')}" data-date="${iso}">${d}</div>`;
  }
  grid.innerHTML = html;

  grid.querySelectorAll('.day:not(.empty)').forEach((cell) => {
    cell.addEventListener('click', () => openRegisterForDate(cell.dataset.date));
  });
}

/* ---------- Formulario ---------- */
function openRegisterForDate(dateStr) {
  switchTab('register');
  $('#reg-date').value = dateStr;
  loadEntryIntoForm(dateStr);
}

async function loadEntryIntoForm(dateStr) {
  const entry = await db.getEntry(dateStr);
  selectedFlow = entry?.flow || 'none';
  selectedSymptoms = new Set(entry?.symptoms || []);
  selectedMoods = new Set(entry?.moods || []);

  resetChips('#flow-chips', true, selectedFlow);
  resetChips('#symptom-chips', false, [...selectedSymptoms]);
  resetChips('#mood-chips', false, [...selectedMoods]);
  $('#reg-notes').value = entry?.notes || '';
}

/* ---------- Historial ---------- */
async function renderHistory() {
  const entries = await db.getAllEntries();
  const list = $('#history-list');
  if (!entries.length) {
    list.innerHTML = '<li class="empty">Aún no hay registros.</li>';
    return;
  }
  list.innerHTML = entries
    .slice()
    .reverse()
    .map((e) => {
      const flow = { none: '—', light: 'Ligero', medium: 'Medio', heavy: 'Abundante' }[e.flow] || '—';
      return `
        <li>
          <div>
            <strong>${e.date}</strong>
            <span class="muted">Flujo: ${flow}</span>
            ${e.symptoms?.length ? `<span class="muted">Síntomas: ${e.symptoms.join(', ')}</span>` : ''}
            ${e.moods?.length ? `<span class="muted">Ánimo: ${e.moods.join(', ')}</span>` : ''}
          </div>
          <button class="icon-btn" data-del="${e.date}" title="Eliminar">✕</button>
        </li>`;
    })
    .join('');

  list.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (confirm('¿Eliminar este registro?')) {
        await db.deleteEntry(btn.dataset.del);
        await refreshAll();
      }
    });
  });
}

/* ---------- Navegación ---------- */
function switchTab(view) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  if (view === 'history') renderHistory();
}

/* ---------- Refresco global ---------- */
async function refreshAll() {
  const entries = await db.getAllEntries();
  const stats = engine.computeCycleStats(entries);
  const predictions = engine.predictFuture(stats, 3);
  const dayStates = engine.buildDayStates(entries, stats, predictions);
  const status = engine.currentStatus(entries, stats, predictions);

  renderSummary(status);
  renderCalendar(dayStates);
}

/* ---------- Init ---------- */
export async function initUI() {
  // Tabs
  $$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.view)));

  // Meses
  $('#prev-month').addEventListener('click', () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    refreshAll();
  });
  $('#next-month').addEventListener('click', () => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    refreshAll();
  });

  // Fecha por defecto = hoy
  $('#reg-date').value = engine.toISO(new Date());
  $('#reg-date').addEventListener('change', (e) => loadEntryIntoForm(e.target.value));

  // Chips
  bindChips('#flow-chips', { single: true, onChange: (v) => (selectedFlow = v) });
  bindChips('#symptom-chips', {
    set: selectedSymptoms,
    onChange: (v) => (selectedSymptoms = new Set(v)),
  });
  bindChips('#mood-chips', {
    set: selectedMoods,
    onChange: (v) => (selectedMoods = new Set(v)),
  });

  // Submit
  $('#daily-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const date = $('#reg-date').value;
    if (!date) return;
    const entry = {
      date,
      flow: selectedFlow,
      symptoms: [...selectedSymptoms],
      moods: [...selectedMoods],
      notes: $('#reg-notes').value.trim(),
      updatedAt: Date.now(),
    };
    await db.saveEntry(entry);
    await refreshAll();
    switchTab('calendar');
  });

  // Exportar
  $('#export-btn').addEventListener('click', async () => {
    const entries = await db.getAllEntries();
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ciclo-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // Borrar todo
  $('#wipe-btn').addEventListener('click', async () => {
    if (confirm('Esto borrará TODOS tus datos locales. ¿Continuar?')) {
      await db.wipeAll();
      await refreshAll();
      await renderHistory();
    }
  });

  // Estado offline
  const badge = $('#offline-badge');
  const updateOnline = () => (badge.hidden = navigator.onLine);
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();

  await refreshAll();
  await loadEntryIntoForm(engine.toISO(new Date()));
}