import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, Plus } from 'lucide-react';
import type { ChallengeRef, ChallengeStatus, Transaction, TxnStatus } from '../../api/types';
import { useAddBeneficiary, useBeneficiaries, useMe, useOverview, useTransactions, useTransfer } from '../../api/queries';
import { Badge, Banner, Button, ButtonLink, EmptyState, ErrorState, Money, Skeleton, fmtTime } from '../../design/components';
import { ApprovalWaiting } from './ApprovalWaiting';

const STATUS: Record<TxnStatus, { label: string; tone: 'neutral' | 'allow' | 'stepup' | 'block' }> = {
  completed: { label: 'Completed', tone: 'neutral' },
  pending_verification: { label: 'Awaiting approval', tone: 'stepup' },
  restricted: { label: 'Stopped for protection', tone: 'block' },
  attempted: { label: 'Not completed', tone: 'neutral' },
};

function TxnList({ txns }: { txns: Transaction[] }) {
  if (txns.length === 0) return <EmptyState title="No transactions yet">Payments you send and receive will appear here.</EmptyState>;
  return (
    <ul className="divide-y divide-[var(--hairline)]">
      {txns.map((t) => (
        <li key={t.id} className="flex items-center gap-3 sm:gap-4 py-3.5">
          <span className={`grid place-items-center h-9 w-9 shrink-0 rounded-full ${t.direction === 'credit' ? 'bg-[var(--allow-tint)] text-[var(--allow)]' : 'bg-[var(--surface-2)] text-[var(--ink-2)]'}`} aria-hidden>
            {t.direction === 'credit' ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium truncate">{t.counterparty}</p>
            <p className="text-[0.8125rem] text-[var(--ink-3)] truncate">{t.description} · {fmtTime(t.created_at, true)}</p>
          </div>
          <div className="text-right shrink-0">
            <Money paise={t.amount_paise} signed direction={t.direction} className={t.direction === 'credit' ? 'text-[var(--allow)] font-medium' : 'font-medium'} />
            {t.status !== 'completed' && <div className="mt-0.5"><Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge></div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function OverviewPage() {
  const q = useOverview();
  const me = useMe();
  const first = me.data?.display_name.split(' ')[0];
  return (
    <div className="space-y-8">
      {me.data?.mode === 'step_up' && <Banner tone="stepup" title="Approval pending">Payments and payee changes are paused until you approve the request on your registered device.</Banner>}
      <section>
        <p className="text-[var(--ink-2)]">{first ? `Good to see you, ${first}` : 'Your account'}</p>
        {q.isPending ? <Skeleton className="h-14 w-64 mt-3" /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
          <>
            <p className="serif text-[2.75rem] sm:text-[3.5rem] font-semibold leading-none tracking-tight mt-3"><Money paise={q.data.account.balance_paise} /></p>
            <p className="text-[0.875rem] text-[var(--ink-3)] mt-2">Available balance · Savings {q.data.account.account_ref}</p>
          </>
        )}
        <div className="flex flex-wrap gap-3 mt-6">
          <ButtonLink to="/bank/transfer" size="lg">Send money</ButtonLink>
          <ButtonLink to="/bank/beneficiaries" size="lg" variant="secondary">Manage payees</ButtonLink>
        </div>
      </section>
      <section className="bg-[var(--surface)] border border-[var(--hairline)] rounded-[var(--radius-m)] px-4 sm:px-6 py-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[1.0625rem] font-semibold">Recent activity</h2>
          <Link to="/bank/transactions" className="text-[0.875rem] text-[var(--accent)]">All transactions</Link>
        </div>
        <div className="mt-1">{q.isPending ? <div className="py-4"><Skeleton lines={4} /></div> : q.data ? <TxnList txns={q.data.recent} /> : null}</div>
      </section>
    </div>
  );
}

export function TransactionsPage() {
  const q = useTransactions(50);
  return (
    <section>
      <h1 className="serif text-[1.875rem] font-semibold">Transactions</h1>
      <p className="text-[var(--ink-2)] mt-1">Your last 50 payments in and out.</p>
      <div className="bg-[var(--surface)] border border-[var(--hairline)] rounded-[var(--radius-m)] px-4 sm:px-6 py-2 mt-6">
        {q.isPending ? <div className="py-4"><Skeleton lines={6} /></div> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <TxnList txns={q.data} />}
      </div>
    </section>
  );
}

export function BeneficiariesPage() {
  const q = useBeneficiaries();
  const add = useAddBeneficiary();
  const [name, setName] = useState('');
  const [ref, setRef] = useState('');
  const [challenge, setChallenge] = useState<{ c: ChallengeRef; msg: string } | null>(null);
  const [notice, setNotice] = useState<{ tone: 'allow' | 'block' | 'stepup'; title: string; body?: string } | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    add.mutate({ name: name.trim(), account_ref: ref.trim().toUpperCase() }, {
      onSuccess: ({ data }) => {
        if (data.result === 'pending_verification' && data.challenge) setChallenge({ c: data.challenge, msg: data.customer_message });
        else setNotice({ tone: 'allow', title: 'Payee added', body: `${name.trim()} is ready to receive payments.` });
        setName(''); setRef('');
      },
      onError: (err) => {
        if (err.code === 'RISK_BLOCKED' || err.code === 'SESSION_RESTRICTED') setNotice({ tone: 'block', title: 'Payee not added', body: 'We paused this change to protect your account.' });
        else if (err.code === 'STEP_UP_REQUIRED') setNotice({ tone: 'stepup', title: 'Approval needed first', body: err.message });
      },
    });
  };
  const onDone = useCallback((s: ChallengeStatus) => {
    setChallenge(null);
    setNotice(s === 'approved' || s === 'consumed' ? { tone: 'allow', title: 'Payee added', body: 'Approved on your registered device.' } : { tone: 'block', title: 'Payee not added', body: 'The request was not approved on your registered device.' });
    q.refetch();
  }, [q]);

  if (challenge) return <ApprovalWaiting challenge={challenge.c} message={challenge.msg} onDone={onDone} />;
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <section>
        <h1 className="serif text-[1.875rem] font-semibold">Payees</h1>
        <p className="text-[var(--ink-2)] mt-1">People and accounts you can send money to.</p>
        <div className="bg-[var(--surface)] border border-[var(--hairline)] rounded-[var(--radius-m)] px-4 sm:px-6 py-2 mt-6">
          {q.isPending ? <div className="py-4"><Skeleton lines={3} /></div> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> :
            q.data.length === 0 ? <EmptyState title="No payees yet">Add a payee to start sending money.</EmptyState> : (
              <ul className="divide-y divide-[var(--hairline)]">
                {q.data.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 py-3.5">
                    <div className="min-w-0"><p className="font-medium truncate">{b.name}</p><p className="text-[0.8125rem] text-[var(--ink-3)] tnum">{b.account_ref} · added {fmtTime(b.created_at, true)}</p></div>
                    {b.trust === 'candidate' && <Badge>New</Badge>}
                    {b.trust === 'blocked' && <Badge tone="block">Not active</Badge>}
                  </li>
                ))}
              </ul>
            )}
        </div>
      </section>
      <section className="bg-[var(--surface)] border border-[var(--hairline)] rounded-[var(--radius-m)] p-5 sm:p-6 self-start">
        <h2 className="text-[1.0625rem] font-semibold flex items-center gap-2"><Plus size={17} aria-hidden />Add a payee</h2>
        <form onSubmit={submit} className="space-y-4 mt-4" noValidate>
          {notice && <Banner tone={notice.tone} title={notice.title}>{notice.body}</Banner>}
          {add.error && !['RISK_BLOCKED', 'SESSION_RESTRICTED', 'STEP_UP_REQUIRED'].includes(add.error.code) && <Banner tone="block" title="Check the details">{add.error.message}</Banner>}
          <div><label className="field-label" htmlFor="ben-name">Name</label><input id="ben-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} /></div>
          <div><label className="field-label" htmlFor="ben-ref">Account reference</label><input id="ben-ref" className="input tnum" placeholder="SYN-1234" value={ref} onChange={(e) => setRef(e.target.value)} required autoCapitalize="characters" /></div>
          <Button type="submit" className="w-full" loading={add.isPending} disabled={!name.trim() || !ref.trim()}>{add.isPending ? 'Adding…' : 'Add payee'}</Button>
        </form>
      </section>
    </div>
  );
}

type TransferOutcome = { kind: 'completed'; amount: number; to: string } | { kind: 'pending'; c: ChallengeRef; msg: string } | { kind: 'stopped' } | { kind: 'denied' };

export function TransferPage() {
  const bens = useBeneficiaries();
  const transfer = useTransfer();
  const nav = useNavigate();
  const [benId, setBenId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState<TransferOutcome | null>(null);
  // One idempotency key per intended transfer; regenerated after each completed attempt.
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const paise = useMemo(() => { const n = Number(amount); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0; }, [amount]);
  const payee = bens.data?.find((b) => String(b.id) === benId);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    transfer.mutate({ beneficiary_id: Number(benId), amount_paise: paise, note: note.trim() || undefined, idempotency_key: idemKey }, {
      onSuccess: ({ status, data }) => {
        setIdemKey(crypto.randomUUID());
        if (status === 202 && data.challenge) setOutcome({ kind: 'pending', c: data.challenge, msg: data.customer_message });
        else setOutcome({ kind: 'completed', amount: paise, to: payee?.name ?? 'your payee' });
      },
      onError: (err) => {
        if (err.code === 'RISK_BLOCKED' || err.code === 'SESSION_RESTRICTED') { setIdemKey(crypto.randomUUID()); setOutcome({ kind: 'stopped' }); }
      },
    });
  };
  const onDone = useCallback((s: ChallengeStatus) => {
    setOutcome(s === 'approved' || s === 'consumed' ? { kind: 'completed', amount: paise, to: payee?.name ?? 'your payee' } : { kind: 'denied' });
  }, [paise, payee]);
  const reset = () => { setOutcome(null); setAmount(''); setNote(''); transfer.reset(); };

  if (outcome?.kind === 'pending') return <ApprovalWaiting challenge={outcome.c} message={outcome.msg} onDone={onDone} />;
  if (outcome) {
    const content = {
      completed: { title: 'Money sent', body: <><Money paise={outcome.kind === 'completed' ? outcome.amount : 0} /> is on its way to {outcome.kind === 'completed' ? outcome.to : ''}.</> },
      stopped: { title: 'Transfer stopped for your protection', body: <>We paused this payment and further changes on this sign-in. Your balance has not changed. Sign in again from your usual device, or contact the fraud line (simulated) if this wasn't you.</> },
      denied: { title: 'Transfer not sent', body: <>The request was not approved on your registered device, so no money left your account.</> },
    }[outcome.kind];
    return (
      <section className="max-w-lg mx-auto bg-[var(--surface)] border border-[var(--hairline)] rounded-[var(--radius-l)] p-6 sm:p-10">
        <h1 className="serif text-[1.75rem] font-semibold leading-tight">{content.title}</h1>
        <p className="text-[var(--ink-2)] mt-3 text-[1.0625rem] leading-relaxed">{content.body}</p>
        <div className="flex flex-wrap gap-3 mt-8">
          {outcome.kind === 'stopped' ? <Button onClick={() => nav('/bank')}>Go to overview</Button> : <><Button onClick={reset}>Make another transfer</Button><Button variant="secondary" onClick={() => nav('/bank')}>Back to overview</Button></>}
        </div>
      </section>
    );
  }

  const fieldErr = transfer.error && !['RISK_BLOCKED', 'SESSION_RESTRICTED'].includes(transfer.error.code) ? transfer.error : null;
  return (
    <section className="max-w-lg">
      <h1 className="serif text-[1.875rem] font-semibold">Send money</h1>
      <p className="text-[var(--ink-2)] mt-1">Transfers to saved payees. Larger or unusual payments may ask you to approve on your registered device.</p>
      <form onSubmit={submit} className="space-y-5 mt-7 bg-[var(--surface)] border border-[var(--hairline)] rounded-[var(--radius-m)] p-5 sm:p-6" noValidate>
        {fieldErr && <Banner tone="block" title={fieldErr.code === 'INSUFFICIENT_FUNDS' ? 'Not enough balance' : fieldErr.code === 'STEP_UP_REQUIRED' ? 'Approval needed first' : 'Transfer not sent'}>{fieldErr.message}</Banner>}
        <div>
          <label className="field-label" htmlFor="payee">Payee</label>
          {bens.isPending ? <Skeleton className="h-11" /> : bens.error ? <ErrorState error={bens.error} onRetry={() => bens.refetch()} /> : bens.data.length === 0 ? (
            <p className="text-[var(--ink-2)]">You have no payees yet. <Link to="/bank/beneficiaries" className="text-[var(--accent)]">Add a payee</Link></p>
          ) : (
            <select id="payee" className="input" value={benId} onChange={(e) => setBenId(e.target.value)} required>
              <option value="">Choose a payee</option>
              {bens.data.filter((b) => b.trust !== 'blocked').map((b) => <option key={b.id} value={b.id}>{b.name} · {b.account_ref}</option>)}
            </select>
          )}
        </div>
        <div>
          <label className="field-label" htmlFor="amount">Amount (₹)</label>
          <input id="amount" className="input tnum text-[1.25rem]" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} required />
        </div>
        <div>
          <label className="field-label" htmlFor="note">Note (optional)</label>
          <input id="note" className="input" maxLength={60} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <Button type="submit" size="lg" className="w-full" loading={transfer.isPending} disabled={!benId || paise <= 0}>
          {transfer.isPending ? 'Sending…' : paise > 0 ? <>Send <Money paise={paise} /></> : 'Send'}
        </Button>
      </form>
    </section>
  );
}
