/* منشئ خطة النشاط الطلابي — واجهة المستخدم */
"use strict";

const S = { meta: null, plan: null, derived: null, step: "school", teacherId: null, programId: null,
            week: 0, saveTimer: null, saving: false, unplaced: [] };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس"];

// ---------------------------------------------------------------- أدوات
async function api(method, url, body, isForm) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    if (isForm) opt.body = body;
    else { opt.body = JSON.stringify(body); opt.headers["Content-Type"] = "application/json"; }
  }
  const r = await fetch(url, opt);
  const ct = r.headers.get("Content-Type") || "";
  const data = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok) { const e = new Error((data && data.error) || "حدث خطأ غير متوقع"); e.data = data; throw e; }
  return data;
}
function toast(msg, err) {
  const t = $("#toast"); t.textContent = msg; t.className = "toast" + (err ? " err" : ""); t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), err ? 6000 : 2800);
}
function modal(html) { $("#modalBody").innerHTML = html; $("#modal").hidden = false; return $("#modalBody"); }
function closeModal() { $("#modal").hidden = true; }
function getPath(o, p) { return p.split(".").reduce((a, k) => (a == null ? a : a[k]), o); }
function setPath(o, p, v) { const ks = p.split("."); const last = ks.pop(); ks.reduce((a, k) => (a[k] ??= {}), o)[last] = v; }
function uid(prefix) { return prefix + "_" + Math.random().toString(16).slice(2, 10); }
function teacherById(id) { return S.plan.teachers.find((t) => t.id === id); }
function programById(id) { return S.plan.programs.find((p) => p.id === id); }
function domainClass(d) { const i = S.meta.domains.indexOf(d); return i >= 0 ? "d" + i : ""; }
function slotLabel(k) { return S.meta.slots[k] || k || ""; }
function hdate(s) { return s ? s + "هـ" : ""; }

// ---------------------------------------------------------------- التخزين في المتصفح
// الخادم عديم الحالة: كل الخطط محفوظة في هذا المتصفح، وتُرسل الخطة مع كل طلب.
const Store = (() => {
  const KEY = "activity-plans:v1", LAST = "activity-plans:last";
  let mem = {}, ok = true;
  try { const t = "__t"; localStorage.setItem(t, "1"); localStorage.removeItem(t); } catch (e) { ok = false; }
  const read = () => { if (!ok) return mem; try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } };
  const write = (all) => {
    if (!ok) { mem = all; return true; }
    try { localStorage.setItem(KEY, JSON.stringify(all)); return true; }
    catch (e) { toast("تعذر الحفظ في المتصفح (المساحة ممتلئة؟). نزّل نسخة احتياطية من خطوة التصدير.", true); return false; }
  };
  return {
    persistent: ok,
    list() {
      return Object.values(read()).map((p) => ({ id: p.id, name: p.name, school: p.school?.name || "", updated: p.updated || "" }))
        .sort((a, b) => (b.updated > a.updated ? 1 : -1));
    },
    get(id) { return read()[id]; },
    save(plan) { const all = read(); plan.updated = new Date().toISOString().slice(0, 19); all[plan.id] = plan; return write(all); },
    remove(id) { const all = read(); delete all[id]; write(all); },
    last(id) { try { if (id) localStorage.setItem(LAST, id); return localStorage.getItem(LAST); } catch (e) { return null; } },
  };
})();

// ---------------------------------------------------------------- الحفظ
function markDirty(reschedule) {
  $("#saveState").textContent = "جارٍ الحفظ…";
  Store.save(S.plan);
  clearTimeout(S.saveTimer);
  S.pendingReschedule = S.pendingReschedule || reschedule;
  S.saveTimer = setTimeout(() => { const r = S.pendingReschedule; S.pendingReschedule = false; save(r); }, 600);
}
async function save(reschedule) {
  try {
    if (reschedule) {
      const res = await api("POST", "/api/autoschedule", { plan: S.plan });
      S.plan.schedule = res.plan.schedule; S.derived = res.derived; S.unplaced = res.unplaced || [];
    } else {
      S.derived = (await api("POST", "/api/derive", { plan: S.plan })).derived;
    }
    Store.save(S.plan);
    $("#saveState").textContent = Store.persistent ? "✓ محفوظ في هذا المتصفح" : "⚠ غير محفوظ (التخزين معطل)";
    renderDerived();
  } catch (e) { $("#saveState").textContent = "تعذر التحديث"; toast(e.message, true); }
}
function setPlan(res) {
  S.plan = res.plan; S.derived = res.derived; S.unplaced = res.unplaced || [];
  S.teacherId = null; S.programId = null; S.week = 0;
  Store.save(S.plan); Store.last(S.plan.id);
  bindInputs(); renderAll(); loadPlanList();
}

