import React, { useMemo, useState } from 'react';
import { useApp } from '../state/store.jsx';
import { PageHead } from '../components/Shell.jsx';
import { Button, Card, Field, Modal, Progress, Empty, useConfirm, useToast } from '../components/ui.jsx';
import { teacherQuota } from '../services/quota.js';
import { programRows } from '../services/insights.js';
import { arNum, percent } from '../utils/arabic.js';
import { cleanLine, cleanInt } from '../utils/sanitize.js';
import { uid } from '../utils/ids.js';

export default function Teachers() {
  const { state, catalog, derived, dispatch } = useApp();
  const confirm = useConfirm();
  const toast = useToast();
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState('');
  const rows = useMemo(() => programRows(state, catalog, derived), [state, catalog, derived]);
  const list = state.teachers.filter((t) => !q.trim() || `${t.name} ${t.subject}`.includes(q.trim()));

  const remove = async (t) => {
    const used = state.plans.filter((p) => p.teacherId === t.id).length;
    if (used) { toast(`ما نقدر نحذف ${t.name} — مرتبط بـ${arNum(used)} خطة`, 'error'); return; }
    if (await confirm({ title: `حذف ${t.name}؟`, confirmText: 'حذف', danger: true })) dispatch({ type: 'teacher/delete', id: t.id });
  };

  return (
    <div className="page">
      <PageHead title="المعلمون" subtitle="نسبة ١٠٪ والبرامج المسندة ونسبة الإنجاز لكل معلم" actions={<Button variant="primary" icon="+" onClick={() => setEdit({ id: uid('t'), name: '', subject: '', weeklyLoad: null, quotaOverride: null, isNew: true })}>معلم جديد</Button>} />
      <input type="search" className="search wide" placeholder="🔍 ابحث بالاسم أو المادة" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث عن معلم" />
      {list.length ? (
        <div className="teacher-grid">
          {list.map((t) => {
            const qq = teacherQuota(state, catalog, t.id);
            const mine = rows.filter((r) => r.teacher?.id === t.id);
            const done = mine.filter((r) => r.record.status === 'done').length;
            const pct = qq.limit ? Math.min(100, Math.round((qq.used / qq.limit) * 100)) : 0;
            return (
              <Card key={t.id} className={`teacher-card ${qq.exceeded ? 'over' : ''}`}>
                <div className="teacher-head">
                  <div className="avatar" aria-hidden="true">{t.name.slice(0, 1)}</div>
                  <div><h3>{t.name}</h3><p className="muted">{t.subject || 'المادة غير محددة'}{t.weeklyLoad ? ` · ${arNum(t.weeklyLoad)} حصص أسبوعيًا` : ''}</p></div>
                </div>
                <div className="quota-nums">
                  <div><small>١٠٪ المتاح</small><strong>{qq.limit != null ? arNum(qq.limit) : '—'}</strong></div>
                  <div><small>المستخدم</small><strong>{arNum(qq.used)}</strong></div>
                  <div className={qq.exceeded ? 'danger' : ''}><small>المتبقي</small><strong>{qq.remaining != null ? arNum(qq.remaining) : '—'}</strong></div>
                </div>
                {qq.limit != null && <Progress value={pct} tone={qq.exceeded ? 'danger' : 'ok'} label={`استخدام حد ١٠٪ لـ${t.name}`} />}
                {qq.exceeded && <p className="quota-over">🔴 تجاوز الحد المسموح</p>}
                <div className="teacher-progs">
                  {mine.length ? mine.map((r) => <span key={r.key} className="tag">{r.program?.name} · {r.classText}</span>) : <span className="muted small">لا توجد برامج مسندة</span>}
                </div>
                <div className="teacher-foot">
                  <span>الإنجاز {arNum(percent(done, mine.length))}٪</span>
                  <span className="row-actions">
                    <Button size="sm" onClick={() => setEdit(t)}>تعديل</Button>
                    <Button size="sm" variant="ghost-danger" onClick={() => remove(t)}>حذف</Button>
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      ) : <Card><Empty icon="👨‍🏫" title="ما فيه معلمون" /></Card>}
      {edit && <TeacherDialog teacher={edit} onClose={() => setEdit(null)} onSave={(t) => { const { isNew, ...item } = t; dispatch({ type: 'teacher/upsert', item }); toast('تم حفظ بيانات المعلم ✓'); setEdit(null); }} />}
    </div>
  );
}

function TeacherDialog({ teacher, onClose, onSave }) {
  const [t, setT] = useState(teacher);
  const err = !cleanLine(t.name) ? 'الاسم مطلوب' : null;
  return (
    <Modal title={teacher.isNew ? 'معلم جديد' : `تعديل ${teacher.name}`} onClose={onClose} size="sm" footer={
      <><Button variant="primary" disabled={!!err} onClick={() => onSave({ ...t, name: cleanLine(t.name), subject: cleanLine(t.subject) })}>حفظ</Button><Button onClick={onClose}>إلغاء</Button></>
    }>
      <Field label="الاسم" required error={t.name && err}><input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></Field>
      <Field label="المادة"><input value={t.subject || ''} onChange={(e) => setT({ ...t, subject: e.target.value })} /></Field>
      <Field label="عدد الحصص الأسبوعية للمادة" hint="يُحسب منه حد ١٠٪ تلقائيًا"><input inputMode="numeric" value={t.weeklyLoad ?? ''} onChange={(e) => setT({ ...t, weeklyLoad: cleanInt(e.target.value, { min: 0, max: 40 }) })} /></Field>
      <Field label="حد ١٠٪ يدويًا (اختياري)"><input inputMode="numeric" value={t.quotaOverride ?? ''} onChange={(e) => setT({ ...t, quotaOverride: cleanInt(e.target.value, { min: 0, max: 500 }) })} /></Field>
    </Modal>
  );
}
