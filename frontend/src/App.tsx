import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthLayout, ConsoleLayout, PortalLayout } from './layout/layouts';
import { ApprovePage, LoginPage, TotpPage } from './features/bank/auth';
import { BeneficiariesPage, OverviewPage, TransactionsPage, TransferPage } from './features/bank/pages';
import { DevicePage } from './features/device/DevicePage';
import { SocOverview } from './features/soc/SocOverview';
import { SessionPage } from './features/soc/SessionPage';
import { BaselineIndex, BaselinePage } from './features/soc/BaselinePage';
import { EvaluationPage } from './features/soc/EvaluationPage';
import { GhostPage } from './features/soc/GhostPage';
import { LabPage } from './features/lab/LabPage';

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
        <Route path="/soc" element={<SocOverview />} />
        <Route path="/soc/sessions/:id" element={<SessionPage />} />
        <Route path="/soc/users" element={<BaselineIndex />} />
        <Route path="/soc/users/:id/baseline" element={<BaselinePage />} />
        <Route path="/soc/evaluation" element={<EvaluationPage />} />
        <Route path="/soc/ghost/:sessionId" element={<GhostPage />} />
        <Route path="/lab" element={<LabPage />} />
      </Route>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
