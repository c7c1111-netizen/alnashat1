import React, { useMemo, useState } from 'react';
import { useApp } from '../../state/store.jsx';
import { Button, Chips, Modal, Empty, Switch, useToast } from '../../components/ui.jsx';
import { programSessions, resolveOccasions } from '../../services/catalog.js';
import { planStage } from '../../scheduler/schedule.js';
import { teacherQuota } from '../../services/quota.js';
import { assistant } from '../../services/assistant.js';
import { QuotaMeter } from './StepBasics.jsx';
import { arNum, sessionsLabel, gregShort } from '../../utils/arabic.js';

export default function StepPrograms({ plan, patch, go }) {
  const { state, catalog } = useApp();
  const toast = useToast();
  const stage = planStage(state, catalog, plan);
  const [domains, setDomains] = useState([]);
  const [q, setQ] = useState('');
  const [size, setSize] = useState(null);
  const [onlyStage, setOnlyStage] = useState(true);
  const [onlySelected, setOnlySelected] = useState(false);
  const [suggest, setSuggest] = useState(null);
  const occ = useMemo(() => Object.fromEntries(resolveOccasions(catalog, plan.semester).map((o) => [o.id, o])), [catalog, plan.semester]);
  const selected = new Set(plan.programs.map((p) => p.programId));
  const q10 = plan.teacherId ? teacherQuota(state, catalog, plan.teacherId) : null;

  if (!stage) return <Empty icon="👆" title="اختر الصف أولًا" action={<Button onClick={() => go(0)}>رجوع لبيانات الخطة</Button>}>عدد حصص كل برنامج يختلف حسب المرحلة.</Empty>;

  const sessionsOf = (p) => programSessions(catalog, state.settings, p.id, stage);
  const browsing = domains.length > 0 || q.trim() || size || onlySelected;
  const list = catalog.programs.filter((p) => {
    const n = sessionsOf(p);
    if (!browsing && !selected.has(p.id)) return false;
    if (onlyStage && !n) return false;
    if (domains.length && !domains.includes(p.domainId)) return false;
    if (onlySelected && !selected.has(p.id)) return false;
    if (size === 'small' && !(n && n <= 3)) return false;
    if (size === 'mid' && !(n >= 4 && n <= 6)) return false;
    if (size === 'big' && !(n >= 7)) return false;
    if (q.trim() && !p.name.includes(q.trim())) return false;
    return true;
  });

  const toggle = (p) => {
    if (selected.has(p.id)) patch({ programs: plan.programs.filter((x) => x.programId !== p.id) });
    else { patch({ programs: [...plan.programs, { programId: p.id }] }); toast(`تمت إضافة «${p.name}» ✓`); }
  };
  const setSessions = (id, n) => patch({ programs: plan.programs.map((x) => (x.programId === id ? { ...x, sessions: n } : x)) });

  const runSuggest = () => setSuggest({ ...assistant.suggestBalancedPlan(state, catalog, plan), chosen: null });
  const applySuggest = (ids) => {
    const add = ids.filter((id) => !selected.has(id)).map((id) => ({ programId: id }));
    patch({ programs: [...plan.programs, ...add] });
    setSuggest(null);
    toast(`أضفنا ${arNum(add.length)} برنامج — تقدر تعدّل عليها`);
  };

  return (
    <div className="step-content">
      <div className="programs-top">
        <QuotaMeter q={q10} />
        <Button variant="accent" icon="✨" onClick={runSuggest}>اقترح لي خطة متوازنة</Button>
      </div>

      <h3 className="sub-title">المجالات</h3>
      <div className="domain-cards" role="group" aria-label="تصفية حسب المجال">
        {catalog.domains.map((d) => {
          const on = domains.includes(d.id);
          const count = plan.programs.filter((x) => catalog.programById[x.programId]?.domainId === d.id).length;
          return (
            <button key={d.id} type="button" className={`domain-card ${on ? 'on' : ''}`} style={{ '--c': d.color }} aria-pressed={on} onClick={() => setDomains(on ? domains.filter((x) => x !== d.id) : [...domains, d.id])}>
              <span className="domain-icon" aria-hidden="true">{d.icon}</span>
              <span>{d.name}</span>
              {count > 0 && <span className="domain-count">{arNum(count)}</span>}
            </button>
          );
        })}
      </div>

      <div className="toolbar wrap">
        <input type="search" className="search" placeholder="🔍 بحث سريع عن برنامج" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث عن برنامج" />
        <Chips label="عدد الحصص" value={size} onChange={setSize} options={[{ value: 'small', label: '١–٣ حصص' }, { value: 'mid', label: '٤–٦' }, { value: 'big', label: '٧ فأكثر' }]} />
        <Switch checked={onlyStage} onChange={setOnlyStage} label="المناسبة لمرحلتي فقط" />
        <Switch checked={onlySelected} onChange={setOnlySelected} label={`المختارة فقط (${arNum(selected.size)})`} />
      </div>

      {!browsing && <p className="hint-box">👆 اختر مجالًا (أو أكثر) لعرض برامجه، أو ابحث باسم البرنامج. {selected.size > 0 && `البرامج المختارة (${arNum(selected.size)}) معروضة تحت.`}</p>}
      <div className="program-grid">
        {list.map((p) => {
          const n = sessionsOf(p);
          const on = selected.has(p.id);
          const d = catalog.domainById[p.domainId];
          const o = p.occasionId ? occ[p.occasionId] : null;
          const item = plan.programs.find((x) => x.programId === p.id);
          return (
            <article key={p.id} className={`program-card ${on ? 'on' : ''} ${!n ? 'off' : ''}`} style={{ '--c': d.color }}>
              <div className="program-card-head">
                <span className="domain-mini"><span aria-hidden="true">{d.icon}</span> {d.name}</span>
                <span className="sessions">{n ? sessionsLabel(item?.sessions || n) : 'غير مطروح للمرحلة'}</span>
              </div>
              <h4>{p.name}</h4>
              <div className="program-card-meta">
                <span>{catalog.stages.filter((s) => programSessions(catalog, state.settings, p.id, s.id)).map((s) => s.name).join('، ') || '—'}</span>
                {o && <span className="occ">📅 {o.name} · {gregShort(o.date)}</span>}
                {p.occasionId && !o && <span className="muted">المناسبة خارج هذا الفصل</span>}
              </div>
              {on ? (
                <div className="program-card-actions">
                  <span className="added">✓ تمت الإضافة</span>
                  <div className="stepper" aria-label={`عدد حصص ${p.name}`}>
                    <button type="button" onClick={() => setSessions(p.id, Math.max(1, (item.sessions || n) - 1))} aria-label="إنقاص">−</button>
                    <span>{arNum(item.sessions || n)}</span>
                    <button type="button" onClick={() => setSessions(p.id, Math.min(60, (item.sessions || n) + 1))} aria-label="زيادة">+</button>
                  </div>
                  <button type="button" className="link danger" onClick={() => toggle(p)}>إزالة</button>
                </div>
              ) : (
                <Button size="sm" variant="primary" onClick={() => toggle(p)} disabled={!n}>+ إضافة</Button>
              )}
            </article>
          );
        })}
        {!list.length && <p className="muted">{browsing ? 'ما فيه برامج بهذا التصفية.' : ''}</p>}
      </div>

      {suggest && (
        <SuggestDialog suggest={suggest} catalog={catalog} stage={stage} state={state} onClose={() => setSuggest(null)} onApply={applySuggest} />
      )}
    </div>
  );
}

