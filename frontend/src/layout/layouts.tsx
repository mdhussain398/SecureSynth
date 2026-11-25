import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LogOut, Moon, Sun, Smartphone } from 'lucide-react';
import { useLogout, useMe } from '../api/queries';
import { ApiError, USE_MOCKS } from '../api/client';
import { Button, ErrorState, Skeleton, SyntheticMarker } from '../design/components';
import { RestrictedNotice } from '../features/bank/RestrictedNotice';
import { Contours, GlassNav } from '../renaissance/primitives';

/** The SecureSynth mark: an identity ring with an electric core. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden>
      <circle cx="15" cy="15" r="13.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <ellipse cx="15" cy="15" rx="13.5" ry="5" fill="none" stroke="#C0C7D1" strokeWidth="1" transform="rotate(-24 15 15)" />
      <circle cx="15" cy="15" r="4.5" fill="#005BFF" />
    </svg>
  );
}
function Brand({ sub }: { sub: string }) {
  return (
    <span className="flex items-center gap-2.5 text-[color:var(--ink)]">
      <BrandMark />
      <span className="leading-tight">
        <span className="block font-semibold tracking-[-0.01em]">SecureSynth</span>
        <span className="block text-[0.8125rem] text-[color:var(--ink-3)]">{sub}</span>
      </span>
    </span>
  );
}

function Footer({ children }: { children?: ReactNode }) {
  return (
    <footer className="mt-auto px-5 sm:px-8 py-4 flex flex-wrap items-center justify-between gap-2 text-[0.8125rem] text-[color:var(--ink-3)]">
      <SyntheticMarker />
      <span>{children ?? 'Prototype for AVISHKAR’26. Not a real bank.'}{USE_MOCKS && ' Mock API.'}</span>
    </footer>
  );
}

/** Minimal shell for the sign-in screens: the behavioural topography behind a single focused panel. */
export function AuthLayout() {
  return (
    <div className="relative isolate min-h-screen flex flex-col overflow-x-clip">
      <Contours className="absolute inset-0 -z-10 h-full w-full opacity-40" seed={1.7} clearAt={[50, 50]} />
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-[45%] -z-10 h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'radial-gradient(closest-side, rgba(0,91,255,0.14), rgba(0,91,255,0.04) 60%, transparent)' }} />
      <header className="px-5 sm:px-8 py-5"><Link to="/" className="no-underline"><Brand sub="Simulated retail banking" /></Link></header>
      <main className="flex-1 flex items-start sm:items-center justify-center px-4 py-6"><Outlet /></main>
      <Footer />
    </div>
  );
}

function useSignOut() {
  const logout = useLogout();
  const navigate = useNavigate();
  return () => logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) });
}

const portalNav = [
  { to: '/bank', label: 'Overview', end: true },
  { to: '/bank/transactions', label: 'Transactions' },
  { to: '/bank/beneficiaries', label: 'Payees' },
  { to: '/bank/transfer', label: 'Transfer' },
];

export function PortalLayout() {
  const me = useMe();
  const signOut = useSignOut();
  const loc = useLocation();
  if (me.isPending) return <div className="max-w-3xl mx-auto p-8"><Skeleton lines={4} /></div>;
  if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
    return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  }
  if (me.data.role === 'admin') return <Navigate to="/soc" replace />;
  const restricted = me.data.mode === 'restricted' || me.data.mode === 'revoked';
  return (
    <div className="relative isolate min-h-screen flex flex-col overflow-x-clip">
      <header className="sticky top-0 z-30 px-4 sm:px-8 py-4">
        <div className="mx-auto max-w-6xl flex items-center justify-between gap-4">
          <Link to="/bank" className="no-underline"><Brand sub="Simulated retail banking" /></Link>
          {!restricted && <div className="hidden md:block"><GlassNav label="Banking" items={portalNav} /></div>}
          <div className="flex items-center gap-2">
            <span className="hidden lg:block text-[0.9375rem] text-[color:var(--ink-2)]">{me.data.display_name}</span>
            <Button variant="ghost" size="sm" onClick={signOut}><LogOut size={15} aria-hidden />Sign out</Button>
          </div>
        </div>
      </header>
      {!restricted && <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-3 md:hidden"><GlassNav label="Banking (mobile)" items={portalNav} /></div>}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-8 pt-4 pb-28 md:pb-12">
        {restricted ? <RestrictedNotice name={me.data.display_name} onSignOut={signOut} /> : <Outlet />}
      </main>
      <Footer />
    </div>
  );
}

