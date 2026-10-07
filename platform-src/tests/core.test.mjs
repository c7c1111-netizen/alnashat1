// اختبارات المنطق الأساسي: التوزيع، نسبة ١٠٪، التعارضات، الترحيل، النسخ الاحتياطي
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog, resolveOccasions, studyDays, instructionalWeeks, programSessions } from '../src/services/catalog.js';
import { scheduleAll, schedulePlan, occasionWeek } from '../src/scheduler/schedule.js';
import { calcQuota, computeCalcRows, calcToAssign } from '../src/services/quotaCalc.js';
import { teacherQuota, semesterSubjectSessions } from '../src/services/quota.js';
import { validatePlan, crossPlanIssues, allIssues, summarize } from '../src/validation/conflicts.js';
import { initialState, newPlan, migrateState } from '../src/state/model.js';
import { migrateLegacy, parseBackup, mergeStates } from '../src/storage/backup.js';
import { buildMasterModel } from '../src/export/masterModel.js';
import { assistant } from '../src/services/assistant.js';
import { buildReport, REPORTS } from '../src/services/reports.js';
import { programRows } from '../src/services/insights.js';
import { safeUrl, safeFileName, cleanInt } from '../src/utils/sanitize.js';
import { parseTeacherLines } from '../src/utils/teachers.js';
import { defaultActivityDays, schoolStages, stageDisplayName } from '../src/services/catalog.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const J = (p) => JSON.parse(fs.readFileSync(path.join(root, 'public/data', p), 'utf8'));
const catalog = buildCatalog({
  domains: J('domains.json').domains, programs: J('programs.json').programs, stages: J('stages.json').stages, schoolTypes: J('stages.json').schoolTypes,
  calendar: J('calendars/1448-1449.json'), seed: J('school-seed.json'),
});

function mkState() {
  const st = initialState(catalog.seed, '1448-1449');
  st.teachers = st.teachers.map((t) => ({ ...t, weeklyLoad: 6 }));
  return st;
}
function mkPlan(st, o) {
  const p = { ...newPlan(st), ...o };
  p.createdAt = o.createdAt || Date.now();
  return p;
}
const progId = (name) => catalog.programs.find((p) => p.name === name).id;

test('التقويم: ٨٨ يوم دراسة، والمناسبات تُحسب بالتكرار السنوي داخل الفصل', () => {
  assert.equal(studyDays(catalog).length, 88);
  assert.equal(instructionalWeeks(catalog), 88 / 5);
  const occ = resolveOccasions(catalog);
  const ids = occ.map((o) => o.id);
  assert.ok(ids.includes('teachers-day'));
  assert.equal(occ.find((o) => o.id === 'teachers-day').date, '2026-10-05');
  assert.ok(!ids.includes('founding-day'), 'يوم التأسيس خارج الفصل الأول');
  assert.ok(!studyDays(catalog).some((d) => d.date === '2026-09-23'), 'إجازة اليوم الوطني مستبعدة');
});

test('أعداد الحصص حسب المرحلة مع التعديل من الإعدادات', () => {
  const st = mkState();
  const ai = progId('الذكاء الاصطناعي');
  assert.equal(programSessions(catalog, st.settings, ai, 'low'), 10);
  assert.equal(programSessions(catalog, st.settings, progId('قيمنا حياة'), 'low'), null);
  st.settings.sessionOverrides[ai] = { low: 6 };
  assert.equal(programSessions(catalog, st.settings, ai, 'low'), 6);
});