function SuggestDialog({ suggest, catalog, stage, state, onClose, onApply }) {
  const [chosen, setChosen] = useState(suggest.programs);
  return (
    <Modal title="✨ اقتراح خطة متوازنة" onClose={onClose} footer={
      <>
        <Button variant="primary" onClick={() => onApply(chosen)} disabled={!chosen.length}>إضافة المختار ({arNum(chosen.length)})</Button>
        <Button onClick={onClose}>إلغاء</Button>
      </>
    }>
      {suggest.programs.length ? (
        <ul className="suggest-list">
          {suggest.programs.map((id) => {
            const p = catalog.programById[id];
            const d = catalog.domainById[p.domainId];
            const on = chosen.includes(id);
            return (
              <li key={id}>
                <label className="check">
                  <input type="checkbox" checked={on} onChange={() => setChosen(on ? chosen.filter((x) => x !== id) : [...chosen, id])} />
                  <span><strong>{p.name}</strong> <small className="muted">{d.icon} {d.name} · {sessionsLabel(programSessions(catalog, state.settings, id, stage))}</small></span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : <p className="muted">ما قدرنا نقترح برامج إضافية.</p>}
      <details open>
        <summary>ليش هذا الاقتراح؟</summary>
        <ul className="reasons">{suggest.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      </details>
    </Modal>
  );
}
