// تعبئة قالب Word الرسمي («خطة برامج النشاط الطلابي») مباشرة داخل ملف الوورد نفسه.
// القالب ملف منفصل (templates/official-plan.docx) ويمكن استبداله من الإعدادات بدون تعديل الكود:
// المحرك يتعرّف على الجداول من عناوينها (البرنامج/الصف/اسم المعلم، جدول اسناد، المرحلة).
import JSZip from 'jszip';
import { arNum } from '../utils/arabic.js';
import { cleanText } from '../utils/sanitize.js';

const WNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XMLNS_XML = 'http://www.w3.org/XML/1998/namespace';

const kids = (el, name) => [...el.childNodes].filter((n) => n.nodeType === 1 && n.namespaceURI === WNS && n.localName === name);
const all = (el, name) => [...el.getElementsByTagNameNS(WNS, name)];
const text = (el) => all(el, 't').map((t) => t.textContent).join('').trim();
function el(doc, name, attrs) {
  const e = doc.createElementNS(WNS, `w:${name}`);
  if (attrs) Object.keys(attrs).forEach((k) => e.setAttributeNS(WNS, `w:${k}`, attrs[k]));
  return e;
}
const attr = (e, name) => e?.getAttributeNS(WNS, name) || e?.getAttribute(`w:${name}`) || null;

// ترتيب العناصر حسب مواصفات Word (مهم عشان Word ما يعتبر الملف تالف)
const RPR = ['rStyle','rFonts','b','bCs','i','iCs','caps','smallCaps','strike','dstrike','outline','shadow','emboss','imprint','noProof','snapToGrid','vanish','webHidden','color','spacing','w','kern','position','sz','szCs','highlight','u','effect','bdr','shd','fitText','vertAlign','rtl','cs','em','lang','eastAsianLayout','specVanish','oMath'];
const PPR = ['pStyle','keepNext','keepLines','pageBreakBefore','framePr','widowControl','numPr','suppressLineNumbers','pBdr','shd','tabs','suppressAutoHyphens','kinsoku','wordWrap','overflowPunct','topLinePunct','autoSpaceDE','autoSpaceDN','bidi','adjustRightInd','snapToGrid','spacing','ind','contextualSpacing','mirrorIndents','suppressOverlap','jc','textDirection','textAlignment','textboxTightWrap','outlineLvl','divId','cnfStyle','rPr','sectPr','pPrChange'];
function orderedSet(parent, order, name, attrs) {
  kids(parent, name).forEach((x) => x.remove());
  const e = el(parent.ownerDocument, name, attrs);
  const idx = order.indexOf(name);
  const after = [...parent.childNodes].find((n) => n.nodeType === 1 && order.indexOf(n.localName) > idx);
  parent.insertBefore(e, after || null);
}

let SEQ = 90000;
function scrubIds(node) {
  [node, ...node.getElementsByTagName('*')].forEach((n) => {
    if (!n.attributes) return;
    [...n.attributes].forEach((a) => { if (a.localName === 'paraId' || a.localName === 'textId') n.removeAttributeNode(a); });
    if (n.localName === 'docPr' || (n.localName === 'cNvPr' && n.hasAttribute('id'))) n.setAttribute('id', String(++SEQ));
  });
}

