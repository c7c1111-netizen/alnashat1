// تنزيل الملفات، الطباعة (PDF)، وتصدير صورة — كلها تعمل بدون إنترنت.
import { safeFileName } from '../utils/sanitize.js';

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFileName(name);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function downloadJSON(obj, name) {
  downloadBlob(new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' }), name);
}

/**
 * طباعة عنصر واحد كـ PDF (A4). يخفي باقي الصفحة ويضبط اتجاه الورقة.
 * على الآيباد: الطباعة ← مشاركة ← حفظ في الملفات.
 */
export function printElement(element, { landscape = false, title = '' } = {}) {
  return new Promise((resolve) => {
    const style = document.createElement('style');
    style.textContent = `@page{size:A4 ${landscape ? 'landscape' : 'portrait'};margin:${landscape ? '8mm 9mm' : '12mm 12mm'};}`;
    document.head.appendChild(style);
    element.classList.add('print-target');
    const path = [];
    for (let n = element.parentElement; n && n !== document.body; n = n.parentElement) { n.classList.add('print-path'); path.push(n); }
    document.body.classList.add('printing');
    const prevTitle = document.title;
    if (title) document.title = safeFileName(title);
    const done = () => {
      document.body.classList.remove('printing');
      element.classList.remove('print-target');
      path.forEach((n) => n.classList.remove('print-path'));
      style.remove();
      document.title = prevTitle;
      window.removeEventListener('afterprint', done);
      resolve();
    };
    window.addEventListener('afterprint', done);
    setTimeout(() => { window.print(); setTimeout(() => { if (document.body.classList.contains('printing')) done(); }, 60000); }, 120);
  });
}

export async function elementToPng(element, name) {
  const { toPng } = await import('html-to-image');
  const url = await toPng(element, { backgroundColor: '#ffffff', pixelRatio: 2, cacheBust: true });
  const res = await fetch(url);
  downloadBlob(await res.blob(), name);
}

export async function fetchBytes(path) {
  const res = await fetch(new URL(path, document.baseURI));
  if (!res.ok) throw new Error('تعذر تحميل القالب');
  return new Uint8Array(await res.arrayBuffer());
}
