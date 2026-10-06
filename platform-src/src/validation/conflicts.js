// محرك التعارضات: يفحص كل خطة وكل المدرسة ويرجّع أخطاء (تمنع الاعتماد) وتحذيرات.
import { programSessions, classLabel, semesterOf } from '../services/catalog.js';
import { planStage, planDays } from '../scheduler/schedule.js';
import { teacherQuota } from '../services/quota.js';
import { DAY_NAMES, PERIOD_NAMES, arNum, gregShort } from '../utils/arabic.js';

const DAY_MS = 86400000;

function issue(severity, code, message, extra = {}) {
  return { severity, code, message, ...extra };
}

export function validatePlan(state, catalog, plan, sched) {
  const out = [];
  const P = { planId: plan.id };
  const cls = state.classes.find((c) => c.id === plan.classId);
  const teacher = state.teachers.find((t) => t.id === plan.teacherId);
  const stage = planStage(state, catalog, plan);
  const maxP = state.settings?.periodsPerDay || 7;

  if (!cls) out.push(issue('error', 'basic', 'لم يتم اختيار الصف', { ...P, step: 0 }));
  if (!teacher) out.push(issue('error', 'basic', 'لم يتم اختيار المعلم', { ...P, step: 0 }));
  if (!semesterOf(catalog, plan.semester || 1)) out.push(issue('error', 'date', 'الفصل الدراسي غير موجود في التقويم', { ...P, step: 0 }));
  if (!(plan.programs || []).length) out.push(issue('error', 'programs', 'لم تتم إضافة أي برنامج', { ...P, step: 1 }));

  // برامج خارج المرحلة أو مكررة
  const seen = new Set();
  (plan.programs || []).forEach((it) => {
    const prog = catalog.programById[it.programId];
    if (!prog) { out.push(issue('error', 'program', 'برنامج غير موجود في الدليل', { ...P, step: 1, programId: it.programId })); return; }
    if (seen.has(it.programId)) out.push(issue('warning', 'duplicate', `تكرار البرنامج «${prog.name}» في نفس الخطة`, { ...P, step: 1, programId: it.programId }));
    seen.add(it.programId);
    if (stage && programSessions(catalog, state.settings, it.programId, stage) == null && !(it.sessions > 0)) {
      out.push(issue('error', 'stage', `«${prog.name}» غير مطروح لـ${catalog.stageById[stage]?.name || 'هذه المرحلة'}`, { ...P, step: 1, programId: it.programId }));
    }
  });

  // الأيام والحصص
  const days = planDays(state, catalog, plan);
  if (!days.length) out.push(issue('error', 'days', 'لم يتم تحديد أيام النشاط', { ...P, step: 2 }));
  days.forEach((d) => {
    const p = parseInt(plan.periods?.[d], 10);
    if (!(p >= 1 && p <= maxP)) out.push(issue('error', 'period', `يوم ${DAY_NAMES[d]} بدون حصة محددة`, { ...P, step: 2 }));
    else if ((plan.doubleDays || []).includes(d) && p + 1 > maxP) {
      out.push(issue('error', 'period', `يوم ${DAY_NAMES[d]} فيه حصتان متتاليتان، والحصة ${PERIOD_NAMES[p - 1]} آخر حصة`, { ...P, step: 2 }));
    }
  });

  // التوزيع
  if (sched) {
    sched.programs.forEach((sp) => {
      if (sp.needed > 0 && sp.shortage) {
        out.push(issue('error', 'shortage', `«${sp.name}» توزّع ${arNum(sp.filled)} من ${arNum(sp.needed)} حصص — أضف يوم نشاط أو قلّل البرامج`, { ...P, step: 2, programId: sp.programId }));
      }
      if (sp.occasion && sp.slots.length) {
        const t = new Date(sp.occasion.date).getTime();
        const nearest = Math.min(...sp.slots.map((s) => Math.abs(new Date(s.date).getTime() - t)));
        if (nearest > 14 * DAY_MS) {
          out.push(issue('warning', 'occasion', `«${sp.name}» بعيد عن تاريخ المناسبة (${gregShort(sp.occasion.date)}) بأكثر من أسبوعين`, { ...P, step: 2, programId: sp.programId }));
        }
      }
    });
    (plan.programs || []).forEach((it) => {
      const prog = catalog.programById[it.programId];
      if (prog?.occasionId && !sched.programs.find((p) => p.programId === it.programId)?.occasion) {
        out.push(issue('warning', 'occasion', `مناسبة «${prog.name}» لا تقع داخل هذا الفصل الدراسي`, { ...P, step: 1, programId: it.programId }));
      }
    });
    const needed = sched.programs.reduce((a, p) => a + p.needed, 0);
    if (needed > sched.capacity && sched.capacity > 0) {
      out.push(issue('warning', 'capacity', `البرامج تحتاج ${arNum(needed)} حصة وأيام النشاط تستوعب ${arNum(sched.capacity)} فقط`, { ...P, step: 2 }));
    }
  }

  // نسبة ١٠٪
  if (teacher) {
    const q = teacherQuota(state, catalog, teacher.id);
    if (q.limit == null) {
      out.push(issue('warning', 'quota-unknown', `لم يُحدد نصاب ${teacher.name} الأسبوعي — ما نقدر نحسب حد ١٠٪`, { ...P, step: 0 }));
    } else if (q.exceeded) {
      const allow = state.settings?.quotaPolicy?.allowOverride && plan.quotaOverrideConfirmed;
      out.push(issue(allow ? 'warning' : 'error', 'quota', `تم تجاوز الحد المسموح بنسبة ١٠٪ لـ${teacher.name}: المستخدم ${arNum(q.used)} من ${arNum(q.limit)}`, { ...P, step: 1 }));
    }
  }
  return out;
}