/** يكتب نصًا في خانة جدول مع الحفاظ على تنسيقها */
export function setCellText(tc, value, o = {}) {
  const doc = tc.ownerDocument;
  const ps = kids(tc, 'p');
  let p = ps[0];
  if (!p) { p = el(doc, 'p'); tc.appendChild(p); }
  ps.slice(1).forEach((x) => x.remove());
  let pPr = kids(p, 'pPr')[0];
  let base;
  const firstR = all(p, 'r').find((r) => kids(r, 'rPr').length);
  if (firstR) base = kids(firstR, 'rPr')[0].cloneNode(true);
  else if (pPr && kids(pPr, 'rPr').length) base = kids(pPr, 'rPr')[0].cloneNode(true);
  else base = el(doc, 'rPr');
  ['ins', 'del', 'moveFrom', 'moveTo', 'rPrChange'].forEach((n) => kids(base, n).forEach((x) => x.remove()));
  [...p.childNodes].forEach((n) => { if (n !== pPr) n.remove(); });
  if (!pPr) { pPr = el(doc, 'pPr'); p.insertBefore(pPr, p.firstChild); }
  kids(pPr, 'ind').forEach((x) => x.remove());
  orderedSet(pPr, PPR, 'bidi');
  orderedSet(pPr, PPR, 'spacing', { before: '0', after: '0', line: '240', lineRule: 'auto' });
  orderedSet(pPr, PPR, 'jc', { val: 'center' });
  if (o.sz) { orderedSet(base, RPR, 'sz', { val: String(o.sz) }); orderedSet(base, RPR, 'szCs', { val: String(o.sz) }); }
  if (o.b) { orderedSet(base, RPR, 'b'); orderedSet(base, RPR, 'bCs'); }
  if (!o.keepScale) kids(base, 'w').forEach((x) => x.remove());
  kids(base, 'rFonts').forEach((x) => { if (!o.keepFont) x.remove(); });
  orderedSet(base, RPR, 'rtl');
  cleanText(value ?? '', 4000).split('\n').forEach((line, i) => {
    const r = el(doc, 'r');
    r.appendChild(base.cloneNode(true));
    if (i) r.appendChild(el(doc, 'br'));
    const t = el(doc, 't');
    t.setAttributeNS(XMLNS_XML, 'xml:space', 'preserve');
    t.textContent = line;
    r.appendChild(t);
    p.appendChild(r);
  });
}

function cloneEmptyRow(tr) {
  const c = tr.cloneNode(true);
  scrubIds(c);
  kids(c, 'tc').forEach((tc) => { if (text(tc)) setCellText(tc, ''); });
  return c;
}

const toLatin = (s) => String(s).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const LABELS = ['البرنامج', 'الصف', 'اسم المعلم'];

/** تقسيم رأس «السادسة» (اللي تحته خانتين) إلى «السادسة» و«السابعة» */
function addSeventhPeriodHeader(doc) {
  all(doc, 'tbl').forEach((tbl) => {
    const rows = kids(tbl, 'tr');
    const hi = rows.findIndex((r) => { const c = kids(r, 'tc'); return c.length === 7 && text(c[0]) === 'السادسة'; });
    if (hi < 0) return;
    const dataRow = rows.slice(hi + 1).find((r) => kids(r, 'tc').length === 9);
    if (!dataRow) return;
    const dc = kids(dataRow, 'tc');
    const spanOf = (tc) => parseInt(attr(tc.getElementsByTagNameNS(WNS, 'gridSpan')[0], 'val'), 10) || 1;
    const widthOf = (tc) => attr(tc.getElementsByTagNameNS(WNS, 'tcW')[0], 'w');
    const h6 = kids(rows[hi], 'tc')[0];
    const h7 = h6.cloneNode(true);
    scrubIds(h7);
    const setGeom = (tc, span, w) => {
      const pr = kids(tc, 'tcPr')[0];
      if (!pr) return;
      kids(pr, 'gridSpan').forEach((x) => x.remove());
      const tcW = kids(pr, 'tcW')[0];
      if (tcW && w) tcW.setAttributeNS(WNS, 'w:w', w);
      if (span > 1) pr.insertBefore(el(doc, 'gridSpan', { val: String(span) }), tcW ? tcW.nextSibling : pr.firstChild);
    };
    setGeom(h7, spanOf(dc[0]), widthOf(dc[0]));
    setGeom(h6, spanOf(dc[1]), widthOf(dc[1]));
    const sz = parseInt(attr(h6.getElementsByTagNameNS(WNS, 'sz')[0], 'val'), 10) || null;
    setCellText(h7, 'السابعة', { sz, keepScale: true });
    setCellText(h6, 'السادسة', { sz, keepScale: true });
    h6.parentNode.insertBefore(h7, h6);
  });
}

const PERIOD_NAMES = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة'];
const OCCASIONS_HEAD = /الأيام\s*والمناسبات/;