// ---------------------------------------------------------------- الخطط
function loadPlanList() {
  const list = Store.list();
  const sel = $("#planSelect");
  sel.innerHTML = list.map((p) => `<option value="${p.id}">${esc(p.name)}${p.school ? " — " + esc(p.school) : ""}</option>`).join("");
  if (S.plan) sel.value = S.plan.id;
  return list;
}
async function openPlan(id) {
  const plan = Store.get(id); if (!plan) return;
  const res = await api("POST", "/api/derive", { plan });
  setPlan({ plan, derived: res.derived });
}
function newPlanDialog() {
  const b = modal(`<h2>خطة جديدة</h2><div class="form">
    <label>اسم الخطة<input id="npName" value="خطة ${new Date().getFullYear()}"></label>
    <label class="check"><input type="radio" name="npKind" value="template" checked> البدء ببرامج الاصطفاف والصلاة الموجودة في القالب الأصلي</label>
    <label class="check"><input type="radio" name="npKind" value="empty"> خطة فارغة</label>
    <label class="check"><input type="radio" name="npKind" value="demo"> الخطة التجريبية (مجمع أبو بكر الصديق — بيانات تجريبية)</label>
    <button id="npGo">إنشاء</button></div>`);
  $("#npGo", b).onclick = async () => {
    const kind = $("input[name=npKind]:checked", b).value;
    const body = { from_template: kind === "template", demo: kind === "demo" };
    if (kind !== "demo") body.name = $("#npName").value;
    try { const res = await api("POST", "/api/plans/new", body); closeModal(); setPlan(res); goStep("school"); }
    catch (e) { toast(e.message, true); }
  };
}

// ---------------------------------------------------------------- الربط
function bindInputs() {
  $$("[data-bind]").forEach((el) => {
    const p = el.dataset.bind; const v = getPath(S.plan, p);
    if (el.type === "checkbox") el.checked = !!v; else el.value = v ?? "";
    el.oninput = el.onchange = () => {
      let val = el.type === "checkbox" ? el.checked : el.value;
      if (el.type === "number" || p === "school.semester") val = val === "" ? "" : Number(val);
      setPath(S.plan, p, val);
      if (p === "calendar.week1_start") checkWeek1();
      if (p.startsWith("school") || p.startsWith("officials") || p === "name") renderWhere();
      markDirty(p === "calendar.week1_start" || p === "settings.prevent_conflicts");
    };
  });
  checkWeek1();
}
async function checkWeek1() {
  const v = S.plan.calendar.week1_start; const el = $("#week1Info");
  try { const r = await api("GET", "/api/hijri?d=" + encodeURIComponent(v));
    el.textContent = r.long + (r.weekday === 0 ? " ✓" : " — يجب أن يكون يوم أحد"); el.style.color = r.weekday === 0 ? "" : "#C00000";
  } catch (e) { el.textContent = e.message; el.style.color = "#C00000"; }
}

// ---------------------------------------------------------------- الخطوات
function goStep(step) {
  S.step = step;
  $$("nav.steps button").forEach((b) => b.classList.toggle("active", b.dataset.step === step));
  $$(".step").forEach((s) => s.classList.toggle("active", s.dataset.step === step));
  renderStep(step);
}
function renderAll() { renderWhere(); renderStep(S.step); renderNavBadges(); }
function renderDerived() {
  renderNavBadges();
  if (S.step === "teachers") { renderTeachersTable(); renderTeacherDerived(); }
  else if (S.step === "programs") { renderProgramsTable(); renderProgramTeacherInfo(); }
  else if (["schedule", "review", "export"].includes(S.step)) renderStep(S.step);
}
function renderStep(step) {
  ({ school: renderWhere, officials: renderWhere, teachers: renderTeachers, programs: renderPrograms,
     schedule: renderSchedule, review: renderReview, export: renderExport })[step]?.();
}
function renderNavBadges() {
  const errs = S.derived?.validation?.errors || [];
  const map = { school: /المدرسة|المرحلة|المنطقة|الأسبوع الأول/, officials: /مدير|رائد/, teachers: /المعلم|معلم/,
                programs: /البرنامج|برنامج/, schedule: /تضارب|محجوب|مجدول/ };
  $$("nav.steps button").forEach((b) => { const rx = map[b.dataset.step]; b.classList.toggle("bad", !!rx && errs.some((e) => rx.test(e))); });
}

// ---------------------------------------------------------------- 1 و 2: المعاينة النصية للمواضع
function renderWhere() {
  if (!S.meta || !S.plan) return;
  const s = S.plan.school, o = S.plan.officials, st = S.meta.stages[s.stage] || {};
  const school = (s.name || "").trim();
  const line = school ? (s.prefix_stage && !school.startsWith(st.adj) ? `${st.adj} ${school}` : school) : `${st.adj || ""}…………………`;
  const sem = S.meta.semesters[s.semester] || "";
  $("#schoolPreview").innerHTML = `
    <li>الغلاف والترويسة: الإدارة العامة للتعليم بمنطقة <b>${esc(s.region || "……")}</b></li>
    <li>الغلاف: <b>${esc(line)}</b></li>
    <li>جدول برامج النشاط: المرحلة <b>${esc(st.table || "")}</b></li>
    <li>الغلاف وكل الصفحات: العام الدراسي <b>${esc(s.year_start)} – ${esc(s.year_end)} هـ</b></li>
    <li>الغلاف وكل الصفحات: الفصل الدراسي <b>${esc(sem)}</b> — ومربع «الفصل» في الغلاف: <b>${esc(s.semester)}</b></li>`;
  $("#officialsPreview").innerHTML = `
    <li>الغلاف — رائد النشاط الطلابي: <b>${esc(o.leader || "……")}</b></li>
    <li>الغلاف — مدير المدرسة: <b>${esc(o.manager || "……")}</b></li>`;
}

