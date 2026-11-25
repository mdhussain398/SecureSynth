import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Info, OctagonX, ShieldAlert, ShieldCheck, ShieldQuestion, Inbox, RotateCw } from 'lucide-react';
import type { Decision } from '../api/types';
import { ApiError } from '../api/client';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

// ---------- Button ----------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const BTN_VARIANT: Record<Variant, string> = {
  primary: 'bg-[var(--accent)] text-[var(--accent-ink)] hover:bg-[var(--accent-hover)] border border-transparent',
  secondary: 'bg-[var(--surface)] text-[var(--ink)] border border-[var(--hairline-strong)] hover:bg-[var(--surface-2)]',
  ghost: 'bg-transparent text-[var(--ink-2)] border border-transparent hover:bg-[var(--surface-2)] hover:text-[var(--ink)]',
  danger: 'bg-[var(--surface)] text-[var(--block)] border border-[var(--block-line)] hover:bg-[var(--block-tint)]',
};
const BTN_SIZE = { sm: 'h-8 px-3 text-[0.8125rem]', md: 'h-10 px-4 text-[0.9375rem]', lg: 'h-12 px-5 text-base' };
const BTN_BASE = 'inline-flex items-center justify-center gap-2 rounded-[var(--radius-s)] font-medium transition-colors no-underline whitespace-nowrap';
/** A router link that looks like a button (never nest a <button> inside a link). */
export function ButtonLink({ to, variant = 'primary', size = 'md', className, children, ...rest }:
  LinkProps & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  return <Link to={to} {...rest} className={cx(BTN_BASE, BTN_VARIANT[variant], BTN_SIZE[size], className as string)}>{children}</Link>;
}
export function Button({ variant = 'primary', size = 'md', className, loading, children, disabled, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-[var(--accent)] text-[var(--accent-ink)] hover:bg-[var(--accent-hover)] border border-transparent',
    secondary: 'bg-[var(--surface)] text-[var(--ink)] border border-[var(--hairline-strong)] hover:bg-[var(--surface-2)]',
    ghost: 'bg-transparent text-[var(--ink-2)] border border-transparent hover:bg-[var(--surface-2)] hover:text-[var(--ink)]',
    danger: 'bg-[var(--surface)] text-[var(--block)] border border-[var(--block-line)] hover:bg-[var(--block-tint)]',
  };
  const sizes = { sm: 'h-8 px-3 text-[0.8125rem]', md: 'h-10 px-4 text-[0.9375rem]', lg: 'h-12 px-5 text-base' };
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx('inline-flex items-center justify-center gap-2 rounded-[var(--radius-s)] font-medium transition-colors disabled:opacity-55 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap', styles[variant], sizes[size], className)}
    >
      {children}
    </button>
  );
}

