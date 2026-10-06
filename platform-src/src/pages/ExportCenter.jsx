// مركز التصدير: ملف الخطة الرسمي (Word من القالب، PDF للطباعة، صورة) + النسخة الاحتياطية
import React, { useMemo, useRef, useState } from 'react';
import { useApp } from '../state/store.jsx';
import { PageHead } from '../components/Shell.jsx';
import { Button, Card, Segmented, useToast, Badge } from '../components/ui.jsx';
import { buildMasterModel } from '../export/masterModel.js';
import OfficialPrintView from '../export/OfficialPrintView.jsx';
import { downloadBlob, downloadJSON, printElement, elementToPng, fetchBytes } from '../export/files.js';
import { createBackup } from '../storage/backup.js';
import { storage } from '../storage/db.js';
import { stageDisplayName } from '../services/catalog.js';
import { arNum, todayISO } from '../utils/arabic.js';

/** قالب Word خاص بكل مدرسة (أو القالب الرسمي) */
export const templateKey = (schoolId) => `template:${schoolId || 'school_main'}`;

export async function templateBytes(schoolId) {
  const custom = (await storage.kvGet(templateKey(schoolId))) || (schoolId === 'school_main' ? await storage.kvGet('template:custom') : null);
  if (custom?.bytes) return new Uint8Array(custom.bytes);
  return fetchBytes('templates/official-plan.docx');
}

export default function ExportCenter() {
  const { state, catalog, derived, dispatch } = useApp();
  const toast = useToast();
  const ref = useRef(null);
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState(false);
  const [week, setWeek] = useState(0);
  const scope = state.settings.exportScope || 'all';
  const model = useMemo(() => buildMasterModel(state, catalog, derived, { scope }), [state, catalog, derived, scope]);
  const stageLabels = Object.fromEntries(catalog.stages.map((s) => [s.id, stageDisplayName(catalog, s.id)]));
  const base = `خطة برامج النشاط الطلابي${state.school.name ? ` - ${state.school.name}` : ''} - ${catalog.calendar.id}`;
  const errors = derived.issues.filter((i) => i.severity === 'error').length;

  const word = async () => {
    setBusy('word');
    try {
      const { fillOfficialTemplate } = await import('../export/officialDocx.js');
      const blob = await fillOfficialTemplate(await templateBytes(state.school.id), model, { stageLabels });
      downloadBlob(blob, `${base}.docx`);
      toast('تم تجهيز ملف Word من القالب الرسمي ✓');
    } catch (e) { console.error(e); toast(e.message || 'تعذر إنشاء ملف Word', 'error'); }
    setBusy('');
  };
  const pdf = async () => {
    setPreview(true);
    await new Promise((r) => setTimeout(r, 200));
    await printElement(ref.current.querySelector('.op-doc'), { landscape: true, title: base });
  };
  const image = async () => {
    setPreview(true);
    setBusy('image');
    await new Promise((r) => setTimeout(r, 250));
    try {
      const pages = ref.current.querySelectorAll('.op-page');
      const idx = Math.min(pages.length - 1, 4 + Number(week));
      await elementToPng(pages[idx], `${base} - صفحة ${idx + 1}.png`);
      toast('تم حفظ الصورة ✓');
    } catch { toast('تعذر إنشاء الصورة', 'error'); }
    setBusy('');
  };
  const backup = async () => {
    setBusy('backup');
    try {
      const data = await createBackup(state, catalog, { includeFiles: true });
      downloadJSON(data, `نسخة احتياطية - منصة النشاط - ${todayISO()}.json`);
      toast(`تم حفظ النسخة (${arNum(data.metadata.plans)} خطة، ${arNum(data.metadata.files)} ملف) ✓`);
    } catch (e) { toast(e.message, 'error'); }
    setBusy('');
  };

  return (
    <div className="page">
      <PageHead title="مركز التصدير" subtitle={`ملف الخطة يتجمّع تلقائيًا من ${arNum(model.planCount)} خطة`} />
      <div className="toolbar">
        <Segmented label="الخطط المضمّنة" value={scope} onChange={(v) => dispatch({ type: 'settings/update', patch: { exportScope: v } })}
          options={[{ value: 'all', label: 'كل الخطط' }, { value: 'approved', label: 'المعتمدة فقط' }]} />
        {errors > 0 && <Badge tone="warn" icon="⚠️">فيه {arNum(errors)} خطأ في الخطط — راجعها قبل الطباعة</Badge>}
      </div>
      <div className="export-grid">
        <Card className="export-card">
          <div className="export-icon" aria-hidden="true">📄</div>
          <h3>Word</h3><p>باستخدام القالب الرسمي — نفس التصميم والجداول والخطوط والهوامش</p>
          <Button variant="primary" onClick={word} disabled={!!busy}>{busy === 'word' ? 'جارٍ التجهيز…' : 'تنزيل Word'}</Button>
        </Card>
        <Card className="export-card">
          <div className="export-icon" aria-hidden="true">📕</div>
          <h3>PDF</h3><p>جاهز للطباعة — A4 أفقي. على الآيباد: طباعة ← مشاركة ← حفظ في الملفات</p>
          <Button variant="primary" onClick={pdf} disabled={!!busy}>طباعة / حفظ PDF</Button>
        </Card>
        <Card className="export-card">
          <div className="export-icon" aria-hidden="true">🖼</div>
          <h3>صورة</h3><p>صفحة أسبوع للمشاركة السريعة</p>
          <select value={week} onChange={(e) => setWeek(e.target.value)} aria-label="الأسبوع">
            {model.weeks.map((w, i) => <option key={i} value={i}>{w.n ? `الأسبوع ${arNum(w.label)}` : w.name}</option>)}
          </select>
          <Button onClick={image} disabled={!!busy}>{busy === 'image' ? 'جارٍ التجهيز…' : 'حفظ صورة'}</Button>
        </Card>
        <Card className="export-card">
          <div className="export-icon" aria-hidden="true">📦</div>
          <h3>نسخة احتياطية</h3><p>كل بيانات المدرسة والخطط والشواهد في ملف واحد</p>
          <Button onClick={backup} disabled={!!busy}>{busy === 'backup' ? 'جارٍ التجهيز…' : 'تنزيل النسخة'}</Button>
          <a href="#/settings" className="link small">الاستعادة من الإعدادات</a>
        </Card>
      </div>
      <Card title="معاينة ملف الخطة" actions={<Button onClick={() => setPreview(!preview)}>{preview ? 'إخفاء المعاينة' : 'عرض المعاينة'}</Button>}>
        {preview ? (
          <div className="op-viewer" ref={ref}><OfficialPrintView model={model} calendarLabel={catalog.calendar.label} stageLabels={stageLabels} /></div>
        ) : <div ref={ref}><p className="muted">المعاينة تعرض الصفحات نفسها اللي بتنطبع: الغلاف، المجالات، البرامج لكل مرحلة، جدول الإسناد، والجداول الأسبوعية.</p></div>}
      </Card>
    </div>
  );
}