// ---------------------------------------------------------------- 3: المعلمون
function teacherDerived(id) { return (S.derived?.teachers || []).find((t) => t.id === id) || { allowed: 0, used: 0, remaining: 0, rows: [] }; }
function renderTeachers() { renderTeachersTable(); renderTeacherPanel(); }
function renderTeachersTable() {
  const rows = S.plan.teachers.map((t) => {
    const d = teacherDerived(t.id);
    return `<tr data-id="${t.id}" class="${t.id === S.teacherId ? "sel" : ""}">
      <td>${esc(t.name) || "<i class=hint>بدون اسم</i>"}</td><td>${esc(t.subject)}</td>
      <td class=num>${esc(t.subject_periods)}</td><td class=num>${d.allowed}</td><td class=num>${d.used}</td>
      <td class="num ${d.remaining < 0 ? "neg" : ""}">${d.remaining}</td>
      <td>${d.rows.map((r) => esc(r.program)).join("، ")}</td></tr>`;
  }).join("");
  $("#teachersTable").innerHTML = `<tr><th>اسم المعلم</th><th>المادة</th><th>حصص المادة</th><th>المتاح (10%)</th><th>المسند</th><th>المتبقي</th><th>البرامج المسندة</th></tr>` +
    (rows || `<tr><td colspan=7 class=hint>لا يوجد معلمون بعد. أضف معلمًا.</td></tr>`);
  $$("#teachersTable tr[data-id]").forEach((tr) => (tr.onclick = () => { S.teacherId = tr.dataset.id; renderTeachers(); }));
}
function renderTeacherPanel() {
  const t = teacherById(S.teacherId); const box = $("#teacherPanel");
  if (!t) { box.innerHTML = `<p class="hint">اختر معلمًا لعرض بياناته: المادة، عدد حصصها، نسبة 10%، الحصص المتاحة، والبرامج المسندة إليه.</p>`; return; }
  const stages = Object.entries(S.meta.stages).map(([k, v]) => `<option value="${k}" ${t.stage === k ? "selected" : ""}>${v.label}</option>`).join("");
  box.innerHTML = `<div class="form">
    <label>اسم المعلم<input data-f="name" value="${esc(t.name)}"></label>
    <label>مادة التدريس<input data-f="subject" value="${esc(t.subject)}"></label>
    <div class="row"><label>المرحلة<select data-f="stage"><option value=""></option>${stages}</select></label>
    <label>عدد حصص المادة<input data-f="subject_periods" type="number" min="0" value="${esc(t.subject_periods)}"></label></div>
    <label>الصفوف التي يدرسها<input data-f="grades" value="${esc(t.grades)}"></label>
    <label>ملاحظات<input data-f="notes" value="${esc(t.notes)}"></label></div>
    <div id="tDerived"></div>
    <p><button class="ghost danger small" id="delTeacher">حذف المعلم</button></p>`;
  renderTeacherDerived();
  bindTeacherPanel(t, box);
}
function renderTeacherDerived() {
  const t = teacherById(S.teacherId); const box = $("#tDerived"); if (!t || !box) return;
  const d = teacherDerived(t.id);
  box.innerHTML = `<dl class="kv"><dt>نسبة 10%</dt><dd>${esc(t.subject_periods || 0)} × 10% = ${d.allowed} حصص</dd>
    <dt>المسند</dt><dd>${d.used} حصص</dd><dt>المتبقي</dt><dd class="${d.remaining < 0 ? "neg" : ""}">${d.remaining} حصص</dd></dl>
    <h3>البرامج المسندة</h3>
    ${d.rows.length ? `<table class="data"><tr><th>البرنامج</th><th>الحصص</th><th>البداية</th><th>المتبقي</th></tr>${d.rows.map((r) =>
      `<tr><td>${esc(r.program)}</td><td class=num>${r.sessions}${r.counts ? "" : " *"}</td><td>${esc(r.start)}</td><td class="num ${r.remaining < 0 ? "neg" : ""}">${r.remaining}</td></tr>`).join("")}</table>
      <p class=hint>* لا تُحتسب من نسبة 10% (برنامج يومي).</p>` : `<p class=hint>لا توجد برامج مسندة. أسند البرامج من خطوة «البرامج».</p>`}`;
}
function bindTeacherPanel(t, box) {
  $$("[data-f]", box).forEach((el) => (el.oninput = () => {
    t[el.dataset.f] = el.type === "number" ? (el.value === "" ? "" : Number(el.value)) : el.value;
    const tr = $(`#teachersTable tr[data-id="${t.id}"]`); if (tr) tr.children[0].textContent = t.name;
    markDirty(false);
  }));
  $("#delTeacher", box).onclick = () => {
    const n = S.plan.programs.filter((p) => p.teacher_id === t.id).length;
    if (!confirm(`حذف المعلم «${t.name}»؟` + (n ? `\nسيُلغى إسناد ${n} برامج له.` : ""))) return;
    S.plan.teachers = S.plan.teachers.filter((x) => x.id !== t.id);
    S.plan.programs.forEach((p) => { if (p.teacher_id === t.id) p.teacher_id = ""; });
    S.plan.schedule.forEach((e) => { if (e.teacher_id === t.id) e.teacher_id = ""; });
    S.teacherId = null; renderTeachers(); markDirty(true);
  };
}

