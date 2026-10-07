// محرك التوزيع الذكي: يوزّع حصص برامج كل خطة على أيام النشاط في أسابيع الفصل.
// - البرامج المرتبطة بمناسبة تنحصر كلها في أسبوع المناسبة: حصة في كل يوم (أي يوم دراسي،
//   حتى لو ما هو من أيام النشاط)، والمعلم يختار الحصة لكل يوم (plan.occasionSlots).
// - باقي البرامج تتوزع بالتتابع على أقرب أيام فاضية.
// - في أيام «الحصتين المتتاليتين» يستوعب اليوم حصتين من نفس البرنامج.
// - التوزيع يتجنب الأيام/الحصص المحجوزة لنفس المعلم أو نفس الفصل في خطط سابقة.
import { programSessions, stageOfClass, studyDays, semesterDays, resolveOccasions, defaultActivityDays } from '../services/catalog.js';
import { DAY_ORDER } from '../utils/arabic.js';

export function planStage(state, catalog, plan) {
  const cls = state.classes.find((c) => c.id === plan.classId);
  return stageOfClass(catalog, cls);
}

export function planDays(state, catalog, plan) {
  const stage = planStage(state, catalog, plan);
  const cls = state.classes.find((c) => c.id === plan.classId);
  const d = Array.isArray(plan.days) && plan.days.length ? plan.days : defaultActivityDays(catalog, state.settings, stage, cls?.gradeId);
  return DAY_ORDER.filter((k) => d.includes(k));
}

export function planProgramSessions(state, catalog, plan, item) {
  if (item.sessions > 0) return item.sessions;
  return programSessions(catalog, state.settings, item.programId, planStage(state, catalog, plan)) || 0;
}

function periodsFor(plan, dayKey, count) {
  const p = parseInt(plan.periods?.[dayKey], 10);
  if (!(p >= 1)) return [];
  return Array.from({ length: count }, (_, i) => p + i);
}

/**
 * أيام أسبوع المناسبة الدراسية. لو يوم المناسبة إجازة أو أسبوعها كله إجازة → أقرب أسبوع دراسي قبلها، وإلا بعدها.
 */
export function occasionWeek(catalog, occasion, semesterId = 1) {
  const all = semesterDays(catalog, semesterId);
  const weeks = [];
  all.forEach((d) => { (weeks[d.weekIndex] = weeks[d.weekIndex] || []).push(d); });
  const list = weeks.filter(Boolean);
  const study = (w) => w.filter((d) => d.type === 'study');
  // الأسبوع اللي يبدأ قبل/في تاريخ المناسبة (الجمعة والسبت يتبعون الأسبوع اللي قبلهم)
  let i = -1;
  list.forEach((w, k) => { if (w[0].date <= occasion.date) i = k; });
  for (let k = i; k >= 0; k--) if (study(list[k]).length) return study(list[k]);
  for (let k = Math.max(0, i + 1); k < list.length; k++) if (study(list[k]).length) return study(list[k]);
  return [];
}

/**
 * يوزّع خطة وحدة.
 * busy: {teacher: Set('date|period'), class: Set('date|period')} — يتحدث أثناء التوزيع
 */