test('التوزيع: الحصص المزدوجة، الحصة لكل يوم، والمناسبة قرب تاريخها', () => {
  const st = mkState();
  const plan = mkPlan(st, {
    classId: 'g4-أ', teacherId: st.classes.find((c) => c.id === 'g4-أ').homeroomTeacherId,
    days: ['sun', 'mon', 'wed'], doubleDays: ['mon'], periods: { sun: 2, mon: 6, wed: 7 },
    programs: [{ programId: progId('الذكاء الاصطناعي') }, { programId: progId('يوم المعلم العالمي') }],
  });
  st.plans.push(plan);
  const s = schedulePlan(st, catalog, plan);
  const ai = s.programs[0];
  assert.equal(ai.needed, 10);
  assert.equal(ai.filled, 10);
  const mon = ai.slots.find((x) => x.day === 'mon');
  assert.deepEqual(mon.periods, [6, 7], 'الاثنين: السادسة والسابعة');
  assert.deepEqual(ai.slots.find((x) => x.day === 'wed').periods, [7]);
  const td = s.programs[1];
  const near = Math.min(...td.slots.map((x) => Math.abs(new Date(x.date) - new Date('2026-10-05'))));
  assert.ok(near <= 3 * 86400000, 'يوم المعلم قريب من ٥ أكتوبر');
  const dates = s.programs.flatMap((p) => p.slots.map((x) => x.date));
  assert.equal(new Set(dates).size, dates.length, 'ما فيه يوم مكرر لبرنامجين');
});

test('التوزيع الذكي يتجنب تعارض المعلم بين خطتين', () => {
  const st = mkState();
  const t = st.teachers[0].id;
  const a = mkPlan(st, { classId: 'g1-أ', teacherId: t, days: ['mon'], periods: { mon: 3 }, programs: [{ programId: progId('الخط العربي') }], createdAt: 1 });
  const b = mkPlan(st, { classId: 'g1-ب', teacherId: t, days: ['mon'], periods: { mon: 3 }, programs: [{ programId: progId('الحرف والمهن') }], createdAt: 2 });
  st.plans.push(a, b);
  const all = scheduleAll(st, catalog);
  const da = all[a.id].programs[0].slots.map((s) => s.date);
  const db = all[b.id].programs[0].slots.map((s) => s.date);
  assert.equal(da.filter((d) => db.includes(d)).length, 0, 'ما فيه نفس اليوم ونفس الحصة لنفس المعلم');
  assert.ok(crossPlanIssues(st, catalog).some((i) => i.code === 'teacher-clash'), 'ينبه على التعارض المحتمل');
});

test('محرك ١٠٪: الحد = ١٠٪ من حصص المادة في الفصل، ويكشف التجاوز', () => {
  const st = mkState();
  const t = st.teachers[0];
  assert.equal(semesterSubjectSessions(catalog, 6), Math.round(6 * 17.6));
  const q0 = teacherQuota(st, catalog, t.id);
  assert.equal(q0.limit, Math.floor(Math.round(6 * 17.6) * 0.1));
  const plan = mkPlan(st, { classId: 'g4-أ', teacherId: t.id, days: ['sun', 'mon', 'tue', 'wed', 'thu'], periods: { sun: 1, mon: 1, tue: 1, wed: 1, thu: 1 }, programs: [{ programId: progId('الذكاء الاصطناعي') }, { programId: progId('خشبة وحبل') }] });
  st.plans.push(plan);
  const q = teacherQuota(st, catalog, t.id);
  assert.equal(q.used, 22);
  assert.ok(q.exceeded);
  const issues = validatePlan(st, catalog, plan, scheduleAll(st, catalog)[plan.id]);
  assert.ok(issues.some((i) => i.code === 'quota' && i.severity === 'error'));
  st.settings.quotaPolicy.allowOverride = true;
  plan.quotaOverrideConfirmed = true;
  const issues2 = validatePlan(st, catalog, plan, scheduleAll(st, catalog)[plan.id]);
  assert.ok(issues2.some((i) => i.code === 'quota' && i.severity === 'warning'), 'مع الصلاحية يصير تحذير');
});

test('التعارضات: يوم بدون حصة، برنامج خارج المرحلة، نقص الحصص', () => {
  const st = mkState();
  const plan = mkPlan(st, { classId: 'g1-أ', teacherId: st.teachers[0].id, days: ['mon'], periods: {}, programs: [{ programId: progId('قيمنا حياة') }, { programId: progId('الذكاء الاصطناعي') }, { programId: progId('الفنون المسرحية') }, { programId: progId('الفن السابع (السينما)') }] });
  st.plans.push(plan);
  const issues = validatePlan(st, catalog, plan, scheduleAll(st, catalog)[plan.id]);
  const codes = issues.map((i) => i.code);
  assert.ok(codes.includes('period'));
  assert.ok(codes.includes('stage'));
  plan.periods = { mon: 2 };
  plan.programs = plan.programs.slice(1);
  const issues2 = validatePlan(st, catalog, plan, scheduleAll(st, catalog)[plan.id]);
  assert.ok(issues2.some((i) => i.code === 'shortage'), 'يوم واحد ما يكفي ٢٦ حصة');
  assert.equal(summarize(issues2).canApprove, false);
});

