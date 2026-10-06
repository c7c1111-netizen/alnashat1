import React, { useMemo, useState } from 'react';
import { useApp } from '../state/store.jsx';
import { PageHead } from '../components/Shell.jsx';
import { Card, Empty, Segmented, Badge } from '../components/ui.jsx';
import { ProgramRecordModal, EvidenceThumb, DomainPill } from '../components/domain.jsx';
import { programRows } from '../services/insights.js';
import { arNum } from '../utils/arabic.js';

export default function Evidence() {
  const { state, catalog, derived } = useApp();
  const [filter, setFilter] = useState('need');
  const [open, setOpen] = useState(null);
  const rows = useMemo(() => programRows(state, catalog, derived), [state, catalog, derived]);
  const list = rows.filter((r) => {
    if (filter === 'need') return !r.evidence.length && (r.record.status === 'done' || r.record.status === 'in_progress');
    if (filter === 'with') return r.evidence.length > 0;
    return true;
  });
  return (
    <div className="page">
      <PageHead title="الشواهد" subtitle={`📎 ${arNum(state.evidence.length)} شاهد — الصور تنحفظ على هذا الجهاز بدون إنترنت`} />
      <Segmented label="تصفية" value={filter} onChange={setFilter} options={[
        { value: 'need', label: 'تحتاج توثيق' }, { value: 'with', label: 'موثّقة' }, { value: 'all', label: 'كل البرامج' },
      ]} />
      {list.length ? (
        <div className="evidence-programs">
          {list.map((r) => (
            <Card key={r.key} className="ev-program">
              <div className="ev-program-head">
                <div><strong>{r.program?.name}</strong> <DomainPill domain={r.domain} /></div>
                <span className="muted small">{r.classText} · {r.teacher?.name}</span>
              </div>
              <div className="evidence-grid">
                {r.evidence.slice(0, 6).map((e) => <EvidenceThumb key={e.id} item={e} />)}
                {r.evidence.length > 6 && <Badge tone="muted">+{arNum(r.evidence.length - 6)}</Badge>}
              </div>
              <button type="button" className="btn secondary sm" onClick={() => setOpen(r)}>📎 {r.evidence.length ? 'إدارة الشواهد' : 'إضافة شواهد'}</button>
            </Card>
          ))}
        </div>
      ) : <Card><Empty icon="📁" title={filter === 'need' ? 'كل البرامج المنفذة موثّقة 👏' : 'ما فيه شواهد بعد'} /></Card>}
      {open && <ProgramRecordModal planId={open.plan.id} programId={open.programId} onClose={() => setOpen(null)} />}
    </div>
  );
}