/** تعارضات بين الخطط (نفس المعلم أو نفس الفصل في نفس اليوم والحصة، وتكرار البرنامج لنفس الفصل) */
export function crossPlanIssues(state, catalog) {
  const out = [];
  const plans = state.plans;
  for (let i = 0; i < plans.length; i++) {
    for (let j = i + 1; j < plans.length; j++) {
      const a = plans[i], b = plans[j];
      const sameTeacher = a.teacherId && a.teacherId === b.teacherId;
      const sameClass = a.classId && a.classId === b.classId;
      if (!sameTeacher && !sameClass) continue;
      const da = planDays(state, catalog, a), db = planDays(state, catalog, b);
      const clashes = da.filter((d) => db.includes(d) && a.periods?.[d] && a.periods?.[d] === b.periods?.[d]);
      if (clashes.length) {
        const who = sameTeacher ? `المعلم ${state.teachers.find((t) => t.id === a.teacherId)?.name || ''}` : `الفصل ${classLabel(catalog, state.classes.find((c) => c.id === a.classId), true)}`;
        const msg = `تعارض ${sameTeacher ? 'المعلم' : 'الفصل'}: ${who} عنده خطتان في نفس الحصة يوم ${clashes.map((d) => DAY_NAMES[d]).join('، ')} — وزّعتها المنصة على أيام مختلفة، وقد تقل الأيام المتاحة`;
        out.push(issue('warning', sameTeacher ? 'teacher-clash' : 'class-clash', msg, { planId: b.id, otherPlanId: a.id, step: 2 }));
      }
      if (sameClass) {
        const dup = (a.programs || []).filter((x) => (b.programs || []).some((y) => y.programId === x.programId));
        dup.forEach((x) => out.push(issue('warning', 'class-duplicate', `برنامج «${catalog.programById[x.programId]?.name}» مكرر لنفس الفصل في خطتين`, { planId: b.id, otherPlanId: a.id, programId: x.programId, step: 1 })));
      }
    }
  }
  return out;
}

export function allIssues(state, catalog, schedules) {
  const list = [];
  state.plans.forEach((p) => list.push(...validatePlan(state, catalog, p, schedules[p.id])));
  list.push(...crossPlanIssues(state, catalog));
  return list;
}

export function summarize(issues) {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return { errors, warnings, ok: errors.length === 0 && warnings.length === 0, canApprove: errors.length === 0 };
}
