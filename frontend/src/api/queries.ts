import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { api, ApiError } from './client';
import type {
  AddBeneficiaryRequest, AdminSessionRow, AppConfig, BaselineView, Beneficiary, ChallengeStatusResponse,
  ClockResponse, CounterfactualRequest, CounterfactualResponse, Decision, DeviceChallenge,
  DeviceRespondRequest, DeviceRespondResponse, EvaluationReport, GhostCompare, LoginRequest, LoginResponse,
  OverviewResponse, ResetResponse, Scenario, ScenarioRun, SensitiveActionResponse, SessionDetail,
  SessionInfo, TotpRequest, TotpResponse, Transaction, TransferRequest, UserRow,
} from './types';

type Opts<T> = Omit<UseQueryOptions<T, ApiError>, 'queryKey' | 'queryFn'>;

export const qk = {
  me: ['me'] as const,
  overview: ['bank', 'overview'] as const,
  txns: (limit: number) => ['bank', 'txns', limit] as const,
  bens: ['bank', 'bens'] as const,
  challenge: (id: string) => ['challenge', id] as const,
  devicePending: ['device', 'pending'] as const,
  config: ['admin', 'config'] as const,
  sessions: (decision?: Decision | '') => ['admin', 'sessions', decision ?? ''] as const,
  session: (id: string) => ['admin', 'session', id] as const,
  users: ['admin', 'users'] as const,
  baseline: (id: string) => ['admin', 'baseline', id] as const,
  evaluation: ['admin', 'evaluation'] as const,
  ghost: (id: string) => ['admin', 'ghost', id] as const,
  scenarios: ['lab', 'scenarios'] as const,
  clock: ['lab', 'clock'] as const,
};

// ---------- auth ----------
export const useMe = (o?: Opts<SessionInfo>) =>
  useQuery({ queryKey: qk.me, queryFn: () => api.get<SessionInfo>('/auth/me'), retry: false, ...o });

export const useLogin = () =>
  useMutation<LoginResponse, ApiError, LoginRequest>({ mutationFn: (b) => api.post<LoginResponse>('/auth/login', b).then((r) => r.data) });

export const useTotp = () => {
  const qc = useQueryClient();
  return useMutation<TotpResponse, ApiError, TotpRequest>({
    mutationFn: (b) => api.post<TotpResponse>('/auth/totp', b).then((r) => r.data),
    onSuccess: (d) => { qc.setQueryData(qk.me, d.session); },
  });
};

export const useLogout = () => {
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, void>({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => { qc.clear(); },
  });
};

export const useChallengeStatus = (id: string | undefined, enabled = true) =>
  useQuery({
    queryKey: qk.challenge(id ?? ''),
    queryFn: () => api.get<ChallengeStatusResponse>(`/auth/challenge/${encodeURIComponent(id!)}`),
    enabled: Boolean(id) && enabled,
    refetchInterval: (q) => (q.state.data && q.state.data.status !== 'pending' ? false : 1500),
  });

// ---------- bank ----------
export const useOverview = () => useQuery({ queryKey: qk.overview, queryFn: () => api.get<OverviewResponse>('/bank/overview') });
export const useTransactions = (limit = 50) =>
  useQuery({ queryKey: qk.txns(limit), queryFn: () => api.get<Transaction[]>(`/bank/transactions?limit=${limit}`) });
export const useBeneficiaries = () => useQuery({ queryKey: qk.bens, queryFn: () => api.get<Beneficiary[]>('/bank/beneficiaries') });

export const useAddBeneficiary = () => {
  const qc = useQueryClient();
  return useMutation<{ status: number; data: SensitiveActionResponse }, ApiError, AddBeneficiaryRequest>({
    mutationFn: (b) => api.post<SensitiveActionResponse>('/bank/beneficiaries', b),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['bank'] }); qc.invalidateQueries({ queryKey: qk.me }); },
  });
};

export const useTransfer = () => {
  const qc = useQueryClient();
  return useMutation<{ status: number; data: SensitiveActionResponse }, ApiError, TransferRequest>({
    mutationFn: (b) => api.post<SensitiveActionResponse>('/bank/transfers', b),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['bank'] }); qc.invalidateQueries({ queryKey: qk.me }); },
  });
};

// ---------- trusted device (X-Device-Key, no cookies) ----------
export const useDevicePending = (enabled: boolean) =>
  useQuery({
    queryKey: qk.devicePending,
    queryFn: () => api.get<DeviceChallenge[]>('/device/pending', true),
    enabled, refetchInterval: 2000, retry: false,
  });

