// تحميل ملفات البيانات (المجالات، البرامج، المراحل، التقويم، بيانات المدرسة الأولية).
// البيانات منفصلة عن الكود في مجلد data/ وتنحدّث بدون إعادة بناء التطبيق.
import { DAY_ORDER } from '../utils/arabic.js';

const BASE = (typeof document !== 'undefined' && document.baseURI) || '/';

// نسخة الملف الواحد: البيانات مضمّنة داخل الصفحة (window.__EMBED__)
const EMBED = (typeof window !== 'undefined' && window.__EMBED__) || null;

async function getJSON(path) {
  if (EMBED?.json?.[path]) return structuredClone(EMBED.json[path]);
  const res = await fetch(new URL(path, BASE), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`تعذر تحميل ${path}`);
  return res.json();
}

export async function loadCatalog(calendarId) {
  const [domains, programs, stages, calIndex, seed] = await Promise.all([
    getJSON('data/domains.json'),
    getJSON('data/programs.json'),
    getJSON('data/stages.json'),
    getJSON('data/calendars/index.json'),
    getJSON('data/school-seed.json'),
  ]);
  const calEntry = calIndex.calendars.find((c) => c.id === calendarId) || calIndex.calendars.find((c) => c.id === calIndex.default);
  const calendar = await getJSON(`data/${calEntry.file}`);
  return buildCatalog({ domains: domains.domains, programs: programs.programs, stages: stages.stages, schoolTypes: stages.schoolTypes, calendar, calendars: calIndex.calendars, seed });
}

/** يبني كائن الفهرس مع دوال مساعدة — يُستخدم أيضًا في الاختبارات */
const DEFAULT_TYPES = [{ id: 'primary', name: 'الابتدائية', label: 'مدرسة ابتدائية', stages: ['low', 'up'], periodsPerDay: 7 }];

export function buildCatalog({ domains, programs, stages, schoolTypes = DEFAULT_TYPES, calendar, calendars = [], seed = null }) {
  const domainById = Object.fromEntries(domains.map((d) => [d.id, d]));
  const programById = Object.fromEntries(programs.map((p) => [p.id, p]));
  const gradeById = {};
  stages.forEach((s) => s.grades.forEach((g) => { gradeById[g.id] = { ...g, stageId: s.id }; }));
  const stageById = Object.fromEntries(stages.map((s) => [s.id, s]));
  const schoolTypeById = Object.fromEntries(schoolTypes.map((t) => [t.id, t]));
  return {
    domains, programs, stages, schoolTypes, calendar, calendars, seed,
    domainById, programById, gradeById, stageById, schoolTypeById,
  };
}

export function stageOfClass(catalog, cls) {
  return cls ? catalog.gradeById[cls.gradeId]?.stageId || null : null;
}

export function classLabel(catalog, cls, short = false) {
  if (!cls) return '';
  const g = catalog.gradeById[cls.gradeId];
  if (!g) return cls.section || '';
  return `${short ? g.short : g.name} ${cls.section || ''}`.trim();
}

/** عدد حصص البرنامج للمرحلة مع تعديلات الإعدادات؛ null = غير مطروح للمرحلة */
export function programSessions(catalog, settings, programId, stage) {
  const p = catalog.programById[programId];
  if (!p || !stage) return null;
  const ov = settings?.sessionOverrides?.[programId];
  const v = ov && typeof ov[stage] === 'number' ? ov[stage] : p.sessions?.[stage];
  return v > 0 ? v : null;
}

/** كل أيام الفصل (دراسة/إجازة/اختبارات) مسطّحة */
export function semesterDays(catalog, semesterId = 1) {
  const sem = catalog.calendar.semesters.find((s) => s.id === semesterId) || catalog.calendar.semesters[0];
  const out = [];
  sem.weeks.forEach((w, wi) => w.days.forEach((d) => out.push({ ...d, weekIndex: wi, weekLabel: w.label, weekN: w.n })));
  return out;
}

export function semesterOf(catalog, semesterId = 1) {
  return catalog.calendar.semesters.find((s) => s.id === semesterId) || catalog.calendar.semesters[0];
}

