/* Security incidents: the analyst's queue of restricted customers, the evidence behind each restriction,
 * and the decisions that resolve it. Every control calls a real backend endpoint; the backend enforces
 * permissions, the fresh-TOTP requirement, eligibility and idempotency. */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Ban, LockKeyhole, ShieldAlert, ShieldCheck, Smartphone, UserCheck, X } from 'lucide-react';
import type { IncidentAction, IncidentDetail, IncidentRow, IncidentStatus } from '../../api/types';
import { useIncident, useIncidentAction, useIncidentRead, useIncidents } from '../../api/queries';
import { Badge, Banner, Button, Card, DataTable, DecisionPill, EmptyState, ErrorState, RiskGauge, Skeleton, Timeline, fmtTime, formatPaise, type Column } from '../../design/components';
import { PageTitle } from '../../layout/layouts';

type Filter = 'open' | 'resolved' | 'all';
const STATUS: Record<IncidentStatus, { label: string; tone: 'block' | 'stepup' | 'allow' | 'neutral' | 'info' }> = {
  pending_review: { label: 'Pending review', tone: 'block' },
  verification_requested: { label: 'Verification requested', tone: 'stepup' },
  session_restored: { label: 'Session restored', tone: 'allow' },
  user_cleared: { label: 'Customer cleared', tone: 'allow' },
  restriction_retained: { label: 'Restriction retained', tone: 'neutral' },
  session_revoked: { label: 'Session revoked', tone: 'neutral' },
};
const ACTION_COPY: Record<IncidentAction, { title: string; verb: string; scope: string; body: string; danger?: boolean; totp?: boolean }> = {
  unblock_session: {
    title: 'Unblock this session', verb: 'Unblock session', scope: 'Session level', totp: true,
    body: 'Releases only this restricted session. Its sign-in was verified and it is still within its lifetime, so the customer continues where they are. The blocked transfer is NOT executed; any new request is risk-assessed again.',
  },
  clear_user: {
    title: 'Clear the customer’s restriction', verb: 'Clear restriction', scope: 'Customer level', totp: true,
    body: 'Resolves the incident for this customer. Every session in the incident is ended (old tokens are never reactivated) and the customer signs in afresh with password, TOTP and, where the engine asks, their trusted device. Blocked transfers stay unexecuted; the reviewed attempts stop counting as transfer velocity.',
  },
  keep_restricted: {
    title: 'Keep the restriction', verb: 'Keep restricted', scope: 'Decision',
    body: 'Records your decision that the activity remains suspicious. The session stays restricted and the customer is told to contact the bank.',
  },
  revoke_session: {
    title: 'Revoke the session', verb: 'Revoke session', scope: 'Session level', danger: true,
    body: 'Terminates every session in this incident immediately. Nothing is restored; the customer must sign in again and will be assessed from scratch.',
  },
  request_verification: {
    title: 'Request trusted-device verification', verb: 'Send request', scope: 'Evidence',
    body: 'Sends a number-matching check to the customer’s registered trusted device and shows the number on their restricted screen. The answer is recorded as evidence; it does not restore access by itself.',
  },
};

function SeverityBadge({ s }: { s: IncidentRow['severity'] }) {
  return <Badge tone={s === 'critical' ? 'block' : 'stepup'}><ShieldAlert size={12} aria-hidden />{s === 'critical' ? 'Critical' : 'High'}</Badge>;
}

