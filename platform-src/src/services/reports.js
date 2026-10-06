// مركز التقارير: كل تقرير يُبنى كبيانات (عناوين، فقرات، جداول) ثم يُعرض HTML أو يُصدّر Word/PDF.
import { programRows, recordOf, planProgress } from './insights.js';
import { teacherQuota } from './quota.js';
import { classLabel, resolveOccasions, semesterOf } from './catalog.js';
import { assistant } from './assistant.js';
import { PROGRAM_STATUS, PLAN_STATUS } from '../state/model.js';
import { arNum, gregShort, hijriShort, DAY_NAMES, PERIOD_NAMES, percent, todayISO } from '../utils/arabic.js';
import { planDays } from '../scheduler/schedule.js';

export const REPORTS = [
  { id: 'plan', icon: '🗂️', title: 'تقرير الخطة', desc: 'بيانات خطة واحدة وبرامجها وجدولها', needsPlan: true },
  { id: 'programs', icon: '📚', title: 'تقرير البرامج', desc: 'كل البرامج ومواعيدها وحالتها' },
  { id: 'teachers', icon: '👨‍🏫', title: 'تقرير المعلمين', desc: 'نسبة ١٠٪ والبرامج المسندة لكل معلم' },
  { id: 'execution', icon: '🚦', title: 'تقرير التنفيذ', desc: 'حالة تنفيذ البرامج والمتأخر منها' },
  { id: 'achievement', icon: '🏆', title: 'تقرير الإنجاز', desc: 'نسب الإنجاز حسب المجال والمعلم' },
  { id: 'evidence', icon: '📎', title: 'تقرير الشواهد', desc: 'الشواهد الموثقة لكل برنامج' },
  { id: 'semester', icon: '📅', title: 'تقرير الفصل الدراسي', desc: 'ملخص الفصل والتقرير الختامي' },
];

const statusText = (s) => `${PROGRAM_STATUS[s]?.label || s}`;

