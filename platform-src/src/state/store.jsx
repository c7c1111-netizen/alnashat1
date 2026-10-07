// الحالة المركزية للتطبيق: reducer واحد + حفظ تلقائي + بيانات مشتقة (التوزيع، التعارضات).
import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, useCallback } from 'react';
import { storage } from '../storage/db.js';
import { initialState, migrateState } from './model.js';
import { uid } from '../utils/ids.js';
import { loadCatalog } from '../services/catalog.js';
import { scheduleAll } from '../scheduler/schedule.js';
import { allIssues } from '../validation/conflicts.js';

const Ctx = createContext(null);

function touch(s) {
  return { ...s, meta: { ...s.meta, updatedAt: Date.now() } };
}

function upsert(list, item) {
  const i = list.findIndex((x) => x.id === item.id);
  if (i < 0) return [...list, item];
  const copy = list.slice();
  copy[i] = { ...list[i], ...item };
  return copy;
}

export function reducer(state, action) {
  switch (action.type) {
    case 'replace':
      return action.state;
    case 'school/update':
      return touch({ ...state, school: { ...state.school, ...action.patch } });
    case 'settings/update':
      return touch({ ...state, settings: { ...state.settings, ...action.patch } });
    case 'class/upsert':
      return touch({ ...state, classes: upsert(state.classes, action.item) });
    case 'class/delete':
      return touch({ ...state, classes: state.classes.filter((c) => c.id !== action.id) });
    case 'teacher/upsert':
      return touch({ ...state, teachers: upsert(state.teachers, action.item) });
    case 'teacher/delete':
      return touch({ ...state, teachers: state.teachers.filter((t) => t.id !== action.id) });
    case 'plan/upsert':
      return touch({ ...state, plans: upsert(state.plans, { ...action.plan, updatedAt: Date.now() }) });
    case 'plan/patch':
      return touch({
        ...state,
        plans: state.plans.map((p) => (p.id === action.id ? { ...p, ...action.patch, updatedAt: Date.now() } : p)),
      });
    case 'plan/delete':
      return touch({
        ...state,
        plans: state.plans.filter((p) => p.id !== action.id),
        evidence: state.evidence.filter((e) => e.planId !== action.id),
      });
    case 'record/patch':
      return touch({
        ...state,
        plans: state.plans.map((p) => {
          if (p.id !== action.planId) return p;
          const prev = p.records?.[action.programId] || {};
          return { ...p, updatedAt: Date.now(), records: { ...p.records, [action.programId]: { ...prev, ...action.patch } } };
        }),
      });
    case 'calc/set':
      return touch({ ...state, quotaCalc: { ...(state.quotaCalc || { rows: [] }), ...action.patch } });
    case 'evidence/add':
      return touch({ ...state, evidence: [...state.evidence, action.item] });
    case 'evidence/delete':
      return touch({ ...state, evidence: state.evidence.filter((e) => e.id !== action.id) });
    default:
      return state;
  }
}

