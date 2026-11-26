/* Live SOC dashboard: every number comes from GET /admin/soc/metrics (computed from records each request). */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, Ghost, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useAct, useGhostConfig, useSoc, type GhostConfig } from '../../api/investigation';
import { Badge, Banner, Card, ErrorState, Skeleton, fmtTime, formatPaise } from '../../design/components';
import { PageTitle } from '../../layout/layouts';
import { ConfirmDialog } from './ConfirmDialog';

const RANGES = [['1h', 'Last hour'], ['24h', 'Last 24 hours'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['custom', 'Custom']] as const;
const axisTick = { fill: 'var(--chart-muted)', fontSize: 12 };

const KPI: { key: string; label: string; money?: boolean; tone?: 'block' | 'stepup' | 'allow' | 'info' }[] = [
  { key: 'monitored_sessions', label: 'Monitored sessions' }, { key: 'active_sessions', label: 'Active sessions' },
  { key: 'suspicious_sessions', label: 'Suspicious sessions', tone: 'stepup' }, { key: 'active_ghost_sessions', label: 'Active Ghost Banking', tone: 'info' },
  { key: 'restricted_sessions', label: 'Restricted sessions', tone: 'block' }, { key: 'pending_incidents', label: 'Pending incidents', tone: 'block' },
  { key: 'resolved_incidents', label: 'Resolved incidents', tone: 'allow' }, { key: 'blocked_attempts', label: 'Blocked transfer attempts' },
  { key: 'prevented_exposure_paise', label: 'Prevented exposure', money: true, tone: 'allow' }, { key: 'confirmed_loss_paise', label: 'Confirmed financial loss', money: true },
  { key: 'synthetic_value_paise', label: 'Synthetic (Ghost) value', money: true, tone: 'info' }, { key: 'pending_verifications', label: 'Pending verifications' },
  { key: 'integrity_alerts', label: 'Evidence integrity alerts', tone: 'block' }, { key: 'reports_prepared', label: 'Cybercrime reports prepared' },
  { key: 'dummy_submitted', label: 'Demo complaints submitted' }, { key: 'official_confirmed', label: 'Official complaints confirmed' },
];
const PERF: { key: string; label: string }[] = [
  { key: 'risk_assessment_latency_ms', label: 'Risk assessment latency' }, { key: 'detection_to_containment_ms', label: 'Detection → containment' },
  { key: 'analyst_response_s', label: 'Analyst response time' }, { key: 'incident_resolution_s', label: 'Incident resolution time' },
  { key: 'notification_delay', label: 'Notification delay' },
];

function fmtDur(v: number | null | undefined, unit: string) {
  if (v == null) return '—';
  if (unit === 'ms') return v < 1000 ? `${v.toFixed(1)} ms` : `${(v / 1000).toFixed(2)} s`;
  return v < 120 ? `${v.toFixed(0)} s` : v < 7200 ? `${(v / 60).toFixed(1)} min` : `${(v / 3600).toFixed(1)} h`;
}

export function GhostControl() {
  const q = useGhostConfig();
  const [open, setOpen] = useState(false);
  const [want, setWant] = useState(true);
  const m = useAct<{ enabled: boolean; reason: string; totp_code?: string; expected_version: number }, GhostConfig & { changed: boolean }>('PUT', '/admin/ghost-config', [['admin']]);
  if (q.isPending) return <Card title="Ghost Banking control"><Skeleton lines={3} /></Card>;
  if (q.error) return <Card title="Ghost Banking control"><ErrorState error={q.error} /></Card>;
  const c = q.data;
  const target = want; // fixed when the dialog opens, so the title never flips after saving
  return (
    <Card title={<span className="flex items-center gap-2"><Ghost size={16} aria-hidden />Ghost Banking control</span>}
      description="Backend-enforced containment policy for BLOCK decisions."
      actions={<Badge tone={c.effective ? 'info' : 'neutral'}>{c.effective ? 'ON — containing' : 'OFF — restricting'}</Badge>}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 space-y-1 text-[0.875rem]">
          <p><span className="text-[var(--ink-3)]">Approval: </span>{c.approval_status}</p>
          <p><span className="text-[var(--ink-3)]">{c.gate_enabled ? 'Active ghost sessions: ' : 'Sessions left in ghost mode (refused while the gate is off): '}</span><b className="tnum">{c.active_ghost_sessions}</b> · <span className="text-[var(--ink-3)]">contained in total: </span><b className="tnum">{c.total_contained_sessions}</b></p>
          <p className="text-[var(--ink-3)]">{c.last_change ? <>Last change: {c.last_change.from} → {c.last_change.to} by <b className="text-[var(--ink)]">{c.last_change.by}</b>, {fmtTime(c.last_change.at, true)} — “{c.last_change.reason}”</> : 'Never changed (default OFF).'}</p>
        </div>
        <button type="button" role="switch" aria-checked={c.effective} aria-label="Ghost Banking" disabled={!c.can_enable && !c.effective}
          onClick={() => { m.reset(); setWant(!c.effective); setOpen(true); }}
          className={`relative h-8 w-14 shrink-0 rounded-full transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${c.effective ? 'bg-[var(--electric)]' : 'bg-[var(--silver)]'}`}>
          <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-[left] duration-200 ${c.effective ? 'left-7' : 'left-1'}`} />
        </button>
      </div>
      <p className="mt-3 text-[0.8125rem] text-[var(--ink-3)]">Policy: {c.policy}</p>
      {open && (
        <ConfirmDialog title={target ? 'Turn Ghost Banking ON' : 'Turn Ghost Banking OFF'} scope="Configuration change" totp danger={!target}
          verb={target ? 'Turn on' : 'Turn off'} pending={m.isPending} error={m.error}
          warning={<Banner tone={target ? 'stepup' : 'info'} title={target ? 'Deception feature' : 'Safe disable'}>
            {target ? 'Blocked sessions will be shown an isolated synthetic bank. Mentor approval is required before any real deployment.' :
              `${c.active_ghost_sessions} live ghost session(s) will be RESTRICTED (never moved to protected banking). Evidence is kept.`}</Banner>}
          success={m.data && <Banner tone="allow" title="Saved">{m.data.changed ? `Ghost Banking is now ${m.data.runtime.toUpperCase()}.` : 'No change.'}{m.data.last_change?.effect?.sessions_restricted ? ` ${m.data.last_change.effect.sessions_restricted} session(s) restricted.` : ''}</Banner>}
          onSubmit={(v) => m.mutate({ enabled: target, reason: v.reason, totp_code: v.totp_code, expected_version: c.version })}
          onClose={() => setOpen(false)} />
      )}
    </Card>
  );
}

export function SocDashboard() {
  const [range, setRange] = useState<string>('24h');
  const [lab, setLab] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const params = `range=${range}&include_lab=${lab}${range === 'custom' && from ? `&start=${encodeURIComponent(new Date(from).toISOString())}${to ? `&end=${encodeURIComponent(new Date(to).toISOString())}` : ''}` : ''}`;
  const q = useSoc(params);
  const d = q.data;
  const series = useMemo(() => (d?.series ?? []).map((r) => ({ ...r, label: new Date(r.t).toLocaleString('en-IN', d && d.range.step_s >= 86400 ? { day: '2-digit', month: 'short' } : { hour: '2-digit', minute: '2-digit' }), prevented: r.prevented_paise / 100 })), [d]);

  return (
    <>
      <PageTitle title="Security operations" sub="Live metrics computed from SecureSynth records. Refreshes every 8 seconds."
        actions={<span className="inline-flex items-center gap-2 text-[0.8125rem] text-[var(--ink-3)]"><span className={`h-2 w-2 rounded-full ${q.isError ? 'bg-[var(--block)]' : 'bg-[var(--allow)]'}`} aria-hidden />{q.isError ? 'Disconnected — retrying' : 'Live'}</span>} />
      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        {RANGES.map(([k, l]) => (
          <button key={k} type="button" aria-pressed={range === k} onClick={() => setRange(k)}
            className={`px-2.5 py-1.5 rounded-[var(--radius-s)] text-[0.8125rem] cursor-pointer border ${range === k ? 'bg-[var(--accent-tint)] border-[var(--accent)]' : 'border-[var(--hairline)] text-[var(--ink-2)] hover:bg-[var(--surface-2)]'}`}>{l}</button>
        ))}
        {range === 'custom' && <><input type="datetime-local" className="input !w-auto !min-h-11 !py-1" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="datetime-local" className="input !w-auto !min-h-11 !py-1" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} /></>}
        <label className="ml-auto inline-flex items-center gap-2 text-[0.8125rem] cursor-pointer"><input type="checkbox" checked={lab} onChange={(e) => setLab(e.target.checked)} />Include Scenario Lab data</label>
        <Badge tone={lab ? 'stepup' : 'allow'}>{lab ? 'Demo data included' : 'Genuine activity only'}</Badge>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4 min-w-0">
          {q.isPending ? <Card><Skeleton lines={8} /></Card> : !d ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
            <>
              <section aria-label="Key metrics" className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {KPI.map((k) => (
                  <div key={k.key} title={d.definitions[k.key]} className="rounded-[var(--radius-m)] border border-[color:var(--hairline)] bg-[var(--surface)] p-3.5 shadow-[var(--shadow-panel)]">
                    <p className="text-[0.75rem] text-[var(--ink-3)] leading-tight">{k.label}</p>
                    <p className="tnum text-[1.375rem] font-semibold mt-1 leading-none">{k.money ? formatPaise(d.kpis[k.key] ?? 0, true) : d.kpis[k.key] ?? 0}</p>
                    {k.key === 'synthetic_value_paise' && <p className="text-[0.75rem] text-[var(--ink-3)] mt-1">fake money, never added to real figures</p>}
                  </div>
                ))}
              </section>
              <Card title="Threat activity over time" description="Risk decisions per interval (status colours: Allow, Step-up, Block).">
                {series.length === 0 ? <p className="text-[var(--ink-3)]">No data in this range.</p> : (
                  <div className="h-[230px]" role="img" aria-label={`Decisions over time: ${Object.entries(d.decisions).map(([k, v]) => `${v} ${k}`).join(', ')}`}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={series} margin={{ top: 6, right: 8, bottom: 0, left: -18 }} barCategoryGap={2}>
                        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--chart-axis)' }} minTickGap={24} />
                        <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} />
                        <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 8, fontSize: 12 }} />
                        <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="ALLOW" name="Allow" stackId="d" fill="var(--allow)" stroke="var(--chart-surface)" strokeWidth={2} isAnimationActive={false} />
                        <Bar dataKey="STEP_UP" name="Step-up" stackId="d" fill="var(--stepup)" stroke="var(--chart-surface)" strokeWidth={2} isAnimationActive={false} />
                        <Bar dataKey="BLOCK" name="Block" stackId="d" fill="var(--block)" stroke="var(--chart-surface)" strokeWidth={2} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Containment activity" description="New incidents per interval by containment mode.">
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={series} margin={{ top: 6, right: 8, bottom: 0, left: -18 }} barCategoryGap={2}>
                        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--chart-axis)' }} minTickGap={24} />
                        <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} />
                        <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 8, fontSize: 12 }} />
                        <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="ghost" name="Ghost Banking" stackId="c" fill="var(--series-1)" stroke="var(--chart-surface)" strokeWidth={2} isAnimationActive={false} />
                        <Bar dataKey="restricted" name="Restricted" stackId="c" fill="var(--series-aqua)" stroke="var(--chart-surface)" strokeWidth={2} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
                <Card title="Prevented exposure over time" description="Stopped protected transfer attempts (₹, never executed).">
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={series} margin={{ top: 6, right: 8, bottom: 0, left: 6 }} barCategoryGap={2}>
                        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--chart-axis)' }} minTickGap={24} />
                        <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                        <Tooltip formatter={(v) => [`₹${Number(v).toLocaleString('en-IN')}`, 'Prevented']} cursor={{ fill: 'var(--surface-2)' }} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 8, fontSize: 12 }} />
                        <Bar dataKey="prevented" name="Prevented exposure" fill="var(--series-1)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
                <Card title="Incident resolution and Ghost activity" description="Resolved incidents and synthetic Ghost Banking events per interval.">
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={series} margin={{ top: 6, right: 8, bottom: 0, left: -18 }} barCategoryGap={2}>
                        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--chart-axis)' }} minTickGap={24} />
                        <YAxis allowDecimals={false} tick={axisTick} tickLine={false} axisLine={false} />
                        <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--hairline)', borderRadius: 8, fontSize: 12 }} />
                        <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="resolved" name="Resolved incidents" fill="var(--series-aqua)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                        <Bar dataKey="ghost_events" name="Ghost events (synthetic)" fill="var(--series-1)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
                <Card title="Distributions" description="In the selected range.">
                  <Dist title="Risk decisions" data={d.decisions} tones={{ ALLOW: 'allow', STEP_UP: 'stepup', BLOCK: 'block' }} />
                  <Dist title="Incident severity" data={d.severity} tones={{ high: 'stepup', critical: 'block' }} />
                  <Dist title="Cybercrime report status" data={d.report_status} />
                </Card>
              </div>
              <Card title="Operational performance" description="Measured from records; unavailable where it cannot be measured.">
                <dl className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                  {PERF.map((p) => { const m = d.performance[p.key]; return (
                    <div key={p.key}><dt className="text-[0.75rem] text-[var(--ink-3)]">{p.label}</dt>
                      <dd className="tnum text-[1.125rem] font-semibold mt-0.5">{fmtDur(m?.value, m?.unit ?? 's')}</dd>
                      <dd className="text-[0.75rem] text-[var(--ink-3)]">{m?.note ?? (m?.n ? `mean · median ${fmtDur(m.median, m.unit)} · n=${m.n}` : 'no samples in range')}</dd></div>
                  ); })}
                </dl>
              </Card>
            </>
          )}
        </div>
        <div className="space-y-4 min-w-0">
          <GhostControl />
          <Card title={<span className="flex items-center gap-2"><Activity size={16} aria-hidden />Live incident feed</span>} padded={false}>
            {!d ? <div className="p-4"><Skeleton lines={5} /></div> : d.feed.length === 0 ? <p className="p-5 text-[var(--ink-3)]">No events yet.</p> : (
              <ul className="max-h-[640px] overflow-y-auto">
                {d.feed.map((f, i) => {
                  const Icon = f.kind === 'integrity' ? ShieldAlert : f.kind === 'report' ? ShieldCheck : f.detail.startsWith('Ghost') ? Ghost : ShieldAlert;
                  const inner = (
                    <span className="flex gap-3 px-4 py-3">
                      <Icon size={15} className={`mt-0.5 shrink-0 ${f.severity === 'critical' ? 'text-[var(--block)]' : 'text-[var(--ink-3)]'}`} aria-hidden />
                      <span className="min-w-0"><span className="block text-[0.875rem] font-medium">{f.title}</span>
                        <span className="block text-[0.75rem] text-[var(--ink-3)]">{f.detail}{f.lab ? ' · lab' : ''} · {fmtTime(f.ts, true)}</span></span>
                    </span>);
                  return <li key={i} className="border-b border-[color:var(--hairline)] last:border-b-0">{f.incident_id ? <Link to={`/soc/investigations/${f.incident_id}`} className="block no-underline hover:bg-[var(--surface-2)]">{inner}</Link> : inner}</li>;
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Dist({ title, data, tones }: { title: string; data: Record<string, number>; tones?: Record<string, 'allow' | 'stepup' | 'block'> }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  return (
    <div className="mb-4 last:mb-0">
      <p className="text-[0.8125rem] font-medium">{title} <span className="text-[var(--ink-3)] font-normal">· {total}</span></p>
      {total === 0 ? <p className="text-[0.8125rem] text-[var(--ink-3)]">None</p> : (
        <ul className="mt-1.5 space-y-1">
          {Object.entries(data).map(([k, v]) => (
            <li key={k} className="grid grid-cols-[120px_1fr_36px] items-center gap-2 text-[0.8125rem]">
              <span className="truncate">{k.replace(/_/g, ' ')}</span>
              <span className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden"><span className="block h-full rounded-full" style={{ width: `${(v / total) * 100}%`, background: tones?.[k] ? `var(--${tones[k]})` : 'var(--series-1)' }} /></span>
              <span className="tnum text-right">{v}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
