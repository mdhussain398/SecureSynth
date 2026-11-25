import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthLayout, ConsoleLayout, PortalLayout } from './layout/layouts';
import { ApprovePage, LoginPage, TotpPage } from './features/bank/auth';
import { BeneficiariesPage, OverviewPage, TransactionsPage, TransferPage } from './features/bank/pages';
import { DevicePage } from './features/device/DevicePage';
import { Skeleton } from './design/components';

// Analyst and Lab screens are code-split: customers never download the console bundle.
const SocOverview = lazy(() => import('./features/soc/SocOverview').then((m) => ({ default: m.SocOverview })));
const SessionPage = lazy(() => import('./features/soc/SessionPage').then((m) => ({ default: m.SessionPage })));
const BaselineIndex = lazy(() => import('./features/soc/BaselinePage').then((m) => ({ default: m.BaselineIndex })));
const BaselinePage = lazy(() => import('./features/soc/BaselinePage').then((m) => ({ default: m.BaselinePage })));
const EvaluationPage = lazy(() => import('./features/soc/EvaluationPage').then((m) => ({ default: m.EvaluationPage })));
const GhostPage = lazy(() => import('./features/soc/GhostPage').then((m) => ({ default: m.GhostPage })));
// Renaissance full-screen views: code-split so three.js loads only where the orb is shown.
const Landing = lazy(() => import('./renaissance/Landing').then((m) => ({ default: m.Landing })));
const Intelligence = lazy(() => import('./renaissance/Intelligence').then((m) => ({ default: m.Intelligence })));
const JudgeMode = lazy(() => import('./renaissance/JudgeMode').then((m) => ({ default: m.JudgeMode })));
const LabPage = lazy(() => import('./features/lab/LabPage').then((m) => ({ default: m.LabPage })));

const fallback = <div className="space-y-3" aria-busy="true" aria-label="Loading"><Skeleton className="h-7 w-64" /><Skeleton className="h-48" /></div>;
const L = (el: ReactNode) => <Suspense fallback={fallback}>{el}</Suspense>;

/** Route guards here are UX only; the backend enforces every permission. */
export default function App() {
  return (
    <Routes>
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/login/verify" element={<TotpPage />} />
        <Route path="/login/approve" element={<ApprovePage />} />
      </Route>
      <Route path="/bank" element={<PortalLayout />}>
        <Route index element={<OverviewPage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="beneficiaries" element={<BeneficiariesPage />} />
        <Route path="transfer" element={<TransferPage />} />
      </Route>
      <Route path="/device" element={<DevicePage />} />
      <Route element={<ConsoleLayout />}>
        <Route path="/soc" element={L(<SocOverview />)} />
        <Route path="/soc/sessions/:id" element={L(<SessionPage />)} />
        <Route path="/soc/users" element={L(<BaselineIndex />)} />
        <Route path="/soc/users/:id/baseline" element={L(<BaselinePage />)} />
        <Route path="/soc/evaluation" element={L(<EvaluationPage />)} />
        <Route path="/soc/ghost/:sessionId" element={L(<GhostPage />)} />
        <Route path="/lab" element={L(<LabPage />)} />
      </Route>
      <Route path="/judge" element={<Suspense fallback={null}><JudgeMode /></Suspense>} />
      <Route path="/soc/intelligence" element={<Suspense fallback={null}><Intelligence /></Suspense>} />
      <Route path="/" element={<Suspense fallback={null}><Landing /></Suspense>} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
