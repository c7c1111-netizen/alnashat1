import React, { useMemo, useRef, useState } from 'react';
import { useApp } from '../state/store.jsx';
import { PageHead } from '../components/Shell.jsx';
import { Button, Card, useToast } from '../components/ui.jsx';
import { REPORTS, buildReport } from '../services/reports.js';
import { downloadBlob, printElement, elementToPng } from '../export/files.js';
import { classLabel } from '../services/catalog.js';

export function ReportView({ report }) {
  return (
    <article className="report" dir="rtl">
      <header className="report-head">
        <p className="report-school">{report.school}</p>
        <h1>{report.title}</h1>
        <p className="report-sub">{report.subtitle}</p>
        <p className="report-date">تاريخ الإصدار: {report.date}</p>
      </header>
      {report.sections.map((s, i) => (
        <section key={i} className="report-section">
          {s.heading && <h2>{s.heading}</h2>}
          {(s.paragraphs || []).map((p, k) => <p key={k} className="pre">{p}</p>)}
          {s.table && s.table.rows.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr>{s.table.head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
                <tbody>{s.table.rows.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </article>
  );
}

export default function Reports({ query }) {
  const { state, catalog, derived } = useApp();
  const toast = useToast();
  const [id, setId] = useState(query.id || 'programs');
  const [planId, setPlanId] = useState(state.plans[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const report = useMemo(() => buildReport(id, state, catalog, derived, { planId }), [id, state, catalog, derived, planId]);
  const def = REPORTS.find((r) => r.id === id);
  const wide = ['programs', 'teachers'].includes(id);

  const word = async () => {
    setBusy(true);
    try { const { reportToDocx } = await import('../export/reportDocx.js'); downloadBlob(await reportToDocx(report, { landscape: wide }), `${report.title}.docx`); toast('تم تجهيز ملف Word ✓'); } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };
  const image = async () => {
    setBusy(true);
    try { await elementToPng(ref.current, `${report.title}.png`); toast('تم حفظ الصورة ✓'); } catch { toast('تعذر إنشاء الصورة', 'error'); }
    setBusy(false);
  };

  return (
    <div className="page">
      <PageHead title="مركز التقارير" subtitle="كل تقرير قابل للتصدير Word و PDF وصورة" />
      <div className="report-picker" role="tablist" aria-label="نوع التقرير">
        {REPORTS.map((r) => (
          <button key={r.id} type="button" role="tab" aria-selected={id === r.id} className={`report-tile ${id === r.id ? 'on' : ''}`} onClick={() => setId(r.id)}>
            <span aria-hidden="true">{r.icon}</span><strong>{r.title}</strong><small>{r.desc}</small>
          </button>
        ))}
      </div>
      <Card title={def?.title} actions={
        <div className="row-actions">
          {def?.needsPlan && (
            <select value={planId} onChange={(e) => setPlanId(e.target.value)} aria-label="الخطة">
              {state.plans.map((p) => <option key={p.id} value={p.id}>{classLabel(catalog, state.classes.find((c) => c.id === p.classId)) || 'خطة'} — {state.teachers.find((t) => t.id === p.teacherId)?.name || ''}</option>)}
            </select>
          )}
          <Button icon="📄" onClick={word} disabled={busy}>Word</Button>
          <Button icon="📕" onClick={() => printElement(ref.current, { landscape: wide, title: report.title })}>PDF</Button>
          <Button icon="🖼" onClick={image} disabled={busy}>صورة</Button>
        </div>
      }>
        <div className="report-preview" ref={ref}><ReportView report={report} /></div>
      </Card>
    </div>
  );
}
