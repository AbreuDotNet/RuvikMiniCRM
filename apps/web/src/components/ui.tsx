import {
  type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes,
  type TextareaHTMLAttributes, type SelectHTMLAttributes,
  useEffect, useId, useRef,
} from 'react';
import { Icon, type IconName } from './Icon';
import { statusLabel, statusTone, avatarColor, initials, type PillTone } from '../lib/format';

/* -------------------------------------------------------------- button --- */

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'brand' | 'secondary' | 'ghost' | 'danger' | 'whatsapp';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  icon?: IconName;
  loading?: boolean;
}

export function Button({
  variant = 'primary', size = 'md', block, icon, loading, children, className, disabled, ...rest
}: ButtonProps) {
  const classes = [
    'btn', `btn--${variant}`,
    size !== 'md' ? `btn--${size}` : '',
    block ? 'btn--block' : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  return (
    <button className={classes} disabled={disabled || loading} aria-busy={loading} {...rest}>
      {loading ? <Spinner /> : icon ? <Icon name={icon} size={18} /> : null}
      {children}
    </button>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <animateTransform
          attributeName="transform" type="rotate"
          from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}

/* --------------------------------------------------------------- forms --- */

interface FieldWrapProps {
  label: string;
  hint?: string;
  error?: string;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}

/**
 * Wires label, hint and error to the control with aria-describedby and
 * aria-invalid, so the error is announced rather than only shown in red.
 */
function FieldWrap({ label, hint, error, children }: FieldWrapProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      {hint && <span className="field__hint" id={hintId}>{hint}</span>}
      {children(id, describedBy)}
      {error && (
        <span className="field__error" id={errorId} role="alert">
          <Icon name="alert" size={14} /> {error}
        </span>
      )}
    </div>
  );
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string;
}

export function TextField({ label, hint, error, ...rest }: TextFieldProps) {
  return (
    <FieldWrap label={label} hint={hint} error={error}>
      {(id, describedBy) => (
        <input
          id={id}
          className="input"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
      )}
    </FieldWrap>
  );
}

interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string;
}

export function TextArea({ label, hint, error, ...rest }: TextAreaProps) {
  return (
    <FieldWrap label={label} hint={hint} error={error}>
      {(id, describedBy) => (
        <textarea
          id={id}
          className="textarea"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
      )}
    </FieldWrap>
  );
}

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string;
  options: Array<{ value: string; label: string }>;
}

export function SelectField({ label, hint, error, options, ...rest }: SelectFieldProps) {
  return (
    <FieldWrap label={label} hint={hint} error={error}>
      {(id, describedBy) => (
        <select id={id} className="select" aria-describedby={describedBy} {...rest}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </FieldWrap>
  );
}

/* --------------------------------------------------------------- pills --- */

export function Pill({ tone = 'neutral', children }: { tone?: PillTone; children: ReactNode }) {
  return <span className={`pill pill--${tone}`}>{children}</span>;
}

export function StatusPill({ status }: { status: string }) {
  return <Pill tone={statusTone(status)}>{statusLabel(status)}</Pill>;
}

/* -------------------------------------------------------------- avatar --- */

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'md' ? 'avatar' : `avatar avatar--${size}`;
  return (
    <div className={cls} style={{ background: avatarColor(name) }} aria-hidden="true">
      {initials(name)}
    </div>
  );
}

/* --------------------------------------------------------------- stars --- */

export function Stars({ rating, count, size = 14 }: { rating: number; count?: number; size?: number }) {
  const rounded = Math.round(rating);
  return (
    <span className="stars">
      <span className="sr-only">
        Rated {rating.toFixed(1)} out of 5{count !== undefined ? ` from ${count} reviews` : ''}
      </span>
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon key={i} name={i <= rounded ? 'star-filled' : 'star'} size={size} strokeWidth={1.5} />
      ))}
      {count !== undefined && (
        <span className="stars__count" aria-hidden="true">
          {rating > 0 ? rating.toFixed(1) : 'New'}{count > 0 ? ` (${count})` : ''}
        </span>
      )}
    </span>
  );
}

/* --------------------------------------------------------- empty/error --- */

export function EmptyState({
  icon = 'clipboard', title, body, action,
}: { icon?: IconName; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon"><Icon name={icon} size={30} /></div>
      <p className="empty-state__title">{title}</p>
      {body && <p className="empty-state__body">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty-state" role="alert">
      <div className="empty-state__icon" style={{ color: 'var(--danger)' }}>
        <Icon name="alert" size={30} />
      </div>
      <p className="empty-state__title">Something went wrong</p>
      <p className="empty-state__body">{message}</p>
      {onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

/* ------------------------------------------------------------ skeleton --- */

export function Skeleton({ height = 16, width = '100%', radius = 8 }: {
  height?: number; width?: number | string; radius?: number;
}) {
  return (
    <div
      className="skeleton"
      style={{ height, width, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="card card--pad">
          <div className="row" style={{ gap: 12 }}>
            <Skeleton height={44} width={44} radius={999} />
            <div className="grow stack stack--tight">
              <Skeleton height={14} width="55%" />
              <Skeleton height={12} width="35%" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- modal --- */

interface ModalProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}

/**
 * Modal dialog with focus trapping and Escape-to-close. Focus moves into
 * the dialog on open and returns to the trigger on close.
 */
export function Modal({ open, title, children, onClose }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement;

    const node = ref.current;
    const focusable = node?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <h2 className="modal__title" id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

interface ConfirmProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open, title, body, confirmLabel = 'Confirm', danger, loading, onConfirm, onCancel,
}: ConfirmProps) {
  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <p className="modal__body">{body}</p>
      <div className="modal__actions">
        <Button variant="secondary" onClick={onCancel} disabled={loading}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------- banner --- */

export function Banner({
  tone = 'info', icon, children,
}: { tone?: 'info' | 'warning' | 'danger' | 'success'; icon?: IconName; children: ReactNode }) {
  return (
    <div className={`banner banner--${tone}`}>
      <Icon name={icon ?? (tone === 'danger' || tone === 'warning' ? 'alert' : 'info')} size={18} />
      <div className="grow">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------- section --- */

export function Section({
  title, action, children,
}: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section__head">
        <h2 className="section__title">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