export const useDeviceRespond = () => {
  const qc = useQueryClient();
  return useMutation<DeviceRespondResponse, ApiError, DeviceRespondRequest>({
    mutationFn: (b) => api.post<DeviceRespondResponse>('/device/respond', b, true).then((r) => r.data),
    onSettled: () => { qc.invalidateQueries({ queryKey: qk.devicePending }); },
  });
};

// ---------- admin ----------
export const useConfig = () => useQuery({ queryKey: qk.config, queryFn: () => api.get<AppConfig>('/admin/config'), staleTime: 60_000 });
export const useSessions = (decision: Decision | '' = '') =>
  useQuery({
    queryKey: qk.sessions(decision),
    queryFn: () => api.get<AdminSessionRow[]>(`/admin/sessions?limit=100${decision ? `&decision=${decision}` : ''}`),
    refetchInterval: 3000,
  });
export const useSessionDetail = (id: string) =>
  useQuery({ queryKey: qk.session(id), queryFn: () => api.get<SessionDetail>(`/admin/sessions/${encodeURIComponent(id)}`), refetchInterval: 5000, enabled: !!id });

export const useRevoke = (id: string) => {
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, void>({
    mutationFn: () => api.post(`/admin/sessions/${encodeURIComponent(id)}/revoke`),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['admin'] }); },
  });
};

export const useCounterfactual = (assessmentId: number) =>
  useMutation<CounterfactualResponse, ApiError, CounterfactualRequest>({
    mutationFn: (b) => api.post<CounterfactualResponse>(`/admin/assessments/${assessmentId}/counterfactual`, b).then((r) => r.data),
  });

export const useUsers = () => useQuery({ queryKey: qk.users, queryFn: () => api.get<UserRow[]>('/admin/users') });
export const useBaseline = (id: string) =>
  useQuery({ queryKey: qk.baseline(id), queryFn: () => api.get<BaselineView>(`/admin/users/${encodeURIComponent(id)}/baseline`), enabled: !!id });
export const useRollback = (id: string) => {
  const qc = useQueryClient();
  return useMutation<BaselineView, ApiError, number>({
    mutationFn: (to_version) => api.post<BaselineView>(`/admin/users/${encodeURIComponent(id)}/baseline/rollback`, { to_version }).then((r) => r.data),
    onSuccess: (d) => { qc.setQueryData(qk.baseline(id), d); },
  });
};
export const useEvaluation = () =>
  useQuery({ queryKey: qk.evaluation, queryFn: () => api.get<EvaluationReport>('/admin/evaluation'), retry: false });
export const useGhost = (sessionId: string) =>
  useQuery({ queryKey: qk.ghost(sessionId), queryFn: () => api.get<GhostCompare>(`/admin/ghost/${encodeURIComponent(sessionId)}`), retry: false });

// ---------- lab ----------
export const useScenarios = () => useQuery({ queryKey: qk.scenarios, queryFn: () => api.get<Scenario[]>('/lab/scenarios'), retry: false });
export const useRunScenario = (id: string) => {
  const qc = useQueryClient();
  return useMutation<ScenarioRun, ApiError, Record<string, number | string>>({
    mutationFn: (params) => api.post<ScenarioRun>(`/lab/scenarios/${encodeURIComponent(id)}/run`, { params }).then((r) => r.data),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['admin'] }); },
  });
};
export const useClock = () => useQuery({ queryKey: qk.clock, queryFn: () => api.get<ClockResponse>('/lab/clock'), retry: false });
export const useAdvanceClock = () => {
  const qc = useQueryClient();
  return useMutation<ClockResponse, ApiError, number>({
    mutationFn: (advance_hours) => api.post<ClockResponse>('/lab/clock', { advance_hours }).then((r) => r.data),
    onSuccess: (d) => { qc.setQueryData(qk.clock, d); },
  });
};
export const useReset = () => {
  const qc = useQueryClient();
  return useMutation<ResetResponse, ApiError, void>({
    mutationFn: () => api.post<ResetResponse>('/lab/reset').then((r) => r.data),
    onSuccess: (d) => { qc.invalidateQueries(); qc.setQueryData(qk.clock, { now: d.now }); },
  });
};

declare module '@tanstack/react-query' {
  interface Register { defaultError: ApiError }
}