function useConsoleTheme(): [string, () => void] {
  // Light is the house style; dark is an explicit choice (older 'auto' preferences fall back to light).
  const [theme, setTheme] = useState<string>(() => { try { return localStorage.getItem('ss_theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') delete root.dataset.theme; else root.dataset.theme = theme;
    try { localStorage.setItem('ss_theme', theme); } catch { /* ignore */ }
    return () => { delete root.dataset.theme; };
  }, [theme]);
  const isDark = theme === 'dark' || (theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  return [isDark ? 'dark' : 'light', () => setTheme(isDark ? 'light' : 'dark')];
}

export const consoleNav = [
  { to: '/soc/intelligence', label: 'Intelligence' },
  { to: '/soc', label: 'Sessions', end: true, match: '/soc/sessions' },
  { to: '/soc/users', label: 'Baselines' },
  { to: '/soc/evaluation', label: 'Evaluation' },
  { to: '/lab', label: 'Lab' },
  { to: '/judge', label: 'Judge mode' },
];

export function ConsoleLayout() {
  const me = useMe();
  const signOut = useSignOut();
  const [theme, toggle] = useConsoleTheme();
  const loc = useLocation();
  let body: ReactNode = <Outlet />;
  if (me.isPending) body = <div className="p-6"><Skeleton lines={6} /></div>;
  else if (me.error) {
    if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
    body = <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  } else if (me.data.role !== 'admin') {
    body = <ErrorState error={null} title="Analyst access required" />;
  }
  return (
    <div className="console flex flex-col">
      <header className="sticky top-0 z-30 px-4 lg:px-8 py-3.5">
        <div className="flex items-center gap-4">
          <Link to="/soc/intelligence" className="no-underline shrink-0"><Brand sub="Command Centre" /></Link>
          <div className="hidden lg:flex flex-1 justify-center min-w-0"><GlassNav label="Command Centre" items={consoleNav} /></div>
          <div className="flex items-center gap-1 shrink-0 ml-auto lg:ml-0">
            <Link to="/device" target="_blank" className="hidden md:inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[0.875rem] text-[color:var(--ink-2)] hover:text-[color:var(--ink)] hover:bg-[rgba(16,24,40,0.05)] no-underline" title="Open the trusted device simulator in a new tab">
              <Smartphone size={15} aria-hidden />Device
            </Link>
            <Button variant="ghost" size="sm" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
              {theme === 'dark' ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
            </Button>
            {me.data && <Button variant="ghost" size="sm" onClick={signOut} aria-label="Sign out"><LogOut size={15} aria-hidden /></Button>}
          </div>
        </div>
      </header>
      <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-3 lg:hidden"><GlassNav label="Command Centre (mobile)" items={consoleNav} /></div>
      <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 lg:px-8 pt-3 pb-28 lg:pb-8">{body}</main>
      <Footer>Analyst view. Scores are a 0–100 risk index, not a probability.</Footer>
    </div>
  );
}

export function PageTitle({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6 mt-2">
      <div className="min-w-0">
        <h1 className="rn-display text-[clamp(2.25rem,4.5vw,3.5rem)]">{title}</h1>
        {sub && <p className="text-[1rem] text-[color:var(--ink-2)] mt-3.5 max-w-[60ch]">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
