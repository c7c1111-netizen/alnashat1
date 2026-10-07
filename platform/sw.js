// Service Worker — العمل بدون إنترنت
// الواجهة: تُخزَّن عند التثبيت وتُخدم من الذاكرة (تتحدث مع كل إصدار جديد)
// البيانات (data/) والقالب: الشبكة أولًا ثم الذاكرة إذا ما فيه إنترنت
const VERSION = '20261007003039';
const CACHE = `activity-platform-${VERSION}`;
const PRECACHE = [
 "./",
 "./assets/app.css",
 "./assets/app.js",
 "./assets/chunk-3EQXVVDE.js",
 "./assets/chunk-3RNHDNP5.js",
 "./assets/chunk-5UABOJYA.js",
 "./assets/chunk-6M4J4XT4.js",
 "./assets/chunk-CL5KKNJK.js",
 "./assets/chunk-FBND2ZAO.js",
 "./assets/chunk-R7T435XT.js",
 "./assets/chunk-ZNGLL6V2.js",
 "./data/calendars/1448-1449.json",
 "./data/calendars/index.json",
 "./data/domains.json",
 "./data/programs.json",
 "./data/school-seed.json",
 "./data/stages.json",
 "./icons/icon-192.png",
 "./icons/icon-512.png",
 "./icons/icon.svg",
 "./index.html",
 "./manifest.webmanifest",
 "./templates/official-plan.docx"
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('activity-platform-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const isData = url.pathname.includes('/data/') || url.pathname.includes('/templates/');
  if (isData) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true })),
    );
    return;
  }
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && url.pathname.startsWith(new URL(self.registration.scope).pathname)) {
        const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : undefined))),
  );
});