// ---------------------------------------------------------------- 4: البرامج
function scheduledCount(pid) { return S.plan.schedule.filter((e) => e.program_id === pid).length; }
function renderPrograms() { renderProgramsTable(); renderProgramPanel(); }
function renderProgramsTable() {
  const f = $("#programFilter");
  if (f.options.length <= 1) f.innerHTML += S.meta.domains.map((d) => `<option>${esc(d)}</option>`).join("");
  f.onchange = renderPrograms;
  const list = S.plan.programs.filter((p) => !f.value || p.domain === f.value);
  const rows = list.map((p) => {
    const t = teacherById(p.teacher_id); const n = scheduledCount(p.id);
    const need = p.mode === "daily" ? "يومي" : (p.sessions || 0);
    return `<tr data-id="${p.id}" class="${p.id === S.programId ? "sel" : ""}">
      <td>${esc(p.name) || "<i class=hint>بدون اسم</i>"}</td><td><span class="pill ${domainClass(p.domain)}">${esc(p.domain || "-")}</span></td>
      <td>${esc(t?.name || "")}</td><td class=num>${need}</td><td>${hdate(p.start)}</td><td>${hdate(p.end)}</td>
      <td>${esc(slotLabel(p.slot))}</td><td class="num ${p.mode !== "daily" && n < (p.sessions || 0) ? "neg" : ""}">${n}</td></tr>`;
  }).join("");
  $("#programsTable").innerHTML = `<tr><th>البرنامج</th><th>المجال</th><th>المعلم</th><th>الحصص</th><th>البداية</th><th>النهاية</th><th>الحصة</th><th>الموزَّع</th></tr>` +
    (rows || `<tr><td colspan=8 class=hint>لا توجد برامج. أضف برنامجًا أو استورد ملفًا.</td></tr>`);
  $$("#programsTable tr[data-id]").forEach((tr) => (tr.onclick = () => { S.programId = tr.dataset.id; renderPrograms(); }));
}
function renderProgramTeacherInfo() {
  const p = programById(S.programId); const el = $("#pTeacherInfo"); if (!p || !el) return;
  const td = teacherDerived(p.teacher_id);
  el.innerHTML = p.teacher_id ? `المتاح ${td.allowed} — المسند ${td.used} — المتبقي <b class="${td.remaining < 0 ? "neg" : ""}">${td.remaining}</b>` : "";
}
function renderProgramPanel() {
  const p = programById(S.programId); const box = $("#programPanel");
  if (!p) { box.innerHTML = `<p class="hint">اختر برنامجًا لعرض بياناته وتعديلها، أو أضف برنامجًا جديدًا.</p>`; return; }
  const doms = S.meta.domains.map((d) => `<option ${p.domain === d ? "selected" : ""}>${esc(d)}</option>`).join("");
  const tchs = S.plan.teachers.map((t) => `<option value="${t.id}" ${p.teacher_id === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("");
  const slots = S.meta.slot_order.map((k) => [k, S.meta.slots[k]]).map(([k, v]) => `<option value="${k}" ${p.slot === k ? "selected" : ""}>${esc(v)}</option>`).join("");
  const wd = p.weekdays || [0, 1, 2, 3, 4];
  box.innerHTML = `<div class="form">
    <label>اسم البرنامج<input data-f="name" value="${esc(p.name)}"></label>
    <div class="row"><label>مجال النشاط<select data-f="domain"><option value=""></option>${doms}</select></label>
    <label>النوع<select data-f="mode"><option value="sessions" ${p.mode !== "daily" ? "selected" : ""}>حصص دراسية</option>
      <option value="daily" ${p.mode === "daily" ? "selected" : ""}>برنامج يومي (اصطفاف/صلاة…)</option></select></label></div>
    <label>المعلم المسؤول<select data-f="teacher_id"><option value="">—</option>${tchs}</select>
      <small class="hint" id="pTeacherInfo"></small></label>
    <div class="row"><label>عدد الحصص<input data-f="sessions" type="number" min="0" value="${esc(p.sessions)}"></label>
    <label>الحصة / الفترة<select data-f="slot"><option value="">أول حصة متاحة</option>${slots}</select></label></div>
    <div class="row"><label>تاريخ البداية (هجري)<input data-f="start" placeholder="10/3/1448" value="${esc(p.start)}"></label>
    <label>تاريخ النهاية (هجري)<input data-f="end" placeholder="اختياري" value="${esc(p.end)}"></label></div>
    <div class="row"><label>الصفوف المستهدفة<input data-f="grades" value="${esc(p.grades)}"></label>
    <label>الحد الأقصى أسبوعيًا<input data-f="per_week" type="number" min="1" value="${esc(p.per_week || 1)}"></label></div>
    <div class="weekdays">أيام التنفيذ: ${DAYS.map((d, i) => `<label><input type="checkbox" data-wd="${i}" ${wd.includes(i) ? "checked" : ""}>${d}</label>`).join("")}</div>
    <label>الهدف<textarea data-f="goal">${esc(p.goal)}</textarea></label>
    <label>وصف مختصر<textarea data-f="description">${esc(p.description)}</textarea></label>
    <div class="row"><label>الفئة المستهدفة<input data-f="target" value="${esc(p.target)}"></label>
    <label>وقت التنفيذ<input data-f="time" value="${esc(p.time)}"></label></div>
    <label>ملاحظات<textarea data-f="notes">${esc(p.notes)}</textarea></label>
    ${p.source ? `<p class="hint">المصدر: ${esc(p.source)}</p>` : ""}
    <p><button class="ghost danger small" id="delProgram">حذف البرنامج</button></p></div>`;
  renderProgramTeacherInfo();
  $$("[data-f]", box).forEach((el) => (el.onchange = el.oninput = (ev) => {
    const k = el.dataset.f;
    p[k] = el.type === "number" ? (el.value === "" ? "" : Number(el.value)) : el.value;
    if (ev.type === "change" && k === "mode") renderProgramPanel();
    const tr = $(`#programsTable tr[data-id="${p.id}"]`); if (tr && k === "name") tr.children[0].textContent = p.name;
    markDirty(true);
  }));
  $$("[data-wd]", box).forEach((el) => (el.onchange = () => {
    p.weekdays = $$("[data-wd]", box).filter((x) => x.checked).map((x) => Number(x.dataset.wd)); markDirty(true);
  }));
  $("#delProgram", box).onclick = () => {
    if (!confirm(`حذف البرنامج «${p.name}» وكل خاناته في الجدول؟`)) return;
    S.plan.programs = S.plan.programs.filter((x) => x.id !== p.id);
    S.plan.schedule = S.plan.schedule.filter((e) => e.program_id !== p.id);
    S.programId = null; renderPrograms(); markDirty(true);
  };
}
function addProgram(data) {
  const p = Object.assign({ id: uid("prg"), name: "", domain: "", mode: "sessions", sessions: "", teacher_id: "",
    slot: "", grades: "", start: "", end: "", goal: "", description: "", target: "", time: "", notes: "",
    weekdays: [0, 1, 2, 3, 4], per_week: 1, date_required: true, source: "" }, data || {});
  S.plan.programs.push(p); return p;
}
function libraryDialog() {
  const lib = S.meta.library;
  const html = Object.entries(lib.domains).map(([d, items]) => `<div class="grp">${esc(d)}</div>` + items.map((it, i) =>
    `<label><input type="checkbox" data-d="${esc(d)}" data-i="${i}"> ${esc(it.name)} <span class="hint">(أولية: ${it.low} — عليا: ${it.up})</span></label>`).join("")).join("");
  const b = modal(`<h2>مكتبة البرامج</h2><p class="hint">${esc(lib.source)}<br>${esc(lib.note)}</p>
    <label>عدد الحصص المعتمد<select id="libCol"><option value="up">الصفوف العليا</option><option value="low">الصفوف الأولية</option><option value="">أُدخله لاحقًا</option></select></label>
    <div class="lib-list">${html}</div><p><button id="libAdd">إضافة المحدد</button></p>`);
  $("#libAdd", b).onclick = () => {
    const col = $("#libCol").value; let n = 0;
    $$("input[data-d]:checked", b).forEach((c) => {
      const it = lib.domains[c.dataset.d][Number(c.dataset.i)];
      const daily = !S.meta.template_domains.includes(c.dataset.d);
      addProgram({ name: it.name, domain: c.dataset.d, sessions: col ? it[col] || "" : "", mode: daily ? "daily" : "sessions",
                   slot: daily ? "morning" : "", source: "مكتبة البرامج" }); n++;
    });
    closeModal(); renderPrograms(); markDirty(true); toast(`أضيف ${n} برنامجًا — أكمل المعلم والتاريخ لكل برنامج.`);
  };
}
async function importFile(file) {
  const fd = new FormData(); fd.append("file", file); fd.append("plan", JSON.stringify(S.plan));
  let res;
  try { res = await api("POST", "/api/import", fd, true); } catch (e) { toast(e.message, true); return; }
  const lv = { error: "err", conflict: "err", warning: "warn", info: "info" };
  const names = { error: "خطأ", conflict: "تعارض", warning: "تنبيه", info: "معلومة" };
  const issues = res.issues.map((i) => `<div class="msg ${lv[i.level]}"><b>${names[i.level]}</b> — ${esc(i.where)}: ${esc(i.msg)}</div>`).join("");
  const rows = res.programs.map((p) => `<tr><td><input type="checkbox" data-id="${p.id}" ${p.name ? "checked" : "disabled"}></td>
    <td>${esc(p.name)}</td><td>${esc(p.domain)}</td><td class=num>${esc(p.sessions)}</td><td>${hdate(p.start)}</td><td>${hdate(p.end)}</td>
    <td>${esc(teacherById(p.teacher_id)?.name || p.teacher_name_new || "")}</td><td>${esc(slotLabel(p.slot))}</td></tr>`).join("");
  const hasConf = res.issues.some((i) => i.level === "conflict" || i.level === "error");
  const b = modal(`<h2>استيراد البرامج من «${esc(res.source)}»</h2>
    <p class="hint">الملف المرفوع هو المرجع: تُنقل أسماء البرامج والتواريخ كما هي دون أي تعديل. راجع التعارضات قبل التطبيق.</p>
    ${hasConf ? `<div class="msg err">يوجد تعارضات أو أخطاء — راجعها أدناه قبل إنشاء الخطة.</div>` : `<div class="msg ok">لا توجد تعارضات.</div>`}
    ${issues}
    <h3>البرامج المقروءة (${res.programs.length})</h3>
    <div class="table-wrap"><table class="data"><tr><th></th><th>البرنامج</th><th>المجال</th><th>الحصص</th><th>البداية</th><th>النهاية</th><th>المعلم</th><th>الحصة</th></tr>${rows}</table></div>
    <div class="toolbar"><label class="check"><input type="radio" name="imode" value="merge" checked> دمج مع برامج الخطة (تحديث المتشابه بالاسم)</label>
    <label class="check"><input type="radio" name="imode" value="replace"> استبدال كل برامج الخطة</label></div>
    <button id="impApply">تطبيق الاستيراد</button> <button class="ghost" id="impCancel">إلغاء</button>`);
  $("#impCancel", b).onclick = closeModal;
  $("#impApply", b).onclick = async () => {
    const selected = new Set($$("input[data-id]:checked", b).map((x) => x.dataset.id));
    const programs = res.programs.filter((p) => selected.has(p.id));
    const mode = $("input[name=imode]:checked", b).value;
    try { const r = await api("POST", "/api/import/apply", { plan: S.plan, programs, mode });
      closeModal(); setPlan(r); goStep("programs"); toast(`تم استيراد ${programs.length} برنامجًا وتوزيعها.`);
    } catch (e) { toast(e.message, true); }
  };
}

