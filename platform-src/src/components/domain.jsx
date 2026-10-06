// مكونات خاصة بالنشاط: بطاقة خطة، لوحة التعارضات، سجل البرنامج، رفع الشواهد
import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state/store.jsx';
import { Badge, Button, Field, Modal, Progress, useConfirm, useToast } from './ui.jsx';
import { classLabel } from '../services/catalog.js';
import { planProgress, recordOf } from '../services/insights.js';
import { PLAN_STATUS, PROGRAM_STATUS } from '../state/model.js';
import { arNum, gregShort, hijriShort, relativeTime, DAY_NAMES, PERIOD_NAMES, sessionsLabel } from '../utils/arabic.js';
import { assistant } from '../services/assistant.js';
import { storage } from '../storage/db.js';
import { uid } from '../utils/ids.js';
import { cleanLine, cleanText, evidenceKind, safeUrl, validateEvidenceFile, EVIDENCE_LIMITS } from '../utils/sanitize.js';

export function PlanStatusBadge({ plan, issues }) {
  const errs = issues?.filter((i) => i.planId === plan.id && i.severity === 'error').length || 0;
  const s = PLAN_STATUS[plan.status] || PLAN_STATUS.draft;
  return (
    <>
      <Badge tone={s.tone}>{s.label}</Badge>
      {errs > 0 && plan.status !== 'approved' && <Badge tone="danger" icon="🔴">{arNum(errs)} خطأ</Badge>}
    </>
  );
}

export function ProgramStatusBadge({ status, overdue }) {
  const s = PROGRAM_STATUS[status] || PROGRAM_STATUS.not_started;
  return (
    <span className="status-wrap">
      <Badge tone={s.tone} icon={s.icon}>{s.label}</Badge>
      {overdue && <Badge tone="danger" icon="⏰">متأخر</Badge>}
    </span>
  );
}

export function PlanCard({ plan }) {
  const { state, catalog, derived } = useApp();
  const cls = state.classes.find((c) => c.id === plan.classId);
  const t = state.teachers.find((x) => x.id === plan.teacherId);
  const progs = (plan.programs || []).map((p) => catalog.programById[p.programId]).filter(Boolean);
  const domains = [...new Set(progs.map((p) => p.domainId))].map((d) => catalog.domainById[d]);
  const pct = planProgress(state, plan);
  const href = plan.status === 'draft' ? `#/plans/${plan.id}/edit` : `#/plans/${plan.id}`;
  return (
    <a className="plan-card" href={href}>
      <div className="plan-card-top">
        <strong className="plan-card-title">{classLabel(catalog, cls) || 'خطة بدون صف'}</strong>
        <span className="plan-card-badges"><PlanStatusBadge plan={plan} issues={derived.issues} /></span>
      </div>
      <div className="plan-card-meta">👨‍🏫 {t?.name || '—'}</div>
      <div className="plan-card-progs">
        {progs.slice(0, 3).map((p) => <span key={p.id} className="tag">{p.name}</span>)}
        {progs.length > 3 && <span className="tag muted">+{arNum(progs.length - 3)}</span>}
        {!progs.length && <span className="muted small">لم تُضف برامج بعد</span>}
      </div>
      <div className="plan-card-domains" aria-label="المجالات">
        {domains.map((d) => <span key={d.id} className="dot" style={{ background: d.color }} title={d.name} aria-label={d.name} />)}
        <span className="muted small">{domains.map((d) => d.name).join('، ')}</span>
      </div>
      <Progress value={pct} label={`إنجاز خطة ${classLabel(catalog, cls)}`} />
      <div className="plan-card-foot">
        <span>الإنجاز {arNum(pct)}٪</span>
        <span>آخر تحديث {relativeTime(plan.updatedAt)}</span>
      </div>
    </a>
  );
}