/** مواقع الخانات على شبكة الجدول (عشان نطابق خانات البيانات مع رأس الحصص مهما اختلف الدمج) */
function gridCols(tr) {
  const gb = tr.getElementsByTagNameNS(WNS, 'gridBefore')[0];
  let g = parseInt(attr(gb, 'val'), 10) || 0;
  return kids(tr, 'tc').map((tc) => {
    const pr = kids(tc, 'tcPr')[0];
    const span = parseInt(attr(pr && kids(pr, 'gridSpan')[0], 'val'), 10) || 1;
    const c = { tc, start: g, span };
    g += span;
    return c;
  });
}

/** من صف الرأس: لكل حصة (وعمود المناسبات) رقم الخانة المقابلة في صفوف البيانات */
function headerMap(headCols, dataCols) {
  const map = { periods: {}, occasions: -1 };
  headCols.forEach((h) => {
    const name = text(h.tc).replace(/\s+/g, ' ');
    const under = dataCols.map((d, i) => (d.start >= h.start && d.start < h.start + h.span ? i : -1)).filter((i) => i >= 0);
    if (!under.length) return;
    const pi = PERIOD_NAMES.indexOf(name);
    if (pi >= 0) map.periods[pi] = under[under.length - 1];
    else if (OCCASIONS_HEAD.test(name)) map.occasions = under[under.length - 1];
  });
  return map;
}

const isPeriodHeader = (tr) => kids(tr, 'tc').some((c) => text(c) === 'الأولى');

function fillWeeks(doc, model) {
  const byHijri = {};
  model.weeks.forEach((w) => w.days.forEach((d) => { byHijri[`${d.hijri.d}/${d.hijri.m}`] = d; }));
  let current = null;
  let head = null; // آخر صف رأس للحصص
  let map = null;
  const report = { missingPeriods: new Set() };
  all(doc, 'tr').forEach((tr) => {
    if (isPeriodHeader(tr)) { head = gridCols(tr); map = null; return; }
    const cells = kids(tr, 'tc');
    const li = cells.findIndex((c) => LABELS.includes(text(c)));
    if (li < 1 || li !== cells.length - 2) return;
    const labelIdx = LABELS.indexOf(text(cells[li]));
    const dayCell = cells[li + 1];
    const dayTxt = text(dayCell);
    if (dayTxt) {
      all(dayCell, 't').forEach((t) => { t.textContent = t.textContent.replace(/١٤٤٧/g, '١٤٤٨').replace(/1447/g, '1448'); });
      const m = toLatin(dayTxt).match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
      current = m ? byHijri[`${parseInt(m[1], 10)}/${parseInt(m[2], 10)}`] || null : null;
    }
    if (!map) {
      // بدون رأس معروف: الطريقة القديمة (الحصة الأولى قبل خانة التسمية مباشرة)
      map = head ? headerMap(head, gridCols(tr)) : { periods: Object.fromEntries(Array.from({ length: li }, (_, i) => [i, li - 1 - i])), occasions: -1 };
    }
    if (!current) return;
    // عمود «الأيام والمناسبات»: اسم المناسبة في صف البرنامج
    if (labelIdx === 0 && map.occasions >= 0 && current.occasions?.length) {
      setCellText(cells[map.occasions], current.occasions.join('\n'), { sz: current.occasions.length > 1 ? 14 : 16, b: true });
    }
    if (current.type !== 'study') return;
    const key = ['program', 'grade', 'teacher'][labelIdx];
    current.cells.forEach((list, pi) => {
      if (!list.length) return;
      const ci = map.periods[pi];
      if (ci == null) { report.missingPeriods.add(pi + 1); return; }
      setCellText(cells[ci], list.map((e) => e[key]).join('\n'), { sz: list.length > 1 ? 14 : 16, b: labelIdx === 0 });
    });
  });
  return { missingPeriods: [...report.missingPeriods].sort() };
}

