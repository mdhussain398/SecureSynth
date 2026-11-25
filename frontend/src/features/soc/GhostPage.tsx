import { Link, useParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import type { AccountSummary, Transaction } from '../../api/types';
import { useGhost } from '../../api/queries';
import { Badge, Card, DataTable, EmptyState, ErrorState, Money, Skeleton, fmtTime } from '../../design/components';
import { PageTitle } from '../../layout/layouts';

function Ledger({ title, account, txns, label }: { title: string; account: AccountSummary; txns: Transaction[]; label?: string }) {
  return (
    <Card padded={false} title={<span className="flex items-center gap-2">{title}{label && <Badge tone="stepup">{label}</Badge>}</span>} description={account.account_ref}>
      <div className="px-4 py-3 border-b border-[var(--hairline)]"><div className="text-[0.8125rem] text-[var(--ink-3)]">Balance</div><Money paise={account.balance_paise} className="text-[1.5rem] font-semibold" /></div>
      {txns.length === 0 ? <EmptyState title="No transactions" /> : (
        <DataTable caption={title} rows={txns} rowKey={(t) => t.id} columns={[
          { key: 't', header: 'Time', cell: (t) => fmtTime(t.created_at) },
          { key: 'c', header: 'Counterparty', cell: (t) => t.counterparty },
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
  const back = <Link to={`/soc/sessions/${encodeURIComponent(sessionId)}`} className="text-[var(--accent)]">Back to session</Link>;
  return (
    <>
      <PageTitle title="Ghost Banking compare" sub={`Protected ledger vs the contained simulation for session ${sessionId}`} actions={back} />
      {q.isPending ? <Skeleton lines={8} /> : q.error ? (
        q.error.code === 'FEATURE_DISABLED' ? (
          <Card><div className="flex flex-col items-center text-center py-10 gap-2"><Lock size={22} className="text-[var(--ink-3)]" aria-hidden /><p className="font-medium">Feature disabled pending mentor approval</p>
            <p className="text-[var(--ink-3)] max-w-[56ch]">Ghost Banking is off by default. Blocked sessions are moved to restricted mode instead: read-only, no payments, no payee changes.</p></div></Card>
        ) : <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Ledger title="Protected account" account={q.data.protected.account} txns={q.data.protected.transactions} />
          <Ledger title="Contained session" account={q.data.ghost.account} txns={q.data.ghost.transactions} label={q.data.ghost.label} />
        </div>
      )}
    </>
  );
}