export function buildReport(id, state, catalog, derived, { planId } = {}) {
  const rows = programRows(state, catalog, derived);
  const sem = semesterOf(catalog, state.school.semester);
  const head = {
    school: state.school.name || 'المدرسة',
    subtitle: `${sem.name} — العام الدراسي ${catalog.calendar.label}`,
    date: gregShort(todayISO()),
  };
  const def = REPORTS.find((r) => r.id === id);
  const R = { ...head, id, title: def?.title || 'تقرير', sections: [] };

  if (id === 'plan') {
    const plan = state.plans.find((p) => p.id === planId) || state.plans[0];
    if (!plan) { R.sections.push({ paragraphs: ['لا توجد خطط بعد.'] }); return R; }
    const cls = state.classes.find((c) => c.id === plan.classId);
    const t = state.teachers.find((x) => x.id === plan.teacherId);
    const q = t ? teacherQuota(state, catalog, t.id) : null;
    const sched = derived.schedules[plan.id];
    R.title = `تقرير الخطة — ${classLabel(catalog, cls)}`;
    R.sections.push({
      heading: 'البيانات الأساسية',
      table: { head: ['البند', 'القيمة'], rows: [
        ['الصف', classLabel(catalog, cls)], ['المعلم', t?.name || '—'], ['مادة التدريس', t?.subject || '—'],
        ['حد ١٠٪', q?.limit != null ? `${arNum(q.used)} من ${arNum(q.limit)}` : '—'],
        ['أيام النشاط', planDays(state, catalog, plan).map((d) => `${DAY_NAMES[d]} (الحصة ${PERIOD_NAMES[(plan.periods?.[d] || 1) - 1] || '—'}${(plan.doubleDays || []).includes(d) ? ' + التالية' : ''})`).join('، ')],
        ['حالة الخطة', PLAN_STATUS[plan.status]?.label || plan.status], ['نسبة الإنجاز', `${arNum(planProgress(state, plan))}٪`],
      ] },
    });
    R.sections.push({
      heading: 'البرامج',
      table: { head: ['البرنامج', 'المجال', 'الحصص', 'البداية', 'النهاية', 'الحالة'], rows: (sched?.programs || []).map((sp) => [
        sp.name, catalog.domainById[sp.domainId]?.name || '', arNum(sp.needed), sp.start ? gregShort(sp.start) : '—', sp.end ? gregShort(sp.end) : '—', statusText(recordOf(plan, sp.programId).status),
      ]) },
    });
    (sched?.programs || []).forEach((sp) => {
      const r = recordOf(plan, sp.programId);
      const paras = [r.goal && `الهدف: ${r.goal}`, r.targetStudents && `الطلاب المستهدفون: ${r.targetStudents}`, r.tools && `الأدوات: ${r.tools}`, r.steps && `خطوات التنفيذ:\n${r.steps}`, r.notes && `ملاحظات: ${r.notes}`].filter(Boolean);
      R.sections.push({
        heading: `«${sp.name}» — مواعيد التنفيذ`,
        paragraphs: paras,
        table: { head: ['#', 'الأسبوع', 'اليوم', 'الميلادي', 'الهجري', 'الحصة'], rows: sp.slots.map((s, i) => [arNum(i + 1), arNum(s.weekLabel), DAY_NAMES[s.day], gregShort(s.date), hijriShort(s.hijri), s.periods.map((p) => PERIOD_NAMES[p - 1]).join(' و') || '—']) },
      });
    });
    return R;
  }

  if (id === 'programs') {
    R.sections.push({
      heading: `البرامج (${arNum(rows.length)})`,
      table: { head: ['البرنامج', 'المجال', 'الصف', 'المعلم', 'الحصص', 'البداية', 'النهاية', 'الحالة'], rows: rows.map((r) => [
        r.program?.name || '', r.domain?.name || '', r.classText, r.teacher?.name || '', arNum(r.sessions), r.start ? gregShort(r.start) : '—', r.end ? gregShort(r.end) : '—', statusText(r.record.status) + (r.overdue ? ' (متأخر)' : ''),
      ]) },
    });
    return R;
  }

  if (id === 'teachers') {
    const list = state.teachers.filter((t) => state.plans.some((p) => p.teacherId === t.id) || t.weeklyLoad);
    R.sections.push({
      heading: 'نسبة ١٠٪ والإسناد',
      table: { head: ['المعلم', 'المادة', 'النصاب الأسبوعي', 'حد ١٠٪', 'المستخدم', 'المتبقي', 'البرامج', 'الإنجاز'], rows: list.map((t) => {
        const q = teacherQuota(state, catalog, t.id);
        const mine = rows.filter((r) => r.teacher?.id === t.id);
        return [t.name, t.subject || '—', t.weeklyLoad ? arNum(t.weeklyLoad) : '—', q.limit != null ? arNum(q.limit) : '—', arNum(q.used), q.remaining != null ? arNum(q.remaining) : '—', arNum(mine.length), `${arNum(percent(mine.filter((r) => r.record.status === 'done').length, mine.length))}٪`];
      }) },
    });
    return R;
  }

  if (id === 'execution') {
    const counts = Object.keys(PROGRAM_STATUS).map((k) => [statusText(k), arNum(rows.filter((r) => r.record.status === k).length)]);
    R.sections.push({ heading: 'ملخص الحالات', table: { head: ['الحالة', 'عدد البرامج'], rows: counts } });
    const late = rows.filter((r) => r.overdue);
    R.sections.push({
      heading: `البرامج المتأخرة (${arNum(late.length)})`,
      paragraphs: late.length ? [] : ['لا توجد برامج متأخرة.'],
      table: late.length ? { head: ['البرنامج', 'الصف', 'المعلم', 'انتهى في', 'الحالة'], rows: late.map((r) => [r.program?.name, r.classText, r.teacher?.name || '', gregShort(r.end), statusText(r.record.status)]) } : null,
    });
    return R;
  }

  if (id === 'achievement') {
    const byDomain = catalog.domains.map((d) => {
      const list = rows.filter((r) => r.domain?.id === d.id);
      const done = list.filter((r) => r.record.status === 'done').length;
      return [d.name, arNum(list.length), arNum(done), `${arNum(percent(done, list.length))}٪`];
    }).filter((r) => r[1] !== '٠');
    R.sections.push({ heading: 'الإنجاز حسب المجال', table: { head: ['المجال', 'البرامج', 'المكتمل', 'النسبة'], rows: byDomain } });
    R.sections.push({ heading: 'ملخص الإنجاز', paragraphs: [assistant.finalReport(state, catalog, derived, rows)] });
    return R;
  }

  if (id === 'evidence') {
    R.sections.push({
      heading: `الشواهد (${arNum(state.evidence.length)})`,
      table: { head: ['البرنامج', 'الصف', 'النوع', 'الاسم/الرابط', 'التاريخ'], rows: state.evidence.map((e) => {
        const r = rows.find((x) => x.plan.id === e.planId && x.programId === e.programId);
        const kind = { image: 'صورة', pdf: 'PDF', video: 'فيديو', file: 'ملف', link: 'رابط' }[e.kind] || e.kind;
        return [r?.program?.name || '—', r?.classText || '—', kind, e.url || e.name, gregShort(new Date(e.createdAt).toISOString().slice(0, 10))];
      }) },
    });
    const missing = rows.filter((r) => r.record.status === 'done' && !r.evidence.length);
    if (missing.length) R.sections.push({ heading: 'برامج مكتملة بدون شواهد', paragraphs: missing.map((r) => `• ${r.program?.name} — ${r.classText}`) });
    return R;
  }

  if (id === 'semester') {
    const occ = resolveOccasions(catalog, state.school.semester);
    const studyWeeks = sem.weeks.filter((w) => w.type === 'study').length;
    R.sections.push({
      heading: 'نظرة عامة',
      table: { head: ['البند', 'القيمة'], rows: [
        ['بداية الفصل', gregShort(sem.start)], ['نهاية الفصل', gregShort(sem.end)], ['أسابيع الدراسة', arNum(studyWeeks)],
        ['عدد الخطط', arNum(state.plans.length)], ['عدد البرامج', arNum(rows.length)], ['المكتمل', arNum(rows.filter((r) => r.record.status === 'done').length)],
        ['الشواهد', arNum(state.evidence.length)],
      ] },
    });
    R.sections.push({ heading: 'المناسبات خلال الفصل', table: { head: ['المناسبة', 'التاريخ'], rows: occ.map((o) => [o.name, gregShort(o.date)]) } });
    R.sections.push({ heading: 'التقرير الختامي', paragraphs: [assistant.finalReport(state, catalog, derived, rows)] });
    return R;
  }
  return R;
}
