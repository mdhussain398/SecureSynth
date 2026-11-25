/* Command Centre — Intelligence workspace (prototype). Admin-only data, fetched from the same authorised
 * endpoints as the existing console; every number, signal and decision below comes from the backend. */
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useBaseline, useLogout, useMe, useSessionDetail, useSessions } from '../api/queries';
import type { Decision, RiskAssessment } from '../api/types';
import './rn.css';
import { IdentityOrb } from './orb/IdentityOrb';
import type { OrbSignal, SignalLevel } from './orb/types';
import { AnimatedNumber, Contours, GlassNav, spring } from './primitives';

const SIGNAL_LABEL: Record<string, string> = {
  device_recognised: 'Browser', hour_rarity: 'Time of day', city_known: 'Location', log_km_from_home: 'Distance from home',
  travel_speed_kmh: 'Travel speed', amount_robust_z: 'Amount', txn_velocity_ratio: 'Transfer frequency',
  beneficiary_new: 'New payee', beneficiary_fresh: 'Payee added this session', log_secs_login_to_sensitive: 'Speed to act',
  sensitive_seq: 'Add-then-pay sequence', failed_auth_24h: 'Failed sign-ins', travel_window_active: 'Verified travel window',
};
const SEV: Record<string, SignalLevel> = { low: 1, medium: 2, high: 3 };
const CHECKPOINT: Record<string, string> = { login: 'Sign-in', beneficiary_add: 'Payee add', transfer: 'Transfer', profile_change: 'Profile change' };
const WORD: Record<Decision, string> = { ALLOW: 'Allowed', STEP_UP: 'Step-up', BLOCK: 'Blocked' };

function signalsOf(a: RiskAssessment | undefined): OrbSignal[] {
  if (!a) return [];
  const dev = new Map(a.deviations.map((d) => [d.feature, SEV[d.severity] ?? 1]));
  return Object.keys(SIGNAL_LABEL).filter((k) => k in a.features)
    .map((k) => ({ id: k, label: SIGNAL_LABEL[k], level: (dev.get(k) ?? 0) as SignalLevel }));
}

