/* Command Centre — Intelligence workspace (prototype). Admin-only data, fetched from the same authorised
 * endpoints as the existing console; every number, signal and decision below comes from the backend. */
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useMemo, useState, type CSSProperties } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useBaseline, useLogout, useMe, useSessionDetail, useSessions } from '../api/queries';
import type { Decision } from '../api/types';
import './rn.css';
import { consoleNav } from '../layout/layouts';
import { IdentityOrb } from './orb/IdentityOrb';
import { LEVEL_COLOR, STATE_COLOR, type OrbSignal } from './orb/types';
import { signalsOf } from './signals';
import { AnimatedNumber, Contours, GlassNav, spring } from './primitives';
import { SynthMark } from '../brand/SynthMark';

const CHECKPOINT: Record<string, string> = { login: 'Sign-in', beneficiary_add: 'Payee add', transfer: 'Transfer', profile_change: 'Profile change' };
const NAV = consoleNav;
/* Screen angles (0° = right, −90° = top) for ring callouts: diagonals first, so labels stay inside the centre column. */
const RING_SLOTS = [-58, -122, 58, 122, -32, -148, 32, 148];
const WORD: Record<Decision, string> = { ALLOW: 'Allowed', STEP_UP: 'Step-up', BLOCK: 'Blocked' };

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
  const ringed = signals.filter((s) => s.level > 0).sort((x, y) => y.level - x.level).slice(0, RING_SLOTS.length);
  const calm = signals.filter((s) => !ringed.includes(s));
  const focus = signals.find((s) => s.id === sel) ?? strongest;
  const dev = a?.deviations.find((d) => d.feature === focus?.id);
  const baseline = useBaseline(detail.data ? String(detail.data.session.user_id) : '');
  const [open, setOpen] = useState(false);

  if (me.isError) return <Navigate to="/login" replace />;
  if (me.data && me.data.role !== 'admin') return <Navigate to="/bank" replace />;

  const policyTotal = a ? a.policy.reduce((s, p) => s + p.points, 0) : 0;

  return (
    <main className="rn relative isolate min-h-[100dvh] overflow-x-hidden">
      <Contours className="absolute inset-0 -z-10 h-full w-full opacity-40" hourProfile={baseline.data?.trusted.hour_profile ?? null} levels={16} clearAt={[50, 44]} />

      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 px-5 py-4 sm:px-8">
        <Link to="/" className="flex items-center gap-2.5" aria-label="SecureSynth home">
          <SynthMark size={26} />
          <span className="hidden font-semibold sm:inline">Command Centre</span>
        </Link>
        <div className="hidden md:block"><GlassNav label="Console" items={NAV} /></div>
        <button type="button" className="rn-btn rn-btn-ghost min-h-10 whitespace-nowrap text-[length:var(--t-sm)]" onClick={() => logout.mutate()}>Sign out</button>
      </header>
      {/* Phones: the same navigation floats at the bottom, within thumb reach. */}
      <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-3 md:hidden"><GlassNav label="Console (mobile)" items={NAV} /></div>

      {sessions.isPending || me.isPending ? (
        <p className="px-8 pt-24 text-[color:var(--graphite-3)]" aria-busy="true">Loading live sessions</p>
      ) : rows.length === 0 ? (
        <section className="mx-auto max-w-xl px-8 pt-28 text-center">
          <h1 className="rn-display text-[length:var(--t-2xl)]">No sessions to investigate yet.</h1>
          <p className="mt-4 text-[color:var(--graphite-2)]">Sign in as a customer or run a scenario in the Lab, and its risk checkpoints will appear here live.</p>
          <Link to="/lab" className="rn-btn rn-btn-primary mt-8">Open the Scenario Lab</Link>
        </section>
      ) : (
        <div className="grid gap-8 px-5 pb-28 sm:px-8 md:pb-12 lg:grid-cols-[minmax(290px,0.85fr)_minmax(0,1.7fr)_minmax(270px,0.8fr)] lg:gap-4">
          {/* Left: the reading. */}
          <section aria-labelledby="who" className="order-2 lg:order-1 lg:pt-14">
            <p className="text-[length:var(--t-sm)] text-[color:var(--graphite-3)]">{detail.data ? `${detail.data.session.city} (simulated), ${detail.data.session.device_recognised ? 'recognised browser' : 'unrecognised browser'}${detail.data.session.is_lab ? ', lab session' : ''}` : ' '}</p>
            <h1 id="who" className="rn-display mt-2 text-[length:var(--t-2xl)]">{detail.data?.session.display_name ?? ' '}</h1>
            {a && (
              <>
                <div className="mt-8 flex flex-wrap items-end gap-x-4 gap-y-2">
                  <span className="rn-display text-[clamp(5rem,9vw,8.5rem)] leading-[0.8]"><AnimatedNumber value={a.risk_score} /></span>
                  <div className="pb-2">
                    <AnimatePresence mode="wait">
                      <motion.p key={a.id} className="rn-state text-[length:var(--t-lg)]" data-d={a.decision}
                        initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={spring}>
                        {WORD[a.decision]}
                      </motion.p>
                    </AnimatePresence>
                    <p className="whitespace-nowrap text-[length:var(--t-sm)] text-[color:var(--graphite-3)]">risk index at {CHECKPOINT[a.checkpoint] ?? a.checkpoint.toLowerCase()}</p>
                  </div>
                </div>
                <p className="mt-3 max-w-[26rem] text-[length:var(--t-sm)] text-[color:var(--graphite-3)]">
                  A 0–100 rarity percentile with transparent policy points, not a probability of fraud. Step-up at {a.thresholds.step_up}, block at {a.thresholds.block}.
                </p>

                {/* Signal inspector: the selected behavioural signal, observed vs this customer's baseline. */}
                <div className="mt-8 border-t border-[color:var(--silver-2)] pt-6" aria-live="polite">
                  <p className="text-[length:var(--t-sm)] text-[color:var(--graphite-3)]">Selected signal</p>
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

          {/* Centre: the sculpture on an instrument bezel. The bezel arc is the real risk index; its ticks mark the
              real thresholds; each callout on the ring is one behavioural signal and selects it. */}
          <section aria-label="Behavioural digital twin" className="order-1 lg:order-2">
            <div className="relative mx-auto w-full max-w-[min(600px,72vh)]">
              <div aria-hidden className="pointer-events-none absolute inset-[-8%] -z-10 rounded-full"
                style={{ background: `radial-gradient(closest-side, ${a?.decision === 'BLOCK' ? 'rgba(240,68,56,0.10)' : a?.decision === 'STEP_UP' ? 'rgba(247,144,9,0.12)' : 'rgba(0,91,255,0.16)'}, rgba(0,91,255,0.05) 60%, transparent)` }} />
              <div aria-hidden className="pointer-events-none absolute bottom-[4%] left-1/2 -z-10 h-[7%] w-[46%] -translate-x-1/2 rounded-[50%] bg-[rgba(16,24,40,0.22)] blur-2xl" />
              <div className="relative">
                <IdentityOrb signals={signals} state={a?.decision ?? 'idle'} selected={focus?.id} onSelect={setSel} />
                {a && <Bezel score={a.risk_score} stepUp={a.thresholds.step_up} block={a.thresholds.block} decision={a.decision} />}
              </div>
              {/* Deviating signals are called out on the ring (diagonal slots keep them clear of the side columns). */}
              <ul aria-label="Deviating signals" className="mt-4 flex flex-wrap justify-center gap-x-3 gap-y-2 lg:mt-0">
                {ringed.map((s, i) => {
                  const th = (RING_SLOTS[i] * Math.PI) / 180;
                  const cx = Math.cos(th), side = cx > 0.25 ? 'r' : cx < -0.25 ? 'l' : 'c';
                  const style = {
                    '--x': `${50 + cx * 43}%`, '--y': `${50 + Math.sin(th) * 43}%`,
                    '--tf': `translate(${side === 'r' ? '0.4rem' : side === 'l' ? 'calc(-100% - 0.4rem)' : '-50%'}, -50%)`,
                  } as CSSProperties;
                  return (
                    <li key={s.id} style={style} className="lg:absolute lg:left-[var(--x)] lg:top-[var(--y)] lg:[transform:var(--tf)]">
                      <SignalButton s={s} on={focus?.id === s.id} onClick={() => setSel(s.id)} reverse={side === 'l'} />
                    </li>
                  );
                })}
              </ul>
            </div>
            {calm.length > 0 && (
              <div className="mx-auto mt-5 max-w-[640px] text-center">
                <p className="text-[length:var(--t-sm)] text-[color:var(--graphite-3)]">Within this customer’s normal behaviour</p>
                <ul aria-label="Signals within normal behaviour" className="mt-1.5 flex flex-wrap justify-center gap-x-1 gap-y-1">
                  {calm.map((s) => <li key={s.id}><SignalButton s={s} on={focus?.id === s.id} onClick={() => setSel(s.id)} /></li>)}
                </ul>
              </div>
            )}
            {/* Risk telemetry across this session's checkpoints. */}
            <ol className="mx-auto mt-6 flex max-w-[600px] flex-wrap items-center justify-center gap-2" aria-label="Checkpoints in this session">
              {assessments.map((x, i) => (
                <li key={x.id} className="flex items-center gap-2">
                  {i > 0 && <span aria-hidden className="h-px w-8 bg-[var(--silver)] sm:w-14" />}
                  <button type="button" onClick={() => setCpPick(x.id)} aria-pressed={x.id === a?.id}
                    className={`relative rounded-full px-3.5 py-2 text-[length:var(--t-sm)] transition-colors ${x.id === a?.id ? 'rn-lens text-[color:var(--graphite)]' : 'text-[color:var(--graphite-2)] hover:bg-[rgba(255,255,255,0.6)]'}`}>
                    <span className="rn-state" data-d={x.decision}><span className="text-[color:var(--graphite)]">{CHECKPOINT[x.checkpoint] ?? x.checkpoint}</span> <span className="rn-num">{x.risk_score.toFixed(0)}</span></span>
                  </button>
                </li>
              ))}
            </ol>
            <p className="mx-auto mt-3 max-w-[38rem] text-center text-[length:var(--t-sm)] text-[color:var(--graphite-3)]">
              The ring shows the risk index against the step-up and block thresholds. Each point inside the glass is one of this customer’s behavioural signals; signals that deviate from their baseline are called out on the ring. The sculpture visualises the engine’s output; it is not the model.
            </p>
          </section>

          {/* Right: readable event stream. */}
          <section aria-labelledby="stream" className="order-3 lg:pt-14">
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

/** Instrument bezel around the sculpture: hairline ticks, threshold marks and an arc for the backend's risk index. */
function Bezel({ score, stepUp, block, decision }: { score: number; stepUp: number; block: number; decision: Decision }) {
  const R = 41;
  const at = (v: number) => { const t = ((v / 100) * 360 - 90) * (Math.PI / 180); return [50 + Math.cos(t) * R, 50 + Math.sin(t) * R, t] as const; };
  const mark = (v: number, color: string) => {
    const [, , t] = at(v);
    return <line x1={50 + Math.cos(t) * (R - 2.6)} y1={50 + Math.sin(t) * (R - 2.6)} x2={50 + Math.cos(t) * (R + 2.6)} y2={50 + Math.sin(t) * (R + 2.6)} stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />;
  };
  return (
    <svg aria-hidden viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
      <circle cx={50} cy={50} r={R} fill="none" stroke="var(--silver)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {Array.from({ length: 100 }, (_, k) => {
        const t = ((k / 100) * 360 - 90) * (Math.PI / 180), major = k % 10 === 0, len = major ? 1.6 : 0.8;
        return <line key={k} x1={50 + Math.cos(t) * (R + 0.6)} y1={50 + Math.sin(t) * (R + 0.6)} x2={50 + Math.cos(t) * (R + 0.6 + len)} y2={50 + Math.sin(t) * (R + 0.6 + len)}
          stroke="var(--graphite-3)" strokeOpacity={major ? 0.55 : 0.25} strokeWidth={1} vectorEffect="non-scaling-stroke" />;
      })}
      <circle cx={50} cy={50} r={R} fill="none" stroke={STATE_COLOR[decision]} strokeWidth={0.55} strokeLinecap="round" pathLength={100}
        strokeDasharray={`${Math.max(0.5, Math.min(100, score))} 100`} transform="rotate(-90 50 50)"
        style={{ transition: 'stroke-dasharray 900ms cubic-bezier(0.22,1,0.36,1), stroke 600ms' }} />
      {mark(stepUp, '#B54708')}
      {mark(block, '#C01048')}
    </svg>
  );
}

function SignalButton({ s, on, onClick, reverse }: { s: OrbSignal; on: boolean; onClick: () => void; reverse?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`flex items-center gap-2 whitespace-nowrap rounded-full px-2.5 py-1 text-[length:var(--t-sm)] transition-colors ${reverse ? 'lg:flex-row-reverse' : ''} ${on ? 'rn-lens font-semibold text-[color:var(--graphite)]' : s.level >= 2 ? 'font-medium text-[color:var(--graphite)] hover:bg-[rgba(255,255,255,0.7)]' : 'text-[color:var(--graphite-3)] hover:bg-[rgba(255,255,255,0.7)] hover:text-[color:var(--graphite)]'}`}>
      <span aria-hidden className="h-2 w-2 flex-none" style={{
        background: LEVEL_COLOR[s.level], borderRadius: s.level === 3 ? 2 : s.level === 2 ? 1 : 999,
        transform: s.level === 2 ? 'rotate(45deg)' : undefined,
      }} />
      {s.label}<span className="sr-only">: {['normal', 'low', 'medium', 'high'][s.level]} deviation</span>
    </button>
  );
}
