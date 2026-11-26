/* Generic confirmation dialog for sensitive analyst actions: optional reason, fresh TOTP, typed phrase, checklist. */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import type { ApiError } from '../../api/client';
import { Badge, Banner, Button } from '../../design/components';

export interface ConfirmValues { reason: string; totp_code?: string; phrase?: string; checklist: Record<string, boolean> }

export function ConfirmDialog({ title, scope, body, warning, reason = true, totp = false, phrase, checklist, danger, verb, pending, error, success, onSubmit, onClose }: {
  title: string; scope?: string; body?: ReactNode; warning?: ReactNode; reason?: boolean; totp?: boolean; phrase?: string;
  checklist?: { key: string; label: string }[]; danger?: boolean; verb: string; pending: boolean; error: ApiError | null;
  success?: ReactNode; onSubmit: (v: ConfirmValues) => void; onClose: () => void;
}) {
  const [why, setWhy] = useState('');
  const [code, setCode] = useState('');
  const [typed, setTyped] = useState('');
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const first = useRef<HTMLElement | null>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    (first.current as HTMLElement | null)?.focus?.();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !pending) onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, pending]);
  const valid = (!reason || why.trim().length >= 8) && (!totp || /^\d{6}$/.test(code)) && (!phrase || typed === phrase)
    && (!checklist || checklist.every((c) => checks[c.key]));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) onSubmit({ reason: why.trim(), totp_code: totp ? code : undefined, phrase: phrase ? typed : undefined, checklist: checks });
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="cd-title">
      <motion.button type="button" aria-label="Close" className="absolute inset-0 bg-[rgba(16,24,40,0.42)] cursor-default" onClick={() => !pending && onClose()}
        initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} />
      <motion.form onSubmit={submit} className="relative w-full max-w-[560px] max-h-[90vh] overflow-y-auto rounded-[var(--radius-l)] border border-[color:var(--hairline)] bg-[var(--surface)] p-6 shadow-[0_30px_80px_-30px_rgba(16,24,40,0.5)]"
        initial={reduce ? false : { opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 34 }}>
        <div className="flex items-start justify-between gap-3">
          <div>{scope && <Badge tone={danger ? 'block' : 'neutral'}>{scope}</Badge>}<h2 id="cd-title" className="text-[1.25rem] font-semibold mt-2 tracking-[-0.01em]">{title}</h2></div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Close" disabled={pending}><X size={16} /></Button>
        </div>
        {success ? <div className="mt-5 space-y-4" aria-live="polite">{success}<div className="flex justify-end"><Button type="button" onClick={onClose}>Done</Button></div></div> : (
          <>
            {warning && <div className="mt-4">{warning}</div>}
            {body && <div className="mt-4 text-[0.9375rem] text-[var(--ink-2)] leading-relaxed">{body}</div>}
            {checklist && (
              <fieldset className="mt-4 space-y-2"><legend className="field-label">Confirm each statement</legend>
                {checklist.map((c, i) => (
                  <label key={c.key} className="flex items-start gap-2.5 text-[0.9375rem] cursor-pointer">
                    <input type="checkbox" className="mt-1" checked={!!checks[c.key]} onChange={(e) => setChecks((x) => ({ ...x, [c.key]: e.target.checked }))}
                      ref={i === 0 && !reason ? (el) => { first.current = el; } : undefined} />{c.label}
                  </label>
                ))}
              </fieldset>
            )}
            {reason && (
              <>
                <label htmlFor="cd-reason" className="field-label mt-5 block">Reason <span className="text-[var(--ink-3)] font-normal">(required, audited)</span></label>
                <textarea id="cd-reason" ref={(el) => { first.current = el; }} className="input mt-1 w-full min-h-[76px] resize-y" maxLength={300} value={why} onChange={(e) => setWhy(e.target.value)} />
                <p className="text-[0.75rem] text-[var(--ink-3)] mt-1">{why.trim().length < 8 ? `At least 8 characters (${why.trim().length}/8)` : `${why.trim().length}/300`}</p>
              </>
            )}
            {phrase && (
              <>
                <label htmlFor="cd-phrase" className="field-label mt-4 block">Type <span className="font-mono">{phrase}</span> to confirm</label>
                <input id="cd-phrase" className="input mt-1 w-full font-mono" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
              </>
            )}
            {totp && (
              <>
                <label htmlFor="cd-totp" className="field-label mt-4 block">Your authenticator code <span className="text-[var(--ink-3)] font-normal">(fresh authentication)</span></label>
                <input id="cd-totp" className="input mt-1 w-40 tnum tracking-[0.3em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                  value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" />
              </>
            )}
            {error && <div className="mt-4"><Banner tone="block" title="Not done">{error.message}</Banner></div>}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
              <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={!valid} loading={pending}>{verb}</Button>
            </div>
          </>
        )}
      </motion.form>
    </div>
  );
}
