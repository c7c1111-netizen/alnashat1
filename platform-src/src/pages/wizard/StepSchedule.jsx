import React from 'react';
import { useApp } from '../../state/store.jsx';
import { Chips, Field, Card, Progress, Empty, Button, Badge, useToast } from '../../components/ui.jsx';
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

      {sched?.programs.some((sp) => sp.occasion && sp.needed > 0) && (
        <Card title="📅 برامج المناسبات — في أسبوع المناسبة" className="occ-card">
          <p className="muted small">برنامج المناسبة ينفَّذ بعدد حصصه كامل داخل أسبوع المناسبة: حصة في كل يوم، حتى لو اليوم ما هو من أيام نشاطك. جهّزت لك اقتراح، وأنت تختار الحصة لكل يوم بضغطة.</p>
          {sched.programs.filter((sp) => sp.occasion && sp.needed > 0).map((sp) => (
            <OccasionPlanner key={sp.programId} sp={sp} plan={plan} patch={patch} maxP={maxP} />
          ))}
        </Card>
      )}

      <Card title="✨ التوزيع الذكي" className="smart-dist">
        <div className="capacity">
          <span>البرامج تحتاج <strong>{arNum(needed)}</strong> حصة — أيام النشاط تستوعب <strong>{arNum(sched?.capacity || 0)}</strong></span>
          <Progress value={sched?.capacity ? (needed / sched.capacity) * 100 : 0} label="استخدام أيام النشاط" tone={needed > (sched?.capacity || 0) ? 'danger' : ''} />
        </div>
        <p className="muted small">برامج المناسبات تنحصر في أسبوع المناسبة، وباقي البرامج تتوزع بالترتيب على أقرب أيام فاضية، مع تجنّب حصص المعلم والفصل المحجوزة في خطط ثانية.</p>
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

/** اختيار حصص برنامج المناسبة يومًا بيوم داخل أسبوع المناسبة */
function OccasionPlanner({ sp, plan, patch, maxP }) {
  const { catalog } = useApp();
  const toast = useToast();
  const dom = catalog.domainById[sp.domainId];
  const days = sp.weekDays || [];
  const current = () => {
    const m = {};
    sp.slots.forEach((s) => { if (s.periods.length) m[s.date] = [...s.periods]; });
    return m;
  };
  const save = (m) => patch({ occasionSlots: { ...(plan.occasionSlots || {}), [sp.programId]: m } });
  const total = (m) => Object.values(m).reduce((a, l) => a + l.length, 0);
  const toggle = (date, p) => {
    const m = current();
    const list = m[date] || [];
    if (list.includes(p)) {
      const rest = list.filter((x) => x !== p);
      if (rest.length) m[date] = rest; else delete m[date];
    } else if (total(m) < sp.needed) {
      m[date] = [...list, p].sort((a, b) => a - b);
    } else if (list.length === 1) {
      m[date] = [p]; // تبديل حصة اليوم
    } else {
      toast(`اكتملت حصص البرنامج (${arNum(sp.needed)}) — شيل حصة من يوم ثاني أولًا`, 'info');
      return;
    }
    save(m);
  };
  const uniform = (p) => {
    const m = current();
    const target = Object.keys(m).length ? Object.keys(m) : sp.slots.map((s) => s.date);
    let skipped = 0;
    target.forEach((d) => {
      if (sp.taken?.[d]?.includes(p)) { skipped++; return; }
      m[d] = (m[d] && m[d].length > 1) ? [p, ...m[d].filter((x) => x !== p).slice(1)].sort((a, b) => a - b) : [p];
    });
    save(m);
    if (skipped) toast(`الحصة ${PERIOD_NAMES[p - 1]} محجوزة في ${arNum(skipped)} يوم — اختر لها حصة ثانية`, 'info');
  };
  const reset = () => { const o = { ...(plan.occasionSlots || {}) }; delete o[sp.programId]; patch({ occasionSlots: o }); };
  const ok = sp.filled === sp.needed && sp.slots.every((s) => s.periods.length >= s.count);
  return (
    <div className="occ-plan" style={{ '--c': dom?.color }}>
      <div className="occ-head">
        <strong><span aria-hidden="true">{dom?.icon}</span> {sp.name}</strong>
        <Badge tone="info">📅 {sp.occasion.name} · {gregShort(sp.occasion.date)}</Badge>
        {days[0] && <span className="muted small">الأسبوع {arNum(days[0].weekLabel)}</span>}
        <span className={`occ-count ${ok ? 'ok' : 'warn'}`}>{arNum(sp.filled)} / {arNum(sp.needed)} حصص</span>
      </div>
      {days.length > 0 && !days.some((d) => d.date === sp.occasion.date) && (
        <p className="occ-note">يوم المناسبة ما هو يوم دراسة (إجازة)، فالحصص في أيام الأسبوع الدراسية{sp.needed > days.length ? ` — ${arNum(days.length)} أيام لـ${arNum(sp.needed)} حصص، فيوم منها فيه حصتين` : ''}.</p>
      )}
      {!days.length ? <p className="muted">ما فيه أيام دراسة في أسبوع المناسبة.</p> : (
        <div className="occ-days">
          {days.map((d) => {
            const slot = sp.slots.find((s) => s.date === d.date);
            const sel = slot?.periods || [];
            const needPick = slot && sel.length < slot.count;
            return (
              <div key={d.date} className={`occ-day ${slot ? 'on' : ''} ${d.date === sp.occasion.date ? 'is-occ' : ''}`}>
                <div className="occ-day-name">
                  <strong>{DAY_NAMES[d.day]}</strong>
                  <small>{hijriShort(d.hijri)}</small>
                  {d.date === sp.occasion.date && <small className="occ-star">⭐ يوم المناسبة</small>}
                  {needPick && <small className="occ-need">اختر الحصة</small>}
                </div>
                <div className="occ-periods" role="group" aria-label={`حصص ${sp.name} يوم ${DAY_NAMES[d.day]}`}>
                  {PERIOD_NAMES.slice(0, maxP).map((n, i) => {
                    const p = i + 1;
                    const on = sel.includes(p);
                    const busy = sp.taken?.[d.date]?.includes(p) && !on;
                    return (
                      <button key={p} type="button" className={`pchip ${on ? 'on' : ''}`} aria-pressed={on} disabled={busy}
                        title={busy ? 'محجوزة للمعلم أو الفصل في خطة ثانية' : n} onClick={() => toggle(d.date, p)}>
                        {arNum(p)}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="occ-foot">
        <label className="occ-uniform">حصة وحدة لكل الأيام:
          <select value="" onChange={(e) => e.target.value && uniform(Number(e.target.value))} aria-label={`حصة موحدة لـ${sp.name}`}>
            <option value="">— اختر —</option>
            {PERIOD_NAMES.slice(0, maxP).map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
          </select>
        </label>
        {sp.custom && <Button size="sm" onClick={reset}>↺ رجّع للاقتراح</Button>}
      </div>
    </div>
  );
}
