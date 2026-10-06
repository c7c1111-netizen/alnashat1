import React, { useMemo, useState } from 'react';
import { useApp } from '../state/store.jsx';
import { PageHead } from '../components/Shell.jsx';
import { Button, Card, LinkButton, Empty, Progress, Badge, useConfirm, useToast } from '../components/ui.jsx';
import { PlanStatusBadge, ProgramStatusBadge, ProgramRecordModal, IssuesPanel, DomainPill } from '../components/domain.jsx';
import { navigate } from '../components/router.jsx';
import { classLabel } from '../services/catalog.js';
import { planProgress, programRows } from '../services/insights.js';
import { teacherQuota } from '../services/quota.js';
import { validatePlan, crossPlanIssues } from '../validation/conflicts.js';
import { planDays } from '../scheduler/schedule.js';
import { storage } from '../storage/db.js';
import { uid } from '../utils/ids.js';
import { arNum, gregShort, DAY_NAMES, PERIOD_NAMES, sessionsLabel } from '../utils/arabic.js';

export default function PlanDetail({ planId }) {
  const { state, catalog, derived, dispatch } = useApp();
  const confirm = useConfirm();
  const toast = useToast();
  const [record, setRecord] = useState(null);
  const plan = state.plans.find((p) => p.id === planId);
  const rows = useMemo(() => programRows(state, catalog, derived).filter((r) => r.plan.id === planId), [state, catalog, derived, planId]);
  if (!plan) return <div className="page"><Empty icon="🔍" title="الخطة غير موجودة" action={<LinkButton href="#/plans">رجوع</LinkButton>} /></div>;
  const issues = [...validatePlan(state, catalog, plan, derived.schedules[plan.id]), ...crossPlanIssues(state, catalog).filter((i) => i.planId === plan.id)];
  const cls = state.classes.find((c) => c.id === plan.classId);
  const t = state.teachers.find((x) => x.id === plan.teacherId);
  const q = t ? teacherQuota(state, catalog, t.id) : null;
  const pct = planProgress(state, plan);
  const days = planDays(state, catalog, plan);

  const edit = (step) => { dispatch({ type: 'plan/patch', id: plan.id, patch: { wizardStep: step } }); navigate(`#/plans/${plan.id}/edit`); };
  const remove = async () => {
    if (!(await confirm({ title: 'حذف الخطة؟', message: 'بتنحذف الخطة وكل شواهدها نهائيًا.', confirmText: 'حذف', danger: true }))) return;
    for (const e of state.evidence.filter((x) => x.planId === plan.id && x.fileKey)) await storage.deleteFile(e.fileKey);
    dispatch({ type: 'plan/delete', id: plan.id });
    toast('تم حذف الخطة');
    navigate('#/plans');
  };
  const duplicate = () => {
    const copy = { ...structuredClone(plan), id: uid('plan'), status: 'draft', createdAt: Date.now(), updatedAt: Date.now(), wizardStep: 0, classId: null, approvedAt: null, records: {} };
    dispatch({ type: 'plan/upsert', plan: copy });
    toast('تم نسخ الخطة — اختر الصف للنسخة الجديدة');
    navigate(`#/plans/${copy.id}/edit`);
  };

  return (
    <div className="page">
      <PageHead
        back="#/plans"
        title={classLabel(catalog, cls) || 'خطة'}
        subtitle={`${t?.name || '—'}${t?.subject ? ` · ${t.subject}` : ''}`}
        actions={<>
          <Button variant="primary" icon="✏️" onClick={() => edit(plan.status === 'approved' ? 1 : plan.wizardStep || 0)}>تعديل</Button>
          <Button icon="📄" onClick={() => edit(5)}>اعتماد وتصدير</Button>
          <Button icon="⧉" onClick={duplicate}>نسخ لفصل آخر</Button>
          <Button variant="ghost-danger" icon="🗑" onClick={remove}>حذف</Button>
        </>}
      />
      <div className="detail-grid">
        <Card className="summary-card">
          <div className="summary-badges"><PlanStatusBadge plan={plan} issues={issues} /></div>
          <div className="big-pct">{arNum(pct)}٪ <small>إنجاز</small></div>
          <Progress value={pct} />
          <dl className="kv">
            <dt>البرامج</dt><dd>{arNum(plan.programs.length)}</dd>
            <dt>الحصص</dt><dd>{arNum(rows.reduce((a, r) => a + r.sessions, 0))}</dd>
            <dt>أيام النشاط</dt><dd>{days.map((d) => `${DAY_NAMES[d]} (${PERIOD_NAMES[(plan.periods?.[d] || 0) - 1] || '؟'}${(plan.doubleDays || []).includes(d) ? '+' : ''})`).join('، ')}</dd>
            <dt>نسبة ١٠٪</dt><dd>{q?.limit != null ? `${arNum(q.used)} من ${arNum(q.limit)}` : 'غير محسوبة'}</dd>
            <dt>الشواهد</dt><dd>📎 {arNum(rows.reduce((a, r) => a + r.evidence.length, 0))}</dd>
          </dl>
        </Card>
        <Card title="التعارضات"><IssuesPanel issues={issues} onGo={edit} compact /></Card>
      </div>
      <Card title="البرامج">
        <div className="program-rows">
          {rows.map((r) => (
            <button key={r.key} type="button" className="program-row" onClick={() => setRecord(r.programId)}>
              <span className="pr-main">
                <strong>{r.program?.name}</strong>
                <DomainPill domain={r.domain} />
              </span>
              <span className="pr-meta">{sessionsLabel(r.sessions)}{r.start ? ` · ${gregShort(r.start)} ← ${gregShort(r.end)}` : ''}</span>
              <span className="pr-status"><ProgramStatusBadge status={r.record.status} overdue={r.overdue} />{r.evidence.length > 0 && <Badge tone="muted">📎 {arNum(r.evidence.length)}</Badge>}</span>
            </button>
          ))}
        </div>
      </Card>
      {record && <ProgramRecordModal planId={plan.id} programId={record} onClose={() => setRecord(null)} />}
    </div>
  );
}
