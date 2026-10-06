import React, { useMemo } from 'react';
import { useApp } from '../state/store.jsx';
import { Card, LinkButton, Stat, Empty, Badge } from '../components/ui.jsx';
import { PlanCard } from '../components/domain.jsx';
import { dashboardStats, smartAlerts, upcomingWeeks } from '../services/insights.js';
import { semesterOf } from '../services/catalog.js';
import { arNum, gregShort } from '../utils/arabic.js';

export default function Dashboard() {
  const { state, catalog, derived } = useApp();
  const stats = useMemo(() => dashboardStats(state, catalog, derived), [state, catalog, derived]);
  const alerts = useMemo(() => smartAlerts(state, catalog, derived, stats), [state, catalog, derived, stats]);
  const weeks = useMemo(() => upcomingWeeks(state, catalog, derived), [state, catalog, derived]);
  const sem = semesterOf(catalog, state.school.semester);
  const recent = [...state.plans].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
  const drafts = state.plans.filter((p) => p.status === 'draft');

  return (
    <div className="page dashboard">
      <section className="hero">
        <div className="hero-text">
          <p className="eyebrow">{state.school.name || 'اسم المدرسة'} · {catalog.calendar.label} · {sem.name}</p>
          <h1>منصة النشاط الطلابي</h1>
          <p className="hero-hello">مرحبًا بك{state.school.leaderName ? `، ${state.school.leaderName}` : ''} 👋</p>
          {!state.school.name && <p className="hero-hint">ابدأ بـ<a href="#/settings">إعدادات المدرسة</a> (الاسم، رائد النشاط، المعلمون) — مرة وحدة بس.</p>}
        </div>
        <div className="hero-actions">
          <LinkButton href="#/plans/new" variant="primary" icon="+">إنشاء خطة جديدة</LinkButton>
          <div className="quick-grid">
            <LinkButton href="#/timeline" icon="📅">الجدول الزمني</LinkButton>
            <LinkButton href="#/reports" icon="📊">التقارير</LinkButton>
            <LinkButton href="#/teachers" icon="👨‍🏫">المعلمون</LinkButton>
            <LinkButton href="#/evidence" icon="📁">الشواهد</LinkButton>
            <LinkButton href="#/export" icon="📤">التصدير</LinkButton>
            <LinkButton href="#/settings" icon="⚙️">إعدادات المدرسة</LinkButton>
          </div>
        </div>
      </section>

      <section className="stats" aria-label="إحصائيات">
        <Stat icon="🗂️" label="الخطط" value={stats.plans} href="#/plans" />
        <Stat icon="📚" label="البرامج" value={stats.programs} href="#/programs" />
        <Stat icon="📈" label="نسبة الإنجاز" value={`${arNum(stats.completion)}٪`} tone="accent" />
        <Stat icon="✅" label="برامج منفذة" value={stats.done} hint={`من ${arNum(stats.programs)}`} href="#/programs?filter=done" />
        <Stat icon="📝" label="تحتاج مراجعة" value={stats.needsReview} tone={stats.needsReview ? 'warn' : ''} href="#/plans?filter=review" />
        <Stat icon="⚠️" label="التعارضات" value={stats.conflicts} tone={stats.errors ? 'danger' : stats.conflicts ? 'warn' : 'ok'} href="#/plans?filter=issues" />
      </section>

      <div className="dash-grid">
        <Card title="تنبيهات ذكية" className="alerts-card">
          {alerts.length ? (
            <ul className="alerts">
              {alerts.map((a, i) => (
                <li key={i} className={`alert ${a.tone}`}><a href={a.to}><span aria-hidden="true">{a.icon}</span> {a.text}</a></li>
              ))}
            </ul>
          ) : <p className="muted">🟢 كل شي تمام — ما فيه تنبيهات الحين.</p>}
          {drafts.length > 0 && (
            <p className="resume">✏️ عندك {arNum(drafts.length)} خطة غير مكتملة — <a href={`#/plans/${drafts[0].id}/edit`}>أكمل آخر خطة</a></p>
          )}
        </Card>

        <Card title="الأسابيع القادمة" actions={<a href="#/timeline" className="link">كل الأسابيع</a>}>
          {weeks.length ? weeks.map((w) => (
            <div key={w.weekIndex} className="upcoming">
              <div className="upcoming-head">
                <strong>{w.type === 'study' ? `الأسبوع ${arNum(w.label)}` : w.note || w.label}</strong>
                <span className="muted small">{gregShort(w.first)} – {gregShort(w.last)}</span>
              </div>
              {w.occasions.map((o) => <Badge key={o.id} tone="info" icon="📅">{o.name} · {gregShort(o.date)}</Badge>)}
              {w.type !== 'study' && <Badge tone="muted">{w.note || 'إجازة'}</Badge>}
              <ul className="upcoming-items">
                {w.items.slice(0, 5).map((x, i) => (
                  <li key={i}><span className="dot" style={{ background: catalog.domainById[x.sp.domainId]?.color }} aria-hidden="true" />{x.sp.name}</li>
                ))}
                {w.items.length > 5 && <li className="muted">+{arNum(w.items.length - 5)} حصة أخرى</li>}
                {!w.items.length && w.type === 'study' && <li className="muted">لا توجد حصص نشاط مجدولة</li>}
              </ul>
            </div>
          )) : <p className="muted">انتهى الفصل الدراسي.</p>}
        </Card>
      </div>

      <Card title="آخر الخطط" actions={<a href="#/plans" className="link">كل الخطط</a>}>
        {recent.length ? (
          <div className="plan-grid">{recent.map((p) => <PlanCard key={p.id} plan={p} />)}</div>
        ) : (
          <Empty icon="✨" title="ما فيه خطط للحين" action={<LinkButton href="#/plans/new" variant="primary" icon="+">أنشئ أول خطة</LinkButton>}>
            المنصة توزّع الحصص، وتحسب نسبة ١٠٪، وتكشف التعارضات، وتعبّي ملف الخطة الرسمي تلقائيًا.
          </Empty>
        )}
      </Card>
    </div>
  );
}
