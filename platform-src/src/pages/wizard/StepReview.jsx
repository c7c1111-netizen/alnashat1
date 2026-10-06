import React, { useState } from 'react';
import { useApp } from '../../state/store.jsx';
import { Button, Card } from '../../components/ui.jsx';
import { IssuesPanel } from '../../components/domain.jsx';
import { assistant } from '../../services/assistant.js';
import { teacherQuota } from '../../services/quota.js';
import { arNum } from '../../utils/arabic.js';
import { recordOf } from '../../services/insights.js';

export function reviewChecklist(state, catalog, derived, plan, issues) {
  const sched = derived.schedules[plan.id];
  const errs = (code) => issues.filter((i) => i.severity === 'error' && (Array.isArray(code) ? code.includes(i.code) : i.code === code));
  const warns = (code) => issues.filter((i) => i.severity === 'warning' && (Array.isArray(code) ? code.includes(i.code) : i.code === code));
  const total = sched?.programs.reduce((a, p) => a + p.needed, 0) || 0;
  const q = plan.teacherId ? teacherQuota(state, catalog, plan.teacherId) : null;
  const occProgs = sched?.programs.filter((p) => catalog.programById[p.programId]?.occasionId) || [];
  const ev = state.evidence.filter((e) => e.planId === plan.id).length;
  const detailsDone = plan.programs.filter((it) => recordOf(plan, it.programId).goal).length;
  return [
    { label: 'بيانات أساسية', ok: !errs('basic').length, value: errs('basic').length ? 'ناقصة' : 'مكتملة', step: 0 },
    { label: 'البرامج', ok: plan.programs.length > 0 && !errs(['stage', 'program']).length, value: `${arNum(plan.programs.length)} برامج`, step: 1 },
    { label: 'الحصص', ok: total > 0, value: `${arNum(total)} حصة`, step: 1 },
    { label: 'الجدول', ok: !errs(['shortage', 'period', 'days']).length, value: errs(['shortage', 'period', 'days']).length ? 'ناقص' : 'مكتمل', step: 2 },
    { label: 'التعارضات', ok: !issues.filter((i) => i.severity === 'error').length, warn: issues.some((i) => i.severity === 'warning'), value: issues.length ? `${arNum(issues.filter((i) => i.severity === 'error').length)} خطأ · ${arNum(issues.filter((i) => i.severity === 'warning').length)} تحذير` : 'لا توجد', step: 2 },
    { label: 'نسبة ١٠٪', ok: !errs('quota').length, warn: q?.limit == null, value: q?.limit == null ? 'غير محسوبة' : errs('quota').length ? 'متجاوزة' : 'سليمة', step: 0 },
    { label: 'المناسبات', ok: !warns('occasion').length, warn: !!warns('occasion').length, value: occProgs.length ? (warns('occasion').length ? 'تحتاج مراجعة' : 'مرتبطة') : 'لا توجد', step: 2 },
    { label: 'تفاصيل التنفيذ', ok: detailsDone === plan.programs.length, warn: detailsDone < plan.programs.length, value: `${arNum(detailsDone)} من ${arNum(plan.programs.length)}`, step: 3 },
    { label: 'الشواهد', ok: ev > 0, warn: ev === 0, value: ev ? `${arNum(ev)} شاهد` : 'لم تتم إضافة شواهد بعد', soft: true },
  ];
}

export default function StepReview({ plan, issues, go }) {
  const { state, catalog, derived, dispatch } = useApp();
  const [analysis, setAnalysis] = useState(null);
  const list = reviewChecklist(state, catalog, derived, plan, issues);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const analyze = () => setAnalysis(assistant.analyzePlan(state, catalog, plan, derived.schedules[plan.id], issues));
  const addSuggested = (id) => {
    dispatch({ type: 'plan/patch', id: plan.id, patch: { programs: [...plan.programs, { programId: id }] } });
    setAnalysis(null);
  };
  return (
    <div className="step-content">
      <Card title="مراجعة الخطة">
        <ul className="checklist">
          {list.map((c) => (
            <li key={c.label} className={c.ok && !c.warn ? 'ok' : c.ok || c.soft ? 'warn' : 'bad'}>
              <span className="check-icon" aria-hidden="true">{c.ok && !c.warn ? '✓' : c.ok || c.soft ? '⚠️' : '✕'}</span>
              <span className="check-label">{c.label}</span>
              <span className="check-value">{c.value}</span>
              {c.step != null && !(c.ok && !c.warn) && <button className="link" onClick={() => go(c.step)}>تعديل</button>}
            </li>
          ))}
        </ul>
        <div className={`ready ${errors ? 'bad' : 'ok'}`} role="status">
          {errors ? `🔴 فيه ${arNum(errors)} خطأ لازم يتصلح قبل الاعتماد` : '🟢 الخطة جاهزة للاعتماد'}
        </div>
      </Card>
      <IssuesPanel issues={issues} onGo={go} />
      <Card title="🤖 حلل خطتي" actions={<Button variant="accent" onClick={analyze}>تحليل</Button>}>
        {analysis ? (
          <div className="analysis">
            {analysis.summary && <p className="analysis-summary">{analysis.summary}</p>}
            <ul>{analysis.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
            {analysis.suggestions.map((s, i) => (
              <div key={i} className="suggestion">
                <span>💡 {s.text}</span>
                {s.kind === 'add' && <Button size="sm" onClick={() => addSuggested(s.programId)}>إضافة</Button>}
                {s.kind === 'redistribute' && <Button size="sm" onClick={() => go(2)}>تعديل الجدولة</Button>}
              </div>
            ))}
          </div>
        ) : <p className="muted">يحلل توازن المجالات، واستخدام أيام النشاط، ونسبة ١٠٪، ويقترح تحسينات.</p>}
      </Card>
    </div>
  );
}
