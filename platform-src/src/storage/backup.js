// النسخ الاحتياطي والاستعادة + الترحيل من الأداة القديمة («مُعِدّ خطة النشاط الطلابي»).
import { APP_VERSION, SCHEMA_VERSION, migrateState, newPlan, emptyRecord } from '../state/model.js';
import { storage } from './db.js';
import { uid } from '../utils/ids.js';
import { cleanLine, cleanText, cleanInt, safeUrl } from '../utils/sanitize.js';
import { DAY_ORDER } from '../utils/arabic.js';

export const BACKUP_KIND = 'activity-platform-backup';

function blobToDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}
function dataURLToBlob(url) {
  const [head, b64] = url.split(',');
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: mime });
}

export async function createBackup(state, catalog, { includeFiles = true } = {}) {
  const files = {};
  if (includeFiles) {
    for (const e of state.evidence) {
      if (!e.fileKey) continue;
      const blob = await storage.getFile(e.fileKey);
      if (blob) files[e.fileKey] = await blobToDataURL(blob);
    }
  }
  return {
    kind: BACKUP_KIND,
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    academicYear: state.school.academicYear,
    semester: state.school.semester,
    school: state.school,
    settings: state.settings,
    teachers: state.teachers,
    classes: state.classes,
    programs: catalog.programs.map((p) => ({ id: p.id, name: p.name, domainId: p.domainId })),
    plans: state.plans,
    evidence: state.evidence,
    calendar: { id: catalog.calendar.id, label: catalog.calendar.label },
    metadata: {
      plans: state.plans.length,
      teachers: state.teachers.length,
      evidence: state.evidence.length,
      files: Object.keys(files).length,
      createdAt: state.meta?.createdAt,
      updatedAt: state.meta?.updatedAt,
    },
    files,
  };
}

/** يحلل ملف نسخة احتياطية (جديدة أو قديمة) ويرجّع حالة جاهزة للدمج/الاستبدال */
export function parseBackup(json, catalog, currentState) {
  if (!json || typeof json !== 'object') throw new Error('الملف ليس نسخة احتياطية صالحة');
  if (json.kind === BACKUP_KIND) {
    if (typeof json.schemaVersion !== 'number') throw new Error('إصدار النسخة غير معروف');
    if (json.schemaVersion > SCHEMA_VERSION) throw new Error('النسخة من إصدار أحدث من المنصة — حدّث الصفحة ثم حاول مرة ثانية');
    const st = migrateState({
      schemaVersion: json.schemaVersion,
      school: json.school, settings: json.settings, classes: json.classes, teachers: json.teachers,
      plans: json.plans, evidence: json.evidence, meta: { createdAt: json.metadata?.createdAt, updatedAt: Date.now() },
    }, catalog.seed);
    sanitizeState(st);
    return { state: st, files: json.files || {}, source: 'platform', summary: summary(st), migrated: json.schemaVersion < SCHEMA_VERSION };
  }
  if (json.type === 'prim-activity-backup' || Array.isArray(json.plans) && json.plans.some((p) => p.selectedPrograms)) {
    const st = migrateLegacy({ settings: json.settings || {}, plans: json.plans || [] }, catalog, currentState);
    return { state: st.state, files: {}, source: 'legacy', summary: summary(st.state), skipped: st.skipped, migrated: true };
  }
  throw new Error('الملف ليس نسخة احتياطية للمنصة أو للأداة السابقة');
}

function summary(st) {
  return { plans: st.plans.length, teachers: st.teachers.length, classes: st.classes.length, evidence: st.evidence.length };
}