// ---------------------------------------------------------------- 5: الجدولة
function renderSchedule() {
  const st = S.meta.structure;
  $("#weekTabs").innerHTML = st.weeks.map((w, i) => {
    const blocked = w.days.every((d) => d.blocked);
    return `<button data-w="${i}" class="${i === S.week ? "active" : ""} ${blocked ? "blocked" : ""}">الأسبوع ${esc(w.label)}</button>`;
  }).join("");
  $$("#weekTabs button").forEach((b) => (b.onclick = () => { S.week = Number(b.dataset.w); renderSchedule(); }));
  $("#unplaced").innerHTML = S.unplaced.length ? `<div class="msg warn"><b>برامج لم تُوزع بالكامل:</b><ul>${S.unplaced.map((u) => `<li>${esc(u.program)}: ${esc(u.reason)}</li>`).join("")}</ul></div>` : "";
  const w = st.weeks[S.week]; const slotKeys = S.meta.slot_order;
  const cal = (S.derived.calendar || []).filter((d) => d.week === S.week);
  let html = `<tr><th class="head">اليوم / الحصة</th>${slotKeys.map((k) => `<th class="head">${esc(S.meta.slots[k])}</th>`).join("")}</tr>`;
  w.days.forEach((d) => {
    const c = cal.find((x) => x.day === d.day); const date = c ? hdate(c.date) : "";
    html += `<tr><td class="day">${d.name}<br>${date}</td>`;
    if (d.blocked) { html += `<td class="blocked" colspan="${slotKeys.length}">محجوب في القالب (إجازة / اختبارات)</td></tr>`; return; }
    slotKeys.forEach((k) => {
      if (!d.slots.includes(k)) { html += `<td class="blocked"></td>`; return; }
      const e = S.plan.schedule.find((x) => x.week === S.week && x.day === d.day && x.slot === k);
      const p = e && programById(e.program_id); const t = e && teacherById(e.teacher_id);
      html += `<td class="slot ${e?.manual ? "manual" : ""}" data-day="${d.day}" data-slot="${k}">${e ? `<div class="p">${esc(p?.name || e.text || "")}</div>
        <div class="g">${esc(e.grade || "")}</div><div class="t">${esc(t?.name || "")}</div>` : ""}</td>`;
    });
    html += `</tr>`;
  });
  $("#weekGrid").innerHTML = html;
  $$("#weekGrid td.slot").forEach((td) => (td.onclick = () => cellDialog(S.week, Number(td.dataset.day), td.dataset.slot)));
}
function cellDialog(week, day, slot) {
  const e = S.plan.schedule.find((x) => x.week === week && x.day === day && x.slot === slot);
  const opts = S.plan.programs.filter((p) => p.name).map((p) => `<option value="${p.id}" ${e?.program_id === p.id ? "selected" : ""}>${esc(p.name)} — ${esc(p.domain || "")}</option>`).join("");
  const tchs = S.plan.teachers.map((t) => `<option value="${t.id}" ${e?.teacher_id === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("");
  const c = (S.derived.calendar || []).find((x) => x.week === week && x.day === day);
  const b = modal(`<h2>${DAYS[day]} ${c ? hdate(c.date) : ""} — ${esc(slotLabel(slot))}</h2><div class="form">
    <label>البرنامج<select id="cProg"><option value="">— خانة فارغة —</option>${opts}</select></label>
    <label>الصف<input id="cGrade" value="${esc(e?.grade || "")}"></label>
    <label>اسم المعلم<select id="cTeacher"><option value="">—</option>${tchs}</select></label>
    <p class="hint">عند اختيار البرنامج يُحضر النظام الصف والمعلم من بيانات البرنامج تلقائيًا.</p>
    <div class="toolbar"><button id="cSave">حفظ</button><button class="ghost" id="cClear">تفريغ الخانة</button></div></div>`);
  $("#cProg", b).onchange = () => {
    const p = programById($("#cProg").value);
    if (p) { $("#cGrade").value = p.grades || "جميع الصفوف"; $("#cTeacher").value = p.teacher_id || ""; }
  };
  const put = (entry) => {
    S.plan.schedule = S.plan.schedule.filter((x) => !(x.week === week && x.day === day && x.slot === slot));
    if (entry) S.plan.schedule.push(entry);
    closeModal(); renderSchedule(); markDirty(false);
  };
  $("#cSave", b).onclick = () => {
    const pid = $("#cProg").value; if (!pid) return put(null);
    put({ week, day, slot, program_id: pid, grade: $("#cGrade").value, teacher_id: $("#cTeacher").value,
          manual: true, ord: c?.ord, date: c?.date });
  };
  $("#cClear", b).onclick = () => put(null);
}

// ---------------------------------------------------------------- 6: المراجعة
function renderReview() {
  const v = S.derived.validation;
  $("#validation").innerHTML = (v.errors.length ? `<div class="msg err"><b>أخطاء يجب تصحيحها قبل التصدير (${v.errors.length}):</b><ul>${v.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>`
    : `<div class="msg ok">✓ لا توجد أخطاء — الخطة جاهزة للتصدير.</div>`) +
    (v.warnings.length ? `<div class="msg warn"><b>تنبيهات (${v.warnings.length}):</b><ul>${v.warnings.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>` : "");
  const sched = S.plan.schedule.length;
  const st = S.meta.structure;
  $("#stats").innerHTML = [["المعلمون", S.plan.teachers.length], ["البرامج", S.plan.programs.length],
    ["خانات مجدولة", sched], ["الأسابيع", st.weeks.length]].map(([k, n]) => `<div class="stat"><b>${n}</b>${k}</div>`).join("");
  let rows = "";
  (S.derived.teachers || []).forEach((d) => {
    const t = teacherById(d.id); if (!t) return;
    const list = d.rows.length ? d.rows : [{ program: "", sessions: "", start: "", remaining: d.allowed }];
    list.forEach((r) => (rows += `<tr><td>${esc(t.name)}</td><td>${esc(t.subject)}</td><td class=num>${d.allowed}</td><td>${esc(r.program)}</td>
      <td class=num>${esc(r.sessions)}</td><td>${esc(r.start)}</td><td class="num ${r.remaining < 0 ? "neg" : ""}">${esc(r.remaining)}</td></tr>`));
  });
  const cap = st.teacher_rows;
  $("#assignTable").innerHTML = `<tr><th>اسم المعلم</th><th>مادة التدريس</th><th>الحصص الممكن الاستفادة منها (10%)</th><th>اسم البرنامج المسند</th><th>عدد حصص البرنامج</th><th>تاريخ بداية التنفيذ</th><th>المتبقي بعد التنفيذ</th></tr>` +
    rows + `<tr><td colspan=7 class=hint>سعة الجدول في القالب: ${cap} صفًا.</td></tr>`;
  const doms = S.meta.template_domains;
  const byDom = doms.map((d) => [...new Map(S.plan.programs.filter((p) => p.domain === d && p.name).map((p) => [p.name, p])).values()]);
  const max = Math.max(1, ...byDom.map((l) => l.length));
  let dt = `<tr>${doms.map((d) => `<th>${esc(d)}</th><th>عدد الحصص</th>`).join("")}</tr>`;
  for (let i = 0; i < max; i++) dt += `<tr>${byDom.map((l) => `<td>${esc(l[i]?.name || "")}</td><td class=num>${esc(l[i]?.sessions ?? "")}</td>`).join("")}</tr>`;
  $("#domainTable").innerHTML = dt + `<tr><td colspan=${doms.length * 2} class=hint>سعة كل مجال في القالب: ${st.domain_rows} برامج. المجالات غير الموجودة في القالب (مثل الفترات اللاصفية) لا تظهر في هذا الجدول.</td></tr>`;
}
async function preview() {
  const btn = $("#btnPreview"); btn.disabled = true; $("#previewBox").innerHTML = `<p class="hint">جارٍ إنشاء ملف Word وتحويله للمعاينة…</p>`;
  try {
    const r = await api("POST", "/api/preview", { plan: S.plan });
    const fitted = r.report.fitted.length ? `<div class="msg info">ضُبط حجم ${r.report.fitted.length} نص ليتسع في مكانه دون تغيير أبعاد الجداول.</div>` : "";
    const over = r.report.overflow.length ? `<div class="msg warn">نصوص طويلة جدًا لم تتسع حتى بأصغر خط: ${r.report.overflow.map((o) => esc(o.text)).join("، ")}</div>` : "";
    const eng = r.engine === "word" ? "" : `<div class="msg info">المعاينة مولدة بـ LibreOffice. الملف النهائي DOCX هو المرجع؛ قد تختلف أشكال الحروف قليلًا إن لم تكن خطوط Word الأصلية مثبتة.</div>`;
    $("#previewBox").innerHTML = fitted + over + eng + r.pages.map((u, i) => `<img src="${u}" alt="صفحة ${i + 1}" loading="lazy">`).join("");
  } catch (e) { $("#previewBox").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
  btn.disabled = false;
}

// ---------------------------------------------------------------- 7: التصدير
function renderExport() {
  const v = S.derived.validation;
  $("#exportMsg").innerHTML = v.errors.length ? `<div class="msg err">يوجد ${v.errors.length} أخطاء تمنع التصدير — راجع خطوة «المراجعة».</div>` : "";
}
async function download(url, btn) {
  btn.disabled = true; const old = btn.textContent; btn.textContent = "جارٍ الإنشاء…";
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: S.plan }) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw Object.assign(new Error(d.error || "تعذر التصدير"), { data: d }); }
    const cd = r.headers.get("Content-Disposition") || ""; let name = "خطة.docx";
    const m = cd.match(/filename\*=UTF-8''([^;]+)/i) || cd.match(/filename="?([^";]+)/i); if (m) name = decodeURIComponent(m[1]);
    const blob = await r.blob(); const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("تم إنشاء: " + name);
  } catch (e) {
    const errs = e.data?.errors;
    $("#exportMsg").innerHTML = `<div class="msg err"><b>${esc(e.message)}</b>${errs ? `<ul>${errs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>`;
  }
  btn.disabled = false; btn.textContent = old;
}
async function runVerify() {
  const btn = $("#btnVerify"); btn.disabled = true; $("#verifyResult").innerHTML = `<p class="hint">جارٍ المقارنة…</p>`;
  try {
    const r = await api("POST", "/api/verify", { plan: S.plan });
    const url = URL.createObjectURL(new Blob([r.report_html], { type: "text/html;charset=utf-8" }));
    $("#verifyResult").innerHTML = `<div class="msg ${r.passed ? "ok" : "err"}">${r.passed ? "✓ ناجح: التصميم لم يتغير" : "✘ يوجد اختلافات"}</div>
      <ul class="checks">${r.checks.map((c) => `<li><span class="${c.ok ? "y" : "n"}">${c.ok ? "✔" : "✘"}</span> ${esc(c.name)}</li>`).join("")}</ul>
      ${r.visual ? "" : `<p class="hint">المقارنة البصرية لصفحات PDF غير متاحة على هذا الخادم؛ نُفذت مقارنة الحزمة وXML والمقاييس كاملة.</p>`}
      <a href="${url}" target="_blank" rel="noopener">فتح التقرير الكامل</a>`;
  } catch (e) { $("#verifyResult").innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
  btn.disabled = false;
}

// ---------------------------------------------------------------- التشغيل
async function init() {
  S.meta = await api("GET", "/api/meta");
  $("#stageSelect").innerHTML = Object.entries(S.meta.stages).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
  $("#semesterSelect").innerHTML = Object.entries(S.meta.semesters).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  $$("nav.steps button").forEach((b) => (b.onclick = () => goStep(b.dataset.step)));
  $("#modalClose").onclick = closeModal;
  $("#modal").onclick = (e) => { if (e.target.id === "modal") closeModal(); };
  $("#planSelect").onchange = (e) => openPlan(e.target.value);
  $("#btnNewPlan").onclick = newPlanDialog;
  $("#btnDupPlan").onclick = () => {
    const copy = JSON.parse(JSON.stringify(S.plan)); copy.id = uid("plan"); copy.name = (copy.name || "") + " (نسخة)";
    setPlan({ plan: copy, derived: S.derived, unplaced: S.unplaced }); toast("تم نسخ الخطة");
  };
  $("#btnDelPlan").onclick = async () => {
    if (!confirm(`حذف الخطة «${S.plan.name}» نهائيًا من هذا المتصفح؟`)) return;
    Store.remove(S.plan.id); S.plan = null; const list = loadPlanList();
    if (list.length) openPlan(list[0].id); else newPlanDialog();
  };
  $("#btnAddTeacher").onclick = () => {
    const t = { id: uid("tch"), name: "", subject: "", stage: S.plan.school.stage, grades: "", subject_periods: "", notes: "" };
    S.plan.teachers.push(t); S.teacherId = t.id; renderTeachers(); $("#teacherPanel [data-f=name]").focus(); markDirty(false);
  };
  $("#btnAddProgram").onclick = () => { const p = addProgram(); S.programId = p.id; renderPrograms(); $("#programPanel [data-f=name]").focus(); };
  $("#btnLibrary").onclick = libraryDialog;
  $("#importFile").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importFile(f); };
  $("#btnAuto").onclick = async () => { clearTimeout(S.saveTimer); await save(true); renderSchedule(); toast("تم التوزيع التلقائي"); };
  $("#btnAutoReset").onclick = async () => {
    if (!confirm("حذف كل التعديلات اليدوية وإعادة التوزيع؟")) return;
    const res = await api("POST", "/api/autoschedule?keep_manual=0", { plan: S.plan });
    S.plan.schedule = res.plan.schedule; S.derived = res.derived; S.unplaced = res.unplaced; Store.save(S.plan); renderSchedule();
  };
  $("#btnPreview").onclick = preview;
  $("#btnDocx").onclick = (e) => download("/api/export/docx", e.target);
  $("#btnPdf").onclick = (e) => download("/api/export/pdf", e.target);
  $("#btnDb").onclick = (e) => download("/api/export/database.xlsx", e.target);
  $("#btnProgCsv").onclick = (e) => download("/api/export/programs.csv", e.target);
  $("#btnTeachCsv").onclick = (e) => download("/api/export/teachers.csv", e.target);
  $("#btnTeachersCsv").onclick = (e) => download("/api/export/teachers.csv", e.target);
  $("#btnBackup").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S.plan, null, 1)], { type: "application/json" }));
    a.download = `${S.plan.name || "خطة"}.json`; document.body.appendChild(a); a.click(); a.remove();
  };
  if (!S.meta.capabilities.pdf) {
    $("#btnPdf").disabled = true; $("#btnPreview").disabled = true;
    const note = `<p class="hint">تحويل PDF غير متاح على هذا الخادم. صدّر ملف Word ثم احفظه PDF من Microsoft Word (ملف ← حفظ باسم ← PDF) لنسخة مطابقة تمامًا.</p>`;
    $("#pdfNote").innerHTML = note; $("#previewNote").innerHTML = note.replace("تحويل PDF", "المعاينة (تحويل PDF)");
  }
  if (!Store.persistent) toast("تخزين المتصفح معطل: لن تُحفظ الخطط بعد إغلاق الصفحة. استخدم النسخة الاحتياطية.", true);
  $("#btnVerify").onclick = runVerify;
  $("#restoreFile").onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try {
      const plan = JSON.parse(await f.text()); if (!plan || !plan.school) throw new Error("ملف الخطة غير صالح");
      plan.id = uid("plan");
      const res = await api("POST", "/api/derive", { plan }); setPlan({ plan, derived: res.derived }); toast("تمت استعادة الخطة");
    } catch (err) { toast(err.message || "ملف الخطة غير صالح", true); }
  };
  const list = loadPlanList();
  const last = Store.last();
  if (list.length) await openPlan(list.some((p) => p.id === last) ? last : list[0].id);
  else { const res = await api("POST", "/api/plans/new", { name: "خطة جديدة", from_template: true }); setPlan(res); }
  goStep("school");
}
init().catch((e) => toast(e.message, true));
