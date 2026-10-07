// عرض «ملف خطة برامج النشاط الطلابي» بصفحات A4 أفقية — للمعاينة وللطباعة PDF
import React from 'react';
import { arNum, hijriShort, DAY_NAMES, PERIOD_NAMES } from '../utils/arabic.js';

const GOAL = 'بناء شخصية وقدرات الطلاب بما يسهم في تعزيز قيمهم واستكشاف ميولهم واهتماماتهم وتطوير مهارات جديدة وإبراز إبداعاتهم وابتكاراتهم ليكونوا على مستوى عالٍ من المهارة والمسؤولية معتزين بقيمهم السعودية منافسين محليًا وعالميًا';
const OFFICIAL = ['citizenship', 'arts', 'sports', 'science', 'scouts', 'occasions'];

function Head({ model, calendarLabel }) {
  return (
    <>
      <div className="op-top">
        <div className="op-ministry">المملكة العربية السعودية<br />وزارة التعليم<br />الإدارة العامة للتعليم بمنطقة عسير<br />قسم النشاط الطلابي</div>
        <div className="op-school">{model.school.name}</div>
      </div>
      <div className="op-row"><div className="op-title">خطة برامج النشاط الطلابي للفصل الدراسي الأول</div><div className="op-year">العام الدراسي {calendarLabel}</div></div>
      <div className="op-row"><div className="op-k">الهدف العام</div><div className="op-v">{GOAL}</div></div>
      <div className="op-row"><div className="op-k">مجالات الأنشطة الطلابية</div><div className="op-doms">
        {OFFICIAL.map((id) => { const d = model.domains.find((x) => x.id === id); return <span key={id} style={{ background: d.color }}>{d.name}</span>; })}
      </div></div>
    </>
  );
}

const Page = ({ children, model, calendarLabel, head = true }) => (
  <section className="op-page">{head && <Head model={model} calendarLabel={calendarLabel} />}<div className="op-body">{children}</div></section>
);

