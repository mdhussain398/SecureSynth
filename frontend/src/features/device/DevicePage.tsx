import { useState, type FormEvent } from 'react';
import { KeyRound, Smartphone, Unlink } from 'lucide-react';
import type { DeviceChallenge } from '../../api/types';
import { getDeviceKey, setDeviceKey, USE_MOCKS } from '../../api/client';
import { useDevicePending, useDeviceRespond } from '../../api/queries';
import { Banner, Button, ErrorState, Skeleton, SyntheticMarker, fmtTime } from '../../design/components';

const OP_LABEL: Record<DeviceChallenge['operation'], string> = { login: 'Sign-in request', beneficiary_add: 'New payee request', transfer: 'Transfer request' };

function ChallengeCard({ c }: { c: DeviceChallenge }) {
  const respond = useDeviceRespond();
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <article className="border border-[var(--hairline)] rounded-[var(--radius-m)] bg-[var(--surface)] p-4">
      <p className="text-[0.8125rem] text-[var(--ink-3)]">{OP_LABEL[c.operation]} · {fmtTime(c.created_at)}</p>
      <p className="font-medium mt-1 leading-snug">{c.context_summary}</p>
      <fieldset className="mt-4">
        <legend className="text-[0.875rem] text-[var(--ink-2)]">Pick the number shown on the banking screen</legend>
        <div className="grid grid-cols-3 gap-2 mt-2" role="radiogroup">
          {c.options.map((n) => (
            <button key={n} type="button" role="radio" aria-checked={picked === n} onClick={() => setPicked(n)}
              className={`serif tnum h-16 text-[1.75rem] font-semibold rounded-[var(--radius-m)] border cursor-pointer ${picked === n ? 'border-[var(--accent)] bg-[var(--accent-tint)] ring-2 ring-[var(--accent)]' : 'border-[var(--hairline-strong)] bg-[var(--surface)] hover:bg-[var(--surface-2)]'}`}>
              {n}
            </button>
          ))}
        </div>
      </fieldset>
      {respond.error && <div className="mt-3"><Banner tone="block" title="Could not send response">{respond.error.message}</Banner></div>}
      {respond.data && <div className="mt-3"><Banner tone={respond.data.status === 'approved' ? 'allow' : 'block'} title={respond.data.status === 'approved' ? 'Approved' : 'Declined'} /></div>}
      <div className="grid grid-cols-2 gap-2 mt-4">
        <Button variant="secondary" loading={respond.isPending} onClick={() => respond.mutate({ challenge_id: c.id, selected_number: picked ?? c.options[0], approve: false })}>Deny</Button>
        <Button disabled={picked == null} loading={respond.isPending} onClick={() => picked != null && respond.mutate({ challenge_id: c.id, selected_number: picked, approve: true })}>Approve</Button>
      </div>
      <p className="text-[0.75rem] text-[var(--ink-3)] mt-3">Expires {fmtTime(c.expires_at)}. Deny anything you did not start.</p>
    </article>
  );
}

/** Trusted Device simulator: a separate phone-sized panel authenticated only by X-Device-Key. */
export function DevicePage() {
  const [key, setKey] = useState<string | null>(() => getDeviceKey());
  const [draft, setDraft] = useState('');
  const pending = useDevicePending(Boolean(key));
  const pair = (e: FormEvent) => { e.preventDefault(); const k = draft.trim(); if (k) { setDeviceKey(k); setKey(k); setDraft(''); } };
  const unpair = () => { setDeviceKey(null); setKey(null); };

  return (
    <div className="min-h-screen bg-[#d9dcd6] flex flex-col items-center px-4 py-8">
      <p className="text-[0.875rem] text-[#3d4541] mb-3 flex items-center gap-2"><Smartphone size={15} aria-hidden />Trusted device (simulated)</p>
      <div className="w-full max-w-[380px] rounded-[34px] bg-[#1d2320] p-2.5 shadow-[0_20px_40px_-20px_rgba(20,30,25,.45)]">
        <div className="rounded-[26px] bg-[var(--canvas)] min-h-[640px] overflow-hidden flex flex-col">
          <header className="px-5 pt-6 pb-4 border-b border-[var(--hairline)] bg-[var(--surface)]">
            <h1 className="serif text-[1.5rem] font-semibold">Approvals</h1>
            <p className="text-[0.8125rem] text-[var(--ink-3)] mt-0.5">{key ? 'Paired · checks every 2 seconds' : 'Not paired'}</p>
          </header>
          <div className="flex-1 p-4 space-y-3">
            {!key ? (
              <form onSubmit={pair} className="space-y-4 pt-2">
                <p className="text-[var(--ink-2)] text-[0.9375rem]">Paste the device key issued at enrolment. It is stored only in this browser and sent as a header, never as a cookie.</p>
                <div>
                  <label className="field-label" htmlFor="dk">Device key</label>
                  <input id="dk" className="input font-mono text-[0.875rem]" autoComplete="off" spellCheck={false} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={USE_MOCKS ? 'any value works in mock mode' : ''} />
                </div>
                <Button type="submit" className="w-full" disabled={!draft.trim()}><KeyRound size={15} aria-hidden />Pair device</Button>
              </form>
            ) : pending.isPending ? <Skeleton lines={4} /> : pending.error ? (
              <ErrorState error={pending.error} title={pending.error.code === 'DEVICE_UNAUTHENTICATED' ? 'Device key not recognised' : 'Could not check for requests'} onRetry={() => pending.refetch()} />
            ) : pending.data.length === 0 ? (
              <div className="text-center py-16 px-4"><p className="font-medium">No requests waiting</p><p className="text-[0.875rem] text-[var(--ink-3)] mt-1">When a sign-in or payment needs your approval, it appears here.</p></div>
            ) : pending.data.map((c) => <ChallengeCard key={c.id} c={c} />)}
          </div>
          <footer className="px-4 py-3 min-h-[52px] border-t border-[var(--hairline)] flex justify-between items-center"><SyntheticMarker />{key && <Button variant="ghost" size="sm" onClick={unpair}><Unlink size={14} aria-hidden />Unpair</Button>}</footer>
        </div>
      </div>
    </div>
  );
}
