// متابعة التنفيذ: كل البرامج في كل الخطط مع تغيير الحالة السريع
import React, { useMemo, useState } from 'react';
import { useApp } from '../state/store.jsx';
import { PageHead } from '../components/Shell.jsx';
import { Card, Segmented, Empty, Badge } from '../components/ui.jsx';
import { ProgramRecordModal, ProgramStatusBadge, DomainPill } from '../components/domain.jsx';
import { programRows } from '../services/insights.js';
import { PROGRAM_STATUS } from '../state/model.js';
import { arNum, gregShort, sessionsLabel } from '../utils/arabic.js';

export default function Programs({ query }) {
  const { state, catalog, derived, dispatch } = useApp();
  const [filter, setFilter] = useState(query.filter || 'all');
  const [domain, setDomain] = useState('');
  const [teacher, setTeacher] = useState('');
  const [open, setOpen] = useState(null);
  const rows = useMemo(() => programRows(state, catalog, derived), [state, catalog, derived]);
  const list = rows.filter((r) => {
    if (filter === 'overdue' && !r.overdue) return false;
    if (filter !== 'all' && filter !== 'overdue' && r.record.status !== filter) return false;
    if (domain && r.domain?.id !== domain) return false;
    if (teacher && r.teacher?.id !== teacher) return false;
    return true;
  }).sort((a, b) => (a.start || '9').localeCompare(b.start || '9'));
  const count = (k) => rows.filter((r) => (k === 'overdue' ? r.overdue : r.record.status === k)).length;

  return (
    <div className="page">
      <PageHead title="متابعة التنفيذ" subtitle={`${arNum(rows.length)} برنامج في ${arNum(state.plans.length)} خطة`} />
      <div className="toolbar wrap">
        <Segmented label="الحالة" value={filter} onChange={setFilter} options={[
          { value: 'all', label: `الكل (${arNum(rows.length)})` },
          ...Object.entries(PROGRAM_STATUS).map(([k, s]) => ({ value: k, label: `${s.icon} ${s.label} (${arNum(count(k))})` })),
          { value: 'overdue', label: `⏰ متأخر (${arNum(count('overdue'))})` },
        ]} />
        <select value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="المجال">
          <option value="">كل المجالات</option>
          {catalog.domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={teacher} onChange={(e) => setTeacher(e.target.value)} aria-label="المعلم">
          <option value="">كل المعلمين</option>
          {state.teachers.filter((t) => rows.some((r) => r.teacher?.id === t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      {list.length ? (
        <Card>
          <div className="program-rows">
            {list.map((r) => (
              <div key={r.key} className="program-row as-div">
                <button type="button" className="pr-open" onClick={() => setOpen(r)}>
                  <span className="pr-main"><strong>{r.program?.name}</strong><DomainPill domain={r.domain} /></span>
                  <span className="pr-meta">{r.classText} · {r.teacher?.name} · {sessionsLabel(r.sessions)}{r.start ? ` · ${gregShort(r.start)} ← ${gregShort(r.end)}` : ''}</span>
                </button>
                <span className="pr-status">
                  <ProgramStatusBadge status={r.record.status} overdue={r.overdue} />
                  {r.evidence.length > 0 && <Badge tone="muted">📎 {arNum(r.evidence.length)}</Badge>}
                  <select aria-label={`تغيير حالة ${r.program?.name}`} value={r.record.status} onChange={(e) => dispatch({ type: 'record/patch', planId: r.plan.id, programId: r.programId, patch: { status: e.target.value } })}>
                    {Object.entries(PROGRAM_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
                  </select>
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : <Card><Empty icon="🚦" title="ما فيه برامج بهذا التصفية" /></Card>}
      {open && <ProgramRecordModal planId={open.plan.id} programId={open.programId} onClose={() => setOpen(null)} />}
    </div>
  );
}
