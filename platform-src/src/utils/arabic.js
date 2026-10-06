// أدوات عرض عربية: الأرقام، التواريخ، الجمع
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function arNum(v) {
  return String(v ?? '').replace(/\d/g, (d) => AR_DIGITS[d]);
}

export function toLatinDigits(v) {
  return String(v ?? '').replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}

export const DAY_ORDER = ['sun', 'mon', 'tue', 'wed', 'thu'];
export const DAY_NAMES = { sun: 'الأحد', mon: 'الاثنين', tue: 'الثلاثاء', wed: 'الأربعاء', thu: 'الخميس' };
export const PERIOD_NAMES = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة'];

const HIJRI_MONTHS = {
  1: 'محرم', 2: 'صفر', 3: 'ربيع الأول', 4: 'ربيع الآخر', 5: 'جمادى الأولى', 6: 'جمادى الآخرة',
  7: 'رجب', 8: 'شعبان', 9: 'رمضان', 10: 'شوال', 11: 'ذو القعدة', 12: 'ذو الحجة',
};

export function hijriLong(h) {
  if (!h) return '';
  return `${arNum(h.d)} ${HIJRI_MONTHS[h.m] || ''} ${arNum(h.y)}هـ`;
}

export function hijriShort(h) {
  if (!h) return '';
  return `${arNum(h.d)} / ${arNum(h.m)} / ${arNum(h.y)}هـ`;
}

export function gregShort(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${arNum(Number(d))}/${arNum(Number(m))}/${arNum(y)}`;
}

/** «حصة / حصتان / حصص» حسب العدد */
export function sessionsLabel(n) {
  if (n == null) return '';
  if (n === 1) return 'حصة واحدة';
  if (n === 2) return 'حصتان';
  if (n >= 3 && n <= 10) return `${arNum(n)} حصص`;
  return `${arNum(n)} حصة`;
}

export function countLabel(n, one, two, few, many) {
  if (n === 0) return `لا ${many}`;
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${arNum(n)} ${few}`;
  return `${arNum(n)} ${many}`;
}

export function relativeTime(ts, now = Date.now()) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return 'الآن';
  if (s < 60) return `منذ ${arNum(s)} ثانية`;
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? 'منذ دقيقة' : m === 2 ? 'منذ دقيقتين' : `منذ ${arNum(m)} دقائق`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? 'منذ ساعة' : h === 2 ? 'منذ ساعتين' : `منذ ${arNum(h)} ساعات`;
  const d = Math.round(h / 24);
  return d === 1 ? 'منذ يوم' : d === 2 ? 'منذ يومين' : `منذ ${arNum(d)} أيام`;
}

export function todayISO(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function percent(a, b) {
  if (!b) return 0;
  return Math.round((a / b) * 100);
}
