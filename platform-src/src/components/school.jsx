// المدارس والمراحل: مبدّل المدارس، إضافة الفصول دفعة وحدة، إضافة المعلمين دفعة وحدة
import React, { useMemo, useState } from 'react';
import { useApp } from '../state/store.jsx';
import { Button, Chips, Field, Modal, Badge, useConfirm, useToast } from './ui.jsx';
import { schoolGrades, classLabel, SECTION_LETTERS } from '../services/catalog.js';
import { navigate } from './router.jsx';
import { arNum } from '../utils/arabic.js';
import { cleanLine, cleanInt } from '../utils/sanitize.js';
import { uid } from '../utils/ids.js';
import { parseTeacherLines } from '../utils/teachers.js';

export function schoolTypesLabel(catalog, types) {
  return (types || ['primary']).map((t) => catalog.schoolTypeById[t]?.name || t).join(' و');
}

/** نافذة المدارس: التبديل، الإضافة، الحذف */
export function SchoolsModal({ onClose }) {
  const { state, catalog, registry, switchSchool, createSchool, deleteSchool } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [types, setTypes] = useState(['primary']);
  const go = async (id) => {
    if (id !== state.school.id) { await switchSchool(id); toast('تم التبديل ✓'); }
    onClose();
    navigate('#/');
  };
  const add = async () => {
    if (!types.length) return;
    await createSchool({ name: cleanLine(name), types });
    toast('تمت إضافة المدرسة ✓ — جهّز فصولها ومعلميها');
    onClose();
    navigate('#/setup');
  };
  const remove = async (s) => {
    const ok = await confirm({ title: `حذف «${s.name || 'مدرسة بدون اسم'}»؟`, message: 'بتنحذف المدرسة وكل خططها وشواهدها من هذا الجهاز نهائيًا. خذ نسخة احتياطية قبل.', confirmText: 'حذف نهائي', danger: true });
    if (!ok) return;
    if (await deleteSchool(s.id)) toast('تم حذف المدرسة');
  };
  return (
    <Modal title="المدارس" onClose={onClose} size="md">
      <ul className="school-list">
        {registry.schools.map((s) => (
          <li key={s.id} className={s.id === state.school.id ? 'on' : ''}>
            <button type="button" className="school-pick" onClick={() => go(s.id)}>
              <span className="school-mark" aria-hidden="true">🏫</span>
              <span><strong>{s.name || 'مدرسة بدون اسم'}</strong><small>{schoolTypesLabel(catalog, s.types)}</small></span>
              {s.id === state.school.id && <Badge tone="ok">الحالية</Badge>}
            </button>
            {registry.schools.length > 1 && <button type="button" className="icon-btn small" aria-label={`حذف ${s.name}`} onClick={() => remove(s)}>✕</button>}
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="add-school">
          <Field label="اسم المدرسة"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: متوسطة الترمذي" autoFocus /></Field>
          <Field label="المرحلة" hint="تقدر تختار أكثر من مرحلة لو المدرسة مجمّع">
            <Chips multiple label="المرحلة" value={types} onChange={setTypes} options={catalog.schoolTypes.map((t) => ({ value: t.id, label: t.name }))} />
          </Field>
          <div className="row-actions"><Button variant="primary" onClick={add} disabled={!types.length}>إضافة المدرسة</Button><Button onClick={() => setAdding(false)}>إلغاء</Button></div>
        </div>
      ) : <Button variant="primary" icon="+" onClick={() => setAdding(true)}>مدرسة جديدة</Button>}
      <p className="muted small">كل مدرسة لها فصولها ومعلموها وخططها وقالب Word الخاص فيها.</p>
    </Modal>
  );
}

/** إضافة الفصول دفعة وحدة: عدد الشعب لكل صف */
export function ClassGenerator({ onDone, compact = false }) {
  const { state, catalog, dispatch } = useApp();
  const toast = useToast();
  const grades = schoolGrades(catalog, state.school);
  const existing = (g) => state.classes.filter((c) => c.gradeId === g).length;
  const [counts, setCounts] = useState(() => Object.fromEntries(grades.map((g) => [g.id, existing(g.id)])));
  const set = (g, n) => setCounts({ ...counts, [g]: Math.max(0, Math.min(SECTION_LETTERS.length, n)) });
  const changes = grades.reduce((a, g) => a + Math.abs((counts[g.id] || 0) - existing(g.id)), 0);
  const apply = () => {
    let added = 0, blocked = 0;
    grades.forEach((g) => {
      const want = counts[g.id] || 0;
      const have = state.classes.filter((c) => c.gradeId === g.id).sort((a, b) => SECTION_LETTERS.indexOf(a.section) - SECTION_LETTERS.indexOf(b.section));
      for (let i = have.length; i < want; i++) {
        const letter = SECTION_LETTERS.find((l) => !state.classes.some((c) => c.gradeId === g.id && c.section === l) && !have.some((c) => c.section === l));
        const c = { id: `${g.id}-${letter}`, gradeId: g.id, section: letter, homeroomTeacherId: null };
        have.push(c);
        dispatch({ type: 'class/upsert', item: c });
        added++;
      }
      have.slice(want).forEach((c) => {
        if (state.plans.some((p) => p.classId === c.id)) { blocked++; return; }
        dispatch({ type: 'class/delete', id: c.id });
      });
    });
    toast(blocked ? `تم — ${arNum(blocked)} فصل ما انحذف لأنه مرتبط بخطة` : 'تم تحديث الفصول ✓', blocked ? 'info' : 'ok');
    onDone?.();
  };
  return (
    <div className={`class-gen ${compact ? 'compact' : ''}`}>
      {grades.map((g) => (
        <div key={g.id} className="class-gen-row">
          <strong>{g.name}</strong>
          <div className="stepper" aria-label={`عدد فصول ${g.name}`}>
            <button type="button" onClick={() => set(g.id, (counts[g.id] || 0) - 1)} aria-label="إنقاص">−</button>
            <span>{arNum(counts[g.id] || 0)}</span>
            <button type="button" onClick={() => set(g.id, (counts[g.id] || 0) + 1)} aria-label="زيادة">+</button>
          </div>
          <span className="muted small">{SECTION_LETTERS.slice(0, counts[g.id] || 0).join('، ') || 'بدون فصول'}</span>
        </div>
      ))}
      <Button variant="primary" onClick={apply} disabled={!changes}>حفظ الفصول</Button>
    </div>
  );
}

/** إضافة عدة معلمين بلصق قائمة */
export function TeacherBulkAdd({ onDone }) {
  const { state, dispatch } = useApp();
  const toast = useToast();
  const [text, setText] = useState('');
  const parsed = useMemo(() => parseTeacherLines(text), [text]);
  const fresh = parsed.filter((t) => !state.teachers.some((x) => x.name === t.name));
  const updates = parsed.filter((t) => state.teachers.some((x) => x.name === t.name) && (t.subject || t.weeklyLoad));
  const add = () => {
    fresh.forEach((t) => dispatch({ type: 'teacher/upsert', item: { id: uid('t'), quotaOverride: null, ...t } }));
    updates.forEach((t) => {
      const old = state.teachers.find((x) => x.name === t.name);
      dispatch({ type: 'teacher/upsert', item: { ...old, subject: t.subject || old.subject, weeklyLoad: t.weeklyLoad ?? old.weeklyLoad } });
    });
    toast(`تمت إضافة ${arNum(fresh.length)} معلم${updates.length ? ` وتحديث ${arNum(updates.length)}` : ''} ✓`);
    setText('');
    onDone?.();
  };
  return (
    <div className="bulk-teachers">
      <Field label="الصق أسماء المعلمين — كل معلم في سطر" hint="اختياري: «الاسم - المادة - عدد الحصص الأسبوعية». تقدر تنسخ عمودين أو ثلاثة من Excel مباشرة.">
        <textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder={'محمد أحمد القحطاني - رياضيات - 18\nسعيد علي الشهري - لغتي\nخالد محمد'} />
      </Field>
      {parsed.length > 0 && (
        <div className="bulk-preview">
          <p className="muted small">بيتضاف {arNum(fresh.length)} معلم{updates.length ? `، وبتتحدث بيانات ${arNum(updates.length)}` : ''}:</p>
          <ul>
            {parsed.slice(0, 40).map((t, i) => (
              <li key={i}>
                <strong>{t.name}</strong>
                {t.subject && <span className="tag">{t.subject}</span>}
                {t.weeklyLoad != null && <span className="tag">{arNum(t.weeklyLoad)} حصة/أسبوع</span>}
                {state.teachers.some((x) => x.name === t.name) && <Badge tone="muted">موجود</Badge>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Button variant="primary" onClick={add} disabled={!fresh.length && !updates.length}>إضافة المعلمين</Button>
    </div>
  );
}

/** تعيين رواد الفصول بسرعة */
export function HomeroomAssign() {
  const { state, catalog, dispatch } = useApp();
  const sorted = [...state.classes].sort((a, b) => Number(a.gradeId.slice(1)) - Number(b.gradeId.slice(1)) || SECTION_LETTERS.indexOf(a.section) - SECTION_LETTERS.indexOf(b.section));
  if (!sorted.length) return <p className="muted">أضف الفصول أولًا.</p>;
  return (
    <div className="class-rows">
      {sorted.map((c) => (
        <div key={c.id} className="class-row two">
          <strong>{classLabel(catalog, c)}</strong>
          <select aria-label={`رائد فصل ${classLabel(catalog, c)}`} value={c.homeroomTeacherId || ''} onChange={(e) => dispatch({ type: 'class/upsert', item: { ...c, homeroomTeacherId: e.target.value || null } })}>
            <option value="">— رائد الفصل (اختياري) —</option>
            {state.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}
