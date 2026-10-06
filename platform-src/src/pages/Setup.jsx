// تجهيز المدرسة بخطوات بسيطة: البيانات ← الفصول ← المعلمون ← رواد الفصول
import React, { useState } from 'react';
import { useApp } from '../state/store.jsx';
import { PageHead } from '../components/Shell.jsx';
import { Button, Card, Chips, Field, LinkButton, useToast } from '../components/ui.jsx';
import { ClassGenerator, TeacherBulkAdd, HomeroomAssign } from '../components/school.jsx';
import { schoolStages } from '../services/catalog.js';
import { arNum } from '../utils/arabic.js';
import { cleanLine } from '../utils/sanitize.js';

const STEPS = ['بيانات المدرسة', 'الفصول', 'المعلمون', 'رواد الفصول'];

export default function Setup() {
  const { state, catalog, dispatch } = useApp();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const school = (patch) => dispatch({ type: 'school/update', patch });
  const setTypes = (types) => {
    if (!types.length) return;
    school({ types, stageName: catalog.schoolTypeById[types[0]]?.name || state.school.stageName });
  };
  return (
    <div className="page">
      <PageHead title="تجهيز المدرسة" subtitle="مرة وحدة بس — وبعدها تبدأ تنشئ الخطط" back="#/" />
      <ol className="setup-steps">
        {STEPS.map((s, i) => (
          <li key={s}><button type="button" className={`step ${i === step ? 'current' : ''} ${i < step ? 'done' : ''}`} onClick={() => setStep(i)} aria-current={i === step ? 'step' : undefined}>
            <span className="step-num">{i < step ? '✓' : arNum(i + 1)}</span><span className="step-label">{s}</span>
          </button></li>
        ))}
      </ol>
      <Card>
        {step === 0 && (
          <>
            <div className="grid-2">
              <Field label="اسم المدرسة"><input value={state.school.name} onChange={(e) => school({ name: cleanLine(e.target.value) })} placeholder="مثال: ثانوية أبو بكر الصديق" /></Field>
              <Field label="المرحلة" hint="مجمّع؟ اختر أكثر من مرحلة">
                <Chips multiple label="المرحلة" value={state.school.types || ['primary']} onChange={setTypes} options={catalog.schoolTypes.map((t) => ({ value: t.id, label: t.name }))} />
              </Field>
              <Field label="اسم رائد النشاط"><input value={state.school.leaderName} onChange={(e) => school({ leaderName: cleanLine(e.target.value) })} /></Field>
              <Field label="اسم مدير المدرسة"><input value={state.school.directorName} onChange={(e) => school({ directorName: cleanLine(e.target.value) })} /></Field>
            </div>
            <p className="muted small">الصفوف المتاحة: {schoolStages(catalog, state.school).flatMap((s) => s.grades.map((g) => g.name)).join('، ')}</p>
          </>
        )}
        {step === 1 && (<><p className="muted">حدد عدد الفصول (الشعب) لكل صف — الأسماء أ، ب، ج… تنعمل تلقائيًا.</p><ClassGenerator onDone={() => setStep(2)} /></>)}
        {step === 2 && (<><TeacherBulkAdd /><p className="muted small">المعلمون الحاليون: {arNum(state.teachers.length)}</p></>)}
        {step === 3 && (<><p className="muted">اختياري: رائد الفصل يتعبّى تلقائيًا كمعلم للخطة لما تختار الفصل.</p><HomeroomAssign /></>)}
      </Card>
      <div className="wizard-nav">
        <Button onClick={() => setStep(step - 1)} disabled={step === 0} icon="→">السابق</Button>
        {step < STEPS.length - 1
          ? <Button variant="primary" onClick={() => setStep(step + 1)}>التالي ←</Button>
          : <LinkButton href="#/plans/new" variant="primary" icon="+">إنشاء أول خطة</LinkButton>}
      </div>
      {step === STEPS.length - 1 && <p className="muted small center">تقدر ترجع لهذي الصفحة من الإعدادات في أي وقت.</p>}
    </div>
  );
}