export function AppProvider({ children }) {
  const [catalog, setCatalog] = useState(null);
  const [state, dispatch] = useReducer(reducer, null);
  const [error, setError] = useState(null);
  const [save, setSave] = useState({ status: 'idle', at: null });
  const [registry, setRegistry] = useState(null);
  const loaded = useRef(false);
  const timer = useRef(null);
  const latest = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        let reg = await storage.loadRegistry();
        let saved = null;
        if (!reg) {
          // أول تشغيل بعد دعم تعدد المدارس: الحالة القديمة تصير «المدرسة الأولى»
          saved = await storage.loadState(null);
          const id = 'school_main';
          if (saved) { saved = { ...saved, school: { ...saved.school, id } }; await storage.saveState(saved); }
          reg = { current: id, schools: [{ id, name: saved?.school?.name || '', types: saved?.school?.types || ['primary'], updatedAt: Date.now() }] };
          await storage.saveRegistry(reg);
        } else {
          saved = await storage.loadState(reg.current);
        }
        const cat = await loadCatalog(saved?.school?.academicYear);
        const entry = reg.schools.find((x) => x.id === reg.current);
        const st = saved
          ? migrateState(saved, cat.seed)
          : initialState(reg.current === 'school_main' ? cat.seed : null, cat.calendar.id, { id: reg.current, types: entry?.types });
        st.school.id = reg.current;
        setCatalog(cat);
        setRegistry(reg);
        dispatch({ type: 'replace', state: st });
        loaded.current = true;
        setSave({ status: saved ? 'saved' : 'idle', at: saved?.meta?.updatedAt || null });
        storage.persist();
      } catch (e) {
        console.error(e);
        setError(e.message || 'تعذر تشغيل المنصة');
      }
    })();
  }, []);

  const flush = useCallback(async () => {
    if (!latest.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    setSave((s) => ({ ...s, status: 'saving' }));
    const cur = latest.current;
    const ok = await storage.saveState(cur);
    setSave({ status: ok ? 'saved' : 'error', at: Date.now() });
    // تحديث اسم المدرسة ونوعها في سجل المدارس
    setRegistry((reg) => {
      if (!reg) return reg;
      const e = reg.schools.find((x) => x.id === cur.school.id);
      if (e && e.name === cur.school.name && String(e.types) === String(cur.school.types)) return reg;
      const next = { ...reg, schools: reg.schools.map((x) => (x.id === cur.school.id ? { ...x, name: cur.school.name, types: cur.school.types, updatedAt: Date.now() } : x)) };
      storage.saveRegistry(next);
      return next;
    });
  }, []);

  // ===== تعدد المدارس =====
  const switchSchool = useCallback(async (id) => {
    await flush();
    const reg = { ...registry, current: id };
    const saved = await storage.loadState(id);
    const entry = reg.schools.find((x) => x.id === id);
    const st = saved ? migrateState(saved, catalog.seed) : initialState(null, catalog.calendar.id, { id, types: entry?.types });
    st.school.id = id;
    await storage.saveRegistry(reg);
    setRegistry(reg);
    latest.current = null;
    dispatch({ type: 'replace', state: st });
    setSave({ status: 'saved', at: st.meta?.updatedAt || Date.now() });
  }, [registry, catalog, flush]);

  const createSchool = useCallback(async ({ name, types }) => {
    await flush();
    const id = uid('school');
    const st = initialState(null, catalog.calendar.id, { id, types });
    st.school.name = name || '';
    st.school.stageName = catalog.schoolTypeById[types[0]]?.name || '';
    st.settings.periodsPerDay = Math.max(...types.map((t) => catalog.schoolTypeById[t]?.periodsPerDay || 7));
    st.meta.updatedAt = Date.now() + 1;
    await storage.saveState(st);
    const reg = { current: id, schools: [...registry.schools, { id, name: st.school.name, types, updatedAt: Date.now() }] };
    await storage.saveRegistry(reg);
    setRegistry(reg);
    latest.current = null;
    dispatch({ type: 'replace', state: st });
    return id;
  }, [registry, catalog, flush]);

  const deleteSchool = useCallback(async (id) => {
    if (registry.schools.length <= 1) return false;
    const other = registry.schools.find((x) => x.id !== id);
    if (id === registry.current) await switchSchool(other.id);
    const gone = await storage.loadState(id);
    for (const e of gone?.evidence || []) if (e.fileKey) await storage.deleteFile(e.fileKey);
    await storage.deleteState(id);
    await storage.kvDelete(`template:${id}`);
    setRegistry((reg) => {
      const next = { ...reg, current: reg.current === id ? other.id : reg.current, schools: reg.schools.filter((x) => x.id !== id) };
      storage.saveRegistry(next);
      return next;
    });
    return true;
  }, [registry, switchSchool]);

  // حفظ تلقائي بعد كل تعديل
  useEffect(() => {
    if (!state || !loaded.current) return;
    latest.current = state;
    if (save.status === 'idle' && state.meta?.updatedAt === state.meta?.createdAt) return;
    setSave((s) => ({ ...s, status: 'saving' }));
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 500);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onHide = () => { if (timer.current) flush(); };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => { window.removeEventListener('pagehide', onHide); document.removeEventListener('visibilitychange', onHide); };
  }, [flush]);

  const derived = useMemo(() => {
    if (!state || !catalog) return null;
    const schedules = scheduleAll(state, catalog);
    const issues = allIssues(state, catalog, schedules);
    return { schedules, issues };
  }, [state, catalog]);

  const value = useMemo(() => ({ state, catalog, dispatch, derived, save, flush, registry, switchSchool, createSchool, deleteSchool }),
    [state, catalog, derived, save, flush, registry, switchSchool, createSchool, deleteSchool]);

  if (error) {
    return (
      <div className="boot-error" role="alert">
        <h1>تعذر تشغيل المنصة</h1>
        <p>{error}</p>
        <button className="btn primary" onClick={() => location.reload()}>إعادة المحاولة</button>
      </div>
    );
  }
  if (!state || !catalog) {
    return <div className="boot" aria-busy="true"><div className="spinner" /><p>جارٍ تحميل المنصة…</p></div>;
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  return useContext(Ctx);
}
