import React, { useState } from 'react';
import { useApp } from '../../state/store.jsx';
import { Field, Chips, Button, Badge, Card, useToast } from '../../components/ui.jsx';
import { classLabel, defaultActivityDays, semesterOf } from '../../services/catalog.js';
import { teacherQuota, semesterSubjectSessions } from '../../services/quota.js';
import { arNum, sessionsLabel } from '../../utils/arabic.js';
import { cleanLine, cleanInt } from '../../utils/sanitize.js';
import { uid } from '../../utils/ids.js';

export default function StepBasics({ plan, patch }) {
  const { state, catalog, dispatch } = useApp();
  const toast = useToast();
  const cls = state.classes.find((c) => c.id === plan.classId);
  const stageOf = (c) => catalog.gradeById[c?.gradeId]?.stageId;
  const [stage, setStage] = useState(stageOf(cls) || null);
  const teacher = state.teachers.find((t) => t.id === plan.teacherId);
  const [newName, setNewName] = useState('');
  const q = teacher ? teacherQuota(state, catalog, teacher.id) : null;
  const sem = semesterOf(catalog, plan.semester);
  const classes = state.classes.filter((c) => !stage || stageOf(c) === stage);

  const pickClass = (c) => {
    const st = stageOf(c);
    const p = { classId: c.id };
    if (!plan.teacherId && c.homeroomTeacherId) p.teacherId = c.homeroomTeacherId;
    if (!plan.days?.length || stageOf(cls) !== st) p.days = defaultActivityDays(catalog, state.settings, st);
    // البرامج غير المطروحة للمرحلة الجديدة تنشال تلقائيًا
    p.programs = (plan.programs || []).filter((it) => (catalog.programById[it.programId]?.sessions?.[st] || 0) > 0 || it.sessions > 0);
    if (p.programs.length !== (plan.programs || []).length) toast('شلنا برامج غير مطروحة للمرحلة الجديدة', 'info');
    setStage(st);
    patch(p);
  };
  const updTeacher = (changes) => dispatch({ type: 'teacher/upsert', item: { ...teacher, ...changes } });
  const addTeacher = () => {
    const name = cleanLine(newName);
    if (!name) return;
    const existing = state.teachers.find((t) => t.name === name);
    const t = existing || { id: uid('t'), name, subject: '', weeklyLoad: null, quotaOverride: null };
    if (!existing) dispatch({ type: 'teacher/upsert', item: t });
    patch({ teacherId: t.id });
    setNewName('');
  };

  return (
    <div className="step-content">
      <Field label="المرحلة الدراسية">
        <Chips label="المرحلة" value={stage} onChange={setStage} options={catalog.stages.map((s) => ({ value: s.id, label: s.name }))} />
      </Field>
      <Field label="الصف والفصل" required hint="عند اختيار الصف يتحدد المستوى والبرامج المناسبة تلقائيًا">
        <div className="class-grid" role="radiogroup" aria-label="الصف">
          {classes.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={plan.classId === c.id} className={`class-tile ${plan.classId === c.id ? 'on' : ''}`} onClick={() => pickClass(c)}>
              <strong>{classLabel(catalog, c, true)}</strong>
              <small>{state.teachers.find((t) => t.id === c.homeroomTeacherId)?.name || ''}</small>
            </button>
          ))}
          {!classes.length && <p className="muted">ما فيه فصول — أضفها من <a href="#/settings">الإعدادات</a>.</p>}
        </div>
      </Field>
      {cls && <p className="muted small">المستوى: <Badge tone="info">{catalog.stageById[stageOf(cls)]?.name}</Badge></p>}

      <div className="grid-2">
        <Field label="اسم المعلم" required>
          <select value={plan.teacherId || ''} onChange={(e) => patch({ teacherId: e.target.value || null })}>
            <option value="">— اختر المعلم —</option>
            {state.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}{t.subject ? ` — ${t.subject}` : ''}</option>)}
          </select>
        </Field>
        <Field label="معلم غير موجود في القائمة؟">
          <div className="inline-form">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="اكتب اسمه" onKeyDown={(e) => e.key === 'Enter' && addTeacher()} />
            <Button onClick={addTeacher} disabled={!newName.trim()}>إضافة</Button>
          </div>
        </Field>
      </div>

      {teacher && (
        <Card className="quota-card" title={`بيانات ${teacher.name}`}>
          <div className="grid-3">
            <Field label="مادة التدريس"><input value={teacher.subject || ''} placeholder="مثال: الرياضيات" onChange={(e) => updTeacher({ subject: cleanLine(e.target.value) })} /></Field>
            <Field label="عدد الحصص الأسبوعية للمادة" hint="يحسب منه حد ١٠٪ تلقائيًا">
              <input inputMode="numeric" value={teacher.weeklyLoad ?? ''} placeholder="مثال: ٥" onChange={(e) => updTeacher({ weeklyLoad: cleanInt(e.target.value, { min: 0, max: 40 }) })} />
            </Field>
            <Field label="تعديل يدوي للحد (اختياري)" hint="اتركه فاضي للحساب التلقائي">
              <input inputMode="numeric" value={teacher.quotaOverride ?? ''} onChange={(e) => updTeacher({ quotaOverride: cleanInt(e.target.value, { min: 0, max: 500 }) })} />
            </Field>
          </div>
          <QuotaMeter q={q} />
          {teacher.weeklyLoad > 0 && teacher.quotaOverride == null && (
            <p className="muted small">إجمالي حصص المادة خلال الفصل: {arNum(semesterSubjectSessions(catalog, teacher.weeklyLoad, plan.semester))} حصة ← ١٠٪ = {arNum(q?.limit)}</p>
          )}
        </Card>
      )}

      <div className="grid-2">
        <Field label="الفصل الدراسي"><input value={sem.name} readOnly /></Field>
        <Field label="العام الدراسي"><input value={catalog.calendar.label} readOnly /></Field>
      </div>
    </div>
  );
}

export function QuotaMeter({ q, extra = 0 }) {
  if (!q) return null;
  if (q.limit == null) return <p className="quota-meter muted">أدخل عدد الحصص الأسبوعية عشان نحسب حد ١٠٪.</p>;
  const used = q.used + extra;
  const over = used > q.limit;
  const pct = q.limit ? Math.min(100, Math.round((used / q.limit) * 100)) : 100;
  return (
    <div className={`quota-meter ${over ? 'over' : ''}`}>
      <div className="quota-line">
        <strong>الحد المتاح: {sessionsLabel(q.limit)}</strong>
        <span>المستخدم: {arNum(used)} من {arNum(q.limit)}</span>
      </div>
      <div className="progress"><div className={`progress-fill ${over ? 'danger' : 'ok'}`} style={{ width: `${pct}%` }} /></div>
      {over && <p className="quota-over" role="alert">🔴 تم تجاوز الحد المسموح بنسبة ١٠٪</p>}
    </div>
  );
}