test('خطة سليمة بدون أخطاء', () => {
  const st = mkState();
  const plan = mkPlan(st, { classId: 'g5-أ', teacherId: st.teachers[10].id, days: ['mon', 'wed'], periods: { mon: 4, wed: 4 }, programs: [{ programId: progId('التطوع الطلابي') }, { programId: progId('الإسعافات الأولية') }] });
  st.plans.push(plan);
  const sched = scheduleAll(st, catalog);
  const errs = allIssues(st, catalog, sched).filter((i) => i.severity === 'error');
  assert.deepEqual(errs, []);
});

test('ملف الخطة: الجدول الأسبوعي، جدول الإسناد، والبرامج لكل مرحلة', () => {
  const st = mkState();
  const p1 = mkPlan(st, { classId: 'g4-أ', teacherId: st.teachers[6].id, days: ['sun', 'mon'], doubleDays: ['mon'], periods: { sun: 2, mon: 6 }, programs: [{ programId: progId('الذكاء الاصطناعي') }], createdAt: 1 });
  const p2 = mkPlan(st, { classId: 'g1-أ', teacherId: st.teachers[0].id, days: ['wed'], periods: { wed: 7 }, programs: [{ programId: progId('الخط العربي') }], createdAt: 2 });
  st.plans.push(p1, p2);
  const m = buildMasterModel(st, catalog, { schedules: scheduleAll(st, catalog) }, { assignSource: 'plans' });
  assert.equal(m.periods, 7);
  assert.equal(m.assign.length, 2);
  assert.equal(buildMasterModel(st, catalog, { schedules: scheduleAll(st, catalog) }).assign.length, 0, 'الافتراضي: جدول الإسناد فاضي للتعبئة اليدوية');
  assert.ok(m.programsByStage.up.science.some((x) => x.name === 'الذكاء الاصطناعي'));
  assert.ok(m.programsByStage.low.arts.some((x) => x.name === 'الخط العربي'));
  const w1 = m.weeks[0];
  const mon = w1.days.find((d) => d.day === 'mon');
  assert.equal(mon.cells[5][0].program, 'الذكاء الاصطناعي');
  assert.equal(mon.cells[6][0].program, 'الذكاء الاصطناعي');
  const wed = w1.days.find((d) => d.day === 'wed');
  assert.equal(wed.cells[6][0].grade, 'الأول أ');
  assert.equal(m.weeks.length, 20, '١٨ أسبوع + الخريف + الاختبارات');
});

test('الترحيل من الأداة السابقة (حصة لكل يوم، حصة وحدة، جدول يدوي)', () => {
  const st = mkState();
  const legacy = {
    settings: { schoolName: 'ابتدائية الهمذاني', teacherInfo: { 'منصور هيف': { subject: 'لغتي', cap: '16' } }, patterns: { low: 'mon', up: 'monwed' } },
    plans: [
      { id: 'prim-plans:1', grade: 'الرابع الابتدائي أ', teacher: 'منصور هيف', days: ['mon', 'wed'], periods: { mon: 3, wed: 5 }, selectedPrograms: [{ name: 'الذكاء الاصطناعي', sessions: '10 حصص', domain: 'العلوم والتقنية' }], goal: 'هدف', actName: 'نشاط' },
      { id: 'prim-plans:2', grade: 'الأول الابتدائي ب', teacher: 'معلم جديد', days: ['mon'], period: 2, selectedPrograms: [{ name: 'الخط العربي', sessions: '4 حصص', domain: 'الثقافة والفنون' }] },
      { id: 'prim-plans:3', manual: true, selectedPrograms: [] },
    ],
  };
  const { state, skipped } = migrateLegacy(legacy, catalog, st);
  assert.equal(skipped, 1);
  assert.equal(state.school.name, 'ابتدائية الهمذاني');
  assert.deepEqual(state.settings.activityDays.low, ['mon']);
  const a = state.plans.find((p) => p.id === 'legacy_prim-plans:1');
  assert.equal(a.classId, 'g4-أ');
  assert.deepEqual(a.periods, { mon: 3, wed: 5 });
  assert.equal(a.records[progId('الذكاء الاصطناعي')].goal, 'هدف');
  assert.equal(state.teachers.find((t) => t.name === 'منصور هيف').quotaOverride, 16);
  const b = state.plans.find((p) => p.id === 'legacy_prim-plans:2');
  assert.deepEqual(b.periods, { mon: 2 });
  assert.ok(state.teachers.some((t) => t.name === 'معلم جديد'));
  // استيراد مرة ثانية ما يكرر
  const again = migrateLegacy(legacy, catalog, state);
  assert.equal(again.state.plans.length, state.plans.length);
});

