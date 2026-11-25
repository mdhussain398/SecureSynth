import { useCallback, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { ChallengeRef, ChallengeStatus, Role } from '../../api/types';
import { useLogin, useTotp, qk } from '../../api/queries';
import { USE_MOCKS } from '../../api/client';
import { Banner, Button } from '../../design/components';
import { ApprovalWaiting } from './ApprovalWaiting';

const home = (role: Role) => (role === 'admin' ? '/soc' : '/bank');

function AuthCard({ title, lede, children }: { title: string; lede?: string; children: React.ReactNode }) {
  return (
    <section className="rn-glass w-full max-w-[440px] rounded-[var(--radius-l)] p-7 sm:p-10">
      <h1 className="rn-display text-[clamp(2.5rem,6vw,3.25rem)]">{title}</h1>
      {lede && <p className="text-[color:var(--ink-2)] mt-3">{lede}</p>}
      <div className="mt-7">{children}</div>
    </section>
  );
}

export function LoginPage() {
  const nav = useNavigate();
  const login = useLogin();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ username: username.trim(), password }, { onSuccess: () => nav('/login/verify', { state: { username: username.trim() } }) });
  };
  return (
    <AuthCard title="Sign in" lede="Use your customer ID and password. You will confirm with your authenticator app next.">
      <form onSubmit={submit} className="space-y-5" noValidate>
        {login.error && <Banner tone="block" title="Could not sign in">{login.error.message}</Banner>}
        <div>
          <label className="field-label" htmlFor="username">Customer ID</label>
          <input id="username" className="input" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="password">Password</label>
          <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Button type="submit" size="lg" className="w-full" loading={login.isPending} disabled={!username || !password}>
          {login.isPending ? 'Signing in…' : 'Continue'}
        </Button>
        {USE_MOCKS && (
          <p className="text-[0.8125rem] text-[var(--ink-3)]">Mock mode: users <b>asha</b> (allowed), <b>vikram</b> (step-up), <b>imran</b> (blocked), <b>admin</b>; password <b>demo</b>; any 6-digit code.</p>
        )}
      </form>
    </AuthCard>
  );
}

export function TotpPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const totp = useTotp();
  const [code, setCode] = useState('');
  const username = (loc.state as { username?: string } | null)?.username;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    totp.mutate({ code }, {
      onSuccess: (d) => {
        if (d.decision === 'STEP_UP' && d.challenge) {
          try { sessionStorage.setItem('ss_pending_challenge', JSON.stringify({ challenge: d.challenge, message: d.customer_message, role: d.session.role })); } catch { /* ignore */ }
          nav('/login/approve', { state: { challenge: d.challenge, message: d.customer_message, role: d.session.role } });
        } else {
          qc.invalidateQueries({ queryKey: qk.me });
          nav(home(d.session.role), { replace: true });
        }
      },
      onError: () => setCode(''),
    });
  };
  return (
    <AuthCard title="Enter your code" lede={`Open your authenticator app and enter the 6-digit code${username ? ` for ${username}` : ''}.`}>
      <form onSubmit={submit} className="space-y-5" noValidate>
        {totp.error && <Banner tone="block" title="Code not accepted">{totp.error.message}</Banner>}
        <div>
          <label className="field-label" htmlFor="totp">6-digit code</label>
          <input
            id="totp" className="input tnum text-center text-[1.75rem] tracking-[0.4em] font-medium" inputMode="numeric" autoComplete="one-time-code"
            pattern="\d{6}" maxLength={6} required autoFocus value={code}
            aria-invalid={totp.isError || undefined}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        </div>
        <Button type="submit" size="lg" className="w-full" loading={totp.isPending} disabled={code.length !== 6}>
          {totp.isPending ? 'Verifying…' : 'Verify and sign in'}
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={() => nav('/login')}>Use a different account</Button>
      </form>
    </AuthCard>
  );
}

export function ApprovePage() {
  const nav = useNavigate();
  const loc = useLocation();
  const qc = useQueryClient();
  const [failed, setFailed] = useState<ChallengeStatus | null>(null);
  let st = loc.state as { challenge: ChallengeRef; message?: string; role: Role } | null;
  if (!st) { try { st = JSON.parse(sessionStorage.getItem('ss_pending_challenge') ?? 'null'); } catch { st = null; } }
  const role = st?.role ?? 'customer';
  const onDone = useCallback((s: ChallengeStatus) => {
    try { sessionStorage.removeItem('ss_pending_challenge'); } catch { /* ignore */ }
    if (s === 'approved' || s === 'consumed') {
      qc.invalidateQueries({ queryKey: qk.me });
      nav(home(role), { replace: true });
    } else setFailed(s);
  }, [nav, qc, role]);

  if (!st) {
    return <AuthCard title="No pending request" lede="There is nothing waiting for approval."><Button onClick={() => nav('/login')}>Back to sign in</Button></AuthCard>;
  }
  if (failed) {
    return (
      <AuthCard title={failed === 'expired' ? 'Request expired' : 'Sign-in not approved'}
        lede={failed === 'expired' ? 'The approval request timed out. Sign in again to get a new one.' : 'The request was declined on your registered device, so this sign-in was stopped.'}>
        <Button onClick={() => nav('/login', { replace: true })}>Back to sign in</Button>
      </AuthCard>
    );
  }
  return <ApprovalWaiting challenge={st.challenge} message={st.message} onDone={onDone} />;
}
