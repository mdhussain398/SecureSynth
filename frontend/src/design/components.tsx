import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Info, OctagonX, ShieldAlert, ShieldCheck, ShieldQuestion, Inbox, RotateCw } from 'lucide-react';
import type { Decision } from '../api/types';
import { ApiError } from '../api/client';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

// ---------- Button ----------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const BTN_VARIANT: Record<Variant, string> = {
  primary: 'bg-[var(--graphite)] text-[color:var(--crystal)] hover:bg-[#0B1220] border border-transparent shadow-[0_10px_26px_-12px_rgba(16,24,40,0.55)] hover:shadow-[0_14px_30px_-12px_rgba(0,61,170,0.5)]',
  secondary: 'bg-[var(--surface)] text-[color:var(--ink)] border border-[color:var(--hairline)] shadow-[0_1px_2px_rgba(16,24,40,0.06)] hover:border-[color:var(--hairline-strong)]',
  ghost: 'bg-transparent text-[color:var(--ink-2)] border border-transparent hover:bg-[rgba(16,24,40,0.05)] hover:text-[color:var(--ink)]',
  danger: 'bg-[var(--surface)] text-[color:var(--block)] border border-[color:var(--block-line)] hover:bg-[var(--block-tint)]',
};
const BTN_SIZE = { sm: 'h-9 px-3.5 text-[0.875rem]', md: 'h-11 px-5 text-[0.9375rem]', lg: 'min-h-[52px] px-6 text-[1.0625rem]' };
const BTN_BASE = 'inline-flex items-center justify-center gap-2 rounded-full font-medium transition-[background-color,box-shadow,border-color,transform] duration-200 active:scale-[0.98] no-underline whitespace-nowrap';
/** A router link that looks like a button (never nest a <button> inside a link). */
export function ButtonLink({ to, variant = 'primary', size = 'md', className, children, ...rest }:
  LinkProps & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  return <Link to={to} {...rest} className={cx(BTN_BASE, BTN_VARIANT[variant], BTN_SIZE[size], className as string)}>{children}</Link>;
}
export function Button({ variant = 'primary', size = 'md', className, loading, children, disabled, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(BTN_BASE, 'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 cursor-pointer', BTN_VARIANT[variant], BTN_SIZE[size], className)}
    >
      {children}
    </button>
  );
}