test('النسخة الاحتياطية: التحقق من الإصدار والدمج', () => {
  const st = mkState();
  st.plans.push(mkPlan(st, { classId: 'g4-أ', teacherId: st.teachers[0].id }));
  const backup = { kind: 'activity-platform-backup', schemaVersion: 1, appVersion: '2.0.0', school: { ...st.school, name: 'مدرسة <b>' }, settings: st.settings, teachers: st.teachers, classes: st.classes, plans: st.plans, evidence: [{ id: 'e1', planId: st.plans[0].id, kind: 'link', url: 'javascript:alert(1)', name: 'x' }], metadata: {} };
  const parsed = parseBackup(backup, catalog, mkState());
  assert.equal(parsed.summary.plans, 1);
  assert.equal(parsed.state.evidence[0].url, '', 'روابط javascript مرفوضة');
  assert.throws(() => parseBackup({ kind: 'activity-platform-backup', schemaVersion: 99 }, catalog, st));
  assert.throws(() => parseBackup({ foo: 1 }, catalog, st));
  const merged = mergeStates(mkState(), parsed.state);
  assert.equal(merged.plans.length, 1);
  assert.ok(migrateState({ plans: [{ id: 'x' }] }, catalog.seed).plans[0].programs);
});

test('المساعد: اقتراح خطة متوازنة ضمن حد ١٠٪ والقدرة', () => {
  const st = mkState();
  const plan = mkPlan(st, { classId: 'g5-ب', teacherId: st.teachers[11].id, days: ['mon', 'wed'], periods: { mon: 2, wed: 2 } });
  st.plans.push(plan);
  const s = assistant.suggestBalancedPlan(st, catalog, plan);
  assert.ok(s.programs.length >= 2);
  const total = s.programs.reduce((a, id) => a + programSessions(catalog, st.settings, id, 'up'), 0);
  const q = teacherQuota(st, catalog, plan.teacherId);
  assert.ok(total <= q.limit, `المجموع ${total} ضمن الحد ${q.limit}`);
  const domains = new Set(s.programs.map((id) => catalog.programById[id].domainId));
  assert.ok(domains.size >= 2, 'متنوعة المجالات');
  // مع برنامج مختار مسبقًا: الاقتراح يحترم المتبقي فقط
  const pre = mkPlan(st, { classId: 'g4-ب', teacherId: st.teachers[11].id, days: ['mon', 'wed'], periods: { mon: 2, wed: 2 }, programs: [{ programId: progId('الذكاء الاصطناعي') }] });
  const s2 = assistant.suggestBalancedPlan(st, catalog, pre);
  const add2 = s2.programs.reduce((a, id) => a + programSessions(catalog, st.settings, id, 'up'), 0);
  assert.ok(!s2.programs.includes(progId('الذكاء الاصطناعي')));
  assert.ok(add2 + 10 + total <= q.limit + total, `المقترح ${add2} + ١٠ ضمن الحد ${q.limit}`);
  plan.programs = s.programs.map((id) => ({ programId: id }));
  const a = assistant.analyzePlan(st, catalog, plan, scheduleAll(st, catalog)[plan.id], []);
  assert.ok(a.lines.length > 0);
});