/** Modal confirmation with a mandatory reason (and a fresh TOTP code when a restriction is lifted). */
function ConfirmAction({ incident, action, sessionId, onClose }: { incident: IncidentRow; action: IncidentAction; sessionId?: string; onClose: () => void }) {
  const m = useIncidentAction(incident.id);
  const copy = ACTION_COPY[action];
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => { reasonRef.current?.focus(); const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !m.isPending) onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose, m.isPending]);
  const valid = reason.trim().length >= 8 && (!copy.totp || /^\d{6}$/.test(code));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    m.mutate({ action, reason: reason.trim(), totp_code: copy.totp ? code : undefined, session_id: sessionId });
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="ia-title">
      <motion.button type="button" aria-label="Close" className="absolute inset-0 bg-[rgba(16,24,40,0.42)] cursor-default" onClick={() => !m.isPending && onClose()}
        initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} />
      <motion.form onSubmit={submit} className="relative w-full max-w-[520px] rounded-[var(--radius-l)] border border-[color:var(--hairline)] bg-[var(--surface)] p-6 shadow-[0_30px_80px_-30px_rgba(16,24,40,0.5)]"
        initial={reduce ? false : { opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 34 }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <Badge tone={copy.danger ? 'block' : action === 'unblock_session' || action === 'clear_user' ? 'allow' : 'neutral'}>{copy.scope}</Badge>
            <h2 id="ia-title" className="text-[1.25rem] font-semibold mt-2 tracking-[-0.01em]">{copy.title}</h2>
            <p className="text-[0.875rem] text-[var(--ink-3)] mt-0.5">{incident.display_name} ({incident.username}) · incident #{incident.id}{sessionId ? ` · session ${sessionId}` : ''}</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Close" disabled={m.isPending}><X size={16} /></Button>
        </div>
        {m.isSuccess ? (
          <div className="mt-5 space-y-4" aria-live="polite">
            <Banner tone="allow" title={m.data.idempotent ? 'Already recorded' : 'Decision recorded'}>
              Incident is now “{STATUS[m.data.status].label.toLowerCase()}”.{typeof m.data.reviewed_attempts === 'number' && m.data.reviewed_attempts > 0 && ` ${m.data.reviewed_attempts} never-executed attempt(s) marked reviewed.`} The customer’s screen updates automatically.
            </Banner>
            <div className="flex justify-end"><Button type="button" onClick={onClose}>Done</Button></div>
          </div>
        ) : (
          <>
            <p className="mt-4 text-[0.9375rem] text-[var(--ink-2)] leading-relaxed">{copy.body}</p>
            <label htmlFor="ia-reason" className="field-label mt-5 block">Reason <span className="text-[var(--ink-3)] font-normal">(required, recorded in the audit log)</span></label>
            <textarea id="ia-reason" ref={reasonRef} className="input mt-1 w-full min-h-[84px] resize-y" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer confirmed the transfer on a call-back to the registered number" aria-describedby="ia-reason-hint" />
            <p id="ia-reason-hint" className="text-[0.75rem] text-[var(--ink-3)] mt-1">{reason.trim().length < 8 ? `At least 8 characters (${reason.trim().length}/8)` : `${reason.trim().length}/300`}</p>
            {copy.totp && (
              <>
                <label htmlFor="ia-totp" className="field-label mt-4 block">Your authenticator code <span className="text-[var(--ink-3)] font-normal">(fresh authentication to lift a restriction)</span></label>
                <input id="ia-totp" className="input mt-1 w-40 tnum tracking-[0.3em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                  value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" />
              </>
            )}
            {m.error && <div className="mt-4"><Banner tone="block" title={m.error.code === 'REAUTH_FAILED' ? 'Code not accepted' : m.error.code === 'SESSION_NOT_ELIGIBLE' ? 'Session not eligible' : m.error.code === 'INCIDENT_RESOLVED' ? 'Already resolved' : 'Action failed'}>{m.error.message}</Banner></div>}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={m.isPending}>Cancel</Button>
              <Button type="submit" variant={copy.danger ? 'danger' : 'primary'} disabled={!valid} loading={m.isPending}>{copy.verb}</Button>
            </div>
          </>
        )}
      </motion.form>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><dt className="text-[0.75rem] text-[var(--ink-3)]">{label}</dt><dd className="mt-0.5 font-medium break-words">{children}</dd></div>;
}

