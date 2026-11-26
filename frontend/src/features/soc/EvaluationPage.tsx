import { useState, type ReactNode } from 'react';
import { FlaskConical, Scale, ShieldOff, TriangleAlert, TrendingDown } from 'lucide-react';
import type { ApproachResult, DetectionMetrics, EvaluationReport } from '../../api/types';
import { useEvaluation } from '../../api/queries';
import { Badge, Card, ErrorState, Skeleton, fmtTime, Segmented } from '../../design/components';
import { PageTitle } from '../../layout/layouts';

/* ------------------------------------------------------------------ helpers */

type Basis = 'intervention' | 'block_only';
type Name = ApproachResult['name'];

/** Short, stable display names. Colour + marker shape follow the approach, never its rank. */
const APPROACH: Record<Name, { short: string; color: string; shape: 'circle' | 'square' | 'diamond' }> = {
  password_totp: { short: 'Password + TOTP only', color: 'var(--chart-muted)', shape: 'diamond' },
  static_rules: { short: 'Static rules', color: 'var(--series-2)', shape: 'square' },
  securesynth: { short: 'SecureSynth', color: 'var(--series-1)', shape: 'circle' },
};
const ORDER: Name[] = ['password_totp', 'static_rules', 'securesynth'];
const nameOf = (a: ApproachResult) => APPROACH[a.name]?.short ?? a.label;

const FAMILY: Record<string, string> = {
  A: 'Credential + SIM swap',
  B: 'Real-time OTP relay',
  C: 'Session hijack on familiar device',
  D: 'Low-and-slow',
  E: 'Remote-access takeover',
};

const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;
const ratio = (v: number) => v.toFixed(2);
function ms(v: number): string {
  if (v === 0) return '0 ms';
  if (v < 0.01) return '<0.01 ms';
  return `${v.toFixed(v < 1 ? 3 : 2)} ms`;
}
/** Indian short-scale money from paise: ₹2.96 cr, ₹14.6 lakh, ₹9,500. */
function inrShort(paise: number): string {
  const r = paise / 100;
  if (r === 0) return '₹0';
  if (r >= 1e7) return `₹${(r / 1e7).toFixed(2)} cr`;
  if (r >= 1e5) return `₹${(r / 1e5).toFixed(1)} lakh`;
  return `₹${Math.round(r).toLocaleString('en-IN')}`;
}
const times = (a: number, b: number) => (b > 0 ? a / b : Infinity);

function Marker({ shape, color, size = 10 }: { shape: 'circle' | 'square' | 'diamond'; color: string; size?: number }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 10 10" aria-hidden className="shrink-0">
      {shape === 'circle' && <circle cx="5" cy="5" r="4.2" fill={color} stroke="var(--surface)" strokeWidth="1.2" />}
      {shape === 'square' && <rect x="1" y="1" width="8" height="8" rx="1.2" fill={color} stroke="var(--surface)" strokeWidth="1.2" />}
      {shape === 'diamond' && <path d="M5 0.6 9.4 5 5 9.4 0.6 5Z" fill={color} stroke="var(--surface)" strokeWidth="1.2" />}
    </svg>
  );
}

function Legend({ approaches }: { approaches: ApproachResult[] }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[0.8125rem] text-[var(--ink-2)]" aria-label="Legend">
      {approaches.map((a) => (
        <li key={a.name} className="flex items-center gap-1.5"><Marker {...APPROACH[a.name]} />{nameOf(a)}</li>
      ))}
    </ul>
  );
}


/* ------------------------------------------------------------- 1. provenance */

