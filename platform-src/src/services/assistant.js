// المساعد الذكي (محرك قواعد يعمل بدون إنترنت). طبقة إضافية فوق البيانات الأساسية،
// ومصمّم بواجهة واحدة (assistant.*) عشان يُستبدل لاحقًا بنموذج ذكاء اصطناعي حقيقي بدون تغيير الصفحات.
import { programSessions, resolveOccasions } from './catalog.js';
import { planStage, planDays, schedulePlan } from '../scheduler/schedule.js';
import { teacherQuota } from './quota.js';
import { arNum, DAY_NAMES, todayISO, sessionsLabel } from '../utils/arabic.js';

const DOMAIN_GOALS = {
  citizenship: 'تعزيز قيم الانتماء والمسؤولية لدى الطلاب، وتنمية مهارات الحياة والعمل التطوعي.',
  science: 'تنمية مهارات التفكير العلمي والتقني لدى الطلاب، وتشجيعهم على الاستكشاف والابتكار.',
  arts: 'اكتشاف المواهب الثقافية والفنية لدى الطلاب وتنميتها، وتعزيز الذائقة الجمالية.',
  sports: 'تعزيز اللياقة البدنية والعادات الصحية، وتنمية روح الفريق والمنافسة الشريفة.',
  scouts: 'تنمية الاعتماد على النفس وروح القيادة والعمل الجماعي من خلال الأنشطة الكشفية.',
  occasions: 'تعريف الطلاب بالمناسبة وأهميتها، وتعزيز مشاركتهم الفاعلة في الاحتفاء بها.',
  periods: 'غرس القيم والمهارات الحياتية خلال الفترات اللاصفية بأسلوب تفاعلي.',
};
const DOMAIN_TOOLS = {
  citizenship: 'بطاقات قيم، لوحة عرض، أوراق عمل، شهادات تقدير',
  science: 'جهاز عرض، أجهزة لوحية، أدوات تجارب بسيطة، أوراق عمل',
  arts: 'أدوات رسم وتلوين، لوحات، ورق مقوى، جهاز عرض',
  sports: 'كرات، أقماع، صافرة، ساعة توقيت، مستلزمات إسعافات أولية',
  scouts: 'حبال، خيمة صغيرة، أوشحة كشفية، أدوات طبخ آمنة',
  occasions: 'لوحات ومطويات، جهاز عرض، أعلام ومستلزمات تزيين، شهادات',
  periods: 'بطاقات حوار، جهاز عرض، مطويات توعوية',
};

