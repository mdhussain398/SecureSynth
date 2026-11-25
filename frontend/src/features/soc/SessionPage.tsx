import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { FlaskConical, Ghost, X } from 'lucide-react';
import type { RiskAssessment } from '../../api/types';
import { useConfig, useCounterfactual, useRevoke, useSessionDetail } from '../../api/queries';
import { Badge, Banner, Button, ButtonLink, Card, DataTable, DecisionPill, ErrorState, RiskGauge, Skeleton, Stat, Timeline, fmtTime } from '../../design/components';
import { PageTitle } from '../../layout/layouts';

const CHECKPOINT: Record<RiskAssessment['checkpoint'], string> = { login: 'Login', beneficiary_add: 'Payee add', transfer: 'Transfer', profile_change: 'Profile change' };
const axisTick = { fill: 'var(--chart-muted)', fontSize: 11 };

function ScoreTimeline({ items }: { items: RiskAssessment[] }) {
  const data = items.map((a) => ({ id: a.id, label: `${CHECKPOINT[a.checkpoint]} ${fmtTime(a.ts)}`, short: CHECKPOINT[a.checkpoint], score: a.risk_score, decision: a.decision }));
  const t = items[items.length - 1].thresholds;
  return (
    <div className="h-[240px]" role="img" aria-label={`Risk index over ${items.length} checkpoints, latest ${items[items.length - 1].risk_score}. Step-up threshold ${t.step_up}, block threshold ${t.block}.`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 72, bottom: 4, left: -16 }}>
          <ReferenceArea y1={t.step_up} y2={t.block} fill="var(--stepup-tint)" fillOpacity={0.9} ifOverflow="hidden" />
          <ReferenceArea y1={t.block} y2={100} fill="var(--block-tint)" fillOpacity={0.9} ifOverflow="hidden" />
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="short" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--chart-axis)' }} />
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={axisTick} tickLine={false} axisLine={false} />
          <ReferenceLine y={t.block} stroke="var(--block)" strokeDasharray="4 3" label={{ value: `Block ${t.block}`, position: 'right', fill: 'var(--ink-2)', fontSize: 11 }} />
          <ReferenceLine y={t.step_up} stroke="var(--stepup)" strokeDasharray="4 3" label={{ value: `Step-up ${t.step_up}`, position: 'right', fill: 'var(--ink-2)', fontSize: 11 }} />
          <Tooltip cursor={{ stroke: 'var(--chart-axis)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as (typeof data)[number];
              return <div className="bg-[var(--surface)] border border-[var(--hairline)] rounded-[var(--radius-s)] px-3 py-2 text-[0.8125rem] shadow-sm"><div className="text-[var(--ink-3)]">{p.label}</div><div className="flex items-center gap-2 mt-1"><span className="tnum font-semibold">{p.score.toFixed(1)}</span><DecisionPill decision={p.decision} /></div></div>;
            }} />
          <Line type="linear" dataKey="score" stroke="var(--series-line)" strokeWidth={2} isAnimationActive={false}
            dot={(props: { cx?: number; cy?: number; index?: number }) => {
              const d = data[props.index ?? 0];
              const c = d?.decision === 'BLOCK' ? 'var(--block)' : d?.decision === 'STEP_UP' ? 'var(--stepup)' : 'var(--allow)';
              return <circle key={props.index} cx={props.cx} cy={props.cy} r={5.5} fill={c} stroke="var(--surface)" strokeWidth={2} />;
            }} activeDot={{ r: 7 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const SEVERITY_TONE = { low: 'neutral', medium: 'stepup', high: 'block' } as const;

function AssessmentPanels({ a }: { a: RiskAssessment }) {
  const policySum = a.policy.reduce((s, p) => s + p.points, 0);
  const mlPart = a.ml_weight * a.ml.index;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="ML anomaly index" description="Isolation Forest on deviation features, shared across customers">
        <div className="flex items-baseline gap-2"><span className="tnum text-[2rem] font-semibold leading-none">{a.ml.index.toFixed(1)}</span><span className="text-[var(--ink-3)]">/ 100</span></div>
        <p className="mt-2 text-[var(--ink-2)]">This event is rarer than <b className="tnum">{a.ml.index.toFixed(1)}%</b> of legitimate validation events. It is a rarity percentile, not a probability of fraud.</p>
        <dl className="grid grid-cols-3 gap-3 mt-4 pt-3 border-t border-[var(--hairline)]">
          <Stat label="Raw score" value={a.ml.raw.toFixed(3)} />
          <Stat label="Weight" value={a.ml_weight.toFixed(2)} />
          <Stat label="Contribution" value={`${mlPart.toFixed(1)} pts`} />
        </dl>
      </Card>
      <Card title="Observed deviations from baseline" description="Observed differences from this customer's trusted baseline — not model feature importance" padded={false}>
        {a.deviations.length === 0 ? <p className="p-4 text-[var(--ink-3)]">No deviations from baseline at this checkpoint.</p> : (
          <DataTable caption="Deviations" rows={a.deviations} rowKey={(d) => d.feature} columns={[
            { key: 'f', header: 'Signal', cell: (d) => <div><div className="font-medium">{d.label}</div><div className="text-[0.75rem] text-[var(--ink-3)] font-mono">{d.feature}</div></div> },
            { key: 'o', header: 'Observed', cell: (d) => d.observed },
            { key: 'b', header: 'Baseline', cell: (d) => <span className="text-[var(--ink-2)]">{d.baseline}</span> },
            { key: 's', header: 'Severity', cell: (d) => <Badge tone={SEVERITY_TONE[d.severity]}>{d.severity}</Badge> },
          ]} />
        )}
      </Card>
      <Card title="Policy contributions" description="Transparent rules; exact additive points" padded={false}>
        {a.policy.length === 0 ? <p className="p-4 text-[var(--ink-3)]">No policy rules fired.</p> : (
          <DataTable caption="Policy contributions" rows={a.policy} rowKey={(p) => p.rule} columns={[
            { key: 'r', header: 'Rule', cell: (p) => <div><div className="font-medium">{p.label}</div><div className="text-[0.75rem] text-[var(--ink-3)] font-mono">{p.rule}</div></div> },
            { key: 'p', header: 'Points', align: 'right', cell: (p) => <span className="font-medium">{p.points > 0 ? '+' : ''}{p.points}</span> },
          ]} />
        )}
        <div className="flex justify-between px-3 py-2 border-t border-[var(--hairline)] text-[var(--ink-2)]"><span>Policy total</span><span className="tnum font-semibold text-[var(--ink)]">{policySum > 0 ? '+' : ''}{policySum}</span></div>
      </Card>
      <Card title="Decision" description={`${CHECKPOINT[a.checkpoint]} checkpoint · ${fmtTime(a.ts, true)}`}>
        <div className="flex items-center gap-3 mb-4"><DecisionPill decision={a.decision} className="text-[0.875rem] py-0.5" /><span className="text-[var(--ink-3)] text-[0.8125rem]">score = clip(W·ML + Σ policy, 0, 100) = clip({mlPart.toFixed(1)} + {policySum}) </span></div>
        <RiskGauge value={a.risk_score} thresholds={a.thresholds} />
        <dl className="grid grid-cols-3 gap-3 mt-5 pt-3 border-t border-[var(--hairline)]">
          <Stat label="Model" value={<span className="text-[0.8125rem] font-mono font-normal">{a.model_version}</span>} />
          <Stat label="Latency" value={`${a.latency_ms.toFixed(1)} ms`} />
          <Stat label="Customer saw" value={<span className="text-[0.8125rem] font-normal">{a.customer_message || '—'}</span>} />
        </dl>
      </Card>
    </div>
  );
}

/** Human labels for known feature keys; unknown keys fall back to the raw key. */
const FEATURE_LABEL: Record<string, string> = {
  device_recognised: 'Device recognised (0 / 1)',
  device_known: 'Device recognised (0 / 1)',
  device_age_days: 'Device age (days)',
  city_known: 'City known (0 / 1)',
  hour_rarity: 'Hour rarity (0–1)',
  log_km_from_home: 'Distance from home (log km)',
  travel_speed_kmh: 'Travel speed since last session (km/h)',
  amount_robust_z: 'Amount vs usual (robust z)',
  amount_to_balance: 'Amount / balance',
  txn_velocity_ratio: 'Transaction velocity ratio',
  beneficiary_new: 'New payee (0 / 1)',
  beneficiary_age_min: 'Payee age (minutes)',
  secs_login_to_sensitive: 'Seconds from login to sensitive action',
  log_secs_login_to_sensitive: 'Login → sensitive action (log seconds)',
  beneficiary_fresh: 'Payee added this session (0 / 1)',
  travel_window_active: 'Inside verified travel window (0 / 1)',
  is_transfer: 'Checkpoint is a transfer (0 / 1)',
  is_beneficiary_add: 'Checkpoint is a payee add (0 / 1)',
  sensitive_seq: 'Sensitive sequence (0 / 1)',
  sensitive_seq_score: 'Sensitive sequence score',
  failed_auth_24h: 'Failed sign-ins in 24 h',
  session_action_rate: 'Session action rate',
};
const BINARY = /(_recognised|_known|_new|_fresh|_active|^sensitive_seq|^is_transfer|^is_beneficiary_add)$/;
const featureLabel = (k: string) => FEATURE_LABEL[k] ?? k;

function CounterfactualDrawer({ a, onClose }: { a: RiskAssessment; onClose: () => void }) {
  const cf = useCounterfactual(a.id);
  const [vals, setVals] = useState<Record<string, string>>({});
  const keys = Object.keys(a.features ?? {}).sort();
  const changes = keys.filter((k) => vals[k] !== undefined && vals[k] !== '' && Number(vals[k]) !== a.features[k]).map((k) => ({ feature: k, value: Number(vals[k]) }));
  const submit = (e: FormEvent) => { e.preventDefault(); cf.mutate({ changes }); };
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="cf-title">
      <button className="absolute inset-0 bg-black/35 cursor-default" aria-label="Close" onClick={onClose} />
      <aside className="relative w-full max-w-[440px] h-full overflow-y-auto bg-[var(--surface)] border-l border-[var(--hairline)] p-5">
        <div className="flex items-start justify-between gap-3">
          <div><h2 id="cf-title" className="text-[1.0625rem] font-semibold">What-if analysis</h2><p className="text-[var(--ink-3)] text-[0.8125rem] mt-0.5">Re-runs the real engine for assessment #{a.id} with edited features. Nothing is changed.</p></div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close what-if analysis"><X size={16} /></Button>
        </div>
        <form onSubmit={submit} className="space-y-3 mt-5">
          {keys.length === 0 && <p className="text-[var(--ink-3)]">This assessment has no editable features.</p>}
          {keys.map((k) => {
            const cur = a.features[k];
            const edited = vals[k] !== undefined && vals[k] !== '' && Number(vals[k]) !== cur;
            return (
              <div key={k}>
                <label className="field-label" htmlFor={`cf-${k}`}>{featureLabel(k)} <span className="font-mono text-[var(--ink-3)]">{k}</span></label>
                {BINARY.test(k) ? (
                  <select id={`cf-${k}`} className="input tnum" value={vals[k] ?? String(cur)} onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))}>
                    <option value="0">0{cur === 0 ? ' (observed)' : ''}</option>
                    <option value="1">1{cur === 1 ? ' (observed)' : ''}</option>
                  </select>
                ) : (
                  <input id={`cf-${k}`} className="input tnum" type="number" step="any" value={vals[k] ?? String(cur)} onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))} />
                )}
                <p className="text-[0.75rem] text-[var(--ink-3)] mt-0.5 tnum">Observed {Number.isInteger(cur) ? cur : cur.toFixed(3)}{edited && ' · edited'}</p>
              </div>
            );
          })}
          <Button type="submit" className="w-full" loading={cf.isPending} disabled={changes.length === 0}><FlaskConical size={15} aria-hidden />Recompute</Button>
        </form>
        {cf.error && <div className="mt-4"><Banner tone="block" title="Recompute failed">{cf.error.message}</Banner></div>}
        {cf.data && (
          <section className="mt-5 border-2 border-dashed border-[var(--stepup-line)] rounded-[var(--radius-m)] p-4" aria-live="polite">
            <Badge tone="stepup">HYPOTHETICAL</Badge>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div><p className="text-[0.75rem] text-[var(--ink-3)]">Original</p><p className="tnum text-[1.25rem] font-semibold">{cf.data.original.score.toFixed(1)}</p><DecisionPill decision={cf.data.original.decision} /></div>
              <div><p className="text-[0.75rem] text-[var(--ink-3)]">With edits</p><p className="tnum text-[1.25rem] font-semibold">{cf.data.result.score.toFixed(1)}</p><DecisionPill decision={cf.data.result.decision} /></div>
            </div>
            <p className="text-[0.8125rem] text-[var(--ink-2)] mt-3">ML index under edits: <span className="tnum">{cf.data.result.ml_index.toFixed(1)}</span>. Policy: {cf.data.result.policy.map((p) => `${p.rule} ${p.points > 0 ? '+' : ''}${p.points}`).join(', ') || 'none'}.</p>
          </section>
        )}
      </aside>
    </div>
  );
}

