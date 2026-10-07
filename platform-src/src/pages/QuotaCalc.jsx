// حاسبة ١٠٪: احسب حصص النشاط المتاحة لكل معلم، وجهّز جدول الإسناد بيدك.
import React, { useMemo, useRef, useState } from 'react';
import { useApp } from '../state/store.jsx';
import { PageHead } from '../components/Shell.jsx';
import { Button, Card, Field, Badge, useConfirm, useToast } from '../components/ui.jsx';
import { calcQuota, calcWeeks, computeCalcRows } from '../services/quotaCalc.js';
import { buildMasterModel } from '../export/masterModel.js';
import { programSessions, schoolStages, instructionalWeeks } from '../services/catalog.js';
import { printElement } from '../export/files.js';
import { arNum, toLatinDigits } from '../utils/arabic.js';
import { cleanLine } from '../utils/sanitize.js';
import { uid } from '../utils/ids.js';

const emptyRow = () => ({ id: uid('r'), teacher: '', subject: '', load: '', program: '', grade: '', n: '', start: '' });
const num = (v) => { const n = parseFloat(toLatinDigits(String(v ?? '')).replace(/[^\d.]/g, '')); return Number.isFinite(n) ? n : ''; };

export default function QuotaCalc() {
  const { state, catalog, derived, dispatch } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const tableRef = useRef(null);
  const pct = state.settings?.quotaPolicy?.percent ?? 10;
  const autoWeeks = instructionalWeeks(catalog, state.school?.semester || 1);
  const weeks = calcWeeks(state, catalog);
  const rows = state.quotaCalc?.rows || [];
  const computed = useMemo(() => computeCalcRows(rows, weeks, pct), [rows, weeks, pct]);
  const [load, setLoad] = useState(24);
  const [prog, setProg] = useState('');
  const quick = calcQuota(load, weeks, pct);
  const stages = schoolStages(catalog, state.school);

  const setRows = (next) => dispatch({ type: 'calc/set', patch: { rows: next } });
  const update = (id, patch) => setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const add = (base = {}) => setRows([...rows, { ...emptyRow(), ...base }]);
  const remove = (id) => setRows(rows.filter((r) => r.id !== id));

  // اختيار معلم من القائمة يعبّي مادته ونصابه
  const onTeacher = (r, v) => {
    const t = state.teachers.find((x) => x.name === v.trim());
    update(r.id, { teacher: v, ...(t && !r.subject ? { subject: t.subject || '' } : {}), ...(t && !r.load && t.weeklyLoad ? { load: t.weeklyLoad } : {}) });
  };
  // اختيار برنامج من الدليل يعبّي عدد حصصه حسب مرحلة المدرسة
  const onProgram = (r, v) => {
    const p = catalog.programs.find((x) => x.name === v.trim());
    let n = null;
    if (p) for (const st of stages) { n = programSessions(catalog, state.settings, p.id, st.id); if (n) break; }
    update(r.id, { program: v, ...(n && !r.n ? { n } : {}) });
  };

  const importPlans = async () => {
    const m = buildMasterModel(state, catalog, derived, { assignSource: 'plans' });
    if (!m.assignFromPlans.length) { toast('ما فيه خطط فيها برامج مسندة', 'info'); return; }
    if (rows.length && !(await confirm({ title: 'استبدال الجدول؟', message: 'بينمسح الجدول الحالي ويتعبّى من الخطط المحفوظة.', confirmText: 'استبدال' }))) return;
    const teacherLoad = Object.fromEntries(state.teachers.map((t) => [t.name, t.weeklyLoad || '']));
    setRows(m.assignFromPlans.map((a) => ({ ...emptyRow(), teacher: a.teacher, subject: a.subject, load: teacherLoad[a.teacher] || '', program: a.program, grade: a.grade, n: a.n, start: a.startH === '—' ? '' : a.startH })));
    toast(`تم استيراد ${arNum(m.assignFromPlans.length)} صف ✓`);
  };
  const clear = async () => {
    if (await confirm({ title: 'مسح الجدول؟', confirmText: 'مسح', danger: true })) setRows([]);
  };
  const copy = async () => {
    const head = ['اسم المعلم', 'مادة التدريس', 'الحصص المتاحة من ١٠٪', 'اسم البرنامج المسند', 'حصص البرنامج', 'تاريخ بداية التنفيذ', 'المتبقي بعد التنفيذ'];
    const lines = computed.map((r) => [r.teacher, r.subject, r.cap ?? '', r.grade ? `${r.program} (${r.grade})` : r.program, r.n || '', r.start, r.remaining ?? ''].join('\t'));
    try { await navigator.clipboard.writeText([head.join('\t'), ...lines].join('\n')); toast('تم نسخ الجدول — الصقه في Word أو Excel ✓'); } catch { toast('تعذر النسخ', 'error'); }
  };

  const totals = useMemo(() => {
    const byT = {};
    computed.forEach((r) => { const k = (r.teacher || '').trim(); if (!k) return; byT[k] = r; });
    const list = Object.values(byT);
    return { teachers: list.length, over: list.filter((r) => r.remaining != null && r.remaining < 0).length, sessions: computed.reduce((a, r) => a + (r.n || 0), 0) };
  }, [computed]);

  return (
    <div className="page calc-page">
      <PageHead title="حاسبة ١٠٪" subtitle="احسب الحصص المتاحة لكل معلم، وجهّز جدول الإسناد بيدك" />

      <Card title="🧮 الحاسبة السريعة" className="calc-quick">
        <div className="calc-quick-grid">
          <div className="calc-input">
            <label htmlFor="q-load">حصص المادة الأسبوعية</label>
            <div className="big-stepper">
              <button type="button" onClick={() => setLoad(Math.max(0, (Number(load) || 0) - 1))} aria-label="إنقاص">−</button>
              <input id="q-load" inputMode="numeric" value={arNum(load)} onChange={(e) => setLoad(num(e.target.value))} />
              <button type="button" onClick={() => setLoad((Number(load) || 0) + 1)} aria-label="زيادة">+</button>
            </div>
          </div>
          <div className="calc-eq" aria-hidden="true">×</div>
          <div className="calc-input">
            <label htmlFor="q-weeks">أسابيع الدراسة الفعلية</label>
            <input id="q-weeks" className="calc-weeks" inputMode="decimal" value={arNum(weeks)} onChange={(e) => { const v = num(e.target.value); dispatch({ type: 'calc/set', patch: { weeks: v > 0 ? v : null } }); }} />
            {Number(state.quotaCalc?.weeks) > 0 && weeks !== autoWeeks
              ? <button type="button" className="link-btn small" onClick={() => dispatch({ type: 'calc/set', patch: { weeks: null } })}>↺ من التقويم ({arNum(autoWeeks)})</button>
              : <small className="muted">من التقويم</small>}
          </div>
          <div className="calc-eq" aria-hidden="true">=</div>
          <div className="calc-out">
            <small>حصص المادة في الفصل</small>
            <strong>{quick.total != null ? arNum(quick.total) : '—'}</strong>
          </div>
          <div className="calc-out hero">
            <small>المتاح للنشاط ({arNum(pct)}٪)</small>
            <strong>{quick.cap != null ? arNum(quick.cap) : '—'}</strong>
            <small>حصة</small>
          </div>
        </div>
        <div className="calc-try">
          <span>لو أسندت برنامج بـ</span>
          <input inputMode="numeric" value={prog === '' ? '' : arNum(prog)} placeholder="؟" onChange={(e) => setProg(num(e.target.value))} aria-label="حصص البرنامج" />
          <span>حصص يتبقى له</span>
          <strong className={quick.cap != null && prog !== '' && quick.cap - prog < 0 ? 'neg' : ''}>{quick.cap != null && prog !== '' ? arNum(quick.cap - prog) : '—'}</strong>
          {quick.cap != null && prog !== '' && quick.cap - prog < 0 && <Badge tone="danger">يتجاوز الحد</Badge>}
        </div>
      </Card>

      <Card title="📋 جدول الإسناد" actions={<>
        <Button size="sm" icon="⤓" onClick={importPlans}>استيراد من الخطط</Button>
        <Button size="sm" icon="⧉" onClick={copy} disabled={!rows.length}>نسخ</Button>
        <Button size="sm" icon="🖨️" onClick={() => printElement(tableRef.current, { landscape: true, title: 'جدول إسناد برامج النشاط' })} disabled={!rows.length}>طباعة</Button>
        {rows.length > 0 && <Button size="sm" variant="ghost-danger" onClick={clear}>مسح</Button>}
      </>}>
        <p className="muted small">اكتب اسم المعلم (أو اختره من القائمة) ونصابه — المتاح والمتبقي ينحسبون تلقائيًا. صفوف نفس المعلم تكمّل من نفس الرصيد.</p>
        <datalist id="calc-teachers">{state.teachers.map((t) => <option key={t.id} value={t.name} />)}</datalist>
        <datalist id="calc-programs">{catalog.programs.map((p) => <option key={p.id} value={p.name} />)}</datalist>
        <div className="table-wrap" ref={tableRef}>
          <table className="calc-tbl">
            <thead><tr>
              <th>اسم المعلم</th><th>مادة التدريس</th><th>الحصص الأسبوعية</th><th className="auto">المتاح من ١٠٪</th>
              <th>اسم البرنامج المسند</th><th>الصف</th><th>حصص البرنامج</th><th>تاريخ بداية التنفيذ</th><th className="auto">المتبقي بعد التنفيذ</th><th aria-label="حذف" className="no-print" />
            </tr></thead>
            <tbody>
              {computed.map((r) => (
                <tr key={r.id} className={r.inherited ? 'cont' : ''}>
                  <td><input list="calc-teachers" value={r.teacher} onChange={(e) => onTeacher(r, cleanLine(e.target.value, 80))} placeholder="اسم المعلم" aria-label="اسم المعلم" /></td>
                  <td><input value={rows.find((x) => x.id === r.id)?.subject || ''} placeholder={r.inherited ? r.subject : 'المادة'} onChange={(e) => update(r.id, { subject: cleanLine(e.target.value, 60) })} aria-label="مادة التدريس" /></td>
                  <td><input className="n" inputMode="numeric" value={rows.find((x) => x.id === r.id)?.load ? arNum(rows.find((x) => x.id === r.id).load) : ''} placeholder={r.inherited && r.load ? arNum(r.load) : '٠'} onChange={(e) => update(r.id, { load: num(e.target.value) })} aria-label="الحصص الأسبوعية" /></td>
                  <td className="auto">{r.cap != null ? arNum(r.cap) : '—'}</td>
                  <td><input list="calc-programs" value={r.program} onChange={(e) => onProgram(r, cleanLine(e.target.value, 120))} placeholder="البرنامج" aria-label="اسم البرنامج" /></td>
                  <td><input className="s" value={r.grade} onChange={(e) => update(r.id, { grade: cleanLine(e.target.value, 30) })} placeholder="مثال: الرابع أ" aria-label="الصف" /></td>
                  <td><input className="n" inputMode="numeric" value={r.n ? arNum(r.n) : ''} placeholder="٠" onChange={(e) => update(r.id, { n: num(e.target.value) })} aria-label="حصص البرنامج" /></td>
                  <td><input className="s" value={r.start} onChange={(e) => update(r.id, { start: cleanLine(e.target.value, 30) })} placeholder="١٤٤٨/٣/١٠" aria-label="تاريخ البداية" /></td>
                  <td className={`auto ${r.remaining != null && r.remaining < 0 ? 'neg' : ''}`}>{r.remaining != null ? arNum(r.remaining) : '—'}</td>
                  <td className="no-print"><span className="row-actions">
                    <button type="button" className="icon-btn small" title="برنامج ثاني لنفس المعلم" aria-label="برنامج ثاني لنفس المعلم" onClick={() => {
                      const i = rows.findIndex((x) => x.id === r.id);
                      const next = [...rows]; next.splice(i + 1, 0, { ...emptyRow(), teacher: r.teacher }); setRows(next);
                    }}>＋</button>
                    <button type="button" className="icon-btn small" aria-label="حذف الصف" onClick={() => remove(r.id)}>✕</button>
                  </span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="calc-foot">
          <Button variant="primary" icon="+" onClick={() => add()}>صف جديد</Button>
          {rows.length > 0 && <span className="muted small">{arNum(totals.teachers)} معلم · {arNum(totals.sessions)} حصة مسندة{totals.over ? <> · <strong className="neg">{arNum(totals.over)} متجاوز</strong></> : ''}</span>}
        </div>
      </Card>

      <Card className="calc-note">
        <p>📄 <strong>في ملف الخطة (Word و PDF):</strong> جدول الإسناد يطلع <strong>{state.settings.assignSource === 'calc' ? 'معبّأ من هذي الحاسبة' : state.settings.assignSource === 'plans' ? 'معبّأ من الخطط' : 'فاضي للتعبئة اليدوية'}</strong> — تغيّرها من <a href="#/export">التصدير</a>.</p>
      </Card>
    </div>
  );
}
