// معالج إنشاء/تعديل الخطة (٦ خطوات) — كل تعديل ينحفظ تلقائيًا ويقدر المستخدم يكمل لاحقًا.
import React, { useEffect, useMemo } from 'react';
import { useApp } from '../../state/store.jsx';
import { newPlan } from '../../state/model.js';
import { navigate } from '../../components/router.jsx';
import { PageHead } from '../../components/Shell.jsx';
import { Button, Empty, LinkButton } from '../../components/ui.jsx';
import { validatePlan, crossPlanIssues } from '../../validation/conflicts.js';
import { arNum, todayISO } from '../../utils/arabic.js';
import { semesterOf } from '../../services/catalog.js';
import StepBasics from './StepBasics.jsx';
import StepPrograms from './StepPrograms.jsx';
import StepSchedule from './StepSchedule.jsx';
import StepDetails from './StepDetails.jsx';
import StepReview from './StepReview.jsx';
import StepApprove from './StepApprove.jsx';

export const STEPS = [
  { title: 'بيانات الخطة', short: 'البيانات', C: StepBasics },
  { title: 'اختيار البرامج', short: 'البرامج', C: StepPrograms },
  { title: 'التوزيع والجدولة', short: 'الجدولة', C: StepSchedule },
  { title: 'تفاصيل التنفيذ', short: 'التفاصيل', C: StepDetails },
  { title: 'المراجعة', short: 'المراجعة', C: StepReview },
  { title: 'الاعتماد والتصدير', short: 'الاعتماد', C: StepApprove },
];

export function NewPlan() {
  const { state, catalog, dispatch } = useApp();
  useEffect(() => {
    const p = newPlan(state);
    // الخطة الجديدة تبدأ توزيعها من اليوم إذا كنا داخل الفصل
    const sem = semesterOf(catalog, p.semester);
    const today = todayISO();
    if (today > sem.start && today <= sem.end) p.startDate = today;
    dispatch({ type: 'plan/upsert', plan: p });
    navigate(`#/plans/${p.id}/edit`);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="boot"><div className="spinner" /></div>;
}

export default function Wizard({ planId }) {
  const { state, catalog, derived, dispatch } = useApp();
  const plan = state.plans.find((p) => p.id === planId);
  const issues = useMemo(() => {
    if (!plan) return [];
    return [...validatePlan(state, catalog, plan, derived.schedules[plan.id]), ...crossPlanIssues(state, catalog).filter((i) => i.planId === plan.id)];
  }, [state, catalog, derived, plan]);

  if (!plan) {
    return <div className="page"><Empty icon="🔍" title="الخطة غير موجودة" action={<LinkButton href="#/plans">رجوع للخطط</LinkButton>} /></div>;
  }
  const step = Math.min(plan.wizardStep || 0, STEPS.length - 1);
  const go = (s) => dispatch({ type: 'plan/patch', id: plan.id, patch: { wizardStep: Math.max(0, Math.min(STEPS.length - 1, s)) } });
  const patch = (p) => dispatch({ type: 'plan/patch', id: plan.id, patch: p });
  const stepErrors = (s) => issues.filter((i) => i.severity === 'error' && i.step === s).length;
  const Cmp = STEPS[step].C;
  const pct = Math.round(((step + 1) / STEPS.length) * 100);

  return (
    <div className="page wizard">
      <PageHead title={plan.status === 'draft' ? 'خطة جديدة' : 'تعديل الخطة'} back={plan.status === 'draft' ? '#/plans' : `#/plans/${plan.id}`} />
      <div className="wizard-progress">
        <div className="wizard-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="تقدم المعالج">
          <div style={{ width: `${pct}%` }} />
        </div>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={i}>
              <button type="button" className={`step ${i === step ? 'current' : ''} ${i < step ? 'done' : ''}`} aria-current={i === step ? 'step' : undefined} onClick={() => go(i)}>
                <span className="step-num">{i < step && !stepErrors(i) ? '✓' : arNum(i + 1)}</span>
                <span className="step-label">{s.short}</span>
                {stepErrors(i) > 0 && i < step && <span className="step-err" aria-label="فيه أخطاء">!</span>}
              </button>
            </li>
          ))}
        </ol>
      </div>
      <section className="wizard-body" aria-labelledby="step-title">
        <h2 id="step-title" className="step-title"><span>{arNum(step + 1)}</span> {STEPS[step].title}</h2>
        <Cmp plan={plan} patch={patch} issues={issues} go={go} />
      </section>
      <div className="wizard-nav">
        <Button onClick={() => go(step - 1)} disabled={step === 0} icon="→">السابق</Button>
        <span className="muted small">الحفظ تلقائي</span>
        {step < STEPS.length - 1 && <Button variant="primary" onClick={() => go(step + 1)}>التالي ←</Button>}
      </div>
    </div>
  );
}
