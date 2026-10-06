import React, { useEffect, useState } from 'react';
import { useApp } from '../state/store.jsx';
import { PageHead } from '../components/Shell.jsx';
import { Button, Card, Chips, Field, Modal, Switch, useConfirm, useToast, Badge } from '../components/ui.jsx';
import { classLabel } from '../services/catalog.js';
import { parseBackup, mergeStates, restoreFiles, readLegacyLocal, migrateLegacy } from '../storage/backup.js';
import { storage } from '../storage/db.js';
import { TEMPLATE_KEY } from './ExportCenter.jsx';
import { initialState } from '../state/model.js';
import { DAY_ORDER, DAY_NAMES, arNum } from '../utils/arabic.js';
import { cleanLine, cleanInt, safeFileName } from '../utils/sanitize.js';

export default function Settings() {
  const { state, catalog, dispatch } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState('school');
  const school = (patch) => dispatch({ type: 'school/update', patch });
  const settings = (patch) => dispatch({ type: 'settings/update', patch });
  const TABS = [
    { id: 'school', label: '🏫 المدرسة' }, { id: 'classes', label: '🧑‍🎓 الفصول' }, { id: 'schedule', label: '🗓 الجدولة' },
    { id: 'programs', label: '📚 أعداد الحصص' }, { id: 'template', label: '📄 القالب' }, { id: 'data', label: '💾 البيانات' },
  ];
  return (
    <div className="page">
      <PageHead title="إعدادات المدرسة" subtitle="تنحفظ تلقائيًا" />
      <div className="tabs" role="tablist" aria-label="أقسام الإعدادات">
        {TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>

      {tab === 'school' && (
        <Card>
          <div className="grid-2">
            <Field label="اسم المدرسة"><input value={state.school.name} placeholder="مثال: ابتدائية الهمذاني" onChange={(e) => school({ name: cleanLine(e.target.value) })} /></Field>
            <Field label="المرحلة الدراسية"><input value={state.school.stageName} onChange={(e) => school({ stageName: cleanLine(e.target.value) })} /></Field>
            <Field label="اسم رائد النشاط"><input value={state.school.leaderName} onChange={(e) => school({ leaderName: cleanLine(e.target.value) })} /></Field>
            <Field label="اسم مدير المدرسة"><input value={state.school.directorName} onChange={(e) => school({ directorName: cleanLine(e.target.value) })} /></Field>
            <Field label="العام الدراسي">
              <select value={state.school.academicYear} onChange={(e) => { school({ academicYear: e.target.value }); toast('بيتغيّر التقويم بعد إعادة تحميل الصفحة', 'info'); }}>
                {catalog.calendars.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="الفصل الدراسي">
              <select value={state.school.semester} onChange={(e) => school({ semester: Number(e.target.value) })}>
                {catalog.calendar.semesters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          </div>
          <p className="muted small">الحسابات السحابية (مدير، رائد نشاط، معلم) مخططة لاحقًا — البيانات الحين محفوظة على هذا الجهاز.</p>
        </Card>
      )}

      {tab === 'classes' && <ClassesSettings />}

      {tab === 'schedule' && (
        <Card>
          {catalog.stages.map((s) => (
            <Field key={s.id} label={`أيام النشاط الافتراضية — ${s.name}`}>
              <Chips multiple label={s.name} value={state.settings.activityDays[s.id] || []} onChange={(v) => v.length && settings({ activityDays: { ...state.settings.activityDays, [s.id]: DAY_ORDER.filter((d) => v.includes(d)) } })}
                options={DAY_ORDER.map((d) => ({ value: d, label: DAY_NAMES[d] }))} />
            </Field>
          ))}
          <Field label="عدد الحصص في اليوم الدراسي">
            <Chips label="عدد الحصص" value={state.settings.periodsPerDay} onChange={(v) => v && settings({ periodsPerDay: v })} options={[5, 6, 7].map((n) => ({ value: n, label: arNum(n) }))} />
          </Field>
          <div className="grid-2">
            <Field label="نسبة الحد من حصص المادة (٪)"><input inputMode="numeric" value={state.settings.quotaPolicy.percent} onChange={(e) => settings({ quotaPolicy: { ...state.settings.quotaPolicy, percent: cleanInt(e.target.value, { min: 1, max: 100, fallback: 10 }) } })} /></Field>
            <Field label="تجاوز الحد"><Switch checked={state.settings.quotaPolicy.allowOverride} onChange={(v) => settings({ quotaPolicy: { ...state.settings.quotaPolicy, allowOverride: v } })} label="السماح بالاعتماد مع تأكيد صلاحية التجاوز" /></Field>
          </div>
        </Card>
      )}

      {tab === 'programs' && <SessionsSettings />}
      {tab === 'template' && <TemplateSettings />}
      {tab === 'data' && <DataSettings />}
    </div>
  );
}

function ClassesSettings() {
  const { state, catalog, dispatch } = useApp();
  const confirm = useConfirm();
  const toast = useToast();
  const [grade, setGrade] = useState(Object.keys(catalog.gradeById)[0]);
  const [section, setSection] = useState('');
  const add = () => {
    const s = cleanLine(section, 10);
    if (!s) return;
    const id = `${grade}-${s}`;
    if (state.classes.some((c) => c.id === id)) { toast('الفصل موجود', 'error'); return; }
    dispatch({ type: 'class/upsert', item: { id, gradeId: grade, section: s, homeroomTeacherId: null } });
    setSection('');
  };
  const remove = async (c) => {
    if (state.plans.some((p) => p.classId === c.id)) { toast('الفصل مرتبط بخطة — احذف الخطة أولًا', 'error'); return; }
    if (await confirm({ title: `حذف ${classLabel(catalog, c)}؟`, confirmText: 'حذف', danger: true })) dispatch({ type: 'class/delete', id: c.id });
  };
  const sorted = [...state.classes].sort((a, b) => a.gradeId.localeCompare(b.gradeId) || a.section.localeCompare(b.section, 'ar'));
  return (
    <Card title="الفصول ورواد الفصول">
      <div className="class-rows">
        {sorted.map((c) => (
          <div key={c.id} className="class-row">
            <strong>{classLabel(catalog, c)}</strong>
            <select aria-label={`رائد فصل ${classLabel(catalog, c)}`} value={c.homeroomTeacherId || ''} onChange={(e) => dispatch({ type: 'class/upsert', item: { ...c, homeroomTeacherId: e.target.value || null } })}>
              <option value="">— رائد الفصل —</option>
              {state.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <Button size="sm" variant="ghost-danger" onClick={() => remove(c)} aria-label={`حذف ${classLabel(catalog, c)}`}>حذف</Button>
          </div>
        ))}
      </div>
      <div className="inline-form">
        <select value={grade} onChange={(e) => setGrade(e.target.value)} aria-label="الصف">
          {Object.values(catalog.gradeById).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <input value={section} onChange={(e) => setSection(e.target.value)} placeholder="الشعبة (أ، ب…)" aria-label="الشعبة" />
        <Button variant="primary" onClick={add} disabled={!section.trim()}>إضافة فصل</Button>
      </div>
    </Card>
  );
}

function SessionsSettings() {
  const { state, catalog, dispatch } = useApp();
  const ov = state.settings.sessionOverrides || {};
  const set = (id, stage, v) => {
    const n = cleanInt(v, { min: 0, max: 60, fallback: 0 });
    dispatch({ type: 'settings/update', patch: { sessionOverrides: { ...ov, [id]: { ...(ov[id] || {}), [stage]: n } } } });
  };
  return (
    <Card title="أعداد الحصص لكل برنامج" actions={<Button size="sm" onClick={() => dispatch({ type: 'settings/update', patch: { sessionOverrides: {} } })}>استعادة الافتراضي</Button>}>
      <p className="muted small">المرجع: الدليل التفسيري لتطبيق خطة النشاط الطلابي ١٤٤٨هـ. اكتب ٠ إذا البرنامج غير مطروح للمرحلة. البيانات الأصلية في ملف data/programs.json.</p>
      {catalog.domains.map((d) => (
        <details key={d.id} className="sessions-group">
          <summary><span aria-hidden="true">{d.icon}</span> {d.name}</summary>
          <div className="table-wrap">
            <table className="compact">
              <thead><tr><th scope="col">البرنامج</th><th scope="col">الأولية</th><th scope="col">العليا</th></tr></thead>
              <tbody>
                {catalog.programs.filter((p) => p.domainId === d.id).map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    {['low', 'up'].map((s) => (
                      <td key={s}><input className={`num ${ov[p.id]?.[s] != null ? 'changed' : ''}`} inputMode="numeric" aria-label={`${p.name} — ${s === 'low' ? 'الأولية' : 'العليا'}`}
                        value={ov[p.id]?.[s] ?? p.sessions[s]} onChange={(e) => set(p.id, s, e.target.value)} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </Card>
  );
}

function TemplateSettings() {
  const toast = useToast();
  const [custom, setCustom] = useState(null);
  useEffect(() => { storage.kvGet(TEMPLATE_KEY).then((v) => setCustom(v ? { name: v.name, at: v.at } : null)); }, []);
  const upload = async (file) => {
    if (!file) return;
    if (!/\.docx$/i.test(file.name) || file.size > 15 * 1024 * 1024) { toast('ارفع ملف Word بصيغة .docx (أقل من ١٥ ميجا)', 'error'); return; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      const { inspectTemplate } = await import('../export/officialDocx.js');
      const info = await inspectTemplate(bytes);
      if (!info.ok) { toast(info.reason || 'الملف ما يحتوي جداول الخطة المعروفة', 'error'); return; }
      await storage.kvSet(TEMPLATE_KEY, { name: safeFileName(file.name), at: Date.now(), bytes: bytes.buffer });
      setCustom({ name: file.name, at: Date.now() });
      toast('تم اعتماد القالب الجديد ✓');
    } catch { toast('تعذر قراءة الملف', 'error'); }
  };
  const reset = async () => { await storage.kvDelete(TEMPLATE_KEY); setCustom(null); toast('رجعنا للقالب الرسمي'); };
  return (
    <Card title="قالب Word">
      <p>القالب الحالي: {custom ? <Badge tone="info">{custom.name}</Badge> : <Badge tone="ok">القالب الرسمي — خطة برامج النشاط الطلابي</Badge>}</p>
      <p className="muted small">المنصة تعبّي القالب نفسه بدون تغيير تصميمه. تقدر ترفع نسخة معدّلة منه (نفس الجداول) وتشتغل مباشرة.</p>
      <div className="row-actions">
        <label className="btn secondary">⬆️ رفع قالب .docx<input type="file" accept=".docx" hidden onChange={(e) => { upload(e.target.files[0]); e.target.value = ''; }} /></label>
        {custom && <Button onClick={reset}>الرجوع للقالب الرسمي</Button>}
        <Button variant="ghost" onClick={async () => { const { fetchBytes, downloadBlob } = await import('../export/files.js'); downloadBlob(new Blob([await fetchBytes('templates/official-plan.docx')]), 'القالب الرسمي - خطة برامج النشاط الطلابي.docx'); }}>تنزيل القالب الرسمي</Button>
      </div>
    </Card>
  );
}

function DataSettings() {
  const { state, catalog, dispatch } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, setPending] = useState(null);
  const legacy = readLegacyLocal();
  const onFile = async (file) => {
    if (!file) return;
    if (file.size > 300 * 1024 * 1024) { toast('الملف كبير جدًا', 'error'); return; }
    try {
      const json = JSON.parse(await file.text());
      setPending(parseBackup(json, catalog, state));
    } catch (e) { toast(e.message || 'الملف غير صالح', 'error'); }
  };
  const apply = async (mode) => {
    const next = mode === 'replace' ? pending.state : mergeStates(state, pending.state);
    await restoreFiles(pending.files);
    dispatch({ type: 'replace', state: { ...next, meta: { ...next.meta, updatedAt: Date.now() } } });
    setPending(null);
    toast('تمت الاستعادة ✓');
  };
  const importLocal = () => {
    const res = migrateLegacy(legacy, catalog, state);
    dispatch({ type: 'replace', state: res.state });
    toast('تم استيراد خطط الأداة السابقة ✓');
  };
  const resetAll = async () => {
    if (!(await confirm({ title: 'مسح كل البيانات؟', message: 'بتنحذف كل الخطط والمعلمين والشواهد من هذا الجهاز. خذ نسخة احتياطية قبل.', confirmText: 'مسح نهائي', danger: true }))) return;
    for (const e of state.evidence) if (e.fileKey) await storage.deleteFile(e.fileKey);
    dispatch({ type: 'replace', state: { ...initialState(catalog.seed, catalog.calendar.id), meta: { createdAt: Date.now(), updatedAt: Date.now() + 1 } } });
    toast('تم مسح البيانات');
  };
  return (
    <>
      <Card title="النسخ الاحتياطي والاستعادة">
        <p className="muted">النسخة تشمل: الإعدادات، المعلمين، الفصول، الخطط، والشواهد. تنزيلها من <a href="#/export">مركز التصدير</a>.</p>
        <label className="btn primary">↩️ استعادة من ملف<input type="file" accept=".json,application/json" hidden onChange={(e) => { onFile(e.target.files[0]); e.target.value = ''; }} /></label>
      </Card>
      <Card title="الأداة السابقة («مُعِدّ خطة النشاط الطلابي»)">
        <p className="muted">تقدر تستعيد ملف «نسخة احتياطية» من الأداة السابقة بنفس زر الاستعادة فوق، أو تستورد الخطط المحفوظة على هذا الجهاز مباشرة.</p>
        <Button onClick={importLocal} disabled={!legacy.plans.length}>استيراد {arNum(legacy.plans.length)} خطة من هذا الجهاز</Button>
      </Card>
      <Card title="منطقة الخطر">
        <Button variant="ghost-danger" onClick={resetAll}>مسح كل البيانات</Button>
      </Card>
      {pending && (
        <Modal title="استعادة نسخة احتياطية" onClose={() => setPending(null)} footer={
          <>
            <Button variant="primary" onClick={() => apply('merge')}>دمج مع بياناتي</Button>
            <Button variant="danger" onClick={() => apply('replace')}>استبدال بياناتي</Button>
            <Button onClick={() => setPending(null)}>إلغاء</Button>
          </>
        }>
          <p>{pending.source === 'legacy' ? '📥 نسخة من الأداة السابقة — بتنضاف خططها كـ«تحتاج مراجعة».' : '📦 نسخة من المنصة.'}{pending.migrated ? ' (تم ترحيلها للإصدار الحالي)' : ''}</p>
          <ul className="kv-list">
            <li>الخطط: {arNum(pending.summary.plans)}</li>
            <li>المعلمون: {arNum(pending.summary.teachers)}</li>
            <li>الفصول: {arNum(pending.summary.classes)}</li>
            <li>الشواهد: {arNum(pending.summary.evidence)}</li>
          </ul>
          <p className="muted small">«دمج» يحدّث العناصر الموجودة ويضيف الجديدة بدون حذف شي. «استبدال» يمسح بياناتك الحالية.</p>
        </Modal>
      )}
    </>
  );
}
