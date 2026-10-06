// بيانات مشتقة للوحات: حالة البرامج، نسب الإنجاز، التنبيهات الذكية، الأسابيع القادمة.
import { classLabel, resolveOccasions, semesterDays } from './catalog.js';
import { teacherQuota } from './quota.js';
import { todayISO, arNum, countLabel } from '../utils/arabic.js';

export function recordOf(plan, programId) {
  const r = plan.records?.[programId] || {};
  const status = r.status || (plan.status === 'approved' ? 'planned' : 'not_started');
  return { goal: '', targetStudents: '', tools: '', steps: '', notes: '', ...r, status };
}

export function programRows(state, catalog, derived, { today = todayISO() } = {}) {
  const rows = [];
  state.plans.forEach((plan) => {
    const sched = derived.schedules[plan.id];
    const cls = state.classes.find((c) => c.id === plan.classId);
    const teacher = state.teachers.find((t) => t.id === plan.teacherId);
    (plan.programs || []).forEach((it) => {
      const sp = sched?.programs.find((p) => p.programId === it.programId);
      const prog = catalog.programById[it.programId];
      const rec = recordOf(plan, it.programId);
      const evidence = state.evidence.filter((e) => e.planId === plan.id && e.programId === it.programId);
      const overdue = rec.status !== 'done' && sp?.end && sp.end < today;
      rows.push({
        key: `${plan.id}:${it.programId}`,
        plan, programId: it.programId, program: prog, domain: catalog.domainById[prog?.domainId],
        cls, classText: classLabel(catalog, cls, true), teacher,
        sched: sp, record: rec, evidence, overdue,
        start: sp?.start || null, end: sp?.end || null, sessions: sp?.needed || 0,
      });
    });
  });
  return rows;
}

export function planProgress(state, plan) {
  const ids = (plan.programs || []).map((p) => p.programId);
  if (!ids.length) return 0;
  const done = ids.filter((id) => recordOf(plan, id).status === 'done').length;
  const prog = ids.filter((id) => recordOf(plan, id).status === 'in_progress').length;
  return Math.round(((done + prog * 0.5) / ids.length) * 100);
}

export function dashboardStats(state, catalog, derived) {
  const rows = programRows(state, catalog, derived);
  const done = rows.filter((r) => r.record.status === 'done').length;
  const errors = derived.issues.filter((i) => i.severity === 'error');
  const warnings = derived.issues.filter((i) => i.severity === 'warning');
  const plansWithErrors = new Set(errors.map((e) => e.planId));
  const needsReview = state.plans.filter((p) => p.status === 'review' || (p.status !== 'approved' && plansWithErrors.has(p.id))).length;
  return {
    plans: state.plans.length,
    programs: rows.length,
    done,
    notDone: rows.length - done,
    completion: rows.length ? Math.round((done / rows.length) * 100) : 0,
    overdue: rows.filter((r) => r.overdue).length,
    needsReview,
    conflicts: errors.length + warnings.length,
    errors: errors.length,
    warnings: warnings.length,
    evidence: state.evidence.length,
    teachers: new Set(state.plans.map((p) => p.teacherId).filter(Boolean)).size,
    rows,
  };
}

export function smartAlerts(state, catalog, derived, stats, { today = todayISO() } = {}) {
  const alerts = [];
  if (stats.overdue) {
    alerts.push({ tone: 'warn', icon: '⏰', text: `لديك ${countLabel(stats.overdue, 'برنامج واحد', 'برنامجان', 'برامج', 'برنامجًا')} انتهى موعده ولم يُنفّذ`, to: '#/programs?filter=overdue' });
  }
  const undocumented = stats.rows.filter((r) => r.record.status === 'done' && !r.evidence.length).length;
  if (undocumented) {
    alerts.push({ tone: 'warn', icon: '📎', text: `${countLabel(undocumented, 'برنامج مكتمل يحتاج', 'برنامجان مكتملان يحتاجان', 'برامج مكتملة تحتاج', 'برنامجًا مكتملًا يحتاج')} توثيقًا بالشواهد`, to: '#/evidence' });
  }
  const in7 = new Date(new Date(today).getTime() + 7 * 86400000).toISOString().slice(0, 10);
  resolveOccasions(catalog, state.school.semester).filter((o) => o.date >= today && o.date <= in7).forEach((o) => {
    alerts.push({ tone: 'info', icon: '📅', text: `خلال الأسبوع القادم: ${o.name}`, to: '#/timeline' });
  });
  state.teachers.forEach((t) => {
    const q = teacherQuota(state, catalog, t.id);
    if (q.exceeded) alerts.push({ tone: 'danger', icon: '🔴', text: `${t.name} تجاوز حد ١٠٪ (${arNum(q.used)} من ${arNum(q.limit)})`, to: '#/teachers' });
  });
  if (stats.errors) {
    alerts.push({ tone: 'danger', icon: '⚠️', text: `${countLabel(stats.errors, 'خطأ واحد', 'خطآن', 'أخطاء', 'خطأً')} في الخطط يمنع الاعتماد`, to: '#/plans' });
  }
  return alerts;
}

/** الأسابيع القادمة (من اليوم): المناسبات والبرامج المجدولة */
export function upcomingWeeks(state, catalog, derived, { today = todayISO(), count = 2 } = {}) {
  const days = semesterDays(catalog, state.school.semester);
  const weeks = [];
  const byWeek = new Map();
  days.forEach((d) => {
    if (!byWeek.has(d.weekIndex)) byWeek.set(d.weekIndex, []);
    byWeek.get(d.weekIndex).push(d);
  });
  const occ = resolveOccasions(catalog, state.school.semester);
  for (const [wi, ds] of byWeek) {
    const last = ds[ds.length - 1].date;
    if (last < today) continue;
    const first = ds[0].date;
    const items = [];
    state.plans.forEach((plan) => {
      derived.schedules[plan.id]?.programs.forEach((sp) => sp.slots.forEach((s) => {
        if (s.date >= first && s.date <= last) items.push({ plan, sp, slot: s });
      }));
    });
    weeks.push({
      weekIndex: wi, label: ds[0].weekLabel, first, last,
      type: ds.every((d) => d.type !== 'study') ? ds[0].type : 'study',
      note: ds.find((d) => d.note)?.note || '',
      occasions: occ.filter((o) => o.date >= first && o.date <= last),
      items,
    });
    if (weeks.length >= count) break;
  }
  return weeks;
}