export const assistant = {
  /** يقترح هدفًا للبرنامج */
  suggestGoal(catalog, programId) {
    const p = catalog.programById[programId];
    if (!p) return '';
    const base = DOMAIN_GOALS[p.domainId] || '';
    return `أن يكتسب الطلاب من برنامج «${p.name}» المعارف والمهارات المرتبطة به. ${base}`;
  },

  suggestTools(catalog, programId) {
    const p = catalog.programById[programId];
    return p ? DOMAIN_TOOLS[p.domainId] || '' : '';
  },

  /** خطوات تنفيذ حسب عدد الحصص */
  suggestSteps(catalog, programId, sessions) {
    const p = catalog.programById[programId];
    if (!p) return '';
    const n = Math.max(1, sessions || 1);
    const steps = [`التمهيد بتعريف الطلاب ببرنامج «${p.name}» وأهدافه.`];
    if (n >= 2) steps.push('تقسيم الطلاب إلى مجموعات وتوزيع الأدوار.');
    if (n >= 3) steps.push('تنفيذ الأنشطة العملية للبرنامج بإشراف المعلم.');
    if (n >= 4) steps.push('متابعة إنجاز المجموعات وتقديم التغذية الراجعة.');
    if (n >= 5) steps.push('إعداد المنتج النهائي أو العرض الختامي.');
    steps.push('عرض النتائج وتكريم المتميزين وتوثيق التنفيذ بالشواهد.');
    return steps.map((s, i) => `${arNum(i + 1)}. ${s}`).join('\n');
  },

  /** «اقترح لي خطة متوازنة» — يرجّع برامج مقترحة مع سبب كل اختيار */
  suggestBalancedPlan(state, catalog, plan) {
    const stage = planStage(state, catalog, plan);
    if (!stage) return { programs: [], reasons: ['اختر الصف أولًا عشان أعرف المرحلة.'] };
    const sessionsOf = (id) => programSessions(catalog, state.settings, id, stage);
    const current = (plan.programs || []).reduce((a, it) => a + (it.sessions > 0 ? it.sessions : sessionsOf(it.programId) || 0), 0);
    const empty = { ...plan, programs: [] };
    const capacity = schedulePlan(state, catalog, empty).capacity;
    const q = plan.teacherId ? teacherQuota(state, catalog, plan.teacherId, { excludePlanId: plan.id }) : null;
    let budget = Math.max(0, capacity - current);
    const reasons = [];
    if (q?.limit != null) {
      const room = Math.max(0, q.limit - q.used - current);
      budget = Math.min(budget, room);
      reasons.push(`المتبقي من نسبة ١٠٪ للمعلم بعد البرامج المختارة: ${arNum(room)} حصة.`);
    }
    reasons.push(`أيام النشاط المختارة تستوعب ${arNum(capacity)} حصة${current ? `، والبرامج المختارة تستخدم ${arNum(current)}` : ''}.`);
    if (budget <= 0) return { programs: [], reasons: [...reasons, 'ما فيه حصص متاحة لإضافة برامج — زِد الأيام أو راجع نصاب المعلم.'] };

    const sameClassUsed = new Set([
      ...state.plans.filter((p) => p.classId === plan.classId && p.id !== plan.id).flatMap((p) => p.programs.map((x) => x.programId)),
      ...(plan.programs || []).map((x) => x.programId),
    ]);
    const picked = [];
    let used = 0;
    const add = (id, why) => {
      const n = sessionsOf(id);
      if (!n || used + n > budget || picked.includes(id) || sameClassUsed.has(id)) return false;
      picked.push(id); used += n; reasons.push(why); return true;
    };

    // ١) مناسبة قادمة داخل الفصل
    const today = todayISO();
    const occ = resolveOccasions(catalog, plan.semester || 1).filter((o) => o.date >= today);
    const occProgs = catalog.programs.filter((p) => p.occasionId && occ.some((o) => o.id === p.occasionId) && sessionsOf(p.id));
    occProgs.sort((a, b) => occ.find((o) => o.id === a.occasionId).date.localeCompare(occ.find((o) => o.id === b.occasionId).date));
    if (occProgs[0]) add(occProgs[0].id, `«${occProgs[0].name}» لأن المناسبة قريبة وداخل الفصل.`);

    // ٢) توازن المجالات: نبدأ بالمجالات الأقل حضورًا في خطط نفس المرحلة
    const domainUse = {};
    state.plans.forEach((p) => {
      if (planStage(state, catalog, p) !== stage) return;
      p.programs.forEach((x) => { const d = catalog.programById[x.programId]?.domainId; if (d) domainUse[d] = (domainUse[d] || 0) + 1; });
    });
    const doms = catalog.domains.filter((d) => d.id !== 'occasions' && d.id !== 'periods')
      .sort((a, b) => (domainUse[a.id] || 0) - (domainUse[b.id] || 0));
    let progress = true;
    while (progress && used < budget) {
      progress = false;
      for (const d of doms) {
        if (picked.some((id) => catalog.programById[id].domainId === d.id) && picked.length < doms.length) continue;
        const options = catalog.programs.filter((p) => p.domainId === d.id && sessionsOf(p.id) && !picked.includes(p.id) && !sameClassUsed.has(p.id))
          .sort((a, b) => sessionsOf(a.id) - sessionsOf(b.id));
        const choice = options.find((p) => used + sessionsOf(p.id) <= budget);
        if (choice && add(choice.id, `«${choice.name}» (${d.name}، ${sessionsLabel(sessionsOf(choice.id))}) لتنويع المجالات.`)) progress = true;
        if (used >= budget) break;
      }
    }
    reasons.push(`المجموع: ${arNum(used)} من ${arNum(budget)} حصة متاحة.`);
    return { programs: picked, reasons };
  },

  /** «حلل خطتي» */
  analyzePlan(state, catalog, plan, sched, issues = []) {
    const lines = [];
    const stage = planStage(state, catalog, plan);
    const counts = {};
    (plan.programs || []).forEach((x) => {
      const d = catalog.programById[x.programId]?.domainId;
      if (d) counts[d] = (counts[d] || 0) + (sched?.programs.find((p) => p.programId === x.programId)?.needed || 0);
    });
    const main = catalog.domains.filter((d) => d.id !== 'periods');
    const strong = main.filter((d) => counts[d.id]).sort((a, b) => counts[b.id] - counts[a.id]);
    const weak = main.filter((d) => !counts[d.id]);
    if (!plan.programs?.length) return { summary: 'الخطة فاضية — أضف برامج أو اضغط «اقترح لي خطة متوازنة».', lines: [], suggestions: [] };
    if (strong.length) lines.push(`الخطة قوية في ${strong.slice(0, 2).map((d) => `مجال ${d.name}`).join(' و')}.`);
    if (weak.length) lines.push(`ما فيها برامج في: ${weak.map((d) => d.name).join('، ')}.`);
    const suggestions = [];
    if (weak.length && stage) {
      const d = weak.find((x) => x.id !== 'occasions') || weak[0];
      const opt = catalog.programs.filter((p) => p.domainId === d.id && programSessions(catalog, state.settings, p.id, stage))
        .sort((a, b) => programSessions(catalog, state.settings, a.id, stage) - programSessions(catalog, state.settings, b.id, stage))[0];
      if (opt) suggestions.push({ kind: 'add', programId: opt.id, text: `أقترح إضافة «${opt.name}» (${sessionsLabel(programSessions(catalog, state.settings, opt.id, stage))}) لتغطية مجال ${d.name}.` });
    }
    if (sched) {
      const needed = sched.programs.reduce((a, p) => a + p.needed, 0);
      const util = sched.capacity ? Math.round((needed / sched.capacity) * 100) : 0;
      lines.push(`البرامج تستخدم ${arNum(util)}٪ من أيام النشاط المتاحة (${arNum(needed)} من ${arNum(sched.capacity)} حصة).`);
      const short = sched.programs.filter((p) => p.shortage);
      if (short.length) {
        const missing = short.reduce((a, p) => a + (p.needed - p.filled), 0);
        const days = planDays(state, catalog, plan);
        const free = ['sun', 'mon', 'tue', 'wed', 'thu'].filter((d) => !days.includes(d));
        suggestions.push({ kind: 'redistribute', text: `ينقص ${arNum(missing)} حصة. أضف يوم ${free[0] ? DAY_NAMES[free[0]] : 'نشاط آخر'} أو فعّل «حصتان متتاليتان» في أحد الأيام، أو احذف برنامجًا.` });
      } else if (util < 50 && needed > 0) {
        suggestions.push({ kind: 'room', text: 'فيه مساحة كافية لإضافة برنامج آخر بدون ضغط على الجدول.' });
      }
    }
    if (plan.teacherId) {
      const q = teacherQuota(state, catalog, plan.teacherId);
      if (q.limit != null) lines.push(q.exceeded ? `تجاوزت حد ١٠٪ (${arNum(q.used)} من ${arNum(q.limit)}).` : `نسبة ١٠٪ سليمة: ${arNum(q.used)} من ${arNum(q.limit)}.`);
    }
    const errs = issues.filter((i) => i.severity === 'error').length;
    lines.push(errs ? `فيه ${arNum(errs)} خطأ لازم يتصلح قبل الاعتماد.` : 'ما فيه أخطاء تمنع الاعتماد.');
    const summary = strong.length && weak.length
      ? `الخطة قوية في ${strong[0].name}، لكنها ضعيفة في ${weak[0].name}.`
      : strong.length ? 'الخطة متوازنة بين المجالات.' : '';
    return { summary, lines, suggestions };
  },

  /** تقرير ختامي/تلخيص إنجاز */
  finalReport(state, catalog, derived, rows) {
    const total = rows.length;
    const done = rows.filter((r) => r.record.status === 'done');
    const ip = rows.filter((r) => r.record.status === 'in_progress');
    const ev = state.evidence.length;
    const byDomain = {};
    done.forEach((r) => { const n = r.domain?.name || '—'; byDomain[n] = (byDomain[n] || 0) + 1; });
    const top = Object.entries(byDomain).sort((a, b) => b[1] - a[1])[0];
    const parts = [
      `نُفّذ خلال الفصل ${arNum(done.length)} برنامجًا من أصل ${arNum(total)} (${arNum(total ? Math.round((done.length / total) * 100) : 0)}٪)، وما زال ${arNum(ip.length)} برنامجًا قيد التنفيذ.`,
      top ? `أكثر المجالات تنفيذًا: ${top[0]} (${arNum(top[1])}).` : '',
      `بلغ عدد الشواهد الموثّقة ${arNum(ev)} شاهدًا.`,
      `شارك في التنفيذ ${arNum(new Set(rows.map((r) => r.teacher?.id).filter(Boolean)).size)} معلمًا عبر ${arNum(state.plans.length)} خطة.`,
    ];
    const overdue = rows.filter((r) => r.overdue).length;
    if (overdue) parts.push(`يوصى بمتابعة ${arNum(overdue)} برنامجًا تجاوز موعده دون تنفيذ.`);
    return parts.filter(Boolean).join(' ');
  },
};
