/**
 * Motor de cálculo del ciclo menstrual.
 * Todo el procesamiento ocurre en el dispositivo.
 */

const MS_DAY = 86400000;

export function toDate(str) {
  // "YYYY-MM-DD" → Date en UTC mediodía (evita problemas de TZ)
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function toISO(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(date, n) {
  return new Date(date.getTime() + n * MS_DAY);
}

export function diffDays(a, b) {
  return Math.round((b - a) / MS_DAY);
}

/**
 * Detecta inicios de periodo a partir de entradas ordenadas.
 * Un día es inicio de periodo si: flujo != none y
 * el día previo (aunque no exista) no tenía flujo, o está a ≥3 días del anterior.
 */
export function detectPeriodStarts(entries) {
  const bleeding = entries.filter((e) => e.flow && e.flow !== 'none');
  const starts = [];
  for (const e of bleeding) {
    const d = toDate(e.date);
    const last = starts[starts.length - 1];
    if (!last || diffDays(toDate(last), d) > 2) {
      starts.push(e.date);
    }
  }
  return starts;
}

/**
 * Calcula duración media del ciclo usando promedios móviles
 * (media simple sobre los últimos N ciclos; N configurable).
 */
export function computeCycleStats(entries, windowSize = 6) {
  const starts = detectPeriodStarts(entries);
  if (starts.length < 2) {
    return { avgCycle: 28, avgPeriod: 5, cycles: [], confidence: 'low' };
  }

  const cycleLengths = [];
  for (let i = 1; i < starts.length; i++) {
    cycleLengths.push(diffDays(toDate(starts[i - 1]), toDate(starts[i])));
  }
  const recent = cycleLengths.slice(-windowSize);
  const avgCycle = Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);

  // Duración media del sangrado
  const periodLengths = [];
  for (const s of starts) {
    const startDate = toDate(s);
    let len = 0;
    for (let i = 0; i < 15; i++) {
      const dayStr = toISO(addDays(startDate, i));
      const rec = entries.find((e) => e.date === dayStr);
      if (rec && rec.flow && rec.flow !== 'none') len++;
      else if (i > 0) break;
    }
    if (len > 0) periodLengths.push(len);
  }
  const recentP = periodLengths.slice(-windowSize);
  const avgPeriod = recentP.length
    ? Math.round(recentP.reduce((a, b) => a + b, 0) / recentP.length)
    : 5;

  // Confianza basada en la varianza de los ciclos recientes
  const mean = avgCycle;
  const variance =
    recent.reduce((acc, v) => acc + (v - mean) ** 2, 0) / recent.length;
  const sd = Math.sqrt(variance);
  let confidence = 'high';
  if (sd > 4) confidence = 'low';
  else if (sd > 2) confidence = 'medium';

  return {
    avgCycle,
    avgPeriod,
    cycles: cycleLengths.slice(-windowSize),
    lastPeriodStart: starts[starts.length - 1],
    lastPeriodEnd: toISO(
      addDays(toDate(starts[starts.length - 1]), Math.max(avgPeriod - 1, 0))
    ),
    periodStarts: starts,
    confidence,
  };
}

/**
 * Predice los próximos N periodos y ventanas fértiles.
 * Ventana fértil: 5 días antes de la ovulación + día de ovulación.
 * Ovulación estimada: 14 días antes del próximo periodo (o mitad del ciclo si es corto).
 */
export function predictFuture(stats, count = 3) {
  if (!stats.lastPeriodStart) return [];
  const out = [];
  let cursor = toDate(stats.lastPeriodStart);

  for (let i = 1; i <= count; i++) {
    const nextStart = addDays(cursor, stats.avgCycle);
    const periodEnd = addDays(nextStart, Math.max(stats.avgPeriod - 1, 0));
    const ovulation = addDays(nextStart, -14);
    const fertileStart = addDays(ovulation, -5);
    const fertileEnd = ovulation;

    out.push({
      periodStart: toISO(nextStart),
      periodEnd: toISO(periodEnd),
      fertileStart: toISO(fertileStart),
      fertileEnd: toISO(fertileEnd),
      ovulation: toISO(ovulation),
    });
    cursor = nextStart;
  }
  return out;
}

/**
 * Construye un mapa de estado por día para el calendario.
 * Claves: YYYY-MM-DD. Valores: { period, predicted, fertile }
 */
export function buildDayStates(entries, stats, predictions) {
  const map = {};

  // Periodos reales
  const bleeding = entries.filter((e) => e.flow && e.flow !== 'none');
  for (const e of bleeding) {
    map[e.date] = { ...(map[e.date] || {}), period: true };
  }

  // Predicciones
  for (const p of predictions) {
    let d = toDate(p.periodStart);
    const end = toDate(p.periodEnd);
    while (d <= end) {
      const k = toISO(d);
      map[k] = { ...(map[k] || {}), predicted: true };
      d = addDays(d, 1);
    }
    let f = toDate(p.fertileStart);
    const fEnd = toDate(p.fertileEnd);
    while (f <= fEnd) {
      const k = toISO(f);
      map[k] = { ...(map[k] || {}), fertile: true };
      f = addDays(f, 1);
    }
  }

  return map;
}

/**
 * Devuelve el estado actual del ciclo.
 */
export function currentStatus(entries, stats, predictions) {
  const today = toISO(new Date());
  const next = predictions[0];
  if (!next) {
    return {
      phase: 'Sin datos suficientes',
      message: 'Registra al menos dos periodos para ver predicciones.',
    };
  }
  const todayD = toDate(today);
  const nextStart = toDate(next.periodStart);
  const daysToNext = diffDays(todayD, nextStart);
  const lastStart = toDate(stats.lastPeriodStart);
  const daysSinceStart = diffDays(lastStart, todayD);

  let phase = 'Folicular';
  if (daysSinceStart < stats.avgPeriod) phase = 'Menstrual';
  else if (
    today >= next.fertileStart &&
    today <= next.fertileEnd &&
    daysToNext > 0
  )
    phase = 'Fértil';
  else if (daysToNext >= 0 && daysToNext <= 3) phase = 'Lútea';

  return {
    phase,
    daysToNext: Math.max(daysToNext, 0),
    message:
      daysToNext > 0
        ? `Próximo periodo en ~${daysToNext} día${daysToNext === 1 ? '' : 's'}.`
        : 'Periodo esperado hoy o pasado.',
    nextStart: next.periodStart,
    nextEnd: next.periodEnd,
    fertileStart: next.fertileStart,
    fertileEnd: next.fertileEnd,
    confidence: stats.confidence,
  };
}