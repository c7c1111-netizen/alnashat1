// الإطار العام: الشريط العلوي + التنقل (جانبي في الشاشات الكبيرة، سفلي في الجوال) + حالة الحفظ
import React, { useEffect, useState } from 'react';
import { useApp } from '../state/store.jsx';
import { relativeTime } from '../utils/arabic.js';

export const NAV = [
  { href: '#/', icon: '🏠', label: 'الرئيسية', match: (p) => p.length === 0 },
  { href: '#/plans', icon: '🗂️', label: 'الخطط', match: (p) => p[0] === 'plans' },
  { href: '#/timeline', icon: '📅', label: 'الجدول الزمني', match: (p) => p[0] === 'timeline' },
  { href: '#/programs', icon: '🚦', label: 'التنفيذ', match: (p) => p[0] === 'programs' },
  { href: '#/teachers', icon: '👨‍🏫', label: 'المعلمون', match: (p) => p[0] === 'teachers' },
  { href: '#/evidence', icon: '📁', label: 'الشواهد', match: (p) => p[0] === 'evidence' },
  { href: '#/reports', icon: '📊', label: 'التقارير', match: (p) => p[0] === 'reports' },
  { href: '#/export', icon: '📤', label: 'التصدير', match: (p) => p[0] === 'export' },
  { href: '#/settings', icon: '⚙️', label: 'الإعدادات', match: (p) => p[0] === 'settings' },
];
const MOBILE = ['#/', '#/plans', '#/timeline', '#/programs', '#/more'];

export function SaveIndicator() {
  const { save } = useApp();
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 10000); return () => clearInterval(t); }, []);
  let text = 'جاهز';
  let tone = 'muted';
  if (save.status === 'saving') { text = 'جارٍ الحفظ…'; tone = 'info'; }
  else if (save.status === 'saved') { text = `محفوظ ✓ · ${relativeTime(save.at)}`; tone = 'ok'; }
  else if (save.status === 'error') { text = 'تعذر الحفظ — تحقق من مساحة الجهاز'; tone = 'danger'; }
  return <span className={`save-ind ${tone}`} role="status" aria-live="polite">{text}</span>;
}

export function Shell({ route, children }) {
  const { state } = useApp();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return (
    <div className="shell">
      <a className="skip" href="#main">تخطي إلى المحتوى</a>
      <header className="topbar">
        <a href="#/" className="brand" aria-label="منصة النشاط الطلابي — الرئيسية">
          <span className="brand-mark" aria-hidden="true">ن</span>
          <span className="brand-text">
            <strong>منصة النشاط الطلابي</strong>
            <small>{state.school.name || 'إعداد المدرسة'}</small>
          </span>
        </a>
        <div className="topbar-end">
          {!online && <span className="badge warn">بدون إنترنت — كل شي يشتغل</span>}
          <SaveIndicator />
        </div>
      </header>
      <nav className="sidenav" aria-label="التنقل الرئيسي">
        {NAV.map((n) => (
          <a key={n.href} href={n.href} className={n.match(route.parts) ? 'active' : ''} aria-current={n.match(route.parts) ? 'page' : undefined}>
            <span aria-hidden="true">{n.icon}</span>{n.label}
          </a>
        ))}
      </nav>
      <main id="main" className="main" tabIndex={-1}>{children}</main>
      <nav className="tabbar" aria-label="التنقل السريع">
        {MOBILE.map((href) => {
          const n = href === '#/more' ? { href, icon: '☰', label: 'المزيد', match: (p) => ['more', 'teachers', 'evidence', 'reports', 'export', 'settings'].includes(p[0]) } : NAV.find((x) => x.href === href);
          const on = n.match(route.parts);
          return (
            <a key={href} href={href} className={on ? 'active' : ''} aria-current={on ? 'page' : undefined}>
              <span aria-hidden="true">{n.icon}</span><small>{n.label}</small>
            </a>
          );
        })}
      </nav>
    </div>
  );
}

export function PageHead({ title, subtitle, actions, back }) {
  return (
    <div className="page-head">
      <div>
        {back && <a href={back} className="back-link">→ رجوع</a>}
        <h1>{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