export function studyDays(catalog, semesterId = 1) {
  return semesterDays(catalog, semesterId).filter((d) => d.type === 'study');
}

/** عدد أسابيع الدراسة الفعلية (أيام الدراسة ÷ ٥) */
export function instructionalWeeks(catalog, semesterId = 1) {
  return studyDays(catalog, semesterId).length / 5;
}

function isoOf(y, m, d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${y}-${p(m)}-${p(d)}`;
}

/** يحوّل تاريخ ميلادي إلى هجري (أم القرى) عبر Intl إن توفّر */
export function toHijri(iso) {
  try {
    const f = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
    const parts = Object.fromEntries(f.formatToParts(new Date(`${iso}T00:00:00Z`)).map((p) => [p.type, p.value]));
    return { d: parseInt(parts.day, 10), m: parseInt(parts.month, 10), y: parseInt(parts.year, 10) };
  } catch {
    return null;
  }
}

/**
 * المناسبات الواقعة داخل الفصل — التكرار (recurrence) يُحسب لكل عام بدل تاريخ ثابت:
 *  gregorian: {month, day} — hijri: {month, day}
 */
export function resolveOccasions(catalog, semesterId = 1) {
  const sem = semesterOf(catalog, semesterId);
  const start = sem.start, end = sem.end;
  const y0 = parseInt(start.slice(0, 4), 10), y1 = parseInt(end.slice(0, 4), 10);
  const out = [];
  (catalog.calendar.occasions || []).forEach((o) => {
    const r = o.recurrence || {};
    if (r.type === 'gregorian') {
      for (let y = y0; y <= y1; y++) {
        const iso = isoOf(y, r.month, r.day);
        if (iso >= start && iso <= end) out.push({ ...o, date: iso });
      }
    } else if (r.type === 'hijri') {
      // نمشي على أيام الفصل ونطابق الشهر واليوم الهجري
      const d0 = new Date(`${start}T00:00:00Z`), d1 = new Date(`${end}T00:00:00Z`);
      for (let t = d0; t <= d1; t = new Date(t.getTime() + 86400000)) {
        const iso = t.toISOString().slice(0, 10);
        const h = toHijri(iso);
        if (h && h.m === r.month && h.d === r.day) { out.push({ ...o, date: iso }); break; }
      }
    } else if (o.date && o.date >= start && o.date <= end) {
      out.push({ ...o });
    }
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** أيام النشاط الافتراضية: إعداد الصف ← إعداد المرحلة ← افتراضي الصف ← افتراضي المرحلة */
export function defaultActivityDays(catalog, settings, stage, gradeId = null) {
  const g = gradeId ? catalog.gradeById[gradeId] : null;
  const list = (gradeId && settings?.activityDaysByGrade?.[gradeId])
    || settings?.activityDays?.[stage]
    || g?.activityDays
    || catalog.stageById[stage]?.activityDays
    || catalog.calendar.activityDaysDefault?.[stage]
    || ['mon', 'wed'];
  return [...list].filter((d) => DAY_ORDER.includes(d));
}

/** مراحل المدرسة الحالية حسب أنواعها (ابتدائية/متوسطة/ثانوية) */
export function schoolStages(catalog, school) {
  const types = school?.types?.length ? school.types : ['primary'];
  const ids = types.flatMap((t) => catalog.schoolTypeById[t]?.stages || []);
  return catalog.stages.filter((s) => ids.includes(s.id));
}

export function schoolGrades(catalog, school) {
  return schoolStages(catalog, school).flatMap((s) => s.grades.map((g) => ({ ...g, stageId: s.id })));
}

/** اسم المرحلة للعرض في ملف الخطة: «الابتدائية — الصفوف العليا» أو «المتوسطة» */
export function stageDisplayName(catalog, stageId) {
  const st = catalog.stageById[stageId];
  if (!st) return '';
  const t = catalog.schoolTypeById[st.type];
  return t && t.stages.length > 1 ? `${t.name} — ${st.name}` : (t?.name || st.name);
}

export const SECTION_LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح', 'ط', 'ي'];
