// طبقة تخزين محلية: IndexedDB (البيانات + ملفات الشواهد) مع بديل localStorage.
// مصمّمة كواجهة (repository) عشان تنضاف لاحقًا مزامنة سحابية بدون تغيير الواجهات.

const DB_NAME = 'activity-platform';
const DB_VERSION = 1;
const STATE_KEY = 'state:v1';
const LS_PREFIX = 'activity-platform:';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function lsGet(k) { try { return localStorage.getItem(LS_PREFIX + k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(LS_PREFIX + k, v); return true; } catch { return false; } }

const REGISTRY_KEY = 'schools:v1';
const stateKey = (id) => (id ? `state:${id}` : STATE_KEY);

async function kvRead(key) {
  const db = await openDB();
  if (db) {
    try {
      const v = await tx(db, 'kv', 'readonly', (s) => s.get(key));
      if (v !== undefined && v !== null) return v;
    } catch { /* نكمل للبديل */ }
  }
  const raw = lsGet(key);
  if (raw) { try { return JSON.parse(raw); } catch { return null; } }
  return null;
}

async function kvWrite(key, value) {
  const db = await openDB();
  if (db) {
    try { await tx(db, 'kv', 'readwrite', (s) => s.put(value, key)); return true; } catch { /* بديل */ }
  }
  return lsSet(key, JSON.stringify(value));
}

export const storage = {
  /** سجل المدارس: {current, schools:[{id, name, types, updatedAt}]} */
  async loadRegistry() { return kvRead(REGISTRY_KEY); },
  async saveRegistry(reg) { return kvWrite(REGISTRY_KEY, reg); },

  /** حالة مدرسة (بدون معرّف = الحالة القديمة قبل تعدد المدارس) */
  async loadState(id = null) { return kvRead(stateKey(id)); },
  async saveState(state) { return kvWrite(stateKey(state?.school?.id), state); },
  async deleteState(id) {
    const db = await openDB();
    if (db) { try { await tx(db, 'kv', 'readwrite', (s) => s.delete(stateKey(id))); } catch { /* */ } }
    try { localStorage.removeItem(LS_PREFIX + stateKey(id)); } catch { /* */ }
  },

  async putFile(key, blob) {
    const db = await openDB();
    if (!db) throw new Error('تخزين الملفات غير متاح في هذا المتصفح');
    await tx(db, 'files', 'readwrite', (s) => s.put(blob, key));
  },

  async getFile(key) {
    const db = await openDB();
    if (!db) return null;
    try { return await tx(db, 'files', 'readonly', (s) => s.get(key)); } catch { return null; }
  },

  async deleteFile(key) {
    const db = await openDB();
    if (!db) return;
    try { await tx(db, 'files', 'readwrite', (s) => s.delete(key)); } catch { /* تجاهل */ }
  },

  async kvGet(key) {
    const db = await openDB();
    if (!db) return null;
    try { return await tx(db, 'kv', 'readonly', (s) => s.get(key)); } catch { return null; }
  },

  async kvSet(key, value) {
    const db = await openDB();
    if (!db) return false;
    try { await tx(db, 'kv', 'readwrite', (s) => s.put(value, key)); return true; } catch { return false; }
  },

  async kvDelete(key) {
    const db = await openDB();
    if (!db) return;
    try { await tx(db, 'kv', 'readwrite', (s) => s.delete(key)); } catch { /* تجاهل */ }
  },

  /** يطلب من المتصفح عدم مسح البيانات تلقائيًا */
  async persist() {
    try { if (navigator.storage?.persist) return await navigator.storage.persist(); } catch { /* */ }
    return false;
  },
};
