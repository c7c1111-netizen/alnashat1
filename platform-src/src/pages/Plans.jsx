import React, { useMemo, useState } from 'react';
import { useApp } from '../state/store.jsx';
import { PageHead } from '../components/Shell.jsx';
import { Card, LinkButton, Empty, Segmented, Button, useToast, useConfirm } from '../components/ui.jsx';
import { PlanCard } from '../components/domain.jsx';
import { classLabel } from '../services/catalog.js';
import { readLegacyLocal, migrateLegacy } from '../storage/backup.js';
import { arNum } from '../utils/arabic.js';

export default function Plans({ query }) {
  const { state, catalog, derived, dispatch } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const [filter, setFilter] = useState(query.filter || 'all');
  const [q, setQ] = useState('');
  const errorPlans = new Set(derived.issues.filter((i) => i.severity === 'error').map((i) => i.planId));
  const issuePlans = new Set(derived.issues.map((i) => i.planId));
  const legacy = useMemo(() => readLegacyLocal(), []);
  const legacyPending = legacy.plans.filter((p) => p && !p.manual && !state.plans.some((x) => x.id === `legacy_${String(p.id).replace(/[^\w:-]/g, '')}`)).length;

  const list = state.plans
    .filter((p) => {
      if (filter === 'draft') return p.status === 'draft';
      if (filter === 'review') return p.status === 'review' || (p.status !== 'approved' && errorPlans.has(p.id));
      if (filter === 'approved') return p.status === 'approved';
      if (filter === 'issues') return issuePlans.has(p.id);
      return true;
    })
    .filter((p) => {
      if (!q.trim()) return true;
      const cls = classLabel(catalog, state.classes.find((c) => c.id === p.classId));
      const t = state.teachers.find((x) => x.id === p.teacherId)?.name || '';
      const progs = p.programs.map((x) => catalog.programById[x.programId]?.name).join(' ');
      return `${cls} ${t} ${progs} ${p.title}`.includes(q.trim());
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const importLegacy = async () => {
    const ok = await confirm({ title: 'استيراد خطط الأداة السابقة؟', message: `لقينا ${arNum(legacyPending)} خطة محفوظة من «مُعِدّ خطة النشاط» على هذا الجهاز. بتنضاف للمنصة كخطط «تحتاج مراجعة» بدون حذف أي شي.`, confirmText: 'استيراد' });
    if (!ok) return;
    const res = migrateLegacy(legacy, catalog, state);
    dispatch({ type: 'replace', state: res.state });
    toast(`تم استيراد الخطط ✓${res.skipped ? ` (تجاوزنا ${arNum(res.skipped)} جدول يدوي)` : ''}`);
  };

  return (
    <div className="page">
      <PageHead title="الخطط" subtitle={`${arNum(state.plans.length)} خطة`} actions={<LinkButton href="#/plans/new" variant="primary" icon="+">خطة جديدة</LinkButton>} />
      {legacyPending > 0 && (
        <div className="banner info">
          <span>📥 فيه {arNum(legacyPending)} خطة محفوظة من الأداة السابقة على هذا الجهاز.</span>
          <Button variant="primary" size="sm" onClick={importLegacy}>استيرادها</Button>
        </div>
      )}
      <div className="toolbar">
        <Segmented label="تصفية الخطط" value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'الكل' }, { value: 'draft', label: 'مسودات' }, { value: 'review', label: 'تحتاج مراجعة' },
          { value: 'approved', label: 'معتمدة' }, { value: 'issues', label: 'فيها تعارضات' },
        ]} />
        <input type="search" className="search" placeholder="🔍 ابحث بالصف أو المعلم أو البرنامج" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث في الخطط" />
      </div>
      {list.length ? (
        <div className="plan-grid">{list.map((p) => <PlanCard key={p.id} plan={p} />)}</div>
      ) : (
        <Card><Empty icon="🗂️" title={state.plans.length ? 'ما فيه خطط بهذا التصفية' : 'ما فيه خطط للحين'} action={!state.plans.length && <LinkButton href="#/plans/new" variant="primary" icon="+">أنشئ أول خطة</LinkButton>} /></Card>
      )}
    </div>
  );
}
