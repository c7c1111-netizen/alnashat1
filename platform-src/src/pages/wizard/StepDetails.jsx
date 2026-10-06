import React, { useState } from 'react';
import { useApp } from '../../state/store.jsx';
import { Button, Field, Empty, useToast } from '../../components/ui.jsx';
import { recordOf } from '../../services/insights.js';
import { assistant } from '../../services/assistant.js';
import { cleanText } from '../../utils/sanitize.js';
import { sessionsLabel, gregShort } from '../../utils/arabic.js';

export default function StepDetails({ plan, go }) {
  const { catalog, derived, dispatch } = useApp();
  const toast = useToast();
  const sched = derived.schedules[plan.id];
  const [open, setOpen] = useState(plan.programs[0]?.programId || null);
  if (!plan.programs.length) return <Empty icon="📚" title="أضف برامج أولًا" action={<Button onClick={() => go(1)}>اختيار البرامج</Button>} />;
  const set = (programId, patch) => dispatch({ type: 'record/patch', planId: plan.id, programId, patch });
  const fillAll = () => {
    plan.programs.forEach((it) => {
      const r = recordOf(plan, it.programId);
      const sp = sched?.programs.find((p) => p.programId === it.programId);
      set(it.programId, {
        goal: r.goal || assistant.suggestGoal(catalog, it.programId),
        tools: r.tools || assistant.suggestTools(catalog, it.programId),
        steps: r.steps || assistant.suggestSteps(catalog, it.programId, sp?.needed),
      });
    });
    toast('تم اقتراح التفاصيل للحقول الفاضية — راجعها وعدّلها', 'info');
  };
  return (
    <div className="step-content">
      <div className="details-top">
        <p className="muted">لكل برنامج سجل مستقل. الحقول اختيارية، وتقدر تكملها لاحقًا من صفحة الخطة.</p>
        <Button variant="accent" icon="✨" onClick={fillAll}>اقترح التفاصيل لكل البرامج</Button>
      </div>
      {plan.programs.map((it) => {
        const p = catalog.programById[it.programId];
        const d = catalog.domainById[p?.domainId];
        const r = recordOf(plan, it.programId);
        const sp = sched?.programs.find((x) => x.programId === it.programId);
        const isOpen = open === it.programId;
        const filled = [r.goal, r.tools, r.steps].filter(Boolean).length;
        return (
          <section key={it.programId} className={`detail-card ${isOpen ? 'open' : ''}`} style={{ '--c': d?.color }}>
            <button type="button" className="detail-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : it.programId)}>
              <span><span aria-hidden="true">{d?.icon}</span> <strong>{p?.name}</strong></span>
              <span className="muted small">{sessionsLabel(sp?.needed)}{sp?.start ? ` · ${gregShort(sp.start)}` : ''} · {filled === 3 ? '✓ مكتمل' : `${filled}/٣`}</span>
            </button>
            {isOpen && (
              <div className="detail-body">
                <Field label="الهدف"><textarea rows={2} value={r.goal} onChange={(e) => set(it.programId, { goal: cleanText(e.target.value) })} /></Field>
                <div className="grid-2">
                  <Field label="الطلاب المستهدفون"><input value={r.targetStudents} placeholder="مثال: جميع طلاب الفصل" onChange={(e) => set(it.programId, { targetStudents: cleanText(e.target.value, 300) })} /></Field>
                  <Field label="الأدوات"><input value={r.tools} onChange={(e) => set(it.programId, { tools: cleanText(e.target.value, 500) })} /></Field>
                </div>
                <Field label="خطوات التنفيذ"><textarea rows={4} value={r.steps} onChange={(e) => set(it.programId, { steps: cleanText(e.target.value) })} /></Field>
                <Field label="ملاحظات"><textarea rows={2} value={r.notes} onChange={(e) => set(it.programId, { notes: cleanText(e.target.value) })} /></Field>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
