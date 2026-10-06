// مكونات الواجهة المشتركة
import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { arNum } from '../utils/arabic.js';

export function Button({ variant = 'secondary', size, icon, children, className = '', ...rest }) {
  return (
    <button type="button" className={`btn ${variant} ${size || ''} ${className}`} {...rest}>
      {icon && <span className="btn-icon" aria-hidden="true">{icon}</span>}
      {children && <span>{children}</span>}
    </button>
  );
}

export function LinkButton({ href, variant = 'secondary', icon, children, className = '' }) {
  return (
    <a href={href} className={`btn ${variant} ${className}`}>
      {icon && <span className="btn-icon" aria-hidden="true">{icon}</span>}
      <span>{children}</span>
    </a>
  );
}

export function Card({ title, actions, children, className = '', as: Tag = 'section', ...rest }) {
  return (
    <Tag className={`card ${className}`} {...rest}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h2 className="card-title">{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </Tag>
  );
}

export function Badge({ tone = 'muted', children, icon }) {
  return <span className={`badge ${tone}`}>{icon && <span aria-hidden="true">{icon}</span>}{children}</span>;
}

export function Progress({ value, label, tone }) {
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <div className="progress" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label || 'نسبة الإنجاز'}>
      <div className={`progress-fill ${tone || ''}`} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Stat({ icon, label, value, hint, tone, href }) {
  const inner = (
    <>
      <span className="stat-icon" aria-hidden="true">{icon}</span>
      <span className="stat-value">{typeof value === 'number' ? arNum(value) : value}</span>
      <span className="stat-label">{label}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </>
  );
  return href ? <a className={`stat ${tone || ''}`} href={href}>{inner}</a> : <div className={`stat ${tone || ''}`}>{inner}</div>;
}

export function Empty({ icon = '🗂️', title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden="true">{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Field({ label, hint, error, children, required }) {
  const id = useId();
  const child = React.isValidElement(children) ? React.cloneElement(children, { id, 'aria-invalid': !!error || undefined, 'aria-describedby': hint || error ? `${id}-d` : undefined }) : children;
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label htmlFor={id}>{label}{required && <span className="req" aria-hidden="true"> *</span>}</label>
      {child}
      {(error || hint) && <div id={`${id}-d`} className={error ? 'field-error' : 'field-hint'}>{error || hint}</div>}
    </div>
  );
}

export function Chips({ options, value, onChange, multiple = false, label, disabled = [] }) {
  const sel = multiple ? value || [] : [value];
  return (
    <div className="chips" role={multiple ? 'group' : 'radiogroup'} aria-label={label}>
      {options.map((o) => {
        const on = sel.includes(o.value);
        const dis = disabled.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            className={`chip ${on ? 'on' : ''}`}
            role={multiple ? 'checkbox' : 'radio'}
            aria-checked={on}
            disabled={dis}
            onClick={() => {
              if (multiple) onChange(on ? sel.filter((x) => x !== o.value) : [...sel, o.value]);
              else onChange(on ? null : o.value);
            }}
          >
            {on && <span aria-hidden="true">✓ </span>}{o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({ checked, onChange, label }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
      <span>{label}</span>
    </label>
  );
}

// ===== التنبيهات المنبثقة (Toast) =====
const ToastCtx = createContext(null);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, tone = 'ok', ms = 2800) => {
    const id = Math.random().toString(36).slice(2);
    const clean = String(text).replace(/\s*✓/g, '').trim();
    setItems((l) => [...l.slice(-2), { id, text: clean, tone }]);
    setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), ms);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <span aria-hidden="true">{t.tone === 'ok' ? '✓' : t.tone === 'error' ? '✕' : 'ℹ︎'}</span> {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ===== النوافذ الحوارية =====
const DialogCtx = createContext(null);
export function DialogProvider({ children }) {
  const [dlg, setDlg] = useState(null);
  const confirm = useCallback((opts) => new Promise((resolve) => setDlg({ ...opts, resolve })), []);
  const close = (v) => { dlg?.resolve(v); setDlg(null); };
  return (
    <DialogCtx.Provider value={confirm}>
      {children}
      {dlg && (
        <Modal title={dlg.title} onClose={() => close(false)} size="sm">
          {dlg.message && <p className="dlg-msg">{dlg.message}</p>}
          <div className="dlg-actions">
            <Button variant={dlg.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>{dlg.confirmText || 'تأكيد'}</Button>
            <Button onClick={() => close(false)}>{dlg.cancelText || 'إلغاء'}</Button>
          </div>
        </Modal>
      )}
    </DialogCtx.Provider>
  );
}
export const useConfirm = () => useContext(DialogCtx);

export function Modal({ title, children, onClose, size = 'md', footer }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    const first = ref.current?.querySelector('button, [href], input, select, textarea');
    first?.focus();
    document.body.classList.add('modal-open');
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('modal-open'); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="إغلاق">✕</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
