/* Event-sequence view of a real Scenario Lab run (shared by the Lab and Judge Mode).
 * Every step, score, decision and balance comes from the backend's ScenarioRun. `revealed` only paces how many of
 * the already-recorded steps are shown; it never invents a state. */
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Clock } from 'lucide-react';
import type { Decision, ScenarioRun, ScenarioStep } from '../api/types';
import { formatPaise } from '../design/components';

export const STAGES = ['Authentication', 'Behavioural assessment', 'Risk evaluation', 'Decision', 'Outcome'] as const;
const ACTOR: Record<ScenarioStep['actor'], string> = { customer: 'Customer', attacker: 'Attacker', trusted_device: 'Trusted device', system: 'System' };
export const DECISION_WORD: Record<Decision, string> = { ALLOW: 'Allowed', STEP_UP: 'Step-up', BLOCK: 'Blocked' };
const OUTCOME_LINE: Record<Decision, string> = {
  ALLOW: 'Allowed to continue.',
  STEP_UP: 'Held for approval on the trusted device.',
  BLOCK: 'Blocked; the session is restricted.',
};

const isAuth = (s: ScenarioStep) => /\/auth\/(login|totp)/.test(s.http.path);

/** How far through the five stages the revealed steps have reached (index into STAGES, −1 = none). */
export function stageReached(run: ScenarioRun, revealed: number): number {
  const shown = run.steps.slice(0, revealed);
  const done = revealed >= run.steps.length;
  if (done) return 4;
  if (shown.some((s) => s.decision)) return 3;
  if (shown.some((s) => s.risk_score != null)) return 2;
  if (shown.some(isAuth)) return shown.length > 1 ? 1 : 0;
  return shown.length ? 0 : -1;
}

export function StageRail({ reached, large }: { reached: number; large?: boolean }) {
  return (
    <ol aria-label="Pipeline stages" className={`grid grid-cols-5 gap-2 ${large ? 'text-[1rem]' : 'text-[0.875rem]'}`}>
      {STAGES.map((st, i) => {
        const on = i <= reached;
        return (
          <li key={st} aria-current={i === reached ? 'step' : undefined} className="min-w-0">
            <span className="block h-[3px] rounded-full transition-colors duration-500" style={{ background: on ? 'var(--electric)' : 'var(--silver)' }} />
            <span className={`mt-2 block truncate ${on ? 'font-medium text-[color:var(--ink)]' : 'text-[color:var(--ink-3)]'}`}>
              <span className="rn-num mr-1.5 text-[color:var(--ink-3)]">{i + 1}</span>{st}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function StepMarker({ d }: { d: Decision | null }) {
  const color = d === 'BLOCK' ? 'var(--block)' : d === 'STEP_UP' ? 'var(--stepup)' : d === 'ALLOW' ? 'var(--electric)' : 'var(--silver)';
  return <span aria-hidden className="block h-3 w-3" style={{ background: color, borderRadius: d === 'ALLOW' || !d ? 999 : 2, transform: d === 'STEP_UP' ? 'rotate(45deg)' : undefined, boxShadow: '0 0 0 4px var(--surface)' }} />;
}

export function RunSequence({ run, revealed = run.steps.length, large }: { run: ScenarioRun; revealed?: number; large?: boolean }) {
  const reduce = useReducedMotion();
  const steps = run.steps.slice(0, revealed);
  return (
    <ol className="relative" aria-label="Run steps" aria-live="polite">
      <span aria-hidden className="absolute bottom-3 left-[5px] top-3 w-px bg-[var(--silver-2)]" />
      <AnimatePresence initial={false}>
        {steps.map((st) => (
          <motion.li key={st.n} initial={reduce ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }} className="relative">
            {st.http.status === 0 ? (
              /* simulated time passing: a marker on the spine, not a request */
              <div className="flex items-center gap-3 py-2.5 pl-7">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--hairline)] bg-[var(--surface-2)] px-3 py-1 text-[0.875rem] text-[color:var(--ink-2)]">
                  <Clock size={13} aria-hidden /><span className="sr-only">Simulated time: </span>{st.action}{st.note && <span className="text-[color:var(--ink-3)]">, {st.note}</span>}
                </span>
              </div>
            ) : (
              <div className={`grid grid-cols-[12px_1fr_auto] items-start gap-x-4 ${large ? 'py-4' : 'py-3'}`}>
                <span className="pt-1.5"><StepMarker d={st.decision} /></span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className={`text-[0.875rem] font-medium ${st.actor === 'attacker' ? 'text-[color:var(--block)]' : 'text-[color:var(--ink-3)]'}`}>{ACTOR[st.actor]}</span>
                    <span className={`${large ? 'text-[1.1875rem]' : 'text-[1rem]'} font-medium text-[color:var(--ink)]`}>{st.action}</span>
                  </p>
                  {st.note && <p className="mt-0.5 text-[0.9375rem] text-[color:var(--ink-2)]">{st.note}</p>}
                  <p className="mt-1 break-all font-mono text-[0.8125rem] text-[color:var(--ink-3)]">
                    {st.http.method} {st.http.path} <span className={st.http.status >= 400 ? 'text-[color:var(--block)]' : ''}>→ {st.http.status}</span>
                  </p>
                </div>
                <div className="text-right">
                  {st.risk_score != null && <p className={`rn-display rn-num ${large ? 'text-[2.25rem]' : 'text-[1.75rem]'}`}>{st.risk_score.toFixed(1)}</p>}
                  {st.decision && <p className="rn-state justify-end text-[0.9375rem]" data-d={st.decision}>{DECISION_WORD[st.decision]}</p>}
                </div>
              </div>
            )}
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}

/** The outcome: final decision and what happened to the protected balance (real before/after from the run). */
export function RunOutcome({ run, large }: { run: ScenarioRun; large?: boolean }) {
  const delta = run.protected_balance_after_paise - run.protected_balance_before_paise;
  const d = run.final_decision;
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div>
        <p className="text-[0.9375rem] text-[color:var(--ink-3)]">Final decision</p>
        {d ? <p className={`rn-display mt-1 ${large ? 'text-[clamp(3rem,6vw,5rem)]' : 'text-[2.75rem]'}`} style={{ color: d === 'BLOCK' ? 'var(--block)' : d === 'STEP_UP' ? 'var(--stepup)' : 'var(--electric-ink)' }}>{DECISION_WORD[d]}</p>
          : <p className="mt-1 text-[color:var(--ink-2)]">No risk decision recorded.</p>}
        {d && <p className="mt-1 text-[color:var(--ink-2)]">{OUTCOME_LINE[d]}</p>}
      </div>
      <div>
        <p className="text-[0.9375rem] text-[color:var(--ink-3)]">Protected balance ({run.username})</p>
        <p className={`rn-display rn-num mt-1 ${large ? 'text-[clamp(2.5rem,4.5vw,3.75rem)]' : 'text-[2.25rem]'}`}>{formatPaise(run.protected_balance_after_paise, true)}</p>
        <p className="mt-1 text-[color:var(--ink-2)]">
          {delta === 0 ? <>Unchanged from {formatPaise(run.protected_balance_before_paise, true)}.</>
            : <>Was {formatPaise(run.protected_balance_before_paise, true)}; <span className={delta < 0 ? 'font-medium text-[color:var(--block)]' : ''}>{delta < 0 ? 'down' : 'up'} {formatPaise(Math.abs(delta), true)}</span>.</>}
        </p>
      </div>
    </div>
  );
}
