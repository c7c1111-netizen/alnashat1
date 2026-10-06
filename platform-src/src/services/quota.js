// محرك نسبة ١٠٪: يحسب الحد المتاح لكل معلم من حصص مادته خلال الفصل، والمستخدم منه في الخطط.
import { instructionalWeeks } from './catalog.js';
import { planProgramSessions } from '../scheduler/schedule.js';

/** إجمالي حصص المادة خلال الفصل = الحصص الأسبوعية × أسابيع الدراسة الفعلية */
export function semesterSubjectSessions(catalog, weeklyLoad, semesterId = 1) {
  const w = Number(weeklyLoad) || 0;
  return Math.round(w * instructionalWeeks(catalog, semesterId));
}

export function quotaLimit(state, catalog, teacher) {
  if (!teacher) return null;
  if (Number.isFinite(teacher.quotaOverride) && teacher.quotaOverride >= 0) return teacher.quotaOverride;
  if (!(teacher.weeklyLoad > 0)) return null;
  const pct = (state.settings?.quotaPolicy?.percent ?? 10) / 100;
  return Math.floor(semesterSubjectSessions(catalog, teacher.weeklyLoad, state.school?.semester || 1) * pct);
}

/** الحصص المسندة لمعلم في كل الخطط (اختياري: استثناء خطة) */
export function quotaUsed(state, catalog, teacherId, { excludePlanId = null, extraPlan = null } = {}) {
  let used = 0;
  state.plans.forEach((p) => {
    if (p.teacherId !== teacherId || p.id === excludePlanId) return;
    (p.programs || []).forEach((it) => { used += planProgramSessions(state, catalog, p, it); });
  });
  if (extraPlan && extraPlan.teacherId === teacherId) {
    (extraPlan.programs || []).forEach((it) => { used += planProgramSessions(state, catalog, extraPlan, it); });
  }
  return used;
}

export function teacherQuota(state, catalog, teacherId, opts) {
  const teacher = state.teachers.find((t) => t.id === teacherId);
  const limit = quotaLimit(state, catalog, teacher);
  const used = quotaUsed(state, catalog, teacherId, opts);
  return {
    teacher,
    limit,
    used,
    remaining: limit == null ? null : limit - used,
    exceeded: limit != null && used > limit,
    total: teacher ? semesterSubjectSessions(catalog, teacher.weeklyLoad, state.school?.semester || 1) : 0,
  };
}
