import React, { useRef, useState } from 'react';
import { useApp } from '../../state/store.jsx';
import { Button, Card, LinkButton, Switch, useToast } from '../../components/ui.jsx';
import { IssuesPanel } from '../../components/domain.jsx';
import { buildReport } from '../../services/reports.js';
import { downloadBlob, printElement } from '../../export/files.js';
import { ReportView } from '../Reports.jsx';
import { classLabel } from '../../services/catalog.js';
import { arNum } from '../../utils/arabic.js';

export default function StepApprove({ plan, patch, issues, go }) {
  const { state, catalog, derived } = useApp();
  const toast = useToast();
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const errors = issues.filter((i) => i.severity === 'error');
  const quotaErr = errors.filter((i) => i.code === 'quota');
  const policy = state.settings.quotaPolicy;
  const blocking = errors.filter((i) => !(i.code === 'quota' && policy.allowOverride && plan.quotaOverrideConfirmed));
  const cls = state.classes.find((c) => c.id === plan.classId);
  const name = `خطة ${classLabel(catalog, cls)}`;
  const report = buildReport('plan', state, catalog, derived, { planId: plan.id });

  const approve = () => {
    patch({ status: 'approved', approvedAt: Date.now() });
    toast('تم اعتماد الخطة ✓ — البرامج صارت «مخطط»');
  };
  const word = async () => {
    setBusy(true);
    try { const { reportToDocx } = await import('../../export/reportDocx.js'); downloadBlob(await reportToDocx(report), `${name}.docx`); toast('تم تجهيز ملف Word ✓'); } catch (e) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <div className="step-content">
      {plan.status === 'approved' ? (
        <Card className="approved-card">
          <h3>🟢 الخطة معتمدة</h3>
          <p className="muted">تقدر تعدّل عليها في أي وقت، وتنعكس التعديلات في ملف الخطة والتقارير.</p>
          <Button onClick={() => patch({ status: 'review' })}>إلغاء الاعتماد</Button>
        </Card>
      ) : (
        <Card title="الاعتماد">
          {blocking.length ? (
            <>
              <p className="ready bad">🔴 ما نقدر نعتمد الخطة — فيه {arNum(blocking.length)} خطأ</p>
              <IssuesPanel issues={blocking} onGo={go} compact />
            </>
          ) : (
            <p className="ready ok">🟢 الخطة جاهزة للاعتماد</p>
          )}
          {quotaErr.length > 0 && policy.allowOverride && (
            <Switch checked={plan.quotaOverrideConfirmed} onChange={(v) => patch({ quotaOverrideConfirmed: v })} label="أؤكد وجود صلاحية لتجاوز حد ١٠٪ لهذه الخطة" />
          )}
          <div className="row-actions">
            <Button variant="primary" onClick={approve} disabled={blocking.length > 0}>اعتماد الخطة</Button>
            {plan.status === 'draft' && <Button onClick={() => { patch({ status: 'review' }); toast('حُفظت الخطة للمراجعة'); }}>حفظ للمراجعة لاحقًا</Button>}
          </div>
        </Card>
      )}

      <Card title="التصدير">
        <div className="export-mini">
          <Button icon="📄" onClick={word} disabled={busy}>تقرير الخطة Word</Button>
          <Button icon="📕" onClick={() => printElement(ref.current, { title: name })}>تقرير الخطة PDF</Button>
          <LinkButton href="#/export" icon="🗂️">ملف الخطة الرسمي (كل الخطط)</LinkButton>
          <LinkButton href={`#/plans/${plan.id}`} icon="👁️">صفحة الخطة</LinkButton>
        </div>
        <div className="report-preview" ref={ref}><ReportView report={report} /></div>
      </Card>
    </div>
  );
}
