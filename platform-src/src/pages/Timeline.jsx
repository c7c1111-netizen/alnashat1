// الجدول الزمني للفصل: الأسابيع، المناسبات، الإجازات، أيام النشاط، والبرامج
import React, { useMemo, useState } from 'react';
import { useApp } from '../state/store.jsx';
import { PageHead } from '../components/Shell.jsx';
import { Card, Modal, Badge } from '../components/ui.jsx';
import { ProgramRecordModal } from '../components/domain.jsx';
import { semesterOf, resolveOccasions, classLabel } from '../services/catalog.js';
import { arNum, gregShort, hijriShort, DAY_NAMES, PERIOD_NAMES, todayISO } from '../utils/arabic.js';

export default function Timeline() {
  const { state, catalog, derived } = useApp();
  const [teacher, setTeacher] = useState('');
  const [cls, setCls] = useState('');
  const [rec, setRec] = useState(null);
  const [occ, setOcc] = useState(null);
  const sem = semesterOf(catalog, state.school.semester);
  const occasions = useMemo(() => resolveOccasions(catalog, state.school.semester), [catalog, state.school.semester]);
  const today = todayISO();

  const slots = useMemo(() => {
    const out = [];
    state.plans.forEach((plan) => {
      if (teacher && plan.teacherId !== teacher) return;
      if (cls && plan.classId !== cls) return;
      derived.schedules[plan.id]?.programs.forEach((sp) => sp.slots.forEach((s) => out.push({ plan, sp, s })));
    });
    return out;
  }, [state, derived, teacher, cls]);

  return (
    <div className="page">
      <PageHead title="الجدول الزمني" subtitle={`${sem.name} · ${gregShort(sem.start)} – ${gregShort(sem.end)}`} />
      <div className="toolbar wrap">
        <select value={cls} onChange={(e) => setCls(e.target.value)} aria-label="الفصل">
          <option value="">كل الفصول</option>
          {state.classes.map((c) => <option key={c.id} value={c.id}>{classLabel(catalog, c, true)}</option>)}
        </select>
        <select value={teacher} onChange={(e) => setTeacher(e.target.value)} aria-label="المعلم">
          <option value="">كل المعلمين</option>
          {state.teachers.filter((t) => state.plans.some((p) => p.teacherId === t.id)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <div className="legend">
          {catalog.domains.map((d) => <span key={d.id} className="legend-item"><span className="dot" style={{ background: d.color }} aria-hidden="true" />{d.name}</span>)}
        </div>
      </div>
      <ol className="timeline">
        {sem.weeks.map((w, wi) => {
          const first = w.days[0]?.date, last = w.days[w.days.length - 1]?.date;
          const current = first <= today && today <= last;
          const past = last < today;
          const wSlots = slots.filter((x) => x.s.date >= first && x.s.date <= last).sort((a, b) => a.s.date.localeCompare(b.s.date));
          const wOcc = occasions.filter((o) => o.date >= first && o.date <= last);
          const holidays = w.days.filter((d) => d.type === 'holiday' && w.type === 'study');
          return (
            <li key={wi} className={`tl-week ${w.type} ${current ? 'current' : ''} ${past ? 'past' : ''}`}>
              <div className="tl-label">
                <strong>{w.type === 'study' || w.type === 'exams' ? `الأسبوع ${arNum(w.label)}` : '—'}</strong>
                <small>{gregShort(first)} – {gregShort(last)}</small>
                {current && <Badge tone="info">هذا الأسبوع</Badge>}
              </div>
              <div className="tl-body">
                {w.type !== 'study' && <div className={`tl-banner ${w.type}`}>{w.name}</div>}
                {holidays.length > 0 && <div className="tl-banner holiday small">{holidays[0].note} ({holidays.map((d) => DAY_NAMES[d.day]).join(' و')})</div>}
                {wOcc.map((o) => (
                  <button key={o.id} type="button" className="tl-occ" onClick={() => setOcc(o)}>📅 {o.name} · {gregShort(o.date)}</button>
                ))}
                <div className="tl-slots">
                  {wSlots.map(({ plan, sp, s }) => {
                    const d = catalog.domainById[sp.domainId];
                    return (
                      <button key={`${plan.id}${sp.programId}${s.date}`} type="button" className="tl-slot" style={{ '--c': d?.color }} onClick={() => setRec({ planId: plan.id, programId: sp.programId })}
                        title={`${sp.name} — ${classLabel(catalog, state.classes.find((c) => c.id === plan.classId), true)}`}>
                        <span className="tl-day">{DAY_NAMES[s.day]}</span>
                        <span className="tl-name">{sp.name}</span>
                        <span className="tl-cls">{classLabel(catalog, state.classes.find((c) => c.id === plan.classId), true)}{s.periods.length ? ` · ح${arNum(s.periods[0])}` : ''}</span>
                      </button>
                    );
                  })}
                  {!wSlots.length && w.type === 'study' && <span className="muted small">لا توجد حصص نشاط</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {rec && <ProgramRecordModal {...rec} onClose={() => setRec(null)} />}
      {occ && (
        <Modal title={occ.name} onClose={() => setOcc(null)} size="sm">
          <p>📅 {gregShort(occ.date)}</p>
          <h3 className="sub-title">البرامج المرتبطة</h3>
          <ul>
            {slots.filter((x) => catalog.programById[x.sp.programId]?.occasionId === occ.id).map((x, i) => (
              <li key={i}>{x.sp.name} — {classLabel(catalog, state.classes.find((c) => c.id === x.plan.classId), true)} — {DAY_NAMES[x.s.day]} {gregShort(x.s.date)} ({hijriShort(x.s.hijri)}){x.s.periods.length ? ` — الحصة ${PERIOD_NAMES[x.s.periods[0] - 1]}` : ''}</li>
            ))}
            {!slots.some((x) => catalog.programById[x.sp.programId]?.occasionId === occ.id) && <li className="muted">ما فيه برامج مرتبطة — أضفها من «اختيار البرامج» في أي خطة.</li>}
          </ul>
        </Modal>
      )}
    </div>
  );
}