export function IssuesPanel({ issues, onGo, compact }) {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  if (!issues.length) return <div className="issues ok" role="status"><span aria-hidden="true">🟢</span> لا توجد أخطاء ولا تحذيرات</div>;
  return (
    <div className="issues">
      {errors.length > 0 && (
        <div className="issues-group danger">
          <h3><span aria-hidden="true">🔴</span> أخطاء يجب إصلاحها ({arNum(errors.length)})</h3>
          <ul>{errors.slice(0, compact ? 4 : 50).map((i, k) => <li key={k}>{i.message}{onGo && i.step != null && <button className="link" onClick={() => onGo(i.step)}>إصلاح</button>}</li>)}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="issues-group warn">
          <h3><span aria-hidden="true">🟠</span> تحذيرات ({arNum(warnings.length)})</h3>
          <ul>{warnings.slice(0, compact ? 4 : 50).map((i, k) => <li key={k}>{i.message}{onGo && i.step != null && <button className="link" onClick={() => onGo(i.step)}>عرض</button>}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

/** سجل البرنامج: الهدف، المستهدفون، الأدوات، الخطوات، الحالة، الشواهد */
export function ProgramRecordModal({ planId, programId, onClose }) {
  const { state, catalog, derived, dispatch } = useApp();
  const toast = useToast();
  const plan = state.plans.find((p) => p.id === planId);
  const prog = catalog.programById[programId];
  const sp = derived.schedules[planId]?.programs.find((p) => p.programId === programId);
  const rec = recordOf(plan, programId);
  const cls = state.classes.find((c) => c.id === plan?.classId);
  const t = state.teachers.find((x) => x.id === plan?.teacherId);
  if (!plan || !prog) return null;
  const set = (patch) => dispatch({ type: 'record/patch', planId, programId, patch });
  const fill = () => {
    set({
      goal: rec.goal || assistant.suggestGoal(catalog, programId),
      tools: rec.tools || assistant.suggestTools(catalog, programId),
      steps: rec.steps || assistant.suggestSteps(catalog, programId, sp?.needed),
    });
    toast('تم اقتراح الهدف والأدوات والخطوات — عدّلها كما تريد', 'info');
  };
  return (
    <Modal title={prog.name} onClose={onClose} size="lg">
      <div className="record-head">
        <Badge tone="muted">{catalog.domainById[prog.domainId]?.icon} {catalog.domainById[prog.domainId]?.name}</Badge>
        <Badge tone="muted">{classLabel(catalog, cls)}</Badge>
        <Badge tone="muted">👨‍🏫 {t?.name}</Badge>
        <Badge tone="muted">{sessionsLabel(sp?.needed)}</Badge>
        {sp?.start && <Badge tone="muted">📅 {gregShort(sp.start)} ← {gregShort(sp.end)}</Badge>}
      </div>
      <fieldset className="status-picker">
        <legend>حالة التنفيذ</legend>
        {Object.entries(PROGRAM_STATUS).map(([k, s]) => (
          <button key={k} type="button" className={`chip ${rec.status === k ? 'on' : ''}`} aria-pressed={rec.status === k} onClick={() => { set({ status: k }); if (k === 'done') toast(`«${prog.name}» مكتمل ✓`); }}>
            <span aria-hidden="true">{s.icon}</span> {s.label}
          </button>
        ))}
      </fieldset>
      <div className="grid-2">
        <Field label="الهدف"><textarea rows={3} value={rec.goal} onChange={(e) => set({ goal: cleanText(e.target.value) })} /></Field>
        <Field label="الطلاب المستهدفون"><textarea rows={3} value={rec.targetStudents} placeholder="مثال: جميع طلاب الفصل (٢٥ طالبًا)" onChange={(e) => set({ targetStudents: cleanText(e.target.value) })} /></Field>
        <Field label="الأدوات"><textarea rows={3} value={rec.tools} onChange={(e) => set({ tools: cleanText(e.target.value) })} /></Field>
        <Field label="ملاحظات"><textarea rows={3} value={rec.notes} onChange={(e) => set({ notes: cleanText(e.target.value) })} /></Field>
      </div>
      <Field label="خطوات التنفيذ"><textarea rows={5} value={rec.steps} onChange={(e) => set({ steps: cleanText(e.target.value) })} /></Field>
      <Button variant="ghost" icon="✨" onClick={fill}>اقترح الهدف والأدوات والخطوات</Button>
      {sp?.slots?.length > 0 && (
        <details className="slots">
          <summary>مواعيد الحصص ({arNum(sp.slots.length)} يوم)</summary>
          <ul>
            {sp.slots.map((s) => (
              <li key={s.date}>الأسبوع {arNum(s.weekLabel)} — {DAY_NAMES[s.day]} {gregShort(s.date)} ({hijriShort(s.hijri)}) — الحصة {s.periods.map((p) => PERIOD_NAMES[p - 1]).join(' و') || '—'}</li>
            ))}
          </ul>
        </details>
      )}
      <EvidenceSection planId={planId} programId={programId} />
    </Modal>
  );
}

export function EvidenceSection({ planId, programId }) {
  const { state, dispatch } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const list = state.evidence.filter((e) => e.planId === planId && e.programId === programId);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const onFiles = async (files) => {
    setBusy(true);
    let n = 0;
    for (const f of files) {
      const err = validateEvidenceFile(f);
      if (err) { toast(`${f.name}: ${err}`, 'error'); continue; }
      const key = uid('file');
      try {
        await storage.putFile(key, f);
        dispatch({ type: 'evidence/add', item: { id: uid('ev'), planId, programId, kind: evidenceKind(f), name: cleanLine(f.name), mime: f.type, size: f.size, fileKey: key, createdAt: Date.now() } });
        n++;
      } catch (e) { toast(e.message || 'تعذر حفظ الملف', 'error'); }
    }
    setBusy(false);
    if (n) toast(`تمت إضافة ${arNum(n)} شاهد ✓`);
  };
  const addLink = () => {
    const url = safeUrl(link);
    if (!url) { toast('الرابط غير صالح', 'error'); return; }
    const isVideo = /youtu|vimeo|tiktok|\.mp4/i.test(url);
    dispatch({ type: 'evidence/add', item: { id: uid('ev'), planId, programId, kind: isVideo ? 'video' : 'link', name: url, url, createdAt: Date.now() } });
    setLink('');
    toast('تمت إضافة الرابط ✓');
  };
  const remove = async (e) => {
    if (!(await confirm({ title: 'حذف الشاهد؟', message: e.name, confirmText: 'حذف', danger: true }))) return;
    if (e.fileKey) await storage.deleteFile(e.fileKey);
    dispatch({ type: 'evidence/delete', id: e.id });
  };
  return (
    <section className="evidence-box" aria-label="الشواهد">
      <h3>📎 الشواهد ({arNum(list.length)})</h3>
      <div className="evidence-grid">
        {list.map((e) => <EvidenceThumb key={e.id} item={e} onRemove={() => remove(e)} />)}
      </div>
      <div className="evidence-add">
        <label className={`btn secondary ${busy ? 'disabled' : ''}`}>
          <span aria-hidden="true">⬆️</span> رفع صور أو ملفات
          <input type="file" multiple accept={EVIDENCE_LIMITS.accept} hidden onChange={(e) => { onFiles([...e.target.files]); e.target.value = ''; }} disabled={busy} />
        </label>
        <div className="inline-form">
          <input type="url" inputMode="url" placeholder="أو الصق رابطًا (فيديو، ملف، صفحة)" value={link} onChange={(e) => setLink(e.target.value)} aria-label="رابط الشاهد" />
          <Button onClick={addLink} disabled={!link.trim()}>إضافة الرابط</Button>
        </div>
      </div>
    </section>
  );
}

export function EvidenceThumb({ item, onRemove }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let u = null;
    if (item.fileKey) storage.getFile(item.fileKey).then((b) => { if (b) { u = URL.createObjectURL(b); setUrl(u); } });
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [item.fileKey]);
  const href = item.url || url;
  const icon = { image: '🖼️', pdf: '📕', video: '🎬', link: '🔗', file: '📄' }[item.kind] || '📄';
  return (
    <div className="ev-thumb">
      <a href={href || undefined} target="_blank" rel="noopener noreferrer" download={item.fileKey && item.kind !== 'image' ? item.name : undefined}>
        {item.kind === 'image' && url ? <img src={url} alt={item.name} /> : <span className="ev-icon" aria-hidden="true">{icon}</span>}
        <span className="ev-name">{item.name}</span>
      </a>
      {onRemove && <button className="icon-btn small" onClick={onRemove} aria-label={`حذف ${item.name}`}>✕</button>}
    </div>
  );
}

export function DomainPill({ domain }) {
  if (!domain) return null;
  return <span className="domain-pill" style={{ '--c': domain.color }}><span aria-hidden="true">{domain.icon}</span>{domain.name}</span>;
}