export function schedulePlan(state, catalog, plan, busy = null, opts = {}) {
  const stage = planStage(state, catalog, plan);
  const days = planDays(state, catalog, plan);
  const doubles = new Set((plan.doubleDays || []).filter((d) => days.includes(d)));
  const occasions = Object.fromEntries(resolveOccasions(catalog, plan.semester || 1).map((o) => [o.id, o]));
  const maxP = state.settings?.periodsPerDay || 7;

  const from = plan.startDate || null;
  const candidates = studyDays(catalog, plan.semester || 1)
    .filter((d) => days.includes(d.day) && (!from || d.date >= from))
    .map((d) => {
      const cap = doubles.has(d.day) ? 2 : 1;
      return { ...d, cap, periods: periodsFor(plan, d.day, cap).filter((p) => p <= maxP) };
    });

  const tKey = plan.teacherId ? `t:${plan.teacherId}` : null;
  const cKey = plan.classId ? `c:${plan.classId}` : null;
  const blocked = (c) => {
    if (!busy || !c.periods.length) return false;
    return c.periods.some((p) => (tKey && busy.has(`${tKey}|${c.date}|${p}`)) || (cKey && busy.has(`${cKey}|${c.date}|${p}`)));
  };
  const used = new Set();
  let occUsedRef = null;
  let occDatesRef = null;
  const occClash = (c) => occUsedRef && (c.periods.length ? c.periods.some((p) => occUsedRef.has(`${c.date}|${p}`)) : occDatesRef.has(c.date));
  const free = (c) => !used.has(c.date) && !occClash(c) && !(opts.avoidBusy !== false && blocked(c));

  const items = (plan.programs || []).map((it, idx) => {
    const prog = catalog.programById[it.programId];
    const needed = planProgramSessions(state, catalog, plan, it);
    const occ = prog?.occasionId ? occasions[prog.occasionId] : null;
    return { idx, programId: it.programId, prog, needed, occasion: occ || null };
  });

  const results = new Array(items.length);
  const take = (item, list) => {
    const slots = [];
    let filled = 0;
    for (const c of list) {
      if (filled >= item.needed) break;
      const count = Math.min(c.cap, item.needed - filled);
      slots.push({ date: c.date, day: c.day, hijri: c.hijri, weekIndex: c.weekIndex, weekLabel: c.weekLabel, count, periods: c.periods.slice(0, count) });
      used.add(c.date);
      filled += count;
    }
    return { slots, filled };
  };

  // ١) البرامج المرتبطة بمناسبة: كلها في أسبوع المناسبة، حصة في كل يوم، والحصة يختارها المعلم
  const occUsed = new Set(); // 'date|period'
  const occDates = new Set();
  const isBusy = (date, p) => !!busy && ((tKey && busy.has(`${tKey}|${date}|${p}`)) || (cKey && busy.has(`${cKey}|${date}|${p}`)));
  const fallbackPeriod = (() => { const v = Object.values(plan.periods || {}).map((x) => parseInt(x, 10)).find((x) => x >= 1 && x <= maxP); return v || null; })();
  const pickPeriod = (date, day, avoid) => {
    const base = parseInt(plan.periods?.[day], 10) || fallbackPeriod;
    if (!base) return null;
    const order = [base, ...Array.from({ length: maxP }, (_, k) => k + 1).filter((x) => x !== base).sort((x, y) => Math.abs(x - base) - Math.abs(y - base) || x - y)];
    return order.find((x) => !avoid.has(x) && !isBusy(date, x) && !occUsed.has(`${date}|${x}`)) || null;
  };
  items.filter((i) => i.occasion && i.needed > 0).forEach((item) => {
    const week = occasionWeek(catalog, item.occasion, plan.semester || 1);
    const weekDays = week.map((d) => ({ date: d.date, day: d.day, hijri: d.hijri, weekIndex: d.weekIndex, weekLabel: d.weekLabel }));
    const taken = Object.fromEntries(weekDays.map((d) => [d.date, Array.from({ length: maxP }, (_, k) => k + 1).filter((p) => isBusy(d.date, p))]));
    const custom = plan.occasionSlots?.[item.programId];
    let slots;
    if (custom && typeof custom === 'object') {
      // اختيار المعلم
      slots = weekDays.filter((d) => Array.isArray(custom[d.date]) && custom[d.date].length).map((d) => {
        const periods = [...new Set(custom[d.date].map((x) => parseInt(x, 10)).filter((x) => x >= 1 && x <= maxP))].sort((x, y) => x - y);
        return { ...d, count: periods.length, periods };
      }).filter((sl) => sl.count);
    } else {
      // اقتراح تلقائي: أقرب الأيام لتاريخ المناسبة، حصة في كل يوم (ولو الحصص أكثر من الأيام نكمّل حصة ثانية)
      const t = new Date(item.occasion.date).getTime();
      const order = [...weekDays].sort((x, y) => Math.abs(new Date(x.date) - t) - Math.abs(new Date(y.date) - t) || x.date.localeCompare(y.date));
      const counts = {};
      for (let k = 0; k < item.needed && order.length; k++) { const d = order[k % order.length]; counts[d.date] = (counts[d.date] || 0) + 1; }
      slots = weekDays.filter((d) => counts[d.date]).map((d) => {
        const periods = [];
        for (let k = 0; k < counts[d.date]; k++) { const p = pickPeriod(d.date, d.day, new Set(periods)); if (p) periods.push(p); }
        return { ...d, count: counts[d.date], periods: periods.sort((x, y) => x - y), auto: true };
      });
    }
    slots.forEach((sl) => { occDates.add(sl.date); sl.periods.forEach((p) => occUsed.add(`${sl.date}|${p}`)); });
    const filled = slots.reduce((a2, sl) => a2 + sl.count, 0);
    results[item.idx] = { ...item, slots, filled, weekDays, taken, custom: !!custom };
  });
  occUsedRef = occUsed; occDatesRef = occDates;
  // ٢) باقي البرامج بالتتابع
  let cursor = 0;
  items.filter((i) => !(i.occasion && i.needed > 0)).forEach((item) => {
    const list = [];
    let cap = 0;
    while (cap < item.needed && cursor < candidates.length) {
      const c = candidates[cursor];
      if (free(c)) { list.push(c); cap += c.cap; }
      cursor++;
    }
    const { slots, filled } = take(item, list);
    results[item.idx] = { ...item, slots, filled };
  });

  // حجز الأوقات المستخدمة للخطط اللي بعدها
  if (busy) {
    results.forEach((r) => r.slots.forEach((s) => s.periods.forEach((p) => {
      if (tKey) busy.add(`${tKey}|${s.date}|${p}`);
      if (cKey) busy.add(`${cKey}|${s.date}|${p}`);
    })));
  }

  const programs = results.map((r) => ({
    programId: r.programId,
    name: r.prog?.name || '؟',
    domainId: r.prog?.domainId || null,
    needed: r.needed,
    filled: r.filled,
    shortage: r.filled < r.needed,
    slots: r.slots,
    start: r.slots[0]?.date || null,
    end: r.slots[r.slots.length - 1]?.date || null,
    occasion: r.occasion,
    weekDays: r.weekDays || null,
    taken: r.taken || null,
    custom: !!r.custom,
  }));
  const capacity = candidates.reduce((a, c) => a + c.cap, 0);
  const usedSessions = programs.reduce((a, p) => a + p.filled, 0);
  return { planId: plan.id, stage, days, programs, capacity, usedSessions, candidates: candidates.length };
}

/** يوزّع كل الخطط بترتيب إنشائها مع تجنّب التعارض بين الخطط */
export function scheduleAll(state, catalog) {
  const busy = new Set();
  const out = {};
  [...state.plans]
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .forEach((plan) => { out[plan.id] = schedulePlan(state, catalog, plan, busy); });
  return out;
}