export function SessionPage() {
  const { id = '' } = useParams();
  const q = useSessionDetail(id);
  const revoke = useRevoke(id);
  const config = useConfig();
  const [selected, setSelected] = useState<number | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  if (q.isPending) return <div className="space-y-4"><Skeleton className="h-8 w-72" /><Skeleton className="h-60" /><Skeleton className="h-40" /></div>;
  if (q.error) return <ErrorState error={q.error} title={q.error.status === 404 ? 'Session not found' : undefined} onRetry={() => q.refetch()} />;
  const { session: s, assessments, audit } = q.data;
  const current = assessments.find((a) => a.id === selected) ?? assessments[assessments.length - 1];
  const ended = s.mode === 'revoked';

  return (
    <>
      <PageTitle
        title={<span className="flex flex-wrap items-center gap-2">{s.display_name}<span className="text-[var(--ink-3)] font-normal text-[0.9375rem]">session {s.id}</span></span>}
        sub={`${s.city} · ${s.device_recognised ? 'device recognised' : 'device not recognised'} · mode ${s.mode.replace('_', '-')}${s.is_lab ? ' · lab session' : ''}`}
        actions={<>
          {config.data?.ghost_banking_enabled && <ButtonLink to={`/soc/ghost/${encodeURIComponent(s.id)}`} variant="secondary" size="sm"><Ghost size={14} aria-hidden />Ghost compare</ButtonLink>}
          <ButtonLink to={`/soc/users/${s.user_id}/baseline`} variant="secondary" size="sm">Baseline</ButtonLink>
          {assessments.length > 0 && <Button variant="secondary" size="sm" onClick={() => setDrawer(true)}><FlaskConical size={14} aria-hidden />What-if</Button>}
          {confirmRevoke ? (
            <span className="inline-flex items-center gap-1.5">
              <Button variant="danger" size="sm" loading={revoke.isPending} onClick={() => revoke.mutate(undefined, { onSettled: () => setConfirmRevoke(false) })}>Confirm revoke</Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmRevoke(false)}>Cancel</Button>
            </span>
          ) : <Button variant="danger" size="sm" disabled={ended} onClick={() => setConfirmRevoke(true)}>{ended ? 'Revoked' : 'Revoke session'}</Button>}
        </>}
      />
      {revoke.isSuccess && <div className="mb-4"><Banner tone="allow" title="Session revoked">The customer's session has ended and its token can no longer be used.</Banner></div>}
      {revoke.error && <div className="mb-4"><Banner tone="block" title="Revoke failed">{revoke.error.message}</Banner></div>}
      {assessments.length === 0 ? <Card title="Assessments"><p className="text-[var(--ink-3)]">No risk checkpoints recorded for this session yet.</p></Card> : (
        <div className="space-y-4">
          <Card title="Risk index over the session" description="Each point is a checkpoint, coloured by its decision. Shaded bands are the step-up and block zones from the validation-tuned thresholds."
            actions={<label className="text-[0.8125rem] text-[var(--ink-2)] flex items-center gap-2">Checkpoint
              <select className="input !min-h-8 !py-1 !w-auto" value={current.id} onChange={(e) => setSelected(Number(e.target.value))}>
                {assessments.map((a) => <option key={a.id} value={a.id}>{CHECKPOINT[a.checkpoint]} · {a.risk_score.toFixed(1)}</option>)}
              </select></label>}>
            <ScoreTimeline items={assessments} />
          </Card>
          <AssessmentPanels a={current} />
          <Card title="Audit trail">
            {audit.length === 0 ? <p className="text-[var(--ink-3)]">No audit events.</p> :
              <Timeline items={audit.map((e) => ({ id: e.id, time: fmtTime(e.ts), title: <span className="font-mono text-[0.8125rem]">{e.event_type}</span>, marker: <span className="text-[0.75rem] text-[var(--ink-3)]">by {e.actor}</span>, body: Object.entries(e.details).map(([k, v]) => `${k}: ${String(v)}`).join(' · ') }))} />}
          </Card>
        </div>
      )}
      {drawer && <CounterfactualDrawer a={current} onClose={() => setDrawer(false)} />}
    </>
  );
}
