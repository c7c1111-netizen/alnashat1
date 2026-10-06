import React from 'react';
import { useApp } from '../../state/store.jsx';
import { Chips, Field, Card, Progress, Empty, Button } from '../../components/ui.jsx';
import { IssuesPanel } from '../../components/domain.jsx';
import { planDays } from '../../scheduler/schedule.js';
import { DAY_ORDER, DAY_NAMES, PERIOD_NAMES, arNum, gregShort, hijriShort, sessionsLabel, todayISO } from '../../utils/arabic.js';

export default function StepSchedule({ plan, patch, issues, go }) {
  const { state, catalog, derived } = useApp();
  const sched = derived.schedules[plan.id];
  const days = planDays(state, catalog, plan);
  const maxP = state.settings.periodsPerDay || 7;
  const setDays = (d) => {
    const keep = DAY_ORDER.filter((k) => d.includes(k));
    if (!keep.length) return;
    patch({ days: keep, doubleDays: (plan.doubleDays || []).filter((x) => keep.includes(x)) });
  };
  const setPeriod = (day, p) => patch({ periods: { ...plan.periods, [day]: p } });
  const scheduleIssues = issues.filter((i) => i.step === 2);
  const needed = sched?.programs.reduce((a, p) => a + p.needed, 0) || 0;

  if (!plan.programs.length) return <Empty icon="📚" title="أضف برامج أولًا" action={<Button onClick={() => go(1)}>اختيار البرامج</Button>} />;

  return (
    <div className="step-content">
      <div className="grid-2">
        <Field label="أيام النشاط" hint="تبدأ بأيام المرحلة الافتراضية من الإعدادات">
          <Chips multiple label="أيام النشاط" value={days} onChange={setDays} options={DAY_ORDER.map((d) => ({ value: d, label: DAY_NAMES[d] }))} />
        </Field>
        <Field label="أيام فيها حصتان متتاليتان" hint="في هذي الأيام يأخذ البرنامج حصتين ورا بعض">
          <Chips multiple label="الحصص المزدوجة" value={(plan.doubleDays || []).filter((d) => days.includes(d))} onChange={(v) => patch({ doubleDays: v })} options={days.map((d) => ({ value: d, label: DAY_NAMES[d] }))} />
        </Field>
      </div>

      <Field label="بداية التوزيع" hint="الحصص تتوزع من هذا التاريخ إلى نهاية الفصل">
        <Chips label="بداية التوزيع" value={plan.startDate ? 'from' : 'sem'} onChange={(v) => v && patch({ startDate: v === 'sem' ? null : (plan.startDate || todayISO()) })}
          options={[{ value: 'from', label: plan.startDate ? `من ${gregShort(plan.startDate)}` : 'من اليوم' }, { value: 'sem', label: 'من بداية الفصل' }]} />
        {plan.startDate && <input type="date" value={plan.startDate} min={catalog.calendar.semesters[0].start} onChange={(e) => e.target.value && patch({ startDate: e.target.value })} aria-label="تاريخ بداية التوزيع" style={{ maxWidth: 220 }} />}
      </Field>

      <Card title="حصة النشاط في كل يوم" className="period-card">
        {days.map((d) => {
          const dbl = (plan.doubleDays || []).includes(d);
          return (
            <div key={d} className="period-row">
              <div className="period-day"><strong>{DAY_NAMES[d]}</strong>{dbl && <small>حصتان متتاليتان</small>}</div>
              <Chips label={`حصة يوم ${DAY_NAMES[d]}`} value={plan.periods?.[d] || null} onChange={(v) => setPeriod(d, v)}
                options={PERIOD_NAMES.slice(0, maxP).map((n, i) => ({ value: i + 1, label: n }))}
                disabled={dbl ? [maxP] : []} />
            </div>
          );
        })}
      </Card>

      <Card title="✨ التوزيع الذكي" className="smart-dist">
        <div className="capacity">
          <span>البرامج تحتاج <strong>{arNum(needed)}</strong> حصة — أيام النشاط تستوعب <strong>{arNum(sched?.capacity || 0)}</strong></span>
          <Progress value={sched?.capacity ? (needed / sched.capacity) * 100 : 0} label="استخدام أيام النشاط" tone={needed > (sched?.capacity || 0) ? 'danger' : ''} />
        </div>
        <p className="muted small">البرامج المرتبطة بمناسبة تنحجز أولًا قرب تاريخها، وباقي البرامج تتوزع بالترتيب على أقرب أيام فاضية، مع تجنّب حصص المعلم والفصل المحجوزة في خطط ثانية.</p>
        <div className="dist-list">
          {sched?.programs.map((sp) => {
            const d = catalog.domainById[sp.domainId];
            return (
              <details key={sp.programId} className="dist-item" style={{ '--c': d?.color }}>
                <summary>
                  <span className="dist-name"><span aria-hidden="true">{d?.icon}</span> {sp.name}</span>
                  <span className="dist-meta">{sessionsLabel(sp.needed)}{sp.start ? ` · ${gregShort(sp.start)} ← ${gregShort(sp.end)}` : ''}</span>
                  {sp.occasion && <span className="badge info">📅 {sp.occasion.name}</span>}
                  {sp.shortage && <span className="badge danger">ناقص {arNum(sp.needed - sp.filled)}</span>}
                </summary>
                <ul className="slot-list">
                  {sp.slots.map((s) => (
                    <li key={s.date}>
                      <span className="slot-week">أ{arNum(s.weekLabel)}</span>
                      <span>{DAY_NAMES[s.day]} {gregShort(s.date)}</span>
                      <span className="muted">{hijriShort(s.hijri)}</span>
                      <span className="slot-p">{s.periods.length ? `الحصة ${s.periods.map((p) => PERIOD_NAMES[p - 1]).join(' و')}` : 'بدون حصة'}</span>
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </div>
      </Card>
      <IssuesPanel issues={scheduleIssues} />
    </div>
  );
}