// ---------- Card ----------
export function Card({ title, actions, children, className, padded = true, as: Tag = 'section', description }:
  { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean; as?: 'section' | 'div' | 'article'; description?: ReactNode }) {
  return (
    <Tag className={cx('min-w-0 bg-[var(--surface)] border border-[var(--hairline)] rounded-[var(--radius-m)]', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-4 pt-3.5 pb-2.5 border-b border-[var(--hairline)]">
          <div className="min-w-0 flex-1 basis-[220px]">
            {title && <h2 className="text-[0.9375rem] font-semibold leading-tight">{title}</h2>}
            {description && <p className="text-[0.8125rem] text-[var(--ink-3)] mt-0.5">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-4' : undefined}>{children}</div>
    </Tag>
  );
}

// ---------- Badge ----------
type Tone = 'neutral' | 'allow' | 'stepup' | 'block' | 'info';
export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  const t: Record<Tone, string> = {
    neutral: 'bg-[var(--surface-2)] text-[var(--ink-2)] border-[var(--hairline)]',
    allow: 'bg-[var(--allow-tint)] text-[var(--allow)] border-[var(--allow-line)]',
    stepup: 'bg-[var(--stepup-tint)] text-[var(--stepup)] border-[var(--stepup-line)]',
    block: 'bg-[var(--block-tint)] text-[var(--block)] border-[var(--block-line)]',
    info: 'bg-[var(--info-tint)] text-[var(--info)] border-[var(--info-line)]',
  };
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-[var(--radius-s)] border px-1.5 py-px text-[0.75rem] font-medium leading-5', t[tone], className)}>{children}</span>;
}

// ---------- DecisionPill: colour + icon + text, never colour alone ----------
const DECISION: Record<Decision, { tone: Tone; label: string; Icon: typeof ShieldCheck }> = {
  ALLOW: { tone: 'allow', label: 'Allow', Icon: ShieldCheck },
  STEP_UP: { tone: 'stepup', label: 'Step-up', Icon: ShieldQuestion },
  BLOCK: { tone: 'block', label: 'Block', Icon: ShieldAlert },
};
export function DecisionPill({ decision, className }: { decision: Decision | null | undefined; className?: string }) {
  if (!decision) return <span className="text-[var(--ink-3)]">—</span>;
  const d = DECISION[decision];
  return (
    <Badge tone={d.tone} className={cx('rounded-[var(--radius-pill)] px-2', className)}>
      <d.Icon size={13} aria-hidden strokeWidth={2.2} />
      {d.label}
    </Badge>
  );
}
export const decisionLabel = (d: Decision) => DECISION[d].label;

// ---------- RiskGauge: a 0–100 risk index meter (never "probability") ----------
export function RiskGauge({ value, thresholds, size = 'md' }: { value: number | null; thresholds?: { step_up: number; block: number }; size?: 'sm' | 'md' }) {
  const v = value == null ? null : Math.max(0, Math.min(100, value));
  const tone = v == null || !thresholds ? 'var(--ink-2)' : v >= thresholds.block ? 'var(--block)' : v >= thresholds.step_up ? 'var(--stepup)' : 'var(--allow)';
  return (
    <div className={size === 'sm' ? 'w-24' : 'w-full'}>
      {size === 'md' && (
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-[0.8125rem] text-[var(--ink-3)]">Risk index</span>
          <span className="tnum text-[1.375rem] font-semibold leading-none">{v == null ? '—' : v.toFixed(1)}<span className="text-[0.8125rem] font-normal text-[var(--ink-3)]"> / 100</span></span>
        </div>
      )}
      <div
        role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v ?? undefined}
        aria-label={`Risk index ${v == null ? 'not available' : v.toFixed(1)} out of 100`}
        className={cx('relative rounded-full bg-[var(--surface-2)] border border-[var(--hairline)]', size === 'sm' ? 'h-1.5' : 'h-2.5')}
      >
        {v != null && <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${v}%`, background: tone }} />}
        {thresholds && [thresholds.step_up, thresholds.block].map((t) => (
          <span key={t} className="absolute -top-0.5 -bottom-0.5 w-px bg-[var(--ink-2)]" style={{ left: `${t}%` }} aria-hidden />
        ))}
      </div>
      {size === 'md' && thresholds && (
        <div className="relative h-4 mt-1 text-[0.6875rem] text-[var(--ink-3)] tnum" aria-hidden>
          <span className="absolute -translate-x-1/2" style={{ left: `${thresholds.step_up}%` }}>step-up {thresholds.step_up}</span>
          <span className="absolute -translate-x-1/2" style={{ left: `${thresholds.block}%` }}>block {thresholds.block}</span>
        </div>
      )}
    </div>
  );
}

// ---------- Stat ----------
export function Stat({ label, value, hint, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className="text-[0.8125rem] text-[var(--ink-3)]">{label}</div>
      <div className="tnum text-[1.375rem] font-semibold leading-tight mt-0.5">{value}</div>
      {hint && <div className="text-[0.75rem] text-[var(--ink-3)] mt-0.5">{hint}</div>}
    </div>
  );
}

// ---------- DataTable ----------
export interface Column<T> { key: string; header: ReactNode; cell: (row: T) => ReactNode; align?: 'left' | 'right'; className?: string }
export function DataTable<T>({ columns, rows, rowKey, caption, onRowClick, dense = true }:
  { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string | number; caption?: string; onRowClick?: (r: T) => void; dense?: boolean }) {
  return (
    <div className="overflow-x-auto -mx-px">
      <table className="w-full border-collapse text-left tnum">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-[var(--hairline)]">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx('px-3 py-2 text-[0.75rem] font-medium text-[var(--ink-3)] whitespace-nowrap', c.align === 'right' && 'text-right', c.className)}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={cx('border-b border-[var(--hairline)] last:border-b-0', onRowClick && 'cursor-pointer hover:bg-[var(--surface-2)]')}
            >
              {columns.map((c) => (
                <td key={c.key} className={cx('px-3 align-middle', dense ? 'py-2' : 'py-3', c.align === 'right' && 'text-right', c.className)}>{c.cell(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- states ----------
export function Skeleton({ className, lines = 0 }: { className?: string; lines?: number }) {
  if (lines > 0) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading">
        {Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton h-4" style={{ width: `${92 - (i % 3) * 14}%` }} />)}
      </div>
    );
  }
  return <div className={cx('skeleton', className)} aria-hidden />;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-10 gap-2">
      <Inbox size={22} className="text-[var(--ink-3)]" aria-hidden />
      <p className="font-medium">{title}</p>
      {children && <p className="text-[0.875rem] text-[var(--ink-3)] max-w-[44ch]">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, title = 'This view could not load', onRetry }: { error: unknown; title?: string; onRetry?: () => void }) {
  const msg = error instanceof ApiError ? error.message : 'Something went wrong while loading this view.';
  const code = error instanceof ApiError ? error.code : null;
  return (
    <div role="alert" className="flex flex-col items-center text-center px-6 py-10 gap-2">
      <AlertTriangle size={22} className="text-[var(--block)]" aria-hidden />
      <p className="font-medium">{title}</p>
      <p className="text-[0.875rem] text-[var(--ink-2)] max-w-[52ch]">{msg}</p>
      {code && <p className="text-[0.75rem] text-[var(--ink-3)]">Code {code}</p>}
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry} className="mt-2"><RotateCw size={14} aria-hidden />Try again</Button>}
    </div>
  );
}

// ---------- Banner ----------
export function Banner({ tone = 'info', title, children, action }: { tone?: 'info' | 'allow' | 'stepup' | 'block'; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const Icon = { info: Info, allow: CheckCircle2, stepup: ShieldQuestion, block: OctagonX }[tone];
  const t = {
    info: 'bg-[var(--info-tint)] border-[var(--info-line)] [--b-ink:var(--info)]',
    allow: 'bg-[var(--allow-tint)] border-[var(--allow-line)] [--b-ink:var(--allow)]',
    stepup: 'bg-[var(--stepup-tint)] border-[var(--stepup-line)] [--b-ink:var(--stepup)]',
    block: 'bg-[var(--block-tint)] border-[var(--block-line)] [--b-ink:var(--block)]',
  }[tone];
  return (
    <div role={tone === 'block' ? 'alert' : 'status'} className={cx('flex gap-3 items-start border rounded-[var(--radius-m)] px-4 py-3', t)}>
      <Icon size={18} className="shrink-0 mt-0.5 text-[var(--b-ink)]" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold text-[var(--ink)]">{title}</p>}
        {children && <div className="text-[0.9rem] text-[var(--ink-2)] mt-0.5">{children}</div>}
      </div>
      {action}
    </div>
  );
}

// ---------- Timeline (vertical event list; sequence is real, so markers are earned) ----------
export interface TimelineItem { id: string | number; time: string; title: ReactNode; body?: ReactNode; marker?: ReactNode }
export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="relative ml-1.5">
      {items.map((it, i) => (
        <li key={it.id} className="relative pl-5 pb-4 last:pb-0">
          {i < items.length - 1 && <span className="absolute left-[3px] top-3 bottom-0 w-px bg-[var(--hairline-strong)]" aria-hidden />}
          <span className="absolute left-0 top-[7px] h-[7px] w-[7px] rounded-full bg-[var(--ink-3)]" aria-hidden />
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <time className="tnum text-[0.75rem] text-[var(--ink-3)]">{it.time}</time>
            <span className="font-medium text-[0.875rem]">{it.title}</span>
            {it.marker}
          </div>
          {it.body && <div className="text-[0.8125rem] text-[var(--ink-2)] mt-0.5">{it.body}</div>}
        </li>
      ))}
    </ol>
  );
}

// ---------- Money: paise → ₹ with Indian digit grouping ----------
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export function formatPaise(paise: number, whole = false): string {
  return (whole ? inr0 : inr).format(paise / 100);
}
export function Money({ paise, whole, signed, direction, className }: { paise: number; whole?: boolean; signed?: boolean; direction?: 'debit' | 'credit'; className?: string }) {
  const sign = signed && direction ? (direction === 'debit' ? '− ' : '+ ') : '';
  return <span className={cx('tnum whitespace-nowrap', className)}>{sign}{formatPaise(paise, whole)}</span>;
}

// ---------- time helpers ----------
/** Parses an ISO-8601 timestamp; strings without an offset are treated as UTC (the backend emits naive UTC). */
export function parseTs(isoStr: string): Date {
  const naive = /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(isoStr);
  return new Date(naive ? `${isoStr}Z` : isoStr);
}
export function fmtTime(isoStr: string, withDate = false): string {
  const d = parseTs(isoStr);
  if (Number.isNaN(d.getTime())) return isoStr;
  return d.toLocaleString('en-IN', withDate ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false } : { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function SyntheticMarker({ className }: { className?: string }) {
  return <span className={cx('inline-flex items-center gap-1.5 text-[0.75rem] text-[var(--ink-3)]', className)}><span className="h-1.5 w-1.5 rounded-full bg-[var(--stepup)]" aria-hidden />Synthetic demo data</span>;
}
