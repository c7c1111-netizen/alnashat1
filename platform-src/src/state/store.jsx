// الحالة المركزية للتطبيق: reducer واحد + حفظ تلقائي + بيانات مشتقة (التوزيع، التعارضات).
import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, useCallback } from 'react';
import { storage } from '../storage/db.js';
import { initialState, migrateState } from './model.js';
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
  const loaded = useRef(false);
  const timer = useRef(null);
  const latest = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const saved = await storage.loadState();
        const cat = await loadCatalog(saved?.school?.academicYear);
        const st = saved ? migrateState(saved, cat.seed) : initialState(cat.seed, cat.calendar.id);
        setCatalog(cat);
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
    const ok = await storage.saveState(latest.current);
    setSave({ status: ok ? 'saved' : 'error', at: Date.now() });
  }, []);

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

  const value = useMemo(() => ({ state, catalog, dispatch, derived, save, flush }), [state, catalog, derived, save, flush]);

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
