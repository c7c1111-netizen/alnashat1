import React, { useEffect, useState } from 'react';
import { useApp } from '../state/store.jsx';
import { PageHead } from '../components/Shell.jsx';
import { Button, Card, Chips, Field, Modal, Switch, useConfirm, useToast, Badge } from '../components/ui.jsx';
import { classLabel, schoolStages, defaultActivityDays } from '../services/catalog.js';
import { ClassGenerator, TeacherBulkAdd, HomeroomAssign } from '../components/school.jsx';
import { parseBackup, mergeStates, restoreFiles, readLegacyLocal, migrateLegacy } from '../storage/backup.js';
import { storage } from '../storage/db.js';
import { templateKey } from './ExportCenter.jsx';
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
            <Field label="مراحل المدرسة" hint="مجمّع؟ اختر أكثر من مرحلة">
              <Chips multiple label="مراحل المدرسة" value={state.school.types || ['primary']} onChange={(v) => v.length && school({ types: v, stageName: catalog.schoolTypeById[v[0]]?.name || state.school.stageName })}
                options={catalog.schoolTypes.map((t) => ({ value: t.id, label: t.name }))} />
            </Field>
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
          <p className="muted small">لإضافة مدرسة ثانية أو التبديل بين المدارس: اضغط اسم المدرسة أعلى الصفحة. <a href="#/setup">تجهيز المدرسة خطوة بخطوة</a></p>
        </Card>
      )}

      {tab === 'classes' && <ClassesSettings />}

      {tab === 'schedule' && (
        <Card>
          <h3 className="sub-title">أيام النشاط (عدد حصص النشاط في الأسبوع) لكل صف</h3>
          <p className="muted small">الافتراضي حسب المرحلة: الابتدائي الاثنين والأربعاء، المتوسط الاثنين، أول ثانوي الاثنين والثلاثاء والأربعاء، ثاني وثالث ثانوي الاثنين والأربعاء. تقدر تغيّرها لكل صف، وتقدر تغيّرها لأي خطة.</p>
          {schoolStages(catalog, state.school).map((s) => (
            <div key={s.id} className="stage-days">
              <strong className="stage-days-title">{s.name}</strong>
              {s.grades.map((g) => {
                const cur = defaultActivityDays(catalog, state.settings, s.id, g.id);
                return (
                  <div key={g.id} className="period-row">
                    <div className="period-day"><strong>{g.name}</strong><small>حصص النشاط في الأسبوع: {arNum(cur.length)}</small></div>
                    <Chips multiple label={g.name} value={cur}
                      onChange={(v) => v.length && settings({ activityDaysByGrade: { ...(state.settings.activityDaysByGrade || {}), [g.id]: DAY_ORDER.filter((d) => v.includes(d)) } })}
                      options={DAY_ORDER.map((d) => ({ value: d, label: DAY_NAMES[d] }))} />
                  </div>
                );
              })}
            </div>
          ))}
          <Field label="عدد الحصص في اليوم الدراسي" hint="يحدد الحصص اللي تختار منها حصة النشاط">
            <Chips label="عدد الحصص" value={state.settings.periodsPerDay} onChange={(v) => v && settings({ periodsPerDay: v })} options={[5, 6, 7, 8].map((n) => ({ value: n, label: arNum(n) }))} />
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
  const remove = async (c) => {
    if (state.plans.some((p) => p.classId === c.id)) { toast('الفصل مرتبط بخطة — احذف الخطة أولًا', 'error'); return; }
    if (await confirm({ title: `حذف ${classLabel(catalog, c)}؟`, confirmText: 'حذف', danger: true })) dispatch({ type: 'class/delete', id: c.id });
  };
  return (
    <>
      <Card title="الفصول — عدد الشعب لكل صف"><ClassGenerator /></Card>
      <Card title="رواد الفصول"><HomeroomAssign /></Card>
      <Card title="إضافة معلمين"><TeacherBulkAdd /></Card>
      {state.classes.length > 0 && (
        <Card title="حذف فصل معيّن">
          <div className="chips">{state.classes.map((c) => <button key={c.id} type="button" className="chip" onClick={() => remove(c)}>✕ {classLabel(catalog, c, true)}</button>)}</div>
        </Card>
      )}
    </>
  );
}

function SessionsSettings() {
  const { state, catalog, dispatch } = useApp();
  const ov = state.settings.sessionOverrides || {};
  const stages = schoolStages(catalog, state.school);
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
              <thead><tr><th scope="col">البرنامج</th>{stages.map((s) => <th key={s.id} scope="col">{s.name}</th>)}</tr></thead>
              <tbody>
                {catalog.programs.filter((p) => p.domainId === d.id && stages.some((s) => p.sessions[s.id] > 0 || ov[p.id]?.[s.id] > 0)).map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    {stages.map(({ id: s, name }) => (
                      <td key={s}><input className={`num ${ov[p.id]?.[s] != null ? 'changed' : ''}`} inputMode="numeric" aria-label={`${p.name} — ${name}`}
                        value={ov[p.id]?.[s] ?? (p.sessions[s] || 0)} onChange={(e) => set(p.id, s, e.target.value)} /></td>
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
  const { state } = useApp();
  const KEY = templateKey(state.school.id);
  useEffect(() => { storage.kvGet(KEY).then((v) => setCustom(v ? { name: v.name, at: v.at } : null)); }, [KEY]);
  const upload = async (file) => {
    if (!file) return;
    if (!/\.docx$/i.test(file.name) || file.size > 15 * 1024 * 1024) { toast('ارفع ملف Word بصيغة .docx (أقل من ١٥ ميجا)', 'error'); return; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      const { inspectTemplate } = await import('../export/officialDocx.js');
      const info = await inspectTemplate(bytes);
      if (!info.ok) { toast(info.reason || 'الملف ما يحتوي جداول الخطة المعروفة', 'error'); return; }
      await storage.kvSet(KEY, { name: safeFileName(file.name), at: Date.now(), bytes: bytes.buffer });
      setCustom({ name: file.name, at: Date.now() });
      toast('تم اعتماد القالب الجديد ✓');
    } catch { toast('تعذر قراءة الملف', 'error'); }
  };
  const reset = async () => { await storage.kvDelete(KEY); await storage.kvDelete('template:custom'); setCustom(null); toast('رجعنا للقالب الرسمي'); };
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
