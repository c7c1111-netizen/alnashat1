// تنظيف وتحقق من مدخلات المستخدم والملفات المستوردة.
// الواجهة تُبنى بـ React فالنص يُهرَّب تلقائيًا؛ هذه الأدوات للبيانات اللي تطلع خارج React
// (أسماء الملفات، الروابط، XML الوورد، النسخ المستعادة).

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** نص عادي: يشيل رموز التحكم ويقصّ الطول */
export function cleanText(v, max = 2000) {
  if (v == null) return '';
  return String(v).replace(CONTROL, '').slice(0, max);
}

/** سطر واحد (أسماء، عناوين) */
export function cleanLine(v, max = 200) {
  return cleanText(v, max).replace(/[\r\n\t]+/g, ' ').trim();
}

export function cleanInt(v, { min = 0, max = 1000, fallback = null } = {}) {
  const n = parseInt(String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** يسمح فقط بروابط http/https */
export function safeUrl(v) {
  const s = cleanLine(v, 2000);
  if (!s) return '';
  try {
    const u = new URL(s.match(/^[a-z]+:\/\//i) ? s : `https://${s}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.href;
  } catch {
    return '';
  }
}

/** اسم ملف آمن (يحافظ على العربي) */
export function safeFileName(v, fallback = 'ملف') {
  const s = cleanLine(v, 120)
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/^\.+/, '')
    .trim();
  return s || fallback;
}

export function escapeXml(v) {
  return cleanText(v, 100000)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeHtml(v) {
  return escapeXml(v).replace(/'/g, '&#39;');
}

/** أنواع الشواهد المسموح رفعها */
export const EVIDENCE_LIMITS = {
  maxBytes: 25 * 1024 * 1024,
  accept: 'image/*,application/pdf,video/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx',
};

export function evidenceKind(file) {
  const t = (file.type || '').toLowerCase();
  if (t.startsWith('image/')) return 'image';
  if (t === 'application/pdf') return 'pdf';
  if (t.startsWith('video/')) return 'video';
  return 'file';
}

export function validateEvidenceFile(file) {
  if (!file) return 'لم يتم اختيار ملف';
  if (file.size > EVIDENCE_LIMITS.maxBytes) return 'حجم الملف أكبر من ٢٥ ميجابايت';
  const name = (file.name || '').toLowerCase();
  if (/\.(exe|bat|cmd|sh|js|html?|svg|msi|apk|scr)$/.test(name)) return 'نوع الملف غير مسموح';
  return null;
}