// ---------- Card ----------
export function Card({ title, actions, children, className, padded = true, as: Tag = 'section', description }:
  { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean; as?: 'section' | 'div' | 'article'; description?: ReactNode }) {
  return (
    <Tag className={cx('min-w-0 bg-[var(--surface)] border border-[color:var(--hairline)] rounded-[var(--radius-m)] shadow-[var(--shadow-panel)]', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-[color:var(--hairline)]">
          <div className="min-w-0 flex-1 basis-[220px]">
            {title && <h2 className="text-[1.0625rem] font-semibold leading-tight tracking-[-0.01em]">{title}</h2>}
            {description && <p className="text-[0.875rem] text-[color:var(--ink-3)] mt-1">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-5' : undefined}>{children}</div>
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
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px text-[0.8125rem] font-medium leading-5', t[tone], className)}>{children}</span>;
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

// ---------- RiskGauge: a 0–100 risk index meter (never "probability") with decision bands ----------
export function RiskGauge({ value, thresholds, size = 'md' }: { value: number | null; thresholds?: { step_up: number; block: number }; size?: 'sm' | 'md' }) {
  const v = value == null ? null : Math.max(0, Math.min(100, value));
  const zone: Decision | null = v == null || !thresholds ? null : v >= thresholds.block ? 'BLOCK' : v >= thresholds.step_up ? 'STEP_UP' : 'ALLOW';
  const tone = zone === 'BLOCK' ? 'var(--block)' : zone === 'STEP_UP' ? 'var(--stepup)' : zone === 'ALLOW' ? 'var(--allow)' : 'var(--ink-2)';
  if (size === 'sm') {
    return (
      <div className="w-20" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v ?? undefined} aria-label={`Risk index ${v == null ? 'not available' : v.toFixed(1)} out of 100`}>
        <div className="relative h-1.5 rounded-full bg-[var(--surface-2)] border border-[var(--hairline)]">
          {v != null && <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${v}%`, background: tone }} />}
        </div>
      </div>
    );
  }
  const bands = thresholds ? [
    { from: 0, to: thresholds.step_up, c: 'var(--allow-tint)', line: 'var(--allow-line)', label: 'Allow' },
    { from: thresholds.step_up, to: thresholds.block, c: 'var(--stepup-tint)', line: 'var(--stepup-line)', label: 'Step-up' },
    { from: thresholds.block, to: 100, c: 'var(--block-tint)', line: 'var(--block-line)', label: 'Block' },
  ] : [];
  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[0.8125rem] text-[var(--ink-3)]">Risk index (0–100, not a probability)</span>
        <span className="tnum text-[1.5rem] font-semibold leading-none" style={{ color: tone }}>{v == null ? '—' : v.toFixed(1)}<span className="text-[0.8125rem] font-normal text-[var(--ink-3)]"> / 100</span></span>
      </div>
      <div role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v ?? undefined}
        aria-label={`Risk index ${v == null ? 'not available' : v.toFixed(1)} out of 100${thresholds ? `; step-up at ${thresholds.step_up}, block at ${thresholds.block}` : ''}`}
        className="relative h-7">
        <div className="absolute inset-x-0 top-1 bottom-1 flex gap-[2px] rounded-[4px] overflow-hidden border border-[var(--hairline)] bg-[var(--surface-2)]">
          {bands.map((b) => <span key={b.label} className="h-full" style={{ width: `${b.to - b.from}%`, background: b.c }} />)}
        </div>
        {v != null && (
          <span className="absolute top-0 bottom-0 w-[3px] -translate-x-1/2 rounded-full shadow-[0_0_0_2px_var(--surface)]" style={{ left: `${v}%`, background: tone }} aria-hidden />
        )}
      </div>
      {thresholds && (
        <div className="relative h-9 mt-1 text-[0.75rem] text-[var(--ink-3)] tnum" aria-hidden>
          {bands.map((b) => (
            <span key={b.label} className="absolute top-0 truncate px-1" style={{ left: `${b.from}%`, width: `${b.to - b.from}%` }}>
              <span className="block font-medium text-[var(--ink-2)]">{b.label}</span>
              <span className="block">{b.from === 0 ? `< ${thresholds.step_up}` : `≥ ${b.from}`}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Stat ----------
export function Stat({ label, value, hint, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className="text-[0.875rem] text-[color:var(--ink-3)]">{label}</div>
      <div className="serif tnum text-[1.875rem] leading-tight mt-0.5">{value}</div>
      {hint && <div className="text-[0.75rem] text-[var(--ink-3)] mt-0.5">{hint}</div>}
    </div>
  );
}

// ---------- DataTable ----------
export interface Column<T> { key: string; header: ReactNode; cell: (row: T) => ReactNode; align?: 'left' | 'right'; className?: string }
export function DataTable<T>({ columns, rows, rowKey, caption, onRowClick, dense = true, minWidth }:
  { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string | number; caption?: string; onRowClick?: (r: T) => void; dense?: boolean; minWidth?: number }) {
  return (
    <div className="overflow-x-auto -mx-px" tabIndex={minWidth ? 0 : undefined} role={minWidth ? 'region' : undefined} aria-label={minWidth ? `${caption ?? 'Table'} (scrolls horizontally)` : undefined}>
      <table className="w-full border-collapse text-left tnum" style={minWidth ? { minWidth } : undefined}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-[var(--hairline)]">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx('px-3 py-2.5 text-[0.8125rem] font-medium text-[color:var(--ink-3)] whitespace-nowrap bg-[var(--surface-2)]', c.align === 'right' && 'text-right', c.className)}>{c.header}</th>
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
    <div role={tone === 'block' ? 'alert' : 'status'} className={cx('flex gap-3 items-start border rounded-[var(--radius-m)] px-4 py-3.5', t)}>
      <Icon size={18} className="shrink-0 mt-0.5 text-[var(--b-ink)]" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold text-[var(--ink)]">{title}</p>}
        {children && <div className="text-[0.9375rem] text-[color:var(--ink-2)] mt-0.5">{children}</div>}
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
