/* Ghost Banking monitor: what a contained session is doing on the isolated synthetic ledger, live, next to the
 * incident evidence and the analyst's decisions. Synthetic data is always labelled; the protected comparison is an
 * explicit, audited request. Every number comes from GET /admin/ghost/{session_id}. */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Ban, Eye, EyeOff, Ghost, Lock, LockKeyhole, ShieldCheck, Smartphone, UserCheck } from 'lucide-react';
import type { GhostTxn, IncidentAction, Transaction } from '../../api/types';
import { useGhost } from '../../api/queries';
import { Badge, Banner, Button, Card, DataTable, DecisionPill, EmptyState, ErrorState, Money, RiskGauge, Skeleton, Timeline, fmtTime, formatPaise } from '../../design/components';
import { PageTitle } from '../../layout/layouts';
import { ConfirmAction, STATUS, SeverityBadge } from './IncidentsPage';

const EVENT: Record<string, string> = {
  entered: 'Session contained in Ghost Banking', viewed_overview: 'Viewed account overview', viewed_transactions: 'Viewed transactions',
  beneficiary_added: 'Added a payee (simulated)', transfer_simulated: 'Sent a transfer (simulated)', transfer_rejected: 'Transfer attempt refused (simulated)',
};

function Synthetic() { return <Badge tone="info"><Ghost size={12} aria-hidden />Synthetic</Badge>; }

function Ledger({ label, tone, account, balance, sub, txns }: { label: string; tone: 'info' | 'allow'; account: string | null; balance: number | null; sub: string; txns: (Transaction | GhostTxn)[] }) {
  return (
    <Card padded={false} title={<span className="flex items-center gap-2"><Badge tone={tone}>{label}</Badge></span>} description={account ?? '—'}>
      <div className="px-5 py-3 border-b border-[var(--hairline)]">
        <div className="text-[0.8125rem] text-[var(--ink-3)]">Balance</div>
        {balance != null ? <Money paise={balance} className="text-[1.5rem] font-semibold" /> : '—'}
        <div className="text-[0.75rem] text-[var(--ink-3)] mt-0.5">{sub}</div>
      </div>
      {txns.length === 0 ? <EmptyState title="No transactions" /> : (
        <DataTable caption={label} rows={txns} rowKey={(t) => t.id} minWidth={420} columns={[
          { key: 't', header: 'Time', cell: (t) => <span className="whitespace-nowrap">{fmtTime(t.created_at, true)}</span> },
          { key: 'c', header: 'Counterparty', cell: (t) => <span>{t.counterparty}{'origin' in t && t.origin === 'session' && <span className="ml-1.5 text-[0.75rem] text-[var(--info)]">by session</span>}</span> },
          { key: 's', header: 'Status', cell: (t) => <Badge tone={t.status === 'completed' ? 'neutral' : t.status === 'restricted' ? 'block' : 'stepup'}>{t.status.replace('_', ' ')}</Badge> },
          { key: 'a', header: 'Amount', align: 'right', cell: (t) => <Money paise={t.amount_paise} signed direction={t.direction} /> },
        ]} />
      )}
    </Card>
  );
}

