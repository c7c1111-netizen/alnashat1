// نموذج «ملف خطة برامج النشاط الطلابي» الموحّد — نفس البيانات تغذّي Word والـ PDF والمعاينة.
import { classLabel, semesterOf } from '../services/catalog.js';
import { planStage } from '../scheduler/schedule.js';
import { teacherQuota } from '../services/quota.js';
import { hijriShort } from '../utils/arabic.js';

export function plansInScope(state, scope = state.settings?.exportScope || 'all') {
  return state.plans.filter((p) => (scope === 'approved' ? p.status === 'approved' : true) && p.classId && p.teacherId && p.programs?.length);
}

export function buildMasterModel(state, catalog, derived, { scope } = {}) {
  const plans = plansInScope(state, scope);
  const maxP = Math.min(state.settings?.periodsPerDay || 7, 8);
  const sem = semesterOf(catalog, state.school.semester);
  const weeks = sem.weeks.map((w) => ({
    label: w.label, n: w.n, type: w.type, name: w.name || '',
    days: w.days.map((d) => ({ ...d, cells: Array.from({ length: maxP }, () => []) })),
  }));
  const dayIndex = {};
  weeks.forEach((w) => w.days.forEach((d) => { dayIndex[d.date] = d; }));

  const programsByStage = { low: {}, up: {} };
  const assign = [];
  plans.forEach((plan) => {
    const sched = derived.schedules[plan.id];
    const stage = planStage(state, catalog, plan);
    const cls = state.classes.find((c) => c.id === plan.classId);
    const teacher = state.teachers.find((t) => t.id === plan.teacherId);
    const grade = classLabel(catalog, cls, true);
    sched?.programs.forEach((sp) => {
      if (stage) {
        const byDom = programsByStage[stage];
        byDom[sp.domainId] = byDom[sp.domainId] || [];
        if (!byDom[sp.domainId].some((x) => x.programId === sp.programId)) byDom[sp.domainId].push({ programId: sp.programId, name: sp.name, n: sp.needed });
      }
      assign.push({
        teacherId: teacher?.id, teacher: teacher?.name || '', subject: teacher?.subject || '',
        grade, program: sp.name, n: sp.needed,
        startDate: sp.start || '9999', startH: sp.slots[0] ? hijriShort(sp.slots[0].hijri) : '—',
      });
      sp.slots.forEach((s) => {
        const d = dayIndex[s.date];
        if (!d) return;
        s.periods.forEach((p) => {
          if (p >= 1 && p <= maxP) d.cells[p - 1].push({ program: sp.name, grade, teacher: teacher?.name || '', domainId: sp.domainId });
        });
      });
    });
  });

  // جدول الإسناد: مرتب حسب المعلم ثم تاريخ البداية، والمتبقي من ١٠٪ تراكمي
  const order = [];
  assign.forEach((a) => { if (!order.includes(a.teacherId)) order.push(a.teacherId); });
  assign.sort((a, b) => order.indexOf(a.teacherId) - order.indexOf(b.teacherId) || a.startDate.localeCompare(b.startDate));
  const usedBy = {};
  assign.forEach((a) => {
    const q = teacherQuota(state, catalog, a.teacherId);
    usedBy[a.teacherId] = (usedBy[a.teacherId] || 0) + a.n;
    a.cap = q.limit;
    a.remaining = q.limit == null ? null : q.limit - usedBy[a.teacherId];
  });

  return {
    school: state.school,
    domains: catalog.domains,
    periods: maxP,
    programsByStage,
    assign,
    weeks,
    planCount: plans.length,
  };
}