function IncidentPanel({ d }: { d: IncidentDetail }) {
  const inc = d.incident;
  const [action, setAction] = useState<IncidentAction | null>(null);
  const a = d.trigger_assessment ?? d.latest_assessment;
  const primary = d.sessions.find((s) => s.id === inc.session_id) ?? d.sessions[0];
  const st = STATUS[inc.status];
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.8125rem] text-[var(--ink-3)]">Incident #{inc.id} · opened {fmtTime(inc.created_at, true)}{inc.is_lab && ' · Scenario Lab'}</p>
            <h2 className="rn-display text-[clamp(1.75rem,3vw,2.375rem)] mt-1">{inc.display_name}</h2>
            <p className="text-[var(--ink-2)] mt-1">{inc.username} · session <Link className="font-mono text-[0.8125rem] underline underline-offset-2" to={`/soc/sessions/${encodeURIComponent(inc.session_id)}`}>{inc.session_id}</Link></p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5"><SeverityBadge s={inc.severity} /><Badge tone={st.tone}>{st.label}</Badge></div>
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-4 border-t border-[var(--hairline)]">
          <Fact label="Risk index (not a probability)"><span className="inline-flex items-center gap-2"><span className="tnum">{inc.risk_score?.toFixed(1) ?? '—'}</span><RiskGauge size="sm" value={inc.risk_score} thresholds={a?.thresholds} /></span></Fact>
          <Fact label="Triggering amount">{inc.amount_paise != null ? formatPaise(inc.amount_paise) : 'None (sign-in or payee)'}</Fact>
          <Fact label="Location (simulated)">{inc.city || '—'}</Fact>
          <Fact label="Device">{inc.device_recognised ? 'Recognised browser' : 'Unrecognised browser'}{inc.device_ref && <span className="block text-[0.75rem] font-normal text-[var(--ink-3)] font-mono">{inc.device_ref}</span>}</Fact>
          <Fact label="Checkpoint">{inc.checkpoint.replace('_', ' ')}</Fact>
          <Fact label="Restrictions in incident">{inc.block_count}</Fact>
          <Fact label="Protected balance">{d.balance_paise != null ? formatPaise(d.balance_paise) : '—'}</Fact>
          <Fact label="Trusted-device check">{inc.verification ? inc.verification.replace('_', ' ') : 'Not requested'}</Fact>
        </dl>
        <p className="mt-4 text-[0.9375rem] text-[var(--ink-2)]"><span className="font-medium text-[var(--ink)]">Reason for restriction: </span>{inc.reason}</p>
        {inc.resolution_action && (
          <div className="mt-4"><Banner tone={inc.status === 'session_restored' || inc.status === 'user_cleared' ? 'allow' : 'info'} title={`${STATUS[inc.status].label} by ${inc.resolved_by} · ${inc.resolved_at ? fmtTime(inc.resolved_at, true) : ''}`}>{inc.resolution_reason}</Banner></div>
        )}
      </Card>

      {inc.open && (
        <Card title="Decision" description="Session-level actions affect one session; customer-level actions resolve the whole incident. Every action needs a reason and is audited.">
          <div className="grid gap-2 sm:grid-cols-2">
            <ActionButton icon={<ShieldCheck size={16} />} label="Unblock session" sub={primary?.unblock_eligible ? 'Session level · restores this session' : primary?.eligibility ?? 'Not eligible'} disabled={!primary?.unblock_eligible} onClick={() => setAction('unblock_session')} />
            <ActionButton icon={<UserCheck size={16} />} label="Clear user restriction" sub="Customer level · fresh secure sign-in" onClick={() => setAction('clear_user')} />
            <ActionButton icon={<LockKeyhole size={16} />} label="Keep restricted" sub="Retain: activity remains suspicious" onClick={() => setAction('keep_restricted')} />
            <ActionButton icon={<Ban size={16} />} label="Revoke session" sub="Terminate every session in the incident" danger onClick={() => setAction('revoke_session')} />
            <ActionButton icon={<Smartphone size={16} />} label={inc.status === 'verification_requested' ? 'Verification pending…' : 'Request verification'} sub="Number match on the trusted device" disabled={inc.status === 'verification_requested'} onClick={() => setAction('request_verification')} />
          </div>
        </Card>
      )}

      {a && (
        <Card title="Risk assessment" description={`Assessment #${a.id} · ${a.model_version} · ${a.latency_ms.toFixed(1)} ms`} actions={<DecisionPill decision={a.decision} />}>
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <h3 className="text-[0.875rem] font-semibold">Score composition</h3>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-1 text-[0.875rem]">
                <dt className="text-[var(--ink-2)]">ML anomaly index {a.ml.index.toFixed(1)} × weight {a.ml_weight}</dt><dd className="tnum text-right">{(a.ml.index * a.ml_weight).toFixed(1)}</dd>
                {a.policy.map((p) => <PolicyRow key={p.rule} label={p.label} points={p.points} />)}
                <dt className="font-medium border-t border-[var(--hairline)] pt-1">Risk index (clipped 0–100)</dt><dd className="tnum text-right font-medium border-t border-[var(--hairline)] pt-1">{a.risk_score.toFixed(1)}</dd>
              </dl>
              <p className="text-[0.75rem] text-[var(--ink-3)] mt-2">Step-up at {a.thresholds.step_up}, block at {a.thresholds.block}. Raw Isolation Forest score {a.ml.raw.toFixed(3)}.</p>
            </div>
            <div>
              <h3 className="text-[0.875rem] font-semibold">Behavioural deviations</h3>
              {a.deviations.length === 0 ? <p className="text-[var(--ink-3)] mt-2 text-[0.875rem]">No individual signal outside the customer’s baseline; the combination was rare.</p> : (
                <ul className="mt-2 space-y-2">
                  {a.deviations.map((dv) => (
                    <li key={dv.feature} className="text-[0.875rem]">
                      <div className="flex items-center gap-2"><Badge tone={dv.severity === 'high' ? 'block' : dv.severity === 'medium' ? 'stepup' : 'neutral'}>{dv.severity}</Badge><span className="font-medium">{dv.label}</span></div>
                      <p className="text-[var(--ink-2)] mt-0.5">{dv.observed} <span className="text-[var(--ink-3)]">· usual: {dv.baseline}</span></p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      )}

      <Card title="Transaction attempts and history" padded={false} description="Blocked attempts are kept as evidence. They are never executed, including after clearance.">
        <DataTable caption="Transactions" minWidth={560} rowKey={(t) => t.id} rows={d.transactions}
          columns={[
            { key: 'ts', header: 'Time', cell: (t) => <span className="whitespace-nowrap text-[var(--ink-2)]">{fmtTime(t.created_at, true)}</span> },
            { key: 'cp', header: 'Payee', cell: (t) => t.counterparty },
            { key: 'amt', header: 'Amount', align: 'right', cell: (t) => <span className="tnum">{formatPaise(t.amount_paise)}</span> },
            { key: 'st', header: 'Status', cell: (t) => <span className="inline-flex items-center gap-1.5"><Badge tone={t.status === 'completed' ? 'allow' : t.status === 'restricted' ? 'block' : 'stepup'}>{t.status.replace('_', ' ')}</Badge>{t.in_incident && <span className="text-[0.75rem] text-[var(--ink-3)]">this incident</span>}</span> },
          ]} />
        {d.attempts.length > 0 && (
          <p className="px-5 py-3 text-[0.8125rem] text-[var(--ink-3)] border-t border-[var(--hairline)]">
            Velocity status of this incident’s transfer attempts: {d.attempts.map((x) => `${x.amount_paise != null ? formatPaise(x.amount_paise, true) : '?'} ${x.outcome ?? 'recorded'}`).join(' · ')}.
            {' '}“reviewed” attempts are excluded from future transfer-velocity features.
          </p>
        )}
      </Card>

      <Card title="Sessions in this incident" padded={false}>
        <DataTable caption="Sessions in this incident" minWidth={600} rowKey={(s) => s.id} rows={d.sessions}
          columns={[
            { key: 'id', header: 'Session', cell: (s) => <Link className="font-mono text-[0.8125rem] underline underline-offset-2" to={`/soc/sessions/${encodeURIComponent(s.id)}`}>{s.id}</Link> },
            { key: 'mode', header: 'Mode', cell: (s) => <Badge tone={s.mode === 'restricted' || s.mode === 'revoked' ? 'block' : s.mode === 'normal' ? 'allow' : 'stepup'}>{s.mode.replace('_', '-')}</Badge> },
            { key: 'login', header: 'Sign-in verified', cell: (s) => s.login_verified ? 'Yes' : 'No' },
            { key: 'el', header: 'Session unblock', cell: (s) => <span className={s.unblock_eligible ? 'text-[var(--allow)]' : 'text-[var(--ink-3)]'}>{s.eligibility}</span> },
          ]} />
      </Card>

      <Card title="Incident audit trail">
        {d.timeline.length === 0 ? <p className="text-[var(--ink-3)]">No events.</p> :
          <Timeline items={d.timeline.map((e) => ({ id: e.id, time: fmtTime(e.ts, true), title: <span className="font-mono text-[0.8125rem]">{e.event_type}</span>, marker: <span className="text-[0.75rem] text-[var(--ink-3)]">by {e.actor}</span>,
            body: Object.entries(e.details).filter(([k]) => k !== 'session_ids').map(([k, v]) => `${k}: ${String(v)}`).join(' · ') }))} />}
      </Card>

      <AnimatePresence>{action && <ConfirmAction key={action} incident={inc} action={action} sessionId={action === 'unblock_session' ? primary?.id : undefined} onClose={() => setAction(null)} />}</AnimatePresence>
    </div>
  );
}

function PolicyRow({ label, points }: { label: string; points: number }) {
  return <><dt className="text-[var(--ink-2)]">{label}</dt><dd className="tnum text-right">{points > 0 ? '+' : ''}{points}</dd></>;
}

function ActionButton({ icon, label, sub, onClick, disabled, danger }: { icon: React.ReactNode; label: string; sub: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`group flex items-start gap-3 rounded-[var(--radius-m)] border p-3.5 text-left transition-[border-color,background-color,box-shadow] duration-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-55 ${danger ? 'border-[color:var(--block-line)] hover:bg-[var(--block-tint)]' : 'border-[color:var(--hairline)] hover:border-[color:var(--hairline-strong)] hover:shadow-[0_6px_20px_-12px_rgba(16,24,40,0.35)]'}`}>
      <span className={`mt-0.5 ${danger ? 'text-[var(--block)]' : 'text-[var(--ink-2)] group-hover:text-[var(--ink)]'}`} aria-hidden>{icon}</span>
      <span className="min-w-0"><span className={`block font-medium ${danger ? 'text-[var(--block)]' : ''}`}>{label}</span><span className="block text-[0.8125rem] text-[var(--ink-3)] mt-0.5">{sub}</span></span>
    </button>
  );
}

export function IncidentsPage() {
  const { id } = useParams();
  const selected = id ? Number(id) : null;
  const [filter, setFilter] = useState<Filter>('open');
  const list = useIncidents(filter);
  const detail = useIncident(selected);
  const read = useIncidentRead();
  const nav = useNavigate();
  const readRef = useRef<number | null>(null);
  useEffect(() => {
    if (detail.data?.incident.unread && readRef.current !== detail.data.incident.id + detail.data.incident.last_activity_at.length) {
      readRef.current = detail.data.incident.id + detail.data.incident.last_activity_at.length;
      read.mutate(detail.data.incident.id);
    }
  }, [detail.data, read]);
  const rows = useMemo(() => list.data ?? [], [list.data]);

  const cols: Column<IncidentRow>[] = [
    { key: 'who', header: 'Customer', cell: (r) => <div className="flex items-start gap-2">{r.unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--electric)]" aria-label="Unread" />}<div><div className="font-medium">{r.display_name}</div><div className="text-[0.75rem] text-[var(--ink-3)]">{r.username} · #{r.id}{r.is_lab && ' · lab'}</div></div></div> },
    { key: 'sev', header: 'Severity', cell: (r) => <SeverityBadge s={r.severity} /> },
    { key: 'score', header: 'Risk', align: 'right', cell: (r) => <span className="tnum font-medium">{r.risk_score?.toFixed(1) ?? '—'}</span> },
    { key: 'amt', header: 'Amount', align: 'right', cell: (r) => <span className="tnum">{r.amount_paise != null ? formatPaise(r.amount_paise, true) : '—'}</span> },
    { key: 'st', header: 'Status', cell: (r) => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge> },
    { key: 'ts', header: 'Last activity', align: 'right', className: 'whitespace-nowrap', cell: (r) => <span className="text-[var(--ink-2)]">{fmtTime(r.last_activity_at)}</span> },
  ];

  return (
    <>
      <PageTitle title="Security incidents" sub="Customers restricted by the risk engine, with the evidence and the decisions that resolve them. Updates every 4 seconds."
        actions={<span className="inline-flex items-center gap-2 text-[0.8125rem] text-[var(--ink-3)]"><span className={`h-2 w-2 rounded-full ${list.isError ? 'bg-[var(--block)]' : 'bg-[var(--allow)]'}`} aria-hidden />{list.isError ? 'Feed interrupted' : 'Live'}</span>} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]">
        <Card padded={false} title="Incidents" className="self-start xl:sticky xl:top-[76px]" actions={
          <div role="group" aria-label="Filter incidents" className="flex gap-1">
            {(['open', 'resolved', 'all'] as const).map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
                className={`px-2 py-1 rounded-[var(--radius-s)] text-[0.8125rem] cursor-pointer border ${filter === f ? 'bg-[var(--accent-tint)] border-[var(--accent)] text-[var(--ink)]' : 'border-[var(--hairline)] text-[var(--ink-2)] hover:bg-[var(--surface-2)]'}`}>
                {f === 'open' ? 'Pending' : f === 'resolved' ? 'Resolved' : 'All'}
              </button>
            ))}
          </div>}>
          {list.isPending ? <div className="p-4"><Skeleton lines={5} /></div> : list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> :
            rows.length === 0 ? <EmptyState title={filter === 'open' ? 'No incidents waiting for review' : 'No incidents'}>{filter === 'open' ? 'When the engine restricts a customer, the incident appears here and in the bell.' : 'Change the filter to see others.'}</EmptyState> :
              <DataTable caption="Security incidents" minWidth={560} columns={cols} rows={rows} rowKey={(r) => r.id} onRowClick={(r) => nav(`/soc/incidents/${r.id}`)} />}
        </Card>
        <div className="min-w-0">
          {selected == null ? (
            <Card><EmptyState title="Select an incident">Open an incident to review the evidence and decide.</EmptyState></Card>
          ) : detail.isPending ? <Card><Skeleton lines={8} /></Card> : detail.error ? <ErrorState error={detail.error} title={detail.error.status === 404 ? 'Incident not found' : undefined} onRetry={() => detail.refetch()} /> : (
            <IncidentPanel d={detail.data} />
          )}
        </div>
      </div>
      {selected == null && rows.some((r) => r.open) && (
        <p className="sr-only" aria-live="polite">{rows.filter((r) => r.open).length} incidents pending review.</p>
      )}
    </>
  );
}

