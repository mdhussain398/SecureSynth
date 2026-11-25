import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CheckCircle2, Clock3, LogIn, Phone, ShieldCheck, Smartphone } from 'lucide-react';
import { useMyIncident, qk } from '../../api/queries';
import type { MyIncident } from '../../api/types';
import { Button, fmtTime } from '../../design/components';

type View = { key: string; title: string; body: string; icon: typeof ShieldCheck; tone: 'wait' | 'verify' | 'ok' | 'stop' };

function viewOf(d: MyIncident | undefined, first: string): View {
  const inc = d?.incident;
  if (!inc) return { key: 'none', icon: ShieldCheck, tone: 'stop', title: 'Your account is protected',
    body: `${first}, we noticed activity that did not look like you, so we paused payments and payee changes on this sign-in. Your balance and saved payees are safe. Sign in again to continue; your next sign-in is checked from scratch.` };
  switch (inc.status) {
    case 'pending_review': return { key: 'pending', icon: Clock3, tone: 'wait', title: 'Your account is protected',
      body: `${first}, we noticed activity that did not look like you, so we paused payments and payee changes. Your balance and saved payees are safe. We have sent this to the bank’s security team, who will review it shortly.` };
    case 'verification_required': return { key: 'verify', icon: Smartphone, tone: 'verify', title: 'Confirm it’s you',
      body: 'The bank’s security team asks you to confirm on your registered trusted device. Open it and pick the number below. Only do this if you are the one using this sign-in.' };
    case 'access_restored': return d!.next_step === 'continue'
      ? { key: 'restored', icon: CheckCircle2, tone: 'ok', title: 'Access restored', body: 'The security team reviewed the activity and restored this sign-in. Payments you tried earlier were not sent; start a new one if you still need it.' }
      : { key: 'restored-signin', icon: CheckCircle2, tone: 'ok', title: 'Access restored', body: 'The security team reviewed the activity. For your safety this sign-in has ended. Sign in again to continue; payments you tried earlier were not sent.' };
    case 'restriction_retained': return { key: 'retained', icon: Phone, tone: 'stop', title: 'Restriction kept in place',
      body: 'After review, the bank’s security team kept this restriction in place to protect your account. Please contact the bank’s fraud line (simulated) to continue.' };
  }
}

const TONE: Record<View['tone'], string> = { wait: 'text-[var(--accent)]', verify: 'text-[var(--stepup)]', ok: 'text-[var(--allow)]', stop: 'text-[var(--accent)]' };
const STEPS: { key: string; label: string }[] = [
  { key: 'pending_review', label: 'Pending analyst review' }, { key: 'verification_required', label: 'Additional verification required' },
  { key: 'done', label: 'Access restored or restriction retained' },
];

/** Calm, protective notice for restricted sessions, with live incident status from the bank's analyst.
 * Never shows scores, thresholds or feature names. Polls a read-only endpoint; the customer cannot change the incident. */