function Provenance({ r }: { r: EvaluationReport }) {
  const facts: Array<[string, ReactNode]> = [
    ['Population seed', <span className="font-mono">{r.dataset.seed}</span>],
    ['Synthetic customers', r.dataset.customers.toLocaleString('en-IN')],
    ['Sessions scored', r.dataset.sessions_test.toLocaleString('en-IN')],
    ['Account takeovers', r.dataset.attacks_test.toLocaleString('en-IN')],
    ['Held-out family', <>{r.dataset.held_out_family} · {FAMILY[r.dataset.held_out_family] ?? 'unnamed'}</>],
    ['Frozen model', <span className="font-mono text-[0.8125rem]">{r.model_version}</span>],
  ];
  return (
    <section aria-labelledby="prov-title" className="rounded-[var(--radius-m)] border border-[var(--stepup-line)] bg-[var(--stepup-tint)] overflow-hidden">
      <div className="flex flex-wrap items-start gap-3 px-4 py-3.5">
        <FlaskConical size={20} className="text-[var(--stepup)] mt-0.5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1 basis-[280px]">
          <h2 id="prov-title" className="font-semibold text-[1rem]">Synthetic evaluation</h2>
          <p className="text-[var(--ink-2)] mt-0.5 max-w-[78ch]">
            Every customer, device, location and attack below was authored by the team. A fresh population (seed {r.dataset.seed}),
            never seen during development, was scored once with the frozen model, features and thresholds. These numbers describe the
            prototype on synthetic data, not real-world fraud performance.
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-px bg-[var(--stepup-line)] border-t border-[var(--stepup-line)]">
        {facts.map(([k, v]) => (
          <div key={k} className="bg-[var(--surface)] px-4 py-2.5 min-w-0">
            <dt className="text-[0.75rem] text-[var(--ink-3)]">{k}</dt>
            <dd className="tnum font-medium mt-0.5 break-all">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ---------------------------------------------------------- 2. honest reading */

function Finding({ icon, tone, title, children }: { icon: ReactNode; tone: 'info' | 'stepup' | 'block' | 'neutral'; title: string; children: ReactNode }) {
  const bar = { info: 'var(--info)', stepup: 'var(--stepup)', block: 'var(--block)', neutral: 'var(--ink-3)' }[tone];
  return (
    <article className="relative bg-[var(--surface)] border border-[color:var(--hairline)] rounded-[var(--radius-m)] shadow-[var(--shadow-panel)] pl-6 pr-5 py-4 min-w-0">
      <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r" style={{ background: bar }} aria-hidden />
      <h3 className="flex items-start gap-2 font-semibold leading-snug"><span className="mt-0.5 shrink-0" style={{ color: bar }}>{icon}</span>{title}</h3>
      <div className="text-[0.9375rem] text-[var(--ink-2)] mt-2 leading-relaxed space-y-1.5">{children}</div>
    </article>
  );
}

function HonestReading({ r }: { r: EvaluationReport }) {
  const ss = r.approaches.find((a) => a.name === 'securesynth');
  const sr = r.approaches.find((a) => a.name === 'static_rules');
  if (!ss || !sr) return null;
  const fprX = times(sr.intervention.fpr, ss.intervention.fpr);
  const delayX = times(sr.prevention.legit_value_delayed_paise, ss.prevention.legit_value_delayed_paise);
  const higherRecall = ss.intervention.recall > sr.intervention.recall;
  const ssPrev = ss.prevention.attack_value_prevented_paise;
  const srPrev = sr.prevention.attack_value_prevented_paise;
  const famC = ss.per_family_recall.C;
  const famCStatic = sr.per_family_recall.C;

  return (
    <section aria-labelledby="hr-title">
      <h2 id="hr-title" className="rn-display text-[2.5rem] mb-4">Honest reading</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <Finding icon={<TrendingDown size={17} />} tone="info" title={higherRecall ? 'The gain is much lower friction at higher recall' : 'The gain is lower friction, not a higher catch rate'}>
          <p>
            SecureSynth flags <b className="tnum text-[var(--ink)]">{pct(ss.intervention.recall, 0)}</b> of takeovers against{' '}
            <b className="tnum text-[var(--ink)]">{pct(sr.intervention.recall, 0)}</b> for static rules, while restricting{' '}
            <b className="tnum text-[var(--ink)]">{pct(ss.intervention.fpr)}</b> of legitimate sessions instead of{' '}
            <b className="tnum text-[var(--ink)]">{pct(sr.intervention.fpr)}</b>
            {Number.isFinite(fprX) && <> (about {fprX.toFixed(1)}× fewer)</>}.
          </p>
          <p>
            Travellers restricted: <span className="tnum">{pct(ss.traveller_restriction_rate)}</span> vs <span className="tnum">{pct(sr.traveller_restriction_rate)}</span>.
            Legitimate money delayed: <span className="tnum">{inrShort(ss.prevention.legit_value_delayed_paise)}</span> vs <span className="tnum">{inrShort(sr.prevention.legit_value_delayed_paise)}</span>
            {Number.isFinite(delayX) && <> ({delayX.toFixed(1)}× less)</>}.
          </p>
        </Finding>
        <Finding icon={<Scale size={17} />} tone="neutral" title={ssPrev > srPrev ? 'Total money prevented is similar to static rules' : 'It does not prevent more money in total than static rules'}>
          <dl className="grid grid-cols-2 gap-3 my-1">
            <div><dt className="text-[0.75rem] text-[var(--ink-3)]">SecureSynth, total prevented</dt><dd className="tnum text-[1.25rem] font-semibold text-[var(--ink)]">{inrShort(ssPrev)}</dd></div>
            <div><dt className="text-[0.75rem] text-[var(--ink-3)]">Static rules, total prevented</dt><dd className="tnum text-[1.25rem] font-semibold text-[var(--ink)]">{inrShort(srPrev)}</dd></div>
          </dl>
          <p>
            {ssPrev <= srPrev
              ? <>Static rules prevent {inrShort(srPrev - ssPrev)} more, because they step up almost every unusual session — at the cost of the friction above.</>
              : <>The difference is {inrShort(ssPrev - srPrev)} of {inrShort(ss.prevention.attack_value_attempted_paise)} attempted; treat the totals as equivalent on synthetic data.</>}
          </p>
        </Finding>
        <Finding icon={<ShieldOff size={17} />} tone="stepup" title="It stops more money outright by block, and blocks more legitimate money">
          <p>
            Attack value stopped by a permanent BLOCK: <b className="tnum text-[var(--ink)]">{inrShort(ss.prevention.attack_value_prevented_by_block_paise)}</b> vs{' '}
            <b className="tnum text-[var(--ink)]">{inrShort(sr.prevention.attack_value_prevented_by_block_paise)}</b> for static rules, so it leans less on the
            assumption that attackers fail trusted-device verification.
          </p>
          <p>
            The cost: legitimate money blocked outright is <b className="tnum text-[var(--ink)]">{inrShort(ss.prevention.legit_value_blocked_paise)}</b> vs{' '}
            <b className="tnum text-[var(--ink)]">{inrShort(sr.prevention.legit_value_blocked_paise)}</b> (legit sessions blocked {pct(ss.legit_block_rate, 2)} vs {pct(sr.legit_block_rate, 2)}).
          </p>
        </Finding>
        {famC !== undefined && (
          <Finding icon={<TriangleAlert size={17} />} tone="block" title={`Limitation: session hijack on a familiar device (family C), recall ${ratio(famC)}`}>
            <p>
              When an attacker uses the customer&rsquo;s own recognised device, from their usual city, at their usual hours, there is little in the
              behaviour baseline to tell the two apart. SecureSynth catches <span className="tnum">{pct(famC, 0)}</span> of these
              {famCStatic !== undefined && <> (static rules <span className="tnum">{pct(famCStatic, 0)}</span>)</>}.
            </p>
            <p>Future work: transaction-intent and payee-risk signals (who is being paid, how new and how connected that payee is), which do not depend on the device or place.</p>
          </Finding>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- 0. editorial lead */

/** The story in two numbers, each shown next to static rules (values straight from the frozen report). */
function Lead({ r }: { r: EvaluationReport }) {
  const ss = r.approaches.find((a) => a.name === 'securesynth');
  const sr = r.approaches.find((a) => a.name === 'static_rules');
  if (!ss || !sr) return null;
  const Fig = ({ value, label, compare }: { value: string; label: string; compare: string }) => (
    <div className="min-w-0">
      <p className="rn-display tnum text-[clamp(4rem,9vw,7.5rem)] leading-[0.85] text-[color:var(--electric-ink)]">{value}</p>
      <p className="mt-3 max-w-[30ch] text-[1.125rem] leading-snug text-[color:var(--ink)]">{label}</p>
      <p className="mt-1 text-[0.9375rem] text-[color:var(--ink-3)]">{compare}</p>
    </div>
  );
  return (
    <section aria-label="Key results" className="grid gap-8 border-y border-[color:var(--hairline)] py-8 sm:grid-cols-2">
      <Fig value={pct(ss.intervention.recall, 0)} label="of account takeovers flagged for step-up or block"
        compare={`Static rules: ${pct(sr.intervention.recall, 0)}. Password and TOTP alone: ${pct(r.approaches.find((a) => a.name === 'password_totp')?.intervention.recall ?? 0, 0)}.`} />
      <Fig value={pct(ss.intervention.fpr)} label="of genuine sessions interrupted"
        compare={`Static rules: ${pct(sr.intervention.fpr)}. Lower is better for customers.`} />
    </section>
  );
}

/* -------------------------------------------------------- 3. comparison table */

interface Row { key: string; label: string; hint?: string; value: (a: ApproachResult) => number; fmt: (v: number) => string; bar?: boolean; better: 'high' | 'low' }

function ComparisonTable({ approaches, basis }: { approaches: ApproachResult[]; basis: Basis }) {
  const m = (a: ApproachResult): DetectionMetrics => a[basis];
  const groups: Array<{ title: string; rows: Row[] }> = [
    { title: 'Detection', rows: [
      { key: 'recall', label: 'Recall', hint: 'takeovers flagged', value: (a) => m(a).recall, fmt: (v) => pct(v), bar: true, better: 'high' },
      { key: 'precision', label: 'Precision', hint: 'flags that were takeovers', value: (a) => m(a).precision, fmt: (v) => pct(v), bar: true, better: 'high' },
      { key: 'f1', label: 'F1', value: (a) => m(a).f1, fmt: (v) => v.toFixed(3), bar: true, better: 'high' },
    ] },
    { title: 'Customer friction', rows: [
      { key: 'fpr', label: 'Legit sessions restricted', hint: basis === 'intervention' ? 'false-positive rate' : 'false-positive rate, block only', value: (a) => m(a).fpr, fmt: (v) => pct(v), bar: true, better: 'low' },
      { key: 'trav', label: 'Travellers restricted', value: (a) => a.traveller_restriction_rate, fmt: (v) => pct(v), bar: true, better: 'low' },
      { key: 'nd', label: 'New-device sessions restricted', value: (a) => a.new_device_restriction_rate, fmt: (v) => pct(v), bar: true, better: 'low' },
      { key: 'lb', label: 'Legit sessions blocked', value: (a) => a.legit_block_rate, fmt: (v) => pct(v, 2), bar: true, better: 'low' },
    ] },
    { title: 'Decision latency', rows: [
      { key: 'p50', label: 'p50', hint: 'in-process scoring', value: (a) => a.latency_ms.p50, fmt: ms, better: 'low' },
      { key: 'p95', label: 'p95', value: (a) => a.latency_ms.p95, fmt: ms, better: 'low' },
    ] },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse tnum text-left">
        <caption className="sr-only">Comparison of the three approaches ({basis === 'intervention' ? 'any intervention' : 'block only'})</caption>
        <thead>
          <tr className="border-b border-[var(--hairline)]">
            <th scope="col" className="px-4 py-2.5 text-[0.75rem] font-medium text-[var(--ink-3)] w-[30%]">Metric</th>
            {approaches.map((a) => (
              <th key={a.name} scope="col" className="px-4 py-2.5 text-[0.8125rem] font-semibold">
                <span className="flex items-center gap-1.5"><Marker {...APPROACH[a.name]} />{nameOf(a)}</span>
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.title}>
            <tr><th colSpan={approaches.length + 1} scope="colgroup" className="px-4 pt-3.5 pb-1 text-[0.75rem] font-semibold text-[var(--ink-2)] bg-[var(--surface-2)] border-b border-[var(--hairline)]">{g.title}</th></tr>
            {g.rows.map((row) => {
              const vals = approaches.map(row.value);
              const max = Math.max(...vals, 1e-9);
              return (
                <tr key={row.key} className="border-b border-[var(--hairline)] last:border-b-0">
                  <th scope="row" className="px-4 py-2.5 font-normal align-top">
                    <span className="text-[var(--ink)]">{row.label}</span>
                    {row.hint && <span className="block text-[0.75rem] text-[var(--ink-3)]">{row.hint}</span>}
                  </th>
                  {approaches.map((a, i) => (
                    <td key={a.name} className="px-4 py-2.5 align-top">
                      <span className="font-medium">{row.fmt(vals[i])}</span>
                      {row.bar && (
                        <span className="block h-1.5 mt-1.5 rounded-full bg-[var(--surface-2)] max-w-[180px]" aria-hidden>
                          <span className="block h-full rounded-full" style={{ width: `${row.key === 'f1' || row.key === 'precision' || row.key === 'recall' ? vals[i] * 100 : (vals[i] / max) * 100}%`, background: APPROACH[a.name].color }} />
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
      <p className="px-4 py-2.5 text-[0.75rem] text-[var(--ink-3)] border-t border-[var(--hairline)]">
        Detection bars run 0–100%. Friction bars are scaled to the largest value in their row. Latency is single-event scoring on one laptop, excluding network and database time.
      </p>
    </div>
  );
}

/* ---------------------------------------------------- 4. confusion matrices */

function Confusion({ a, basis }: { a: ApproachResult; basis: Basis }) {
  const m = a[basis];
  const pos = m.tp + m.fn;
  const neg = m.fp + m.tn;
  const flagged = basis === 'intervention' ? 'Flagged' : 'Blocked';
  const notFlagged = basis === 'intervention' ? 'Not flagged' : 'Not blocked';
  const cell = (n: number, of: number, label: string, good: boolean) => (
    <td className={`px-2.5 py-2 align-top border border-[var(--hairline)] ${good ? 'bg-[var(--surface-2)]' : 'bg-[var(--surface)]'}`}>
      <span className="block text-[1.125rem] font-semibold leading-tight">{n.toLocaleString('en-IN')}</span>
      <span className="block text-[0.75rem] text-[var(--ink-3)]">{label} · {of ? pct(n / of, 0) : '—'}</span>
    </td>
  );
  return (
    <figure className="min-w-0">
      <figcaption className="flex items-center gap-1.5 font-semibold text-[0.875rem] mb-2"><Marker {...APPROACH[a.name]} />{nameOf(a)}</figcaption>
      <table className="w-full border-collapse tnum text-left table-fixed">
        <caption className="sr-only">Confusion matrix for {nameOf(a)}, {basis === 'intervention' ? 'any intervention' : 'block only'}</caption>
        <thead>
          <tr>
            <td className="w-[34%]" />
            <th scope="col" className="px-2.5 pb-1 text-[0.75rem] font-medium text-[var(--ink-3)]">{flagged}</th>
            <th scope="col" className="px-2.5 pb-1 text-[0.75rem] font-medium text-[var(--ink-3)]">{notFlagged}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" className="pr-2 py-2 text-[0.75rem] font-medium text-[var(--ink-2)] align-top">Actual takeover</th>
            {cell(m.tp, pos, 'TP', true)}
            {cell(m.fn, pos, 'FN · missed', false)}
          </tr>
          <tr>
            <th scope="row" className="pr-2 py-2 text-[0.75rem] font-medium text-[var(--ink-2)] align-top">Actual legit</th>
            {cell(m.fp, neg, 'FP · friction', false)}
            {cell(m.tn, neg, 'TN', true)}
          </tr>
        </tbody>
      </table>
    </figure>
  );
}

/* ------------------------------------------------- 5. financial protection */

interface Seg { key: string; label: string; value: number; fill: string; hatch?: boolean }

function StackBar({ segs, scale, label }: { segs: Seg[]; scale: number; label: string }) {
  const total = segs.reduce((s, x) => s + x.value, 0);
  return (
    <div role="img" aria-label={`${label}: ${segs.map((s) => `${s.label} ${inrShort(s.value)}`).join(', ')}`}
      className="flex h-6 gap-[2px] rounded-[4px] bg-[var(--surface-2)] overflow-hidden" style={{ width: scale > 0 ? `${Math.max((total / scale) * 100, 0.5)}%` : '0.5%' }}>
      {segs.filter((s) => s.value > 0).map((s) => (
        <span key={s.key} title={`${s.label}: ${inrShort(s.value)}`} className="h-full first:rounded-l-[4px] last:rounded-r-[4px]"
          style={{ flexGrow: s.value, flexBasis: 0, minWidth: 3, background: s.hatch ? `repeating-linear-gradient(135deg, ${s.fill} 0 4px, var(--surface) 4px 6px)` : s.fill }} />
      ))}
    </div>
  );
}

const SEG_ATTACK = {
  block: { label: 'Prevented by block', fill: 'var(--accent)' },
  challenge: { label: 'Prevented by challenge', fill: 'var(--seq-light)' },
  lost: { label: 'Completed (lost)', fill: 'var(--block)' },
};
const SEG_LEGIT = {
  blocked: { label: 'Legit value blocked', fill: 'var(--block)' },
  challenged: { label: 'Legit value challenged, then completed', fill: 'var(--seq-light)' },
};

function SwatchKey({ items }: { items: Array<{ label: string; fill: string; hatch?: boolean; note?: string }> }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[0.8125rem] text-[var(--ink-2)]">
      {items.map((s) => (
        <li key={s.label} className="flex items-start gap-1.5">
          <span className="h-3 w-3 mt-[3px] rounded-[2px] shrink-0" aria-hidden style={{ background: s.hatch ? `repeating-linear-gradient(135deg, ${s.fill} 0 3px, var(--surface) 3px 4.5px)` : s.fill }} />
          <span>{s.label}{s.note && <span className="text-[var(--ink-3)]"> ({s.note})</span>}</span>
        </li>
      ))}
    </ul>
  );
}

function Financial({ approaches }: { approaches: ApproachResult[] }) {
  const scale = Math.max(...approaches.map((a) => Math.max(a.prevention.attack_value_attempted_paise, a.prevention.legit_value_blocked_paise + a.prevention.legit_value_challenged_paise)), 1);
  const challengeNote = 'assumes attacker fails trusted-device verification';
  return (
    <Card title="Financial protection (simulated)" description="Detection says whether a session was flagged; prevention says what happened to the money. Permanent blocks are kept separate from challenges.">
      <div className="space-y-6">
        <div>
          <h3 className="text-[0.875rem] font-semibold">Attack money: where it ended up</h3>
          <div className="mt-2"><SwatchKey items={[
            { ...SEG_ATTACK.block },
            { ...SEG_ATTACK.challenge, hatch: true, note: challengeNote },
            { ...SEG_ATTACK.lost },
          ]} /></div>
          <div className="mt-3 space-y-3">
            {approaches.map((a) => {
              const p = a.prevention;
              return (
                <div key={a.name} className="grid gap-1 sm:grid-cols-[160px_1fr] sm:gap-3 items-center">
                  <span className="text-[0.8125rem] font-medium flex items-center gap-1.5"><Marker {...APPROACH[a.name]} />{nameOf(a)}</span>
                  <div className="min-w-0">
                    <StackBar scale={scale} label={`${nameOf(a)} attack money`} segs={[
                      { key: 'b', ...SEG_ATTACK.block, value: p.attack_value_prevented_by_block_paise },
                      { key: 'c', ...SEG_ATTACK.challenge, value: p.attack_value_prevented_by_challenge_paise, hatch: true },
                      { key: 'l', ...SEG_ATTACK.lost, value: p.attack_value_completed_paise },
                    ]} />
                    <p className="tnum text-[0.75rem] text-[var(--ink-3)] mt-1">
                      Prevented {inrShort(p.attack_value_prevented_paise)} of {inrShort(p.attack_value_attempted_paise)} · lost {inrShort(p.attack_value_completed_paise)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <h3 className="text-[0.875rem] font-semibold">Legitimate money: the cost to genuine customers</h3>
          <div className="mt-2"><SwatchKey items={[{ ...SEG_LEGIT.blocked }, { ...SEG_LEGIT.challenged, hatch: true }]} /></div>
          <div className="mt-3 space-y-3">
            {approaches.map((a) => {
              const p = a.prevention;
              const total = p.legit_value_blocked_paise + p.legit_value_challenged_paise;
              return (
                <div key={a.name} className="grid gap-1 sm:grid-cols-[160px_1fr] sm:gap-3 items-center">
                  <span className="text-[0.8125rem] font-medium flex items-center gap-1.5"><Marker {...APPROACH[a.name]} />{nameOf(a)}</span>
                  <div className="min-w-0">
                    {total === 0 ? <p className="text-[0.75rem] text-[var(--ink-3)] h-6 flex items-center">No legitimate money delayed or blocked</p> : (
                      <StackBar scale={scale} label={`${nameOf(a)} legitimate money`} segs={[
                        { key: 'b', ...SEG_LEGIT.blocked, value: p.legit_value_blocked_paise },
                        { key: 'c', ...SEG_LEGIT.challenged, value: p.legit_value_challenged_paise, hatch: true },
                      ]} />
                    )}
                    {total > 0 && <p className="tnum text-[0.75rem] text-[var(--ink-3)] mt-1">Blocked {inrShort(p.legit_value_blocked_paise)} · challenged then completed {inrShort(p.legit_value_challenged_paise)}</p>}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[0.75rem] text-[var(--ink-3)] mt-3">Both charts share one rupee scale (max {inrShort(scale)}), so bar lengths compare across sections.</p>
        </div>

        <div className="overflow-x-auto -mx-4 border-t border-[var(--hairline)]">
          <table className="w-full min-w-[760px] border-collapse tnum text-left">
            <caption className="sr-only">Financial protection by approach</caption>
            <thead>
              <tr className="border-b border-[var(--hairline)] text-[0.75rem] text-[var(--ink-3)]">
                <th scope="col" className="px-4 py-2 font-medium">Approach</th>
                <th scope="col" className="px-3 py-2 font-medium text-right">Attempted</th>
                <th scope="col" className="px-3 py-2 font-medium text-right">Prevented by block</th>
                <th scope="col" className="px-3 py-2 font-medium text-right">Prevented by challenge*</th>
                <th scope="col" className="px-3 py-2 font-medium text-right">Total prevented</th>
                <th scope="col" className="px-3 py-2 font-medium text-right">Completed (lost)</th>
                <th scope="col" className="px-3 py-2 font-medium text-right">Legit blocked</th>
                <th scope="col" className="px-4 py-2 font-medium text-right">Legit challenged, completed</th>
              </tr>
            </thead>
            <tbody>
              {approaches.map((a) => {
                const p = a.prevention;
                return (
                  <tr key={a.name} className="border-b border-[var(--hairline)] last:border-b-0">
                    <th scope="row" className="px-4 py-2.5 font-medium">{nameOf(a)}</th>
                    <td className="px-3 py-2.5 text-right">{inrShort(p.attack_value_attempted_paise)}</td>
                    <td className="px-3 py-2.5 text-right">{inrShort(p.attack_value_prevented_by_block_paise)}</td>
                    <td className="px-3 py-2.5 text-right">{inrShort(p.attack_value_prevented_by_challenge_paise)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold">{inrShort(p.attack_value_prevented_paise)}</td>
                    <td className="px-3 py-2.5 text-right">{inrShort(p.attack_value_completed_paise)}</td>
                    <td className="px-3 py-2.5 text-right">{inrShort(p.legit_value_blocked_paise)}</td>
                    <td className="px-4 py-2.5 text-right">{inrShort(p.legit_value_challenged_paise)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-4 pt-2 text-[0.75rem] text-[var(--ink-3)]">* Counts as prevented only if the attacker fails trusted-device verification. Blocked money is stopped permanently.</p>
        </div>
      </div>
    </Card>
  );
}

/* --------------------------------------------------- 6. per-family recall */

function FamilyRecall({ r }: { r: EvaluationReport }) {
  const held = r.dataset.held_out_family;
  const keys = Array.from(new Set(r.approaches.flatMap((a) => Object.keys(a.per_family_recall))));
  // Tuned families first (alphabetical), held-out family last and set apart.
  const fams = [...keys.filter((k) => k !== held).sort(), ...keys.filter((k) => k === held)];
  return (
    <Card title="Recall by attack family" description="Share of takeovers in each family that reached step-up or block."
      actions={<Legend approaches={r.approaches} />}>
      <ul className="space-y-1">
        {fams.map((f) => {
          const isHeld = f === held;
          return (
            <li key={f} className={`grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(180px,240px)_1fr] items-center py-2 ${isHeld ? 'mt-3 pt-4 border-t border-dashed border-[var(--hairline-strong)]' : ''}`}>
              <div className="min-w-0">
                <span className="font-medium">{f} · {FAMILY[f] ?? 'Unnamed family'}</span>
                {isHeld && <span className="ml-2 align-middle"><Badge tone="info">held out of tuning</Badge></span>}
              </div>
              <div className="min-w-0">
                <div className="relative h-[34px] mx-1.5" role="img" aria-label={`Family ${f} recall: ${r.approaches.map((a) => `${nameOf(a)} ${ratio(a.per_family_recall[f] ?? 0)}`).join(', ')}`}>
                  {[0, 0.25, 0.5, 0.75, 1].map((t) => <span key={t} className="absolute top-0 bottom-0 w-px bg-[var(--chart-grid)]" style={{ left: `${t * 100}%` }} aria-hidden />)}
                  {r.approaches.map((a, lane) => {
                    const v = a.per_family_recall[f] ?? 0;
                    const top = 5 + lane * 12;
                    return (
                      <span key={a.name} aria-hidden>
                        <span className="absolute h-[2px] rounded-full" style={{ top: top - 1, left: 0, width: `${v * 100}%`, background: APPROACH[a.name].color, opacity: 0.45 }} />
                        <span className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${v * 100}%`, top }} title={`${nameOf(a)}: ${ratio(v)}`}>
                          <Marker {...APPROACH[a.name]} size={10} />
                        </span>
                      </span>
                    );
                  })}
                </div>
                <p className="tnum text-[0.75rem] text-[var(--ink-3)] mt-0.5 flex flex-wrap gap-x-3">
                  {r.approaches.map((a) => <span key={a.name}>{nameOf(a)} {ratio(a.per_family_recall[f] ?? 0)}</span>)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-[0.75rem] text-[var(--ink-3)] mt-3">Scale 0 to 1. Family {held} never appeared in the validation window used to choose the ML weight and thresholds, so its recall estimates generalisation rather than tuning.</p>
    </Card>
  );
}

/* ---------------------------------------------------------------- page */

export function EvaluationPage() {
  const q = useEvaluation();
  const [basis, setBasis] = useState<Basis>('intervention');
  if (q.isPending) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-8 w-80" /><Skeleton className="h-32" /><Skeleton className="h-72" /><Skeleton className="h-40" /></div>;
  if (q.error) return <ErrorState error={q.error} title={q.error.status === 404 ? 'No evaluation report yet' : undefined} onRetry={() => q.refetch()} />;
  const r = q.data;
  const approaches = [...r.approaches].sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name));
  const basisToggle = <Segmented<Basis> label="Positive class" value={basis} onChange={setBasis} options={[['intervention', 'Any intervention'], ['block_only', 'Block only']]} />;

  return (
    <>
      <PageTitle title="Evaluation" sub="Three approaches scored on the identical synthetic test population."
        actions={<span className="text-[0.8125rem] text-[var(--ink-3)] tnum">Report generated {fmtTime(r.generated_at, true)}</span>} />
      <div className="space-y-8">
        <Lead r={r} />
        <Provenance r={r} />
        <HonestReading r={r} />

        <Card padded={false} title="Side-by-side comparison" actions={basisToggle}
          description={basis === 'intervention' ? 'A session counts as flagged if it reached STEP-UP or BLOCK.' : 'A session counts as flagged only if it reached BLOCK.'}>
          <ComparisonTable approaches={approaches} basis={basis} />
        </Card>

        <Card title="Confusion matrices" actions={basisToggle}
          description={`Unit: session. ${r.dataset.attacks_test.toLocaleString('en-IN')} takeovers and ${(r.dataset.sessions_test - r.dataset.attacks_test).toLocaleString('en-IN')} legitimate sessions. Percentages are of the actual row.`}>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {approaches.map((a) => <Confusion key={a.name} a={a} basis={basis} />)}
          </div>
        </Card>

        <Financial approaches={approaches} />
        <FamilyRecall r={{ ...r, approaches }} />

        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Assumptions"><ul className="list-disc pl-5 space-y-1.5 text-[var(--ink-2)] max-w-[80ch]">{r.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></Card>
          <Card title="Limitations"><ul className="list-disc pl-5 space-y-1.5 text-[var(--ink-2)] max-w-[80ch]">{r.limitations.map((a) => <li key={a}>{a}</li>)}</ul></Card>
        </div>
      </div>
    </>
  );
}