test('التقارير تُبنى بدون أخطاء', () => {
  const st = mkState();
  st.plans.push(mkPlan(st, { classId: 'g4-أ', teacherId: st.teachers[0].id, days: ['mon'], periods: { mon: 1 }, programs: [{ programId: progId('الخط العربي') }] }));
  const derived = { schedules: scheduleAll(st, catalog), issues: [] };
  for (const r of REPORTS) {
    const rep = buildReport(r.id, st, catalog, derived, { planId: st.plans[0].id });
    assert.ok(rep.sections.length > 0, r.id);
  }
  assert.equal(programRows(st, catalog, derived).length, 1);
});

test('تنظيف المدخلات', () => {
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('youtube.com/watch?v=1'), 'https://youtube.com/watch?v=1');
  assert.equal(safeFileName('خطة/الرابع:أ?.docx'), 'خطة-الرابع-أ-.docx');
  assert.equal(cleanInt('١٢'), 12);
});

test('المراحل: المتوسط والثانوي بأعداد حصصها وأيام نشاطها', () => {
  const st = initialState(null, '1448-1449', { types: ['middle', 'secondary'] });
  assert.deepEqual(schoolStages(catalog, st.school).map((s) => s.id), ['mid', 'high']);
  assert.equal(programSessions(catalog, st.settings, progId('التطوع الطلابي'), 'mid'), 5);
  assert.equal(programSessions(catalog, st.settings, progId('التطوع الطلابي'), 'high'), 6);
  assert.equal(programSessions(catalog, st.settings, progId('مخيمي التقني'), 'mid'), 10);
  assert.equal(programSessions(catalog, st.settings, progId('مخيمي التقني'), 'high'), null);
  assert.equal(programSessions(catalog, st.settings, progId('خيمتي الجميلة'), 'mid'), null);
  assert.deepEqual(defaultActivityDays(catalog, st.settings, 'mid', 'g8'), ['mon']);
  assert.deepEqual(defaultActivityDays(catalog, st.settings, 'high', 'g10'), ['mon', 'tue', 'wed']);
  assert.deepEqual(defaultActivityDays(catalog, st.settings, 'high', 'g11'), ['mon', 'wed']);
  st.settings.activityDaysByGrade = { g11: ['sun'] };
  assert.deepEqual(defaultActivityDays(catalog, st.settings, 'high', 'g11'), ['sun']);
  assert.equal(stageDisplayName(catalog, 'up'), 'الابتدائية — الصفوف العليا');
  assert.equal(stageDisplayName(catalog, 'high'), 'الثانوية');
});

test('خطة ثانوية: أول ثانوي ٣ أيام، والملف يضم المرحلتين', () => {
  const st = initialState(null, '1448-1449', { types: ['middle', 'secondary'] });
  st.classes = [{ id: 'g10-أ', gradeId: 'g10', section: 'أ' }, { id: 'g8-أ', gradeId: 'g8', section: 'أ' }];
  st.teachers = [{ id: 't1', name: 'معلم', weeklyLoad: 20 }, { id: 't2', name: 'معلم٢', weeklyLoad: 20 }];
  const a = mkPlan(st, { classId: 'g10-أ', teacherId: 't1', periods: { mon: 2, tue: 2, wed: 2 }, programs: [{ programId: progId('سواعد الكشفية') }], createdAt: 1 });
  const b = mkPlan(st, { classId: 'g8-أ', teacherId: 't2', periods: { mon: 5 }, programs: [{ programId: progId('الملاحة على اليابس') }], createdAt: 2 });
  st.plans.push(a, b);
  const sched = scheduleAll(st, catalog);
  assert.deepEqual(sched[a.id].days, ['mon', 'tue', 'wed']);
  assert.deepEqual(sched[b.id].days, ['mon']);
  assert.equal(sched[a.id].programs[0].needed, 6);
  const errs = allIssues(st, catalog, sched).filter((i) => i.severity === 'error');
  assert.deepEqual(errs, []);
  const m = buildMasterModel(st, catalog, { schedules: sched }, { assignSource: 'plans' });
  assert.deepEqual(m.stagesUsed, ['mid', 'high']);
  assert.equal(m.assign.length, 2);
});

