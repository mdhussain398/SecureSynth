/* Analyst notification bell: unread count, the latest incidents, and a short toast when a new alert arrives.
 * Fed by GET /admin/incidents/summary (polled every 4 s); nothing here is simulated. */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Bell, ShieldAlert, X } from 'lucide-react';
import { useIncidentSummary, useIncidentsReadAll } from '../../api/queries';
import type { IncidentRow } from '../../api/types';
import { fmtTime, formatPaise } from '../../design/components';

const STATUS_TEXT: Record<IncidentRow['status'], string> = {
  pending_review: 'Pending review', verification_requested: 'Verification requested', session_restored: 'Session restored',
  user_cleared: 'Customer cleared', restriction_retained: 'Restriction retained', session_revoked: 'Session revoked',
};

export function NotificationBell() {
  const q = useIncidentSummary();
  const readAll = useIncidentsReadAll();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<IncidentRow | null>(null);
  const seen = useRef<Map<number, string> | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const reduce = useReducedMotion();
  const unread = q.data?.unread ?? 0;

  // Toast only for incidents that became unread after the first load (never replay old alerts on page open).
  useEffect(() => {
    if (!q.data) return;
    const now = new Map(q.data.latest.map((i) => [i.id, i.last_activity_at]));
    if (seen.current) {
      const fresh = q.data.latest.find((i) => i.unread && seen.current!.get(i.id) !== i.last_activity_at);
      if (fresh) setToast(fresh);
    }
    seen.current = now;
  }, [q.data]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 7000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog"
        aria-label={unread ? `Security notifications, ${unread} unread` : 'Security notifications'}
        className="rn-icon-btn relative">
        <Bell size={18} strokeWidth={1.75} aria-hidden />
        <AnimatePresence>
          {unread > 0 && (
            <motion.span key="n" initial={reduce ? false : { scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 28 }}
              className="absolute right-1 top-1 min-w-[18px] h-[18px] rounded-full bg-[var(--block)] px-1 text-[0.75rem] font-semibold leading-[18px] text-white tnum text-center shadow-[0_0_0_2px_var(--canvas)]">
              {unread > 99 ? '99+' : unread}
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      <span className="sr-only" aria-live="polite">{toast ? `New security incident: ${toast.display_name}, risk index ${toast.risk_score?.toFixed(1)}` : ''}</span>

      <AnimatePresence>
        {open && (
          <motion.div role="dialog" aria-label="Security notifications"
            initial={reduce ? false : { opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 top-11 z-50 w-[min(380px,calc(100vw-24px))] origin-top-right rounded-[var(--radius-l)] border border-[color:var(--hairline)] bg-[var(--surface)] shadow-[0_24px_60px_-24px_rgba(16,24,40,0.45)]">
            <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2.5 border-b border-[color:var(--hairline)]">
              <div><p className="font-semibold">Security incidents</p><p className="text-[0.75rem] text-[var(--ink-3)]">{q.data ? `${q.data.open} pending review · ${unread} unread` : 'Loading…'}</p></div>
              {unread > 0 && <button type="button" className="text-[0.8125rem] text-[var(--ink-2)] hover:text-[var(--ink)] underline-offset-2 hover:underline cursor-pointer" onClick={() => readAll.mutate()} disabled={readAll.isPending}>Mark all read</button>}
            </div>
            {q.error ? <p className="p-4 text-[0.875rem] text-[var(--block)]">{q.error.message}</p> :
              (q.data?.latest.length ?? 0) === 0 ? <p className="p-4 text-[0.875rem] text-[var(--ink-3)]">No incidents. Restrictions raised by the engine appear here automatically.</p> : (
                <ul className="max-h-[360px] overflow-y-auto">
                  {q.data!.latest.map((i) => (
                    <li key={i.id}>
                      <button type="button" onClick={() => { setOpen(false); nav(`/soc/incidents/${i.id}`); }}
                        className="flex w-full gap-3 px-4 py-3 text-left hover:bg-[var(--surface-2)] border-b border-[color:var(--hairline)] last:border-b-0 cursor-pointer">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${i.unread ? 'bg-[var(--electric)]' : 'bg-transparent'}`} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2"><span className="font-medium truncate">{i.display_name}</span><span className="text-[0.75rem] text-[var(--ink-3)] whitespace-nowrap">{fmtTime(i.last_activity_at)}</span></span>
                          <span className="block text-[0.8125rem] text-[var(--ink-2)]">
                            {i.severity === 'critical' ? 'Critical' : 'High'} · risk {i.risk_score?.toFixed(1) ?? '—'}{i.amount_paise != null ? ` · ${formatPaise(i.amount_paise, true)}` : ''}{i.ghost ? ' · ghost' : ''}{i.is_lab ? ' · lab' : ''}
                          </span>
                          <span className="block text-[0.75rem] text-[var(--ink-3)]">{STATUS_TEXT[i.status]}{i.block_count > 1 ? ` · ${i.block_count} restrictions` : ''}</span>
                        </span>
                        {i.unread && <span className="sr-only">Unread</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            <div className="px-4 py-2.5 border-t border-[color:var(--hairline)]"><Link to="/soc/incidents" onClick={() => setOpen(false)} className="text-[0.8125rem] font-medium underline underline-offset-4">Open all incidents</Link></div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && !open && (
          <motion.div role="status" initial={reduce ? false : { opacity: 0, y: -10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className="fixed right-4 top-[76px] z-50 w-[min(360px,calc(100vw-32px))] rounded-[var(--radius-l)] border border-[color:var(--block-line)] bg-[var(--surface)] p-4 shadow-[0_24px_60px_-24px_rgba(16,24,40,0.5)]">
            <div className="flex items-start gap-3">
              <ShieldAlert size={18} className="mt-0.5 shrink-0 text-[var(--block)]" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{toast.ghost ? 'Session contained in Ghost Banking' : 'New security incident'}</p>
                <p className="text-[0.875rem] text-[var(--ink-2)] mt-0.5">{toast.display_name} restricted · risk index {toast.risk_score?.toFixed(1) ?? '—'}{toast.amount_paise != null ? ` · ${formatPaise(toast.amount_paise, true)}` : ''}</p>
                <button type="button" className="mt-2 text-[0.8125rem] font-medium underline underline-offset-4 cursor-pointer" onClick={() => { setToast(null); nav(`/soc/incidents/${toast.id}`); }}>Review incident</button>
              </div>
              <button type="button" aria-label="Dismiss" className="text-[var(--ink-3)] hover:text-[var(--ink)] cursor-pointer" onClick={() => setToast(null)}><X size={15} /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