export function RestrictedNotice({ name, onSignOut }: { name: string; onSignOut: () => void }) {
  const q = useMyIncident(true);
  const qc = useQueryClient();
  const nav = useNavigate();
  const reduce = useReducedMotion();
  const first = name.split(' ')[0];
  const v = viewOf(q.data, first);
  const inc = q.data?.incident;
  const handled = useRef(false);

  // Analyst restored this session: refresh auth + bank state once, then continue into the portal (no reload, no loop).
  useEffect(() => {
    if (handled.current || q.data?.next_step !== 'continue' || !inc) return;
    handled.current = true;
    const t = setTimeout(() => {
      qc.removeQueries({ queryKey: ['bank'] });
      qc.invalidateQueries({ queryKey: qk.me });
      qc.removeQueries({ queryKey: qk.myIncident });
      nav('/bank', { replace: true });
    }, 1600);
    return () => clearTimeout(t);
  }, [q.data, inc, qc, nav]);

  const signInAgain = () => { qc.clear(); nav('/login', { replace: true }); };
  const unauth = q.error?.status === 401;
  const stepIdx = inc ? (inc.status === 'pending_review' ? 0 : inc.status === 'verification_required' ? 1 : 2) : -1;

  return (
    <section className="rn-glass max-w-xl mx-auto rounded-[var(--radius-l)] p-7 sm:p-11" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={v.key} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: -6 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
          <v.icon size={30} className={TONE[v.tone]} aria-hidden />
          <h1 className="rn-display text-[clamp(2.5rem,6vw,3.5rem)] mt-4">{v.title}</h1>
          <p className="text-[1.0625rem] text-[var(--ink-2)] mt-3 leading-relaxed">{v.body}</p>
          {inc?.verification && (
            <div className="mt-6 rounded-[var(--radius-m)] border border-[color:var(--stepup-line)] bg-[var(--stepup-tint)] p-5 text-center">
              <p className="text-[0.875rem] text-[var(--ink-2)]">Pick this number on your trusted device</p>
              <p className="rn-display tnum text-[4rem] leading-none mt-2" aria-label={`Number ${inc.verification.number_match}`}>{inc.verification.number_match}</p>
              <p className="text-[0.75rem] text-[var(--ink-3)] mt-2">Expires {fmtTime(inc.verification.expires_at)}</p>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {inc && (
        <div className="mt-7">
          <h2 className="text-[1rem] font-semibold">Case status <span className="font-normal text-[0.8125rem] text-[var(--ink-3)]">· reference #{inc.id} · updated {fmtTime(inc.updated_at)}</span></h2>
          <ol className="mt-3 space-y-2">
            {STEPS.map((s, i) => {
              const state = i < stepIdx ? 'done' : i === stepIdx ? 'now' : 'next';
              if (s.key === 'verification_required' && stepIdx !== 1) return null;
              return (
                <li key={s.key} className={`flex items-center gap-3 text-[0.9375rem] ${state === 'next' ? 'text-[var(--ink-3)]' : 'text-[var(--ink)]'}`}>
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${state === 'now' ? (i === 2 ? (inc.status === 'access_restored' ? 'bg-[var(--allow)]' : 'bg-[var(--ink-2)]') : 'bg-[var(--electric)] animate-pulse motion-reduce:animate-none') : state === 'done' ? 'bg-[var(--ink-3)]' : 'border border-[var(--hairline-strong)]'}`} aria-hidden />
                  {i === 2 && stepIdx === 2 ? (inc.status === 'access_restored' ? 'Access restored' : 'Restriction retained') : s.label}
                  {state === 'now' && i < 2 && <span className="sr-only">(current)</span>}
                </li>
              );
            })}
          </ol>
          {stepIdx < 2 && <p className="mt-3 text-[0.8125rem] text-[var(--ink-3)]">This page updates on its own. You do not need to refresh.</p>}
        </div>
      )}

      {(!inc || inc.status === 'pending_review') && (
        <>
          <h2 className="text-[1rem] font-semibold mt-7">What you can do</h2>
          <ul className="mt-3 space-y-3 text-[var(--ink-2)]">
            <li className="flex gap-3"><Smartphone size={18} className="shrink-0 mt-0.5 text-[var(--ink-3)]" aria-hidden />Approve requests on your registered phone only if you started them.</li>
            <li className="flex gap-3"><Phone size={18} className="shrink-0 mt-0.5 text-[var(--ink-3)]" aria-hidden />If you did not try to sign in or send money, contact the bank's fraud line (simulated) and change your password.</li>
          </ul>
        </>
      )}

      <div className="mt-8 flex flex-wrap gap-2">
        {(q.data?.next_step === 'sign_in_again' || unauth) ? (
          <Button onClick={signInAgain}><LogIn size={16} aria-hidden />Sign in again</Button>
        ) : q.data?.next_step === 'continue' ? (
          <Button onClick={() => { handled.current = true; qc.removeQueries({ queryKey: ['bank'] }); qc.invalidateQueries({ queryKey: qk.me }); nav('/bank', { replace: true }); }}>Continue to your account</Button>
        ) : (
          <Button variant="secondary" onClick={onSignOut}>Sign out</Button>
        )}
      </div>
    </section>
  );
}