test('إضافة المعلمين دفعة وحدة من نص ملصوق', () => {
  const list = parseTeacherLines('محمد أحمد - رياضيات - 18\nسعيد علي، لغتي\nخالد\tعلوم\t٢٠\n\n  ');
  assert.equal(list.length, 3);
  assert.deepEqual(list[0], { name: 'محمد أحمد', subject: 'رياضيات', weeklyLoad: 18 });
  assert.equal(list[1].subject, 'لغتي');
  assert.equal(list[2].weeklyLoad, 20);
});

test('برامج المناسبات: كل الحصص في أسبوع المناسبة، حصة في كل يوم، والحصة يختارها المعلم', () => {
  const st = mkState();
  const occ = resolveOccasions(catalog, 1).find((o) => o.name === 'يوم المعلم العالمي');
  const week = occasionWeek(catalog, occ, 1);
  assert.ok(week.length >= 4 && week.every((d) => d.type === 'study'));
  assert.ok(week.some((d) => d.date === occ.date));
  const prog = catalog.programs.find((p) => p.occasionId === occ.id);
  const plan = mkPlan(st, { classId: 'g4-أ', teacherId: st.teachers[2].id, days: ['mon'], periods: { mon: 3 }, programs: [{ programId: prog.id, sessions: 4 }] });
  st.plans.push(plan);
  let s = schedulePlan(st, catalog, plan).programs[0];
  assert.equal(s.filled, 4);
  assert.equal(s.slots.length, 4, 'حصة في كل يوم');
  assert.ok(s.slots.every((x) => week.some((d) => d.date === x.date)), 'كلها في نفس الأسبوع');
  assert.ok(s.slots.every((x) => x.periods.length === 1 && x.periods[0] === 3), 'الاقتراح: نفس حصة المعلم');
  assert.ok(s.slots.some((x) => x.day !== 'mon'), 'يشمل أيام غير أيام النشاط');
  // اختيار المعلم
  plan.occasionSlots = { [prog.id]: { [week[0].date]: [1], [week[1].date]: [5], [week[2].date]: [2, 4] } };
  s = schedulePlan(st, catalog, plan).programs[0];
  assert.equal(s.filled, 4);
  assert.deepEqual(s.slots.map((x) => x.periods), [[1], [5], [2, 4]]);
  // ناقص حصة → تنبيه
  plan.occasionSlots = { [prog.id]: { [week[0].date]: [1] } };
  const sched = scheduleAll(st, catalog);
  const errs = validatePlan(st, catalog, plan, sched[plan.id]).filter((i) => i.severity === 'error');
  assert.ok(errs.some((e) => e.message.includes('أسبوع المناسبة')));
  // الجدول الأسبوعي يستقبلها
  plan.occasionSlots = {};
  const m = buildMasterModel(st, catalog, { schedules: scheduleAll(st, catalog) });
  const cells = m.weeks.flatMap((w) => w.days).filter((d) => d.cells[2].some((e) => e.program === prog.name));
  assert.equal(cells.length, 4);
});

test('حاسبة ١٠٪: المتاح والمتبقي التراكمي لكل معلم', () => {
  assert.deepEqual(calcQuota(24, 17.6, 10), { total: 422, cap: 42 });
  assert.deepEqual(calcQuota('', 17.6, 10), { total: null, cap: null });
  const rows = computeCalcRows([
    { id: 'a', teacher: 'سعيد', subject: 'علوم', load: 24, program: 'س', n: 10 },
    { id: 'b', teacher: 'سعيد', program: 'ص', n: 12 },
    { id: 'c', teacher: 'خالد', load: 12, program: 'ع', n: 30 },
  ], 17.6, 10);
  assert.equal(rows[0].remaining, 32);
  assert.equal(rows[1].subject, 'علوم');
  assert.equal(rows[1].cap, 42);
  assert.equal(rows[1].remaining, 20);
  assert.equal(rows[2].cap, 21);
  assert.equal(rows[2].remaining, -9);
  const a = calcToAssign([{ id: 'x', teacher: '', program: '' }, { id: 'y', teacher: 'سعيد', load: 24, program: 'س', grade: 'الرابع أ', n: 4 }], 17.6, 10);
  assert.equal(a.length, 1);
  assert.equal(a[0].remaining, 38);
});