function sanitizeState(st) {
  st.school.name = cleanLine(st.school.name);
  st.school.leaderName = cleanLine(st.school.leaderName);
  st.school.directorName = cleanLine(st.school.directorName);
  st.teachers = st.teachers.filter((t) => t && t.id).map((t) => ({ ...t, name: cleanLine(t.name), subject: cleanLine(t.subject) }));
  st.classes = st.classes.filter((c) => c && c.id);
  st.plans = st.plans.filter((p) => p && p.id).map((p) => ({
    ...p,
    title: cleanLine(p.title),
    days: (p.days || []).filter((d) => DAY_ORDER.includes(d)),
    doubleDays: (p.doubleDays || []).filter((d) => DAY_ORDER.includes(d)),
    records: Object.fromEntries(Object.entries(p.records || {}).map(([k, r]) => [k, {
      ...r, goal: cleanText(r.goal), targetStudents: cleanText(r.targetStudents), tools: cleanText(r.tools), steps: cleanText(r.steps), notes: cleanText(r.notes),
    }])),
  }));
  st.evidence = st.evidence.filter((e) => e && e.id).map((e) => ({ ...e, name: cleanLine(e.name), url: e.url ? safeUrl(e.url) : '' }));
}

/** يدمج حالة مستعادة مع الحالية: العناصر بنفس المعرّف تتحدث، والباقي ينضاف */
export function mergeStates(current, incoming) {
  const byId = (a, b) => { const m = new Map(a.map((x) => [x.id, x])); b.forEach((x) => m.set(x.id, { ...m.get(x.id), ...x })); return [...m.values()]; };
  return {
    ...current,
    school: { ...current.school, ...Object.fromEntries(Object.entries(incoming.school).filter(([, v]) => v)) },
    teachers: byId(current.teachers, incoming.teachers),
    classes: byId(current.classes, incoming.classes),
    plans: byId(current.plans, incoming.plans),
    evidence: byId(current.evidence, incoming.evidence),
    meta: { ...current.meta, updatedAt: Date.now() },
  };
}

export async function restoreFiles(files) {
  for (const [key, url] of Object.entries(files || {})) {
    if (typeof url === 'string' && url.startsWith('data:')) await storage.putFile(key, dataURLToBlob(url));
  }
}

// ===== ترحيل من الأداة القديمة =====
const PATTERNS = { mon: ['mon'], monwed: ['mon', 'wed'], montuewed: ['mon', 'tue', 'wed'] };