function fillAssign(doc, model) {
  const tbl = all(doc, 'tbl').find((t) => { const r = kids(t, 'tr')[0]; return r && text(r).includes('جدول اسناد'); });
  if (!tbl) return;
  const rows = kids(tbl, 'tr').filter((r, i) => i >= 2 && kids(r, 'tc').length === 7);
  if (!rows.length) return;
  while (rows.length < model.assign.length) {
    const last = rows[rows.length - 1];
    const c = cloneEmptyRow(last);
    last.parentNode.insertBefore(c, last.nextSibling);
    rows.push(c);
  }
  model.assign.forEach((a, i) => {
    const c = kids(rows[i], 'tc');
    const vals = [a.remaining != null ? arNum(a.remaining) : '', a.startH, arNum(a.n), `${a.program} (${a.grade})`, a.cap != null ? arNum(a.cap) : '', a.subject, a.teacher];
    vals.forEach((v, j) => setCellText(c[j], v, { sz: 18, b: j === 6 || j === 3 }));
  });
}

// ترتيب المجالات في جدول البرامج بالقالب (خانة اسم البرنامج؛ عدد الحصص قبلها)
const DOMAIN_NAME_CELL = { citizenship: 11, arts: 9, sports: 7, science: 5, scouts: 3, occasions: 1 };
const isProgramsTable = (t) => { const r = kids(t, 'tr')[0]; return r && /ﻟﻤﺮﺣﻠﺔ|المرحلة/.test(text(r)) && kids(t, 'tr').length > 5; };

function fillProgramsTable(tbl, byDomain, stageLabel) {
  const rows = kids(tbl, 'tr');
  if (stageLabel) setCellText(kids(rows[0], 'tc')[0], `المرحلة: ${stageLabel}`, { b: true, keepFont: true, keepScale: true });
  const data = rows.filter((r, i) => i >= 2 && kids(r, 'tc').length === 13);
  const need = Math.max(0, ...Object.keys(DOMAIN_NAME_CELL).map((d) => (byDomain[d] || []).length));
  while (data.length < need) {
    const last = data[data.length - 1];
    const c = cloneEmptyRow(last);
    last.parentNode.insertBefore(c, last.nextSibling);
    data.push(c);
  }
  Object.entries(DOMAIN_NAME_CELL).forEach(([d, ni]) => {
    (byDomain[d] || []).forEach((p, i) => {
      const c = kids(data[i], 'tc');
      setCellText(c[ni], p.name, { sz: 17 });
      setCellText(c[ni - 1], arNum(p.n), { sz: 17, b: true });
    });
  });
}

function fillPrograms(doc, model, stageLabels) {
  const tbl = all(doc, 'tbl').find(isProgramsTable);
  if (!tbl) return;
  const stages = model.stagesUsed || [];
  if (stages.length < 2) {
    const st = stages[0];
    fillProgramsTable(tbl, st ? model.programsByStage[st] : {}, st ? stageLabels[st] : '');
    return;
  }
  // أكثر من مرحلة: نكرّر صفحة البرامج (نفس القسم بالضبط) لكل مرحلة إضافية
  const body = all(doc, 'body')[0];
  const list = [...body.childNodes].filter((n) => n.nodeType === 1);
  let top = tbl; while (top.parentNode !== body) top = top.parentNode;
  const idx = list.indexOf(top);
  const isSect = (e) => e.localName === 'p' && e.getElementsByTagNameNS(WNS, 'sectPr').length;
  let s = idx; while (s > 0 && !isSect(list[s - 1])) s--;
  let e = idx; while (e < list.length - 1 && !isSect(list[e])) e++;
  const original = list.slice(s, e + 1);
  let ref = list[e].nextSibling;
  stages.slice(1).forEach((st) => {
    const copy = original.map((n) => { const c = n.cloneNode(true); scrubIds(c); return c; });
    copy.forEach((n) => body.insertBefore(n, ref));
    const copyTbl = copy.flatMap((n) => (n.localName === 'tbl' ? [n] : all(n, 'tbl'))).find(isProgramsTable);
    if (copyTbl) fillProgramsTable(copyTbl, model.programsByStage[st], stageLabels[st]);
  });
  fillProgramsTable(tbl, model.programsByStage[stages[0]], stageLabels[stages[0]]);
}

