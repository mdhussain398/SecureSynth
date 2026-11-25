import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LogOut, Moon, Shield, Sun, Smartphone } from 'lucide-react';
import { useLogout, useMe } from '../api/queries';
import { ApiError, USE_MOCKS } from '../api/client';
import { Button, ErrorState, Skeleton, SyntheticMarker } from '../design/components';
import { RestrictedNotice } from '../features/bank/RestrictedNotice';

function Brand({ sub }: { sub: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid place-items-center h-8 w-8 rounded-[7px] bg-[var(--accent)] text-[var(--accent-ink)]"><Shield size={17} aria-hidden /></span>
      <span className="leading-tight">
        <span className="block font-semibold tracking-tight">SecureSynth</span>
        <span className="block text-[0.75rem] text-[var(--ink-3)]">{sub}</span>
      </span>
    </span>
  );
}

function Footer({ children }: { children?: ReactNode }) {
  return (
    <footer className="mt-auto border-t border-[var(--hairline)] px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-2 text-[0.75rem] text-[var(--ink-3)]">
      <SyntheticMarker />
      <span>{children ?? 'Prototype for AVISHKAR’26 · not a real bank'}{USE_MOCKS && ' · mock API'}</span>
    </footer>
  );
}

/** Minimal shell for /login screens. */
export function AuthLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-4 sm:px-6 py-4"><Brand sub="Simulated retail banking" /></header>
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
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-[var(--hairline)] bg-[var(--surface)]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link to="/bank" className="no-underline text-inherit"><Brand sub="Simulated retail banking" /></Link>
          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-[0.875rem] text-[var(--ink-2)]">{me.data.display_name}</span>
            <Button variant="ghost" size="sm" onClick={signOut}><LogOut size={15} aria-hidden />Sign out</Button>
          </div>
        </div>
        {!restricted && (
          <nav aria-label="Banking" className="max-w-5xl mx-auto px-2 sm:px-4 flex gap-1 overflow-x-auto">
            {portalNav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}
                className={({ isActive }) => `px-3 py-2.5 text-[0.9375rem] whitespace-nowrap border-b-2 no-underline ${isActive ? 'border-[var(--accent)] text-[var(--ink)] font-medium' : 'border-transparent text-[var(--ink-2)] hover:text-[var(--ink)]'}`}>
                {n.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {restricted ? <RestrictedNotice name={me.data.display_name} onSignOut={signOut} /> : <Outlet />}
      </main>
      <Footer />
    </div>
  );
}

function useConsoleTheme(): [string, () => void] {
  const [theme, setTheme] = useState<string>(() => { try { return localStorage.getItem('ss_theme') ?? 'auto'; } catch { return 'auto'; } });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') delete root.dataset.theme; else root.dataset.theme = theme;
    try { localStorage.setItem('ss_theme', theme); } catch { /* ignore */ }
    return () => { delete root.dataset.theme; };
  }, [theme]);
  const isDark = theme === 'dark' || (theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  return [isDark ? 'dark' : 'light', () => setTheme(isDark ? 'light' : 'dark')];
}

const consoleNav = [
  { to: '/soc', label: 'Sessions', end: true },
  { to: '/soc/users', label: 'Baselines', match: '/soc/users' },
  { to: '/soc/evaluation', label: 'Evaluation' },
  { to: '/lab', label: 'Scenario Lab' },
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
      <header className="sticky top-0 z-20 border-b border-[var(--hairline)] bg-[var(--surface)]">
        <div className="px-4 lg:px-6 py-2 flex flex-wrap items-center gap-x-6 gap-y-1">
          <Link to="/soc" className="no-underline text-inherit shrink-0"><Brand sub="Security Command Centre" /></Link>
          <nav aria-label="Command Centre" className="order-last w-full md:order-none md:w-auto md:flex-1 flex gap-0.5 overflow-x-auto min-w-0 -mx-1 md:mx-0">
            {consoleNav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}
                className={({ isActive }) => {
                  const active = isActive || (n.match && loc.pathname.startsWith(n.match));
                  return `px-2.5 py-1.5 rounded-[var(--radius-s)] whitespace-nowrap no-underline ${active ? 'bg-[var(--accent-tint)] text-[var(--ink)] font-medium' : 'text-[var(--ink-2)] hover:text-[var(--ink)] hover:bg-[var(--surface-2)]'}`;
                }}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-1 shrink-0 ml-auto">
            <Link to="/device" target="_blank" className="hidden md:inline-flex items-center gap-1.5 px-2 py-1.5 text-[var(--ink-2)] hover:text-[var(--ink)] no-underline" title="Open trusted device simulator in a new tab">
              <Smartphone size={15} aria-hidden />Device
            </Link>
            <Button variant="ghost" size="sm" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
              {theme === 'dark' ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
            </Button>
            {me.data && <Button variant="ghost" size="sm" onClick={signOut} aria-label="Sign out"><LogOut size={15} aria-hidden /></Button>}
          </div>
        </div>
      </header>
      <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 lg:px-6 py-5">{body}</main>
      <Footer>Analyst view · scores are a 0–100 risk index, not a probability</Footer>
    </div>
  );
}

export function PageTitle({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h1 className="text-[1.25rem] font-semibold tracking-tight">{title}</h1>
        {sub && <p className="text-[var(--ink-3)] mt-0.5">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