export function migrateLegacy({ settings = {}, plans = [] }, catalog, currentState) {
  const st = JSON.parse(JSON.stringify(currentState));
  if (settings.schoolName && !st.school.name) st.school.name = cleanLine(settings.schoolName);
  if (settings.directorName && !st.school.directorName) st.school.directorName = cleanLine(settings.directorName);
  if (settings.leaderName && !st.school.leaderName) st.school.leaderName = cleanLine(settings.leaderName);
  if (settings.patterns) {
    ['low', 'up'].forEach((s) => { if (PATTERNS[settings.patterns[s]]) st.settings.activityDays[s] = [...PATTERNS[settings.patterns[s]]]; });
  }
  const domainByName = Object.fromEntries(catalog.domains.map((d) => [d.name, d.id]));
  const progKey = (domName, progName) => catalog.programs.find((p) => p.domainId === domainByName[domName] && p.name === progName)?.id
    || catalog.programs.find((p) => p.name === progName)?.id || null;
  Object.entries(settings.overrides || {}).forEach(([k, v]) => {
    const [d, n] = k.split('||');
    const id = progKey(d, n);
    if (id && v && typeof v === 'object') st.settings.sessionOverrides[id] = { ...v };
  });

  const teacherByName = (name) => {
    const n = cleanLine(name);
    if (!n) return null;
    let t = st.teachers.find((x) => x.name === n);
    if (!t) { t = { id: uid('t'), name: n, subject: '', weeklyLoad: null, quotaOverride: null }; st.teachers.push(t); }
    return t;
  };
  Object.entries(settings.teacherInfo || {}).forEach(([name, info]) => {
    const t = teacherByName(name);
    if (!t) return;
    if (info?.subject && !t.subject) t.subject = cleanLine(info.subject);
    const cap = cleanInt(info?.cap, { min: 0, max: 500 });
    if (cap != null && t.quotaOverride == null) t.quotaOverride = cap;
  });

  const classByText = (txt) => {
    const s = cleanLine(txt);
    if (!s) return null;
    for (const c of st.classes) {
      const g = catalog.gradeById[c.gradeId];
      if (g && `${g.name} ${c.section}` === s) return c;
    }
    const grade = Object.values(catalog.gradeById).find((g) => s.startsWith(g.name));
    if (!grade) return null;
    const section = s.slice(grade.name.length).trim() || 'أ';
    const c = { id: `${grade.id}-${section}`, gradeId: grade.id, section, homeroomTeacherId: null };
    st.classes.push(c);
    return c;
  };

  let skipped = 0;
  plans.forEach((old) => {
    if (!old || old.manual || !(old.selectedPrograms || []).length) { skipped++; return; }
    const id = `legacy_${String(old.id || uid('x')).replace(/[^\w:-]/g, '')}`;
    if (st.plans.some((p) => p.id === id)) return;
    const cls = classByText(old.grade);
    const teacher = teacherByName(old.teacher);
    if (teacher) {
      if (old.subject && !teacher.subject) teacher.subject = cleanLine(old.subject);
      const cap = cleanInt(old.cap, { min: 0, max: 500 });
      if (cap != null && teacher.quotaOverride == null) teacher.quotaOverride = cap;
    }
    const plan = newPlan(st);
    plan.id = id;
    plan.createdAt = old.savedAt ? Date.parse(old.savedAt) || Date.now() : Date.now();
    plan.classId = cls?.id || null;
    plan.teacherId = teacher?.id || null;
    plan.title = cleanLine(old.actName);
    plan.days = (old.days || []).filter((d) => DAY_ORDER.includes(d));
    plan.doubleDays = (old.doubleDays || []).filter((d) => DAY_ORDER.includes(d));
    const periods = {};
    plan.days.forEach((d) => {
      const v = old.periods && old.periods[d] != null ? old.periods[d] : old.period;
      const n = cleanInt(v, { min: 1, max: 8 });
      if (n) periods[d] = n;
    });
    plan.periods = periods;
    const stage = cls ? catalog.gradeById[cls.gradeId]?.stageId : null;
    plan.programs = [];
    old.selectedPrograms.forEach((sp) => {
      const pid = progKey(sp.domain, sp.name);
      if (!pid || plan.programs.some((x) => x.programId === pid)) return;
      const n = cleanInt(String(sp.sessions || '').match(/[\d٠-٩]+/)?.[0], { min: 1, max: 60 });
      const def = stage ? catalog.programById[pid].sessions[stage] : null;
      plan.programs.push(n && n !== def ? { programId: pid, sessions: n } : { programId: pid });
      plan.records[pid] = {
        ...emptyRecord(),
        goal: cleanText(old.goal), tools: cleanText(old.tools), steps: cleanText(old.steps),
        notes: cleanText([old.notes, old.place ? `المكان: ${old.place}` : ''].filter(Boolean).join('\n')),
      };
    });
    plan.status = 'review';
    plan.wizardStep = 4;
    st.plans.push(plan);
  });
  st.meta.updatedAt = Date.now();
  return { state: st, skipped };
}

/** يقرأ خطط الأداة القديمة المحفوظة في نفس المتصفح (نفس الموقع) */
export function readLegacyLocal() {
  try {
    const plans = [];
    let settings = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('prim-plans:')) { try { plans.push(JSON.parse(localStorage.getItem(k))); } catch { /* تالف */ } }
    }
    try { settings = JSON.parse(localStorage.getItem('prim-activity:settings') || '{}') || {}; } catch { settings = {}; }
    return { plans: plans.filter(Boolean), settings };
  } catch {
    return { plans: [], settings: {} };
  }
}