/** الغلاف: اسم المدرسة، والمرحلة، ومدير المدرسة، ورائد النشاط، والعام — إذا كانت معبّأة في الإعدادات */
function fillCover(doc, model, opts = {}) {
  const school = model.school || {};
  const setPara = (p, value) => {
    const ts = all(p, 't');
    if (!ts.length) return;
    ts[0].textContent = value;
    ts[0].setAttributeNS(XMLNS_XML, 'xml:space', 'preserve');
    ts.slice(1).forEach((t) => { t.textContent = ''; });
  };
  const runText = (p) => kids(p, 'r').map((r) => text(r)).join('').trim();
  const body = all(doc, 'body')[0];
  const paras = [...body.childNodes].filter((n) => n.nodeType === 1).slice(0, 40).filter((n) => n.localName === 'p');
  const name = cleanText(school.name || '', 120).trim();
  let schoolDone = false;
  paras.forEach((p) => {
    const t = runText(p);
    // القالب الجديد: «المدرسة ......» و«(المرحلة الدراسية ......)»
    if (/^المدرسة\s*[.…]{3,}/.test(t)) { if (name) setPara(p, `المدرسة: ${name}`); schoolDone = true; }
    else if (/^\(?\s*المرحلة الدراسية\s*[.…]{3,}\s*\)?$/.test(t) && opts.schoolTypeLabel) setPara(p, `(المرحلة الدراسية: ${opts.schoolTypeLabel})`);
    // العام الميلادي (مثل 2026 – 2025)
    else if (model.gregorianLabel && /^\d{4}\s*[–-]\s*\d{4}$/.test(t)) setPara(p, model.gregorianLabel);
  });
  // القالب القديم: اسم المدرسة في الفقرة اللي بعد «الإدارة العامة للتعليم…»
  if (!schoolDone && name) {
    const ai = paras.findIndex((p) => runText(p).includes('الإدارة العامة للتعليم'));
    if (ai >= 0 && paras[ai + 1] && kids(paras[ai + 1], 'r').some((r) => text(r))) setPara(paras[ai + 1], name);
  }
  // المدير ورائد النشاط داخل مربعات النص (اللي ما له اسم يبقى خطه المنقّط)
  const director = cleanText(school.directorName || '', 80).trim();
  const leader = cleanText(school.leaderName || '', 80).trim();
  all(doc, 'txbxContent').forEach((tb) => {
    const ps = kids(tb, 'p');
    const head = ps[0] ? text(ps[0]).replace(/\s+/g, ' ') : '';
    if (/^مدير(\/ة)? المدرسة$/.test(head) && director && ps[1]) setPara(ps[1], director);
    if (/^رائد(\/ة)? النشاط الطلابي$/.test(head) && leader && ps[1]) setPara(ps[1], leader);
  });
}

/** يرجّع Blob لملف Word معبّأ */
export async function fillOfficialTemplate(templateBytes, model, { stageLabels, schoolTypeLabel = '' }) {
  const zip = await JSZip.loadAsync(templateBytes);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('ملف القالب لا يحتوي على مستند Word صالح');
  const xml = await file.async('string');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('تعذر قراءة القالب');
  if (model.periods >= 7) addSeventhPeriodHeader(doc);
  const weeksReport = fillWeeks(doc, model);
  fillAssign(doc, model);
  fillPrograms(doc, model, stageLabels);
  fillCover(doc, model, { schoolTypeLabel });
  let out = new XMLSerializer().serializeToString(doc);
  if (!/^<\?xml/.test(out)) out = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n${out}`;
  zip.file('word/document.xml', out);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  blob.report = weeksReport;
  return blob;
}

/** تحقق سريع إن الملف المرفوع قالب مناسب */
export async function inspectTemplate(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) return { ok: false, reason: 'ليس ملف Word (.docx) صالحًا' };
  const weekRows = (xml.match(/اسم المعلم/g) || []).length;
  const assign = xml.includes('جدول اسناد');
  return { ok: weekRows > 5 || assign, weekRows, assign };
}
