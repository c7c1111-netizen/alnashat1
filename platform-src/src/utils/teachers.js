import { cleanLine, cleanInt } from './sanitize.js';

/** يحلل سطر معلم: «الاسم - المادة - الحصص» أو «الاسم، المادة، الحصص» أو جدول منسوخ من Excel */
export function parseTeacherLines(text) {
  return String(text || '').split(/\r?\n/).map((line) => {
    const parts = line.split(/\t|\s[-–]\s|،|,|\|/).map((x) => cleanLine(x)).filter(Boolean);
    if (!parts.length) return null;
    const [name, ...rest] = parts;
    const num = rest.find((x) => /^[\d٠-٩]+$/.test(x));
    const subject = rest.find((x) => !/^[\d٠-٩]+$/.test(x)) || '';
    return { name, subject, weeklyLoad: num ? cleanInt(num, { min: 0, max: 40 }) : null };
  }).filter((t) => t && t.name.length > 1);
}