export function GhostPage() {
  const { sessionId = '' } = useParams();
  const q = useGhost(sessionId);
  const [compare, setCompare] = useState(false);
  const cmp = useGhost(compare ? sessionId : '', true);
  const [action, setAction] = useState<IncidentAction | null>(null);
  const reduce = useReducedMotion();
  const back = <Link to={q.data?.incident ? `/soc/incidents/${q.data.incident.id}` : `/soc/sessions/${encodeURIComponent(sessionId)}`} className="text-[var(--accent)]">{q.data?.incident ? 'Back to incident' : 'Back to session'}</Link>;

  if (q.isPending) return <><PageTitle title="Ghost Banking" sub={`Contained session ${sessionId}`} actions={back} /><Skeleton lines={8} /></>;
  if (q.error) {
    return (
      <>
        <PageTitle title="Ghost Banking" sub={`Contained session ${sessionId}`} actions={back} />
        {q.error.code === 'FEATURE_DISABLED' ? (
          <Card><div className="flex flex-col items-center text-center py-10 gap-2"><Lock size={22} className="text-[var(--ink-3)]" aria-hidden /><p className="font-medium">Feature disabled pending mentor approval</p>
            <p className="text-[var(--ink-3)] max-w-[56ch]">Ghost Banking is off by default. Blocked sessions are moved to restricted mode instead: no payments, no payee changes.</p></div></Card>
        ) : <ErrorState error={q.error} title={q.error.status === 404 ? 'This session was not contained in Ghost Banking' : undefined} onRetry={() => q.refetch()} />}
      </>
    );
  }
  const d = q.data;
  const g = d.ghost;
  const inc = d.incident;
  const a = d.trigger_assessment;
  const ps = d.protected_status;
  const live = d.session.mode === 'ghost';
  const sessionTxns = g.transactions.filter((t) => t.origin === 'session');
  const sessionBens = g.beneficiaries.filter((b) => b.origin === 'session');

  return (
    <>
      <PageTitle
        title={<span className="flex flex-wrap items-center gap-3">Ghost Banking <Synthetic /></span>}
        sub={<>{d.session.display_name} ({d.session.username}) · session <span className="font-mono text-[0.875rem]">{d.session.id}</span> · {live ? 'contained now, refreshes every 3 s' : `session ${d.session.mode}`}</>}
        actions={<>{inc && <Link to={`/soc/investigations/${inc.id}`} className="text-[var(--accent)]">Investigation workspace</Link>}{back}</>} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="space-y-4 min-w-0">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[0.8125rem] text-[var(--ink-3)]">{inc ? `Incident #${inc.id} · opened ${fmtTime(inc.created_at, true)}` : 'No incident found'}{d.session.is_lab && ' · Scenario Lab'}</p>
                <p className="mt-1 text-[0.9375rem] text-[var(--ink-2)]"><span className="font-medium text-[var(--ink)]">Why contained: </span>{inc?.reason ?? g.account.reason}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">{inc && <SeverityBadge s={inc.severity} />}{inc && <Badge tone={STATUS[inc.status].tone}>{STATUS[inc.status].label}</Badge>}<Badge tone={live ? 'info' : 'neutral'}>{live ? 'Live in ghost' : `Session ${d.session.mode}`}</Badge></div>
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-4 border-t border-[var(--hairline)]">
              <div><dt className="text-[0.75rem] text-[var(--ink-3)]">Risk index at block</dt><dd className="mt-0.5 font-medium flex items-center gap-2"><span className="tnum">{inc?.risk_score?.toFixed(1) ?? '—'}</span><RiskGauge size="sm" value={inc?.risk_score ?? null} thresholds={a?.thresholds} /></dd></div>
              <div><dt className="text-[0.75rem] text-[var(--ink-3)]">Simulated transfers</dt><dd className="mt-0.5 font-medium tnum">{g.totals.simulated_transfers} · {formatPaise(g.totals.simulated_value_paise, true)}</dd></div>
              <div><dt className="text-[0.75rem] text-[var(--ink-3)]">Attempted value (incl. refused)</dt><dd className="mt-0.5 font-medium tnum">{formatPaise(g.totals.attempted_value_paise, true)}</dd></div>
              <div><dt className="text-[0.75rem] text-[var(--ink-3)]">Payees added (simulated)</dt><dd className="mt-0.5 font-medium tnum">{g.totals.payees_added}</dd></div>
            </dl>
          </Card>

          <Card title="Protected account status" description="Integrity of the real ledger since containment. Real balances are shown only in the comparison below.">
            <ul className="space-y-2 text-[0.9375rem]">
              <li className="flex items-center gap-2"><ShieldCheck size={16} className={ps.completed_transfers_by_session_since_entry === 0 ? 'text-[var(--allow)]' : 'text-[var(--block)]'} aria-hidden />
                <span><b className="tnum">{ps.completed_transfers_by_session_since_entry}</b> protected transfers by this session since {fmtTime(ps.entered_at)}</span></li>
              <li className="flex items-center gap-2"><ShieldCheck size={16} className={ps.payees_added_since_entry === 0 ? 'text-[var(--allow)]' : 'text-[var(--stepup)]'} aria-hidden />
                <span><b className="tnum">{ps.payees_added_since_entry}</b> protected payees added for this customer since containment</span></li>
              <li className="flex items-center gap-2"><ShieldCheck size={16} className={ps.balance_unchanged_since_entry ? 'text-[var(--allow)]' : 'text-[var(--stepup)]'} aria-hidden />
                <span>Protected balance {ps.balance_unchanged_since_entry == null ? 'not recorded at entry' : ps.balance_unchanged_since_entry ? 'unchanged since containment' : 'has changed since containment (other sessions)'}</span></li>
            </ul>
          </Card>

          <Card title={<span className="flex items-center gap-2">Simulated activity <Synthetic /></span>} description="Everything the contained session did, in order.">
            {g.events.length === 0 ? <p className="text-[var(--ink-3)]">No activity yet.</p> : (
              <Timeline items={[...g.events].reverse().map((e) => ({
                id: e.id, time: fmtTime(e.ts, true), title: EVENT[e.kind] ?? e.kind,
                marker: e.kind === 'transfer_simulated' || e.kind === 'beneficiary_added' ? <Badge tone="info">simulated</Badge> : e.kind === 'transfer_rejected' ? <Badge tone="stepup">refused</Badge> : undefined,
                body: [e.details.payee ?? e.details.name, e.details.amount_paise != null ? formatPaise(Number(e.details.amount_paise)) : null, e.details.reason ? String(e.details.reason).replace('_', ' ') : null].filter(Boolean).join(' · ') || undefined,
              }))} />
            )}
          </Card>
        </div>

        <div className="space-y-4 min-w-0">
          {inc && inc.open && live && (
            <Card title="Decision" description="Every action needs a reason and is audited. A ghost session is never restored in place.">
              <div className="grid gap-2">
                <ActionRow icon={<UserCheck size={16} />} label="Resolve and authorise recovery" sub="Ends the ghost session; customer signs in afresh to protected banking" onClick={() => setAction('clear_user')} />
                <ActionRow icon={<Smartphone size={16} />} label={inc.status === 'verification_requested' ? 'Verification pending…' : 'Request identity verification'} sub="Number match on the registered trusted device" disabled={inc.status === 'verification_requested'} onClick={() => setAction('request_verification')} />
                <ActionRow icon={<LockKeyhole size={16} />} label="Retain containment" sub="Keep monitoring the session in Ghost Banking" onClick={() => setAction('keep_restricted')} />
                <ActionRow icon={<Ban size={16} />} label="Revoke session" sub="Terminate the contained session now" danger onClick={() => setAction('revoke_session')} />
              </div>
              {inc.verification && <p className="mt-3 text-[0.8125rem] text-[var(--ink-3)]">Trusted-device check: <b className="text-[var(--ink)]">{inc.verification}</b></p>}
            </Card>
          )}
          {inc && !inc.open && <Banner tone={inc.status === 'user_cleared' ? 'allow' : 'info'} title={`${STATUS[inc.status].label} by ${inc.resolved_by ?? '—'}`}>{inc.resolution_reason}</Banner>}

          {a && (
            <Card title="Why the engine blocked" actions={<DecisionPill decision={a.decision} />}>
              <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-[0.875rem]">
                <dt className="text-[var(--ink-2)]">ML anomaly index {a.ml.index.toFixed(1)} × {a.ml_weight}</dt><dd className="tnum text-right">{(a.ml.index * a.ml_weight).toFixed(1)}</dd>
                {a.policy.map((p) => <PolicyLine key={p.rule} label={p.label} points={p.points} />)}
              </dl>
              {a.deviations.length > 0 && (
                <ul className="mt-3 pt-3 border-t border-[var(--hairline)] space-y-1.5 text-[0.875rem]">
                  {a.deviations.map((dv) => <li key={dv.feature}><span className="font-medium">{dv.label}:</span> {dv.observed} <span className="text-[var(--ink-3)]">(usual: {dv.baseline})</span></li>)}
                </ul>
              )}
            </Card>
          )}

          <Card title={<span className="flex items-center gap-2">Attempted payees and transfers <Synthetic /></span>} padded={false}>
            <div className="p-5 space-y-3 text-[0.875rem]">
              {sessionBens.length === 0 && sessionTxns.length === 0 ? <p className="text-[var(--ink-3)]">The session has not added payees or sent money yet.</p> : (
                <>
                  {sessionBens.map((b) => <p key={`b${b.id}`}>Payee <b>{b.name}</b> <span className="font-mono text-[0.8125rem]">{b.account_ref}</span> · added {fmtTime(b.created_at)}</p>)}
                  {sessionTxns.map((t) => <p key={`t${t.id}`}><b className="tnum">{formatPaise(t.amount_paise)}</b> to {t.counterparty} · {fmtTime(t.created_at)} · <span className="text-[var(--info)]">simulated, never executed</span></p>)}
                </>
              )}
            </div>
          </Card>
        </div>
      </div>

      <div className="mt-4">
        <Card title="Synthetic vs protected comparison" description="Shows real balances side by side with the synthetic ones. Admin only; each view is recorded in the audit log."
          actions={<Button variant="secondary" size="sm" onClick={() => setCompare((c) => !c)}>{compare ? <><EyeOff size={14} aria-hidden />Hide comparison</> : <><Eye size={14} aria-hidden />Show comparison</>}</Button>}>
          <AnimatePresence initial={false} mode="wait">
            {!compare ? (
              <motion.p key="off" className="text-[var(--ink-3)]" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>Hidden. The synthetic account above is never derived from the real one.</motion.p>
            ) : cmp.isPending ? <Skeleton key="ld" lines={4} /> : cmp.error ? <ErrorState key="err" error={cmp.error} /> : cmp.data?.comparison ? (
              <motion.div key="on" className="grid gap-4 lg:grid-cols-2" initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.28 }}>
                <Ledger label={cmp.data.comparison.protected.label} tone="allow" account={cmp.data.comparison.protected.account_ref} balance={cmp.data.comparison.protected.balance_paise}
                  sub={cmp.data.comparison.protected.balance_at_entry_paise != null ? `At containment: ${formatPaise(cmp.data.comparison.protected.balance_at_entry_paise)}` : ''} txns={cmp.data.comparison.protected.transactions} />
                <Ledger label={cmp.data.comparison.ghost.label} tone="info" account={cmp.data.comparison.ghost.account_ref} balance={cmp.data.comparison.ghost.balance_paise}
                  sub={`Synthetic opening balance: ${formatPaise(cmp.data.comparison.ghost.opening_balance_paise)}`} txns={cmp.data.comparison.ghost.transactions} />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </Card>
      </div>

      <AnimatePresence>{action && inc && <ConfirmAction key={action} incident={inc} action={action} onClose={() => setAction(null)} />}</AnimatePresence>
    </>
  );
}

function PolicyLine({ label, points }: { label: string; points: number }) {
  return <><dt className="text-[var(--ink-2)]">{label}</dt><dd className="tnum text-right">{points > 0 ? '+' : ''}{points}</dd></>;
}

function ActionRow({ icon, label, sub, onClick, disabled, danger }: { icon: React.ReactNode; label: string; sub: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`group flex items-start gap-3 rounded-[var(--radius-m)] border p-3.5 text-left transition-[border-color,background-color,box-shadow] duration-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-55 ${danger ? 'border-[color:var(--block-line)] hover:bg-[var(--block-tint)]' : 'border-[color:var(--hairline)] hover:border-[color:var(--hairline-strong)] hover:shadow-[0_6px_20px_-12px_rgba(16,24,40,0.35)]'}`}>
      <span className={`mt-0.5 ${danger ? 'text-[var(--block)]' : 'text-[var(--ink-2)] group-hover:text-[var(--ink)]'}`} aria-hidden>{icon}</span>
      <span className="min-w-0"><span className={`block font-medium ${danger ? 'text-[var(--block)]' : ''}`}>{label}</span><span className="block text-[0.8125rem] text-[var(--ink-3)] mt-0.5">{sub}</span></span>
    </button>
  );
}
