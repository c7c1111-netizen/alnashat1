// نموذج البيانات المركزي وإصدار المخطط (schema) والترحيل بين الإصدارات.
import { uid } from '../utils/ids.js';

export const APP_VERSION = '2.0.0';
export const SCHEMA_VERSION = 1;

export const PROGRAM_STATUS = {
  not_started: { label: 'لم يبدأ', icon: '⚪', tone: 'muted' },
  planned: { label: 'مخطط', icon: '🔵', tone: 'info' },
  in_progress: { label: 'جارٍ التنفيذ', icon: '🟡', tone: 'warn' },
  done: { label: 'مكتمل', icon: '🟢', tone: 'ok' },
};

export const PLAN_STATUS = {
  draft: { label: 'مسودة', tone: 'muted' },
  review: { label: 'تحتاج مراجعة', tone: 'warn' },
  approved: { label: 'معتمدة', tone: 'ok' },
};

export function initialState(seed = null, calendarId = '1448-1449') {
  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    school: {
      name: seed?.school?.name || '',
      stageName: seed?.school?.stageName || 'الابتدائية',
      leaderName: '',
      directorName: '',
      academicYear: calendarId,
      semester: 1,
    },
    settings: {
      activityDays: { low: ['mon', 'wed'], up: ['mon', 'wed'] },
      periodsPerDay: 7,
      sessionOverrides: {},
      quotaPolicy: { percent: 10, allowOverride: false },
      exportScope: 'all', // all | approved
      templateName: null, // اسم قالب Word مرفوع بدل الرسمي
      onboarded: false,
    },
    classes: (seed?.classes || []).map((c) => ({ ...c })),
    teachers: (seed?.teachers || []).map((t) => ({ ...t, quotaOverride: null })),
    plans: [],
    evidence: [],
    meta: { createdAt: now, updatedAt: now, appVersion: APP_VERSION },
  };
}

export function newPlan(state) {
  const now = Date.now();
  return {
    id: uid('plan'),
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    wizardStep: 0,
    classId: null,
    teacherId: null,
    academicYear: state.school.academicYear,
    semester: state.school.semester || 1,
    programs: [], // [{programId, sessions?}]
    days: [],
    doubleDays: [],
    periods: {}, // {mon: 3}
    records: {}, // {programId: {goal, targetStudents, tools, steps, notes, status}}
    quotaOverrideConfirmed: false,
    approvedAt: null,
    title: '',
    startDate: null, // بداية التوزيع (null = من بداية الفصل)
  };
}

export function emptyRecord() {
  return { goal: '', targetStudents: '', tools: '', steps: '', notes: '', status: 'not_started' };
}

/** ترحيل أي حالة محفوظة إلى الإصدار الحالي */
export function migrateState(raw, seed) {
  if (!raw || typeof raw !== 'object') return null;
  let s = { ...raw };
  if (!s.schemaVersion) s.schemaVersion = 1;
  // إصدارات لاحقة: if (s.schemaVersion < 2) { ...; s.schemaVersion = 2; }
  const base = initialState(seed, s.school?.academicYear);
  s.school = { ...base.school, ...(s.school || {}) };
  s.settings = { ...base.settings, ...(s.settings || {}), quotaPolicy: { ...base.settings.quotaPolicy, ...(s.settings?.quotaPolicy || {}) } };
  s.classes = Array.isArray(s.classes) ? s.classes : base.classes;
  s.teachers = Array.isArray(s.teachers) ? s.teachers : base.teachers;
  s.plans = Array.isArray(s.plans) ? s.plans.map((p) => ({ ...newPlanShape(), ...p })) : [];
  s.evidence = Array.isArray(s.evidence) ? s.evidence : [];
  s.meta = { ...base.meta, ...(s.meta || {}), appVersion: APP_VERSION };
  s.schemaVersion = SCHEMA_VERSION;
  return s;
}

function newPlanShape() {
  return { programs: [], days: [], doubleDays: [], periods: {}, records: {}, status: 'draft', wizardStep: 0, semester: 1, quotaOverrideConfirmed: false };
}