function fmtTime(ts: string) {
  const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(ts) ? ts : `${ts}Z`);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export function Intelligence() {
  const me = useMe();
  const logout = useLogout();
  const reduce = useReducedMotion();
  const sessions = useSessions('');
  const rows = useMemo(() => (sessions.data ?? []).filter((s) => s.assessments_count > 0 && s.username !== me.data?.username), [sessions.data, me.data]);
  const [picked, setPicked] = useState<string | null>(null);
  const sid = picked ?? rows[0]?.id ?? '';
  const detail = useSessionDetail(sid);
  const [cpPick, setCpPick] = useState<number | null>(null);
  const assessments = detail.data?.assessments ?? [];
  const a = assessments.find((x) => x.id === cpPick) ?? assessments[assessments.length - 1];
  const signals = useMemo(() => signalsOf(a), [a]);
  const [sel, setSel] = useState<string | null>(null);
  const strongest = [...signals].sort((x, y) => y.level - x.level)[0];
  const focus = signals.find((s) => s.id === sel) ?? strongest;
  const dev = a?.deviations.find((d) => d.feature === focus?.id);
  const baseline = useBaseline(detail.data ? String(detail.data.session.user_id) : '');
  const [open, setOpen] = useState(false);

  if (me.isError) return <Navigate to="/login" replace />;
  if (me.data && me.data.role !== 'admin') return <Navigate to="/bank" replace />;

  const policyTotal = a ? a.policy.reduce((s, p) => s + p.points, 0) : 0;

  return (
    <main className="rn relative isolate min-h-[100dvh] overflow-x-hidden">
      <Contours className="absolute inset-0 -z-10 h-full w-full opacity-60" hourProfile={baseline.data?.trusted.hour_profile ?? null} levels={16} />

      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 px-5 py-4 sm:px-8">
        <Link to="/" className="flex items-center gap-2.5" aria-label="SecureSynth home">
          <svg width="26" height="26" viewBox="0 0 30 30" aria-hidden><circle cx="15" cy="15" r="13.5" fill="none" stroke="#101828" strokeWidth="1.5" /><circle cx="15" cy="15" r="4.5" fill="#005BFF" /></svg>
          <span className="hidden font-semibold sm:inline">Command Centre</span>
        </Link>
        <div className="overflow-x-auto"><GlassNav label="Console" items={[
          { to: '/soc/intelligence', label: 'Intelligence' }, { to: '/soc', label: 'Sessions', end: true },
          { to: '/soc/evaluation', label: 'Evaluation' }, { to: '/lab', label: 'Lab' },
        ]} /></div>
        <button type="button" className="rn-btn rn-btn-ghost min-h-10 text-[length:var(--t-sm)]" onClick={() => logout.mutate()}>Sign out</button>
      </header>

      {sessions.isPending || me.isPending ? (
        <p className="px-8 pt-24 text-[color:var(--graphite-3)]" aria-busy="true">Loading live sessions</p>
      ) : rows.length === 0 ? (
        <section className="mx-auto max-w-xl px-8 pt-28 text-center">
          <h1 className="rn-display text-[length:var(--t-2xl)]">No sessions to investigate yet.</h1>
          <p className="mt-4 text-[color:var(--graphite-2)]">Sign in as a customer or run a scenario in the Lab, and its risk checkpoints will appear here live.</p>
          <Link to="/lab" className="rn-btn rn-btn-primary mt-8">Open the Scenario Lab</Link>
        </section>
      ) : (
        <div className="grid gap-8 px-5 pb-12 sm:px-8 lg:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.5fr)_minmax(240px,0.8fr)] lg:gap-6">
          {/* Left: the reading. */}
          <section aria-labelledby="who" className="order-2 lg:order-1 lg:pt-10">
            <p className="text-[length:var(--t-sm)] text-[color:var(--graphite-3)]">{detail.data ? `${detail.data.session.city} (simulated), ${detail.data.session.device_recognised ? 'recognised browser' : 'unrecognised browser'}${detail.data.session.is_lab ? ', lab session' : ''}` : ' '}</p>
            <h1 id="who" className="rn-display mt-2 text-[length:var(--t-2xl)]">{detail.data?.session.display_name ?? ' '}</h1>
            {a && (
              <>
                <div className="mt-8 flex items-end gap-4">
                  <span className="rn-display text-[clamp(5rem,9vw,8.5rem)] leading-[0.8]"><AnimatedNumber value={a.risk_score} /></span>
                  <div className="pb-2">
                    <AnimatePresence mode="wait">
                      <motion.p key={a.id} className="rn-state text-[length:var(--t-lg)]" data-d={a.decision}
                        initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={spring}>
                        {WORD[a.decision]}
                      </motion.p>
                    </AnimatePresence>
                    <p className="text-[length:var(--t-sm)] text-[color:var(--graphite-3)]">risk index at {CHECKPOINT[a.checkpoint] ?? a.checkpoint.toLowerCase()}</p>
                  </div>
                </div>
                <p className="mt-3 max-w-[26rem] text-[length:var(--t-sm)] text-[color:var(--graphite-3)]">
                  A 0–100 rarity percentile with transparent policy points, not a probability of fraud. Step-up at {a.thresholds.step_up}, block at {a.thresholds.block}.
                </p>

                {/* Signal inspector: the selected behavioural signal, observed vs this customer's baseline. */}
                <div className="mt-8 border-t border-[color:var(--silver-2)] pt-6" aria-live="polite">
                  <p className="text-[length:var(--t-sm)] text-[color:var(--graphite-3)]">Signal</p>
                  <p className="mt-1 text-[length:var(--t-lg)] font-semibold">{focus?.label ?? 'No signals'}</p>
                  {dev ? (
                    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[length:var(--t-base)]">
                      <dt className="text-[color:var(--graphite-3)]">Observed</dt><dd className="font-medium">{dev.observed}</dd>
                      <dt className="text-[color:var(--graphite-3)]">Usual</dt><dd>{dev.baseline}</dd>
                      <dt className="text-[color:var(--graphite-3)]">Severity</dt><dd className="capitalize">{dev.severity}</dd>
                    </dl>
                  ) : focus ? <p className="mt-2 text-[color:var(--graphite-2)]">Within this customer’s normal behaviour at this checkpoint.</p> : null}
                </div>

                <div className="mt-6">
                  <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
                    className="text-[length:var(--t-sm)] font-medium text-[color:var(--electric-ink)] underline-offset-4 hover:underline">
                    {open ? 'Hide technical details' : 'Show technical details'}
                  </button>
                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: reduce ? 0 : 0.35, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
                        <dl className="mt-4 grid grid-cols-[1fr_auto] gap-y-1.5 text-[length:var(--t-sm)]">
                          <dt className="text-[color:var(--graphite-3)]">ML anomaly index × weight {a.ml_weight}</dt><dd className="rn-num text-right">{(a.ml.index * a.ml_weight).toFixed(1)}</dd>
                          {a.policy.map((p) => (<FragmentRow key={p.rule} label={p.label} value={`${p.points > 0 ? '+' : ''}${p.points}`} />))}
                          <dt className="font-medium">Score (clipped 0–100)</dt><dd className="rn-num text-right font-medium">{a.risk_score.toFixed(1)}</dd>
                          <dt className="text-[color:var(--graphite-3)]">Policy total</dt><dd className="rn-num text-right">{policyTotal > 0 ? '+' : ''}{policyTotal}</dd>
                          <dt className="text-[color:var(--graphite-3)]">Model, latency</dt><dd className="text-right">{a.model_version}, {a.latency_ms.toFixed(1)} ms</dd>
                        </dl>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <Link to={`/soc/sessions/${encodeURIComponent(sid)}`} className="mt-5 block text-[length:var(--t-sm)] font-medium underline underline-offset-4">
                    Open the full investigation and what-if
                  </Link>
                </div>
              </>
            )}
          </section>

          {/* Centre: the dominant focal visualisation. */}
          <section aria-label="Behavioural digital twin" className="order-1 lg:order-2">
            <div className="mx-auto max-w-[min(680px,78vh)]">
              <IdentityOrb signals={signals} state={a?.decision ?? 'idle'} selected={focus?.id} onSelect={setSel} />
            </div>
            {/* Risk telemetry across this session's checkpoints. */}
            <ol className="mx-auto mt-2 flex max-w-[560px] items-center justify-center gap-2" aria-label="Checkpoints in this session">
              {assessments.map((x, i) => (
                <li key={x.id} className="flex items-center gap-2">
                  {i > 0 && <span aria-hidden className="h-px w-8 bg-[var(--silver)] sm:w-14" />}
                  <button type="button" onClick={() => setCpPick(x.id)} aria-pressed={x.id === a?.id}
                    className={`rounded-full px-3 py-1.5 text-[length:var(--t-sm)] transition-colors ${x.id === a?.id ? 'bg-[var(--graphite)] text-[color:var(--crystal)]' : 'text-[color:var(--graphite-2)] hover:bg-[rgba(16,24,40,0.05)]'}`}>
                    <span className="rn-state" data-d={x.decision} style={x.id === a?.id ? { color: 'inherit' } : undefined}>{CHECKPOINT[x.checkpoint] ?? x.checkpoint} <span className="rn-num">{x.risk_score.toFixed(0)}</span></span>
                  </button>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-center text-[length:var(--t-xs)] text-[color:var(--graphite-3)]">
              Each point is one of this customer’s behavioural signals at the selected checkpoint; colour shows how far it deviates from their baseline. The orb visualises the engine’s output; it is not the model.
            </p>
            <ul className="sr-only">{signals.map((s) => <li key={s.id}><button type="button" onClick={() => setSel(s.id)}>{s.label}: {['normal', 'low', 'medium', 'high'][s.level]} deviation</button></li>)}</ul>
          </section>

          {/* Right: readable event stream. */}
          <section aria-labelledby="stream" className="order-3 lg:pt-10">
            <div className="flex items-baseline justify-between">
              <h2 id="stream" className="text-[length:var(--t-md)] font-semibold">Live sessions</h2>
              <span className="text-[length:var(--t-xs)] text-[color:var(--graphite-3)]">updates every 3 s</span>
            </div>
            <ul className="mt-3">
              {rows.slice(0, 9).map((s) => {
                const on = s.id === sid;
                return (
                  <li key={s.id}>
                    <button type="button" onClick={() => { setPicked(s.id); setCpPick(null); setSel(null); }} aria-current={on || undefined}
                      className={`relative grid w-full grid-cols-[1fr_auto] gap-x-3 border-t border-[color:var(--silver-2)] py-3 text-left transition-colors ${on ? '' : 'hover:bg-[rgba(16,24,40,0.03)]'}`}>
                      {on && <motion.span layoutId="stream-mark" transition={spring} className="absolute -left-3 top-3 bottom-3 w-[3px] rounded-full bg-[var(--electric)]" />}
                      <span className="font-medium">{s.display_name}</span>
                      <span className="rn-num text-right font-medium">{s.latest_score?.toFixed(1) ?? '—'}</span>
                      <span className="text-[length:var(--t-sm)] text-[color:var(--graphite-3)]">{s.city}, {fmtTime(s.last_seen)}</span>
                      {s.latest_decision ? <span className="rn-state justify-end text-[length:var(--t-sm)]" data-d={s.latest_decision}>{WORD[s.latest_decision]}</span> : <span />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}
    </main>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (<><dt className="text-[color:var(--graphite-3)]">{label}</dt><dd className="rn-num text-right">{value}</dd></>);
}
