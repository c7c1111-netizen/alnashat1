// حاسبة ١٠٪: حساب الحصص المتاحة والمتبقي لجدول الإسناد اليدوي.
import { instructionalWeeks } from './catalog.js';

/** حصص المادة في الفصل والمتاح منها */
export function calcQuota(load, weeks, percent = 10) {
  const l = Number(load) || 0;
  const w = Number(weeks) || 0;
  if (!(l > 0) || !(w > 0)) return { total: null, cap: null };
  const total = Math.round(l * w);
  return { total, cap: Math.floor(total * (Number(percent) || 0) / 100) };
}

export function calcWeeks(state, catalog) {
  const custom = Number(state.quotaCalc?.weeks);
  return custom > 0 ? custom : instructionalWeeks(catalog, state.school?.semester || 1);
}

/**
 * يكمّل صفوف الجدول: صفوف نفس المعلم ترث المادة والنصاب من أول صف له،
 * والمتاح يُحسب من النصاب، والمتبقي تراكمي لكل معلم حسب ترتيب الصفوف.
 */
export function computeCalcRows(rows, weeks, percent = 10) {
  const firstOf = {};
  const usedBy = {};
  return (rows || []).map((r) => {
    const key = (r.teacher || '').trim();
    const base = key ? (firstOf[key] = firstOf[key] || r) : r;
    const subject = r.subject || base.subject || '';
    const load = Number(r.load) > 0 ? Number(r.load) : Number(base.load) || null;
    const { total, cap } = calcQuota(load, weeks, percent);
    const n = Number(r.n) > 0 ? Number(r.n) : 0;
    let remaining = null;
    if (cap != null) {
      const k = key || r.id;
      usedBy[k] = (usedBy[k] || 0) + n;
      remaining = cap - usedBy[k];
    }
    return { ...r, subject, load, total, cap, n, remaining, inherited: base !== r && key };
  });
}

/** صفوف جدول الإسناد بصيغة ملف الخطة */
export function calcToAssign(rows, weeks, percent) {
  return computeCalcRows(rows, weeks, percent)
    .filter((r) => (r.teacher || '').trim() || (r.program || '').trim())
    .map((r) => ({ teacher: r.teacher || '', subject: r.subject, cap: r.cap, program: r.program || '', grade: r.grade || '', n: r.n, startH: r.start || '', remaining: r.remaining }));
}