export default function OfficialPrintView({ model, calendarLabel, stageLabels }) {
  const stages = model.stagesUsed || [];
  const doms = model.domains.filter((d) => OFFICIAL.includes(d.id) || stages.some((s) => model.programsByStage[s][d.id]?.length));
  const assignPages = [];
  for (let i = 0; i < Math.max(1, model.assign.length); i += 14) assignPages.push(model.assign.slice(i, i + 14));
  const P = model.periods;
  return (
    <div className="op-doc" dir="rtl">
      <section className="op-page">
        <div className="op-cover">
          <div className="op-cover-min">المملكة العربية السعودية<br />وزارة التعليم<br />الإدارة العامة للتعليم بمنطقة عسير<br />{model.school.name || 'المدرسة ....................'}<br />(المرحلة الدراسية: {model.school.stageName})</div>
          <div className="op-cover-big">خطة برامج النشاط الطلابي</div>
          <div className="op-cover-term">الفصل الدراسي الأول</div>
          <div className="op-cover-sig">
            <div>رائد النشاط الطلابي<br />{model.school.leaderName || '....................'}</div>
            <div>مدير المدرسة<br />{model.school.directorName || '....................'}</div>
          </div>
          <div className="op-cover-yr">العام الدراسي {calendarLabel}</div>
        </div>
      </section>
      <Page model={model} calendarLabel={calendarLabel}>
        <div className="op-h2">مجالات النشاط الطلابي</div>
        <table className="op-goals"><tbody>
          {OFFICIAL.map((id) => { const d = model.domains.find((x) => x.id === id); return <tr key={id}><td style={{ background: d.color }}>{d.name}</td><td>{d.goal}</td></tr>; })}
        </tbody></table>
      </Page>
      {(stages.length ? stages : [null]).map((st) => {
        const lists = doms.map((d) => (st ? model.programsByStage[st][d.id] : null) || []);
        const n = Math.max(8, ...lists.map((l) => l.length));
        return (
          <Page key={st || 'none'} model={model} calendarLabel={calendarLabel}>
            <div className="op-h2">برامج النشاط الطلابي</div>
            <table className="op-tbl"><tbody>
              <tr><th colSpan={doms.length * 2 + 1} className="op-stage">المرحلة: {st ? stageLabels[st] : model.school.stageName}</th></tr>
              <tr><th>المجال</th>{doms.map((d) => <React.Fragment key={d.id}><th style={{ background: d.color, color: '#fff' }}>{d.name}</th><th className="op-cnt small">عدد الحصص</th></React.Fragment>)}</tr>
              {Array.from({ length: n }, (_, i) => (
                <tr key={i}>
                  {i === 0 && <td rowSpan={n} className="op-hdr">البرنامج</td>}
                  {lists.map((l, j) => <React.Fragment key={j}><td>{l[i]?.name || ''}</td><td className="op-cnt">{l[i] ? arNum(l[i].n) : ''}</td></React.Fragment>)}
                </tr>
              ))}
            </tbody></table>
          </Page>
        );
      })}
      {assignPages.map((rows, pi) => (
        <Page key={`a${pi}`} model={model} calendarLabel={calendarLabel}>
          <div className="op-h2 wide">جدول إسناد برامج النشاط للمعلمين بعد احتساب الـ ١٠٪ من حصص المواد{assignPages.length > 1 ? ` (${arNum(pi + 1)})` : ''}</div>
          <table className="op-tbl"><thead><tr>
            <th>اسم المعلم</th><th>مادة التدريس</th><th>الحصص المتاحة من ١٠٪</th><th>اسم البرنامج المسند</th><th>حصص البرنامج</th><th>تاريخ بداية التنفيذ</th><th>المتبقي بعد التنفيذ</th>
          </tr></thead><tbody>
            {rows.map((a, i) => <tr key={i}><td>{a.teacher}</td><td>{a.subject}</td><td>{a.cap != null ? arNum(a.cap) : ''}</td><td>{a.program} ({a.grade})</td><td className="op-cnt">{arNum(a.n)}</td><td>{a.startH}</td><td>{a.remaining != null ? arNum(a.remaining) : ''}</td></tr>)}
            {pi === assignPages.length - 1 && Array.from({ length: Math.max(0, 12 - rows.length) }, (_, i) => <tr key={`e${i}`}>{Array.from({ length: 7 }, (_, j) => <td key={j}>&nbsp;</td>)}</tr>)}
          </tbody></table>
        </Page>
      ))}
      {model.weeks.map((w, wi) => (
        <Page key={`w${wi}`} model={model} calendarLabel={calendarLabel}>
          <div className="op-weekhead"><span className="k">الأسبوع</span><span className="n">{w.n ? arNum(w.label) : '—'}</span><span className="bar" /></div>
          <table className="op-tbl op-week"><tbody>
            <tr><th colSpan={P + 4} className="op-hdr">الحصص الدراسية</th></tr>
            <tr><th colSpan={2}>اليوم / الصف</th>{PERIOD_NAMES.slice(0, P).map((p) => <th key={p}>{p}</th>)}<th>الأيام والمناسبات</th><th>المسابقات</th></tr>
            {w.days.map((d, di) => ['البرنامج', 'الصف', 'اسم المعلم'].map((lbl, ri) => (
              <tr key={`${di}${ri}`}>
                {ri === 0 && <td rowSpan={3} className="op-day">{DAY_NAMES[d.day]}<br />{hijriShort(d.hijri)}</td>}
                <td className="op-lbl">{lbl}</td>
                {w.type !== 'study' ? (di === 0 && ri === 0 ? <td colSpan={P + 2} rowSpan={w.days.length * 3} className={`op-banner ${w.type}`}>{w.name}</td> : null)
                  : d.type !== 'study' ? (ri === 0 ? <td colSpan={P + 2} rowSpan={3} className="op-banner holiday">{d.note}</td> : null)
                    : <>
                      {d.cells.map((c, ci) => <td key={ci}>{c.map((e, k) => <div key={k}>{e[['program', 'grade', 'teacher'][ri]]}</div>)}</td>)}
                      {ri === 0 && <td rowSpan={3} className="op-occ">{(d.occasions || []).map((o) => <div key={o}>{o}</div>)}</td>}
                      {ri === 0 && <td rowSpan={3} />}
                    </>}
              </tr>
            )))}
          </tbody></table>
        </Page>
      ))}
    </div>
  );
}
