// محرك التوزيع الذكي: يوزّع حصص برامج كل خطة على أيام النشاط في أسابيع الفصل.
// - البرامج المرتبطة بمناسبة تنحجز أولًا في أقرب الأيام لتاريخ المناسبة.
// - باقي البرامج تتوزع بالتتابع على أقرب أيام فاضية.
// - في أيام «الحصتين المتتاليتين» يستوعب اليوم حصتين من نفس البرنامج.
// - التوزيع يتجنب الأيام/الحصص المحجوزة لنفس المعلم أو نفس الفصل في خطط سابقة.
import { programSessions, stageOfClass, studyDays, resolveOccasions, defaultActivityDays } from '../services/catalog.js';
import { DAY_ORDER } from '../utils/arabic.js';

export function planStage(state, catalog, plan) {
  const cls = state.classes.find((c) => c.id === plan.classId);
  return stageOfClass(catalog, cls);
}

export function planDays(state, catalog, plan) {
  const stage = planStage(state, catalog, plan);
  const d = Array.isArray(plan.days) && plan.days.length ? plan.days : defaultActivityDays(catalog, state.settings, stage);
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
  const free = (c) => !used.has(c.date) && !(opts.avoidBusy !== false && blocked(c));

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

  // ١) البرامج المرتبطة بمناسبة
  items.filter((i) => i.occasion && i.needed > 0).forEach((item) => {
    const t = new Date(item.occasion.date).getTime();
    const pool = candidates.filter(free).sort((a, b) =>
      Math.abs(new Date(a.date) - t) - Math.abs(new Date(b.date) - t) || a.date.localeCompare(b.date));
    const picked = [];
    let cap = 0;
    for (const c of pool) { if (cap >= item.needed) break; picked.push(c); cap += c.cap; }
    picked.sort((a, b) => a.date.localeCompare(b.date));
    const { slots, filled } = take(item, picked);
    results[item.idx] = { ...item, slots, filled };
  });
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
