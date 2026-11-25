/**
 * In-browser mock backend (enabled by VITE_USE_MOCKS=true, i.e. `npm run dev:mock`).
 * Implements the frozen contract in ./types.ts with clearly synthetic data ("SYN-" refs).
 * State lives in localStorage so the /device tab and the banking tab can share challenges.
 *
 * Mock logins (password "demo", any 6-digit TOTP except 000000):
 *   asha   → ALLOW      vikram → STEP_UP (approve on /device)   imran → BLOCK (restricted)
 *   admin  → admin role (Command Centre + Lab)
 */
import type {
  AdminSessionRow, AppConfig, AuditEvent, BaselineView, Beneficiary, ChallengeRef, ChallengeStatus,
  ClockResponse, CounterfactualResponse, Decision, DeviceChallenge, ErrorCode, EvaluationReport,
  Operation, OverviewResponse, PolicyContribution, ResetResponse, RiskAssessment, Scenario,
  ScenarioRun, ScenarioStep, SensitiveActionResponse, SessionDetail, SessionInfo, SessionMode,
  Transaction, UserRow, ApproachResult, DetectionMetrics,
} from './types';

interface MockChallenge {
  id: string; operation: Operation; number_match: number; options: number[];
  status: ChallengeStatus; context_summary: string; created_at: string; expires_at: string;
  pending?: { kind: 'transfer'; txnId: number } | { kind: 'beneficiary'; benId: number };
}
interface MockState {
  now: string;
  preOtp: string | null;
  session: { id: string; username: string; mode: SessionMode; challengeId: string | null } | null;
  balance: number;
  txns: Transaction[];
  bens: Beneficiary[];
  challenges: MockChallenge[];
  baselineVersion: number;
  rolledBack: number[];
}

const KEY = 'ss_mock_state';
const START = '2026-11-25T09:30:00+05:30';
const USERS: Record<string, { display: string; role: 'customer' | 'admin'; city: string; recognised: boolean; login: Decision }> = {
  asha: { display: 'Asha R.', role: 'customer', city: 'Pune', recognised: true, login: 'ALLOW' },
  vikram: { display: 'Vikram S.', role: 'customer', city: 'Dubai', recognised: false, login: 'STEP_UP' },
  imran: { display: 'Imran K.', role: 'customer', city: 'Lagos', recognised: false, login: 'BLOCK' },
  admin: { display: 'SOC Analyst', role: 'admin', city: 'Pune', recognised: true, login: 'ALLOW' },
};

function iso(base: string, minutes: number): string {
  return new Date(new Date(base).getTime() + minutes * 60_000).toISOString();
}

function seed(): MockState {
  const txns: Transaction[] = [
    { id: 1008, created_at: iso(START, -60 * 20), amount_paise: 8_500_000, direction: 'credit', counterparty: 'SYN Payroll Pvt Ltd', status: 'completed', description: 'Salary November (synthetic)' },
    { id: 1007, created_at: iso(START, -60 * 30), amount_paise: 1_850_000, direction: 'debit', counterparty: 'SYN-4410 Meera Iyer', status: 'completed', description: 'Rent share' },
    { id: 1006, created_at: iso(START, -60 * 52), amount_paise: 64_900, direction: 'debit', counterparty: 'SYN Grocer', status: 'completed', description: 'Groceries' },
    { id: 1005, created_at: iso(START, -60 * 75), amount_paise: 250_000, direction: 'debit', counterparty: 'SYN-7720 Anil P.', status: 'completed', description: 'Dinner split' },
    { id: 1004, created_at: iso(START, -60 * 98), amount_paise: 1_299_00, direction: 'debit', counterparty: 'SYN Electricity Board', status: 'completed', description: 'Electricity bill' },
    { id: 1003, created_at: iso(START, -60 * 140), amount_paise: 500_000, direction: 'credit', counterparty: 'SYN-7720 Anil P.', status: 'completed', description: 'Refund' },
  ];
  return {
    now: START, preOtp: null, session: null, balance: 18_450_000, txns,
    bens: [
      { id: 7, name: 'Meera Iyer', account_ref: 'SYN-4410', created_at: iso(START, -60 * 24 * 200), trust: 'trusted' },
      { id: 8, name: 'Anil P.', account_ref: 'SYN-7720', created_at: iso(START, -60 * 24 * 120), trust: 'trusted' },
    ],
    challenges: [], baselineVersion: 4, rolledBack: [],
  };
}

function load(): MockState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as MockState;
  } catch { /* fall through */ }
  return seed();
}
let state = load();
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ } }

interface MockResponse { status: number; body: unknown }
function ok<T = unknown>(body: T, status = 200): MockResponse { return { status, body }; }
const err = (status: number, code: ErrorCode, message: string): MockResponse => ({
  status, body: { error: { code, message, request_id: `mock-${Math.random().toString(16).slice(2, 10)}` } },
});
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sessionInfo(): SessionInfo {
  const s = state.session!;
  const u = USERS[s.username];
  return {
    username: s.username, display_name: u.display, role: u.role, mode: s.mode,
    expires_at: iso(state.now, 30), simulated_context: { city: u.city, device_recognised: u.recognised },
  };
}

function newChallenge(operation: Operation, context: string, pending?: MockChallenge['pending']): ChallengeRef {
  const n = 10 + Math.floor(Math.random() * 89);
  const decoys = new Set<number>();
  while (decoys.size < 2) { const d = 10 + Math.floor(Math.random() * 89); if (d !== n) decoys.add(d); }
  const options = [n, ...decoys].sort(() => Math.random() - 0.5);
  const c: MockChallenge = {
    id: `c_${Math.random().toString(36).slice(2, 8)}`, operation, number_match: n, options, status: 'pending',
    context_summary: context, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 120_000).toISOString(), pending,
  };
  state.challenges.unshift(c);
  return { id: c.id, operation, number_match: n, expires_at: c.expires_at };
}

function expireChallenges() {
  for (const c of state.challenges) {
    if (c.status === 'pending' && new Date(c.expires_at).getTime() < Date.now()) c.status = 'expired';
  }
}

const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`;

// ---------- admin synthetic data ----------
const SESSION_SEEDS: Array<[string, string, string, boolean, Decision, number, SessionMode, boolean]> = [
  ['s_ato_relay', 'asha', 'Mumbai', false, 'BLOCK', 91.2, 'restricted', true],
  ['s_traveller', 'vikram', 'Dubai', false, 'STEP_UP', 54.0, 'normal', true],
  ['s_normal_01', 'asha', 'Pune', true, 'ALLOW', 12.4, 'normal', false],
  ['s_normal_02', 'nisha', 'Bengaluru', true, 'ALLOW', 8.9, 'normal', false],
  ['s_nightshift', 'farhan', 'Hyderabad', true, 'ALLOW', 27.5, 'normal', false],
  ['s_poison_07', 'meera', 'Pune', false, 'STEP_UP', 41.3, 'step_up', true],
  ['s_hijack', 'gopal', 'Chennai', true, 'BLOCK', 78.6, 'revoked', true],
  ['s_retiree', 'lakshmi', 'Kochi', true, 'ALLOW', 5.2, 'normal', false],
];
const USER_IDS: Record<string, number> = { asha: 1, vikram: 2, nisha: 3, farhan: 4, meera: 5, gopal: 6, lakshmi: 7 };
const DISPLAY: Record<string, string> = { asha: 'Asha R.', vikram: 'Vikram S.', nisha: 'Nisha D.', farhan: 'Farhan A.', meera: 'Meera I.', gopal: 'Gopal V.', lakshmi: 'Lakshmi N.' };

function adminRows(): AdminSessionRow[] {
  return SESSION_SEEDS.map(([id, u, city, rec, dec, score, mode, lab], i) => ({
    id, user_id: USER_IDS[u] ?? 1, username: u, display_name: DISPLAY[u] ?? u, mode, created_at: iso(state.now, -12 - i * 9),
    last_seen: iso(state.now, -1 - i * 4), city, device_recognised: rec, latest_score: score,
    latest_decision: dec, assessments_count: dec === 'ALLOW' ? 1 : 3, is_lab: lab,
  }));
}

const THRESH = { step_up: 38.0, block: 71.5 };
function decide(score: number): Decision { return score >= THRESH.block ? 'BLOCK' : score >= THRESH.step_up ? 'STEP_UP' : 'ALLOW'; }

function assessmentsFor(row: AdminSessionRow): RiskAssessment[] {
  const final = row.latest_score ?? 10;
  const risky = row.latest_decision !== 'ALLOW';
  const plan: Array<[RiskAssessment['checkpoint'], number]> = risky
    ? [['login', Math.min(final, 34.1)], ['beneficiary_add', Math.max(final - 22, 20)], ['transfer', final]]
    : [['login', final]];
  return plan.map(([checkpoint, score], i) => {
    const policy: PolicyContribution[] = [];
    if (!row.device_recognised) policy.push({ rule: 'new_device', label: 'Device not recognised', points: 12 });
    if (checkpoint !== 'login' && risky) policy.push({ rule: 'new_beneficiary_fast_transfer', label: 'New payee, transfer within 10 min', points: 20 });
    if (checkpoint === 'transfer' && risky) policy.push({ rule: 'sensitive_sequence', label: 'Profile → payee → transfer sequence', points: 15 });
    const policySum = policy.reduce((a, p) => a + p.points, 0);
    const mlWeight = 0.6;
    const mlIndex = Math.max(0, Math.min(99.8, (score - policySum) / mlWeight));
    return {
      id: 500 + i + row.id.length * 10, ts: iso(row.created_at, i * 0.7 + 0.2), checkpoint,
      risk_score: Number(score.toFixed(1)), decision: decide(score),
      ml: { raw: Number((-0.05 - mlIndex / 600).toFixed(3)), index: Number(mlIndex.toFixed(1)) },
      deviations: risky ? [
        { feature: 'log_km_from_home', label: 'Distance from home', observed: `${row.city} · 1,190 km`, baseline: 'Pune · ≤ 25 km', severity: 'high' },
        { feature: 'hour_rarity', label: 'Hour of activity', observed: '02:40', baseline: '08:00–22:00 (p = 0.96)', severity: 'medium' },
        ...(checkpoint !== 'login' ? [{ feature: 'secs_login_to_sensitive', label: 'Login → sensitive action', observed: '38 s', baseline: 'median 11 min', severity: 'high' as const }] : []),
        ...(checkpoint === 'transfer' ? [{ feature: 'amount_robust_z', label: 'Transfer amount', observed: '₹95,000', baseline: 'median ₹2,400', severity: 'high' as const }] : []),
      ] : [
        { feature: 'hour_rarity', label: 'Hour of activity', observed: '09:30', baseline: '08:00–22:00', severity: 'low' },
      ],
      policy, ml_weight: mlWeight, thresholds: THRESH, model_version: 'if-2026.11.25-syn',
      latency_ms: 6 + i * 1.4, customer_message: risky ? 'New device and location.' : '',
      features: {
        device_recognised: row.device_recognised ? 1 : 0, city_known: risky ? 0 : 1,
        travel_speed_kmh: risky ? 1840 : 0, hour_rarity: risky ? 0.92 : 0.1,
        amount_robust_z: checkpoint === 'transfer' ? 7.4 : 0, sensitive_seq: checkpoint === 'transfer' && risky ? 1 : 0,
        secs_login_to_sensitive: checkpoint === 'login' ? 0 : 38,
      },
    } satisfies RiskAssessment;
  });
}

function auditFor(row: AdminSessionRow): AuditEvent[] {
  return [
    { id: 1, ts: row.created_at, actor: row.username, event_type: 'auth.login', details: { city: row.city } },
    { id: 2, ts: iso(row.created_at, 0.3), actor: 'risk_engine', event_type: 'risk.assessed', details: { checkpoint: 'login', decision: 'ALLOW' } },
    ...(row.latest_decision === 'BLOCK' ? [{ id: 3, ts: iso(row.created_at, 1.5), actor: 'risk_engine', event_type: 'session.restricted', details: { reason: 'BLOCK at transfer' } }] : []),
  ];
}

function metrics(tp: number, fp: number, tn: number, fn: number): DetectionMetrics {
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  return { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0, fpr: fp / (fp + tn), tp, fp, tn, fn };
}

function evaluation(): EvaluationReport {
  const approaches: ApproachResult[] = [
    { name: 'password_totp', label: 'Password + TOTP only', intervention: metrics(0, 0, 3420, 180), block_only: metrics(0, 0, 3420, 180), traveller_restriction_rate: 0,
      prevention: { attack_value_attempted_paise: 1_284_000_000, attack_value_prevented_paise: 0, attack_value_completed_paise: 1_284_000_000, legit_value_delayed_paise: 0 },
      latency_ms: { p50: 0.1, p95: 0.2 }, per_family_recall: { A: 0, B: 0, C: 0, D: 0 } },
    { name: 'static_rules', label: 'Static rules', intervention: metrics(139, 612, 2808, 41), block_only: metrics(52, 38, 3382, 128), traveller_restriction_rate: 0.71,
      prevention: { attack_value_attempted_paise: 1_284_000_000, attack_value_prevented_paise: 905_000_000, attack_value_completed_paise: 379_000_000, legit_value_delayed_paise: 412_000_000 },
      latency_ms: { p50: 0.4, p95: 0.9 }, per_family_recall: { A: 0.95, B: 0.81, C: 0.62, D: 0.33 } },
    { name: 'securesynth', label: 'SecureSynth', intervention: metrics(164, 158, 3262, 16), block_only: metrics(118, 9, 3411, 62), traveller_restriction_rate: 0.12,
      prevention: { attack_value_attempted_paise: 1_284_000_000, attack_value_prevented_paise: 1_196_000_000, attack_value_completed_paise: 88_000_000, legit_value_delayed_paise: 96_000_000 },
      latency_ms: { p50: 6.2, p95: 11.8 }, per_family_recall: { A: 0.99, B: 0.93, C: 0.88, D: 0.71 } },
  ];
  return {
    generated_at: state.now, model_version: 'if-2026.11.25-syn',
    dataset: { customers: 240, sessions_test: 3600, attacks_test: 180, held_out_family: 'D', seed: 2026 },
    approaches,
    assumptions: [
      'Attacker fails independent trusted-device verification; the legitimate user passes it.',
      'Prevented value counts attack transfers that ended non-completed (pending, restricted).',
      'All three approaches are scored on the identical held-out test window (days 76–90).',
    ],
    limitations: [
      'Synthetic data authored by the team; real attacker behaviour is more varied.',
      'Geography and devices are simulated; the trusted device is not a real push channel.',
      'The risk index is a rarity percentile, not a calibrated probability.',
      'MOCK DATA: these figures come from the in-browser mock, not `make eval`.',
    ],
  };
}

function baseline(): BaselineView {
  const hp = Array.from({ length: 24 }, (_, h) => {
    const v = h >= 8 && h <= 22 ? 0.06 + 0.02 * Math.sin((h - 8) / 2.3) : 0.004;
    return v;
  });
  const sum = hp.reduce((a, b) => a + b, 0);
  return {
    user_id: 1, version: state.baselineVersion,
    trusted: {
      devices: ['SYN-DEV-a91f (Android, 2025)', 'SYN-DEV-07c2 (Laptop)'], cities: ['Pune', 'Mumbai'],
      travel_windows: [{ city: 'Dubai', until: iso(state.now, 60 * 24 * 6) }],
      hour_profile: hp.map((v) => v / sum), amount_median_paise: 240_000, amount_mad_paise: 110_000,
      beneficiaries: ['SYN-4410 Meera Iyer', 'SYN-7720 Anil P.'],
    },
    candidate: [
      { kind: 'device', value: 'SYN-DEV-ff10 (new phone)', verified_by: 'c_9a1x', clean_sessions: 1, first_seen: iso(state.now, -60 * 20), status: 'pending', reason: 'Verified; needs 2 clean sessions and 24 h' },
      { kind: 'city', value: 'Dubai', verified_by: 'c_7mq2', clean_sessions: 0, first_seen: iso(state.now, -60 * 30), status: 'travel_window', reason: 'Verified trip → 7-day travel window' },
      { kind: 'device', value: 'SYN-DEV-6e3b (unknown)', verified_by: null, clean_sessions: 10, first_seen: iso(state.now, -60 * 24 * 3), status: 'rejected', reason: 'Never independently verified (poisoning pattern)' },
    ],
    versions: [4, 3, 2, 1].filter((v) => v <= state.baselineVersion + 0).map((v) => ({
      version: v, ts: iso(state.now, -60 * 24 * (5 - v)), reason: ['Seed from 90-day history', 'Promoted device SYN-DEV-07c2', 'Added payee SYN-7720', 'Travel window Dubai'][v - 1],
      diff: { changed: ['devices', 'beneficiaries', 'devices', 'travel_windows'][v - 1] }, rolled_back: state.rolledBack.includes(v),
    })),
    rejected_count: 10,
  };
}

const SCENARIOS: Scenario[] = [
  { id: 'ato_relay', title: 'Takeover despite password + TOTP', narrative: 'An attacker relays a phished password and OTP from a new device, adds a payee and attempts a large transfer within a minute.', expected: 'Login passes with moderate risk; transfer is blocked and the session restricted.',
    params: [{ key: 'city', label: 'Attacker city', type: 'select', value: 'Mumbai', options: ['Mumbai', 'Dubai', 'Lagos'] }, { key: 'amount_paise', label: 'Transfer amount (paise)', type: 'number', value: 9_500_000, min: 100, max: 50_000_000 }] },
  { id: 'traveller', title: 'Genuine traveller', narrative: 'The real customer logs in from Dubai on their own phone and approves on their trusted device.', expected: 'Step-up, number match approved, then allowed; a 7-day travel window is created.',
    params: [{ key: 'city', label: 'Destination', type: 'select', value: 'Dubai', options: ['Dubai', 'Singapore', 'London'] }] },
  { id: 'continuous', title: 'Legitimate login → suspicious activity', narrative: 'A normal login is followed by a rapid profile change, new payee and maximum transfer.', expected: 'Login allowed; later checkpoints step up then block.',
    params: [{ key: 'amount_paise', label: 'Transfer amount (paise)', type: 'number', value: 15_000_000, min: 100, max: 50_000_000 }] },
  { id: 'poisoning', title: 'Baseline poisoning attempt', narrative: 'Ten quiet sessions from an unverified device try to become "normal".', expected: 'All ten candidate changes rejected; trusted baseline unchanged.',
    params: [{ key: 'sessions', label: 'Quiet sessions', type: 'number', value: 10, min: 1, max: 20 }] },
];

function runScenario(id: string, params: Record<string, number | string>): ScenarioRun {
  const amount = Number(params.amount_paise ?? 9_500_000);
  const before = 18_450_000;
  const step = (n: number, actor: ScenarioStep['actor'], action: string, method: string, path: string, status: number, decision: Decision | null, score: number | null, note: string): ScenarioStep =>
    ({ n, actor, action, http: { method, path, status }, decision, risk_score: score, note });
  let steps: ScenarioStep[];
  let final: Decision | null;
  let after = before;
  if (id === 'traveller') {
    steps = [
      step(1, 'customer', 'Sign in with password', 'POST', '/api/auth/login', 200, null, null, 'Password accepted'),
      step(2, 'customer', 'Enter TOTP', 'POST', '/api/auth/totp', 200, 'STEP_UP', 54.0, `New city (${params.city}), recognised device`),
      step(3, 'trusted_device', 'Pick matching number and approve', 'POST', '/api/device/respond', 200, null, null, 'Number match correct'),
      step(4, 'system', 'Create travel window', 'GET', '/api/auth/challenge/c_mock', 200, 'ALLOW', null, `${params.city} trusted for 7 days`),
    ];
    final = 'ALLOW';
  } else if (id === 'poisoning') {
    const n = Number(params.sessions ?? 10);
    steps = Array.from({ length: Math.min(n, 6) }, (_, i) => step(i + 1, 'attacker', `Quiet session ${i + 1}`, 'POST', '/api/auth/totp', 200, i < 2 ? 'STEP_UP' : 'ALLOW', 30 + (i % 3) * 3.1, 'Candidate change rejected (unverified device)'));
    steps.push(step(steps.length + 1, 'system', `Baseline check after ${n} sessions`, 'GET', '/api/admin/users/1/baseline', 200, null, null, 'Trusted version unchanged'));
    final = 'ALLOW';
  } else {
    const blocked = amount >= 5_000_000;
    steps = [
      step(1, id === 'continuous' ? 'customer' : 'attacker', 'Sign in with password', 'POST', '/api/auth/login', 200, null, null, 'Credentials valid'),
      step(2, id === 'continuous' ? 'customer' : 'attacker', 'Enter TOTP', 'POST', '/api/auth/totp', 200, id === 'continuous' ? 'ALLOW' : 'ALLOW', id === 'continuous' ? 9.8 : 34.1, 'Login checkpoint'),
      step(3, 'attacker', 'Add new payee SYN-9911', 'POST', '/api/bank/beneficiaries', 201, 'ALLOW', 36.9, '38 s after login'),
      step(4, 'attacker', `Transfer ${rupees(amount)}`, 'POST', '/api/bank/transfers', blocked ? 403 : 202, blocked ? 'BLOCK' : 'STEP_UP', blocked ? 91.2 : 58.4, blocked ? 'Session restricted' : 'Pending trusted-device approval'),
    ];
    final = blocked ? 'BLOCK' : 'STEP_UP';
    after = before;
  }
  return { scenario_id: id, username: id === 'traveller' ? 'vikram' : 'asha', session_id: id === 'traveller' ? 's_traveller' : 's_ato_relay', steps, final_decision: final, protected_balance_before_paise: before, protected_balance_after_paise: after };
}

// ---------- router ----------
export async function mockFetch(method: string, rawPath: string, body: unknown, headers: Record<string, string>): Promise<MockResponse> {
  await delay(180 + Math.random() * 220);
  state = load();
  expireChallenges();
  const res = route(method, rawPath.split('?')[0], body as Record<string, unknown> | undefined, headers);
  save();
  return res;
}

function route(method: string, path: string, body: Record<string, unknown> | undefined, headers: Record<string, string>): MockResponse {
  const s = state.session;
  const isAdmin = s && USERS[s.username]?.role === 'admin';
  let m: RegExpMatchArray | null;

  // device (header auth only)
  if (path.startsWith('/device/')) {
    if (!headers['X-Device-Key']) return err(401, 'DEVICE_UNAUTHENTICATED', 'Pair this device with a device key first.');
    if (method === 'GET' && path === '/device/pending') {
      return ok(state.challenges.filter((c) => c.status === 'pending').map<DeviceChallenge>((c) => ({ id: c.id, operation: c.operation, context_summary: c.context_summary, created_at: c.created_at, expires_at: c.expires_at, options: c.options })));
    }
    if (method === 'POST' && path === '/device/respond') {
      const c = state.challenges.find((x) => x.id === body?.challenge_id);
      if (!c || c.status !== 'pending') return err(400, 'CHALLENGE_INVALID', 'This request is no longer waiting for approval.');
      const approved = Boolean(body?.approve) && body?.selected_number === c.number_match;
      c.status = approved ? 'approved' : 'denied';
      if (c.pending?.kind === 'transfer') {
        const t = state.txns.find((x) => x.id === (c.pending as { txnId: number }).txnId);
        if (t) { t.status = approved ? 'completed' : 'restricted'; if (approved) state.balance -= t.amount_paise; }
      }
      if (c.pending?.kind === 'beneficiary') {
        const b = state.bens.find((x) => x.id === (c.pending as { benId: number }).benId);
        if (b) b.trust = approved ? 'candidate' : 'blocked';
      }
      if (state.session && state.session.challengeId === c.id) {
        state.session.mode = approved ? 'normal' : 'restricted';
      }
      return ok({ status: c.status });
    }
  }

  // auth
  if (method === 'POST' && path === '/auth/login') {
    const u = String(body?.username ?? '').toLowerCase();
    if (!USERS[u] || body?.password !== 'demo') return err(401, 'INVALID_CREDENTIALS', 'Username or password is incorrect.');
    state.preOtp = u;
    document.cookie = 'ss_csrf=mock-csrf-token; path=/';
    return ok({ stage: 'totp_required' });
  }
  if (method === 'POST' && path === '/auth/totp') {
    if (!state.preOtp) return err(401, 'UNAUTHENTICATED', 'Sign in again.');
    const code = String(body?.code ?? '');
    if (!/^\d{6}$/.test(code) || code === '000000') return err(401, 'INVALID_TOTP', 'That code did not match. Check your authenticator app and try again.');
    const u = USERS[state.preOtp];
    const decision = u.login;
    state.session = { id: `s_${Math.random().toString(36).slice(2, 8)}`, username: state.preOtp, mode: decision === 'ALLOW' ? 'normal' : decision === 'STEP_UP' ? 'step_up' : 'restricted', challengeId: null };
    state.preOtp = null;
    let challenge: ChallengeRef | null = null;
    if (decision === 'STEP_UP') {
      challenge = newChallenge('login', `Sign-in · ${u.city} (simulated) · device not recognised`);
      state.session.challengeId = challenge.id;
    }
    const msg = decision === 'ALLOW' ? '' : decision === 'STEP_UP' ? 'New device and location. Approve this sign-in on your registered device.' : 'Sign-in restricted for your protection.';
    return ok({ decision, session: sessionInfo(), challenge, customer_message: msg });
  }
  if (method === 'POST' && path === '/auth/logout') { state.session = null; return ok(null, 204); }
  if (!s) return err(401, 'UNAUTHENTICATED', 'Your session has ended. Sign in again.');
  if (method === 'GET' && path === '/auth/me') return ok(sessionInfo());
  if (method === 'GET' && (m = path.match(/^\/auth\/challenge\/(.+)$/))) {
    const c = state.challenges.find((x) => x.id === m![1]);
    return c ? ok({ id: c.id, operation: c.operation, status: c.status }) : err(404, 'NOT_FOUND', 'Challenge not found.');
  }

  // bank
  if (path.startsWith('/bank/')) {
    if (s.mode === 'revoked') return err(401, 'UNAUTHENTICATED', 'Your session has ended.');
    if (method === 'GET' && path === '/bank/overview') {
      const restricted = s.mode === 'restricted';
      return ok<OverviewResponse>({ account: { account_ref: restricted ? 'SYN-XXXX-0042' : 'SYN-4471-0042', balance_paise: state.balance, currency: 'INR', simulated: true }, recent: restricted ? [] : state.txns.slice(0, 5), session: sessionInfo() });
    }
    if (s.mode === 'restricted') return err(403, 'SESSION_RESTRICTED', 'This session is restricted for your protection.');
    if (method === 'GET' && path === '/bank/transactions') return ok(state.txns);
    if (method === 'GET' && path === '/bank/beneficiaries') return ok(state.bens);
    if (s.mode === 'step_up' && method === 'POST') return err(403, 'STEP_UP_REQUIRED', 'Approve the pending request on your registered device first.');
    if (method === 'POST' && path === '/bank/beneficiaries') {
      const b: Beneficiary = { id: Math.max(0, ...state.bens.map((x) => x.id)) + 1, name: String(body?.name ?? ''), account_ref: String(body?.account_ref ?? ''), created_at: new Date().toISOString(), trust: 'candidate' };
      if (!b.name || !/^SYN-\d{4}$/.test(b.account_ref)) return err(422, 'VALIDATION_ERROR', 'Enter a name and a synthetic account reference like SYN-1234.');
      state.bens.push(b);
      return ok<SensitiveActionResponse>({ result: 'completed', decision: 'ALLOW', customer_message: '', transaction: null, beneficiary: b, challenge: null }, 201);
    }
    if (method === 'POST' && path === '/bank/transfers') {
      const amt = Number(body?.amount_paise);
      const ben = state.bens.find((b) => b.id === body?.beneficiary_id);
      if (!ben || !Number.isInteger(amt) || amt <= 0) return err(422, 'VALIDATION_ERROR', 'Choose a payee and enter an amount above zero.');
      if (amt > state.balance) return err(422, 'INSUFFICIENT_FUNDS', 'The amount is more than your available balance.');
      const t: Transaction = { id: Math.max(...state.txns.map((x) => x.id)) + 1, created_at: new Date().toISOString(), amount_paise: amt, direction: 'debit', counterparty: `${ben.account_ref} ${ben.name}`, status: 'completed', description: String(body?.note ?? 'Transfer') || 'Transfer' };
      if (amt >= 20_000_000) {
        t.status = 'restricted'; state.txns.unshift(t); s.mode = 'restricted';
        return err(403, 'RISK_BLOCKED', 'This transfer was stopped for your protection.');
      }
      if (amt >= 5_000_000 || ben.trust === 'candidate') {
        t.status = 'pending_verification'; state.txns.unshift(t);
        const ch = newChallenge('transfer', `Transfer ${rupees(amt)} to ${ben.trust === 'candidate' ? 'new payee' : ben.name} · ${USERS[s.username].city} (simulated)`, { kind: 'transfer', txnId: t.id });
        return ok<SensitiveActionResponse>({ result: 'pending_verification', decision: 'STEP_UP', customer_message: 'Large transfer to a payee. Approve it on your registered device.', transaction: t, beneficiary: null, challenge: ch }, 202);
      }
      state.balance -= amt; state.txns.unshift(t);
      return ok<SensitiveActionResponse>({ result: 'completed', decision: 'ALLOW', customer_message: '', transaction: t, beneficiary: null, challenge: null }, 201);
    }
  }

  // admin + lab
  if (path.startsWith('/admin/') || path.startsWith('/lab/')) {
    if (!isAdmin) return err(403, 'FORBIDDEN', 'Analyst access is required.');
    if (method === 'GET' && path === '/admin/config') return ok<AppConfig>({ ghost_banking_enabled: false, demo_mode: true, model_version: 'if-2026.11.25-syn' });
    if (method === 'GET' && path === '/admin/sessions') return ok(adminRows());
    if ((m = path.match(/^\/admin\/sessions\/([^/]+)$/)) && method === 'GET') {
      const row = adminRows().find((r) => r.id === m![1]);
      if (!row) return err(404, 'NOT_FOUND', 'Session not found.');
      return ok<SessionDetail>({ session: row, assessments: assessmentsFor(row), audit: auditFor(row) });
    }
    if ((m = path.match(/^\/admin\/sessions\/([^/]+)\/revoke$/)) && method === 'POST') return ok({ mode: 'revoked' });
    if ((m = path.match(/^\/admin\/assessments\/(\d+)\/counterfactual$/)) && method === 'POST') {
      const changes = (body?.changes as { feature: string; value: number }[]) ?? [];
      let score = 91.2;
      const policy: PolicyContribution[] = [{ rule: 'new_beneficiary_fast_transfer', label: 'New payee, transfer within 10 min', points: 20 }, { rule: 'sensitive_sequence', label: 'Profile → payee → transfer sequence', points: 15 }];
      for (const c of changes) {
        if (c.feature === 'device_recognised' && c.value === 1) score -= 12;
        if (c.feature === 'city_known' && c.value === 1) score -= 10;
        if (c.feature === 'travel_speed_kmh') score -= c.value < 900 ? 14 : 0;
        if (c.feature === 'sensitive_seq' && c.value === 0) score -= 15;
        if (c.feature === 'secs_login_to_sensitive') score -= Math.min(25, c.value / 40);
        if (c.feature === 'amount_robust_z') score -= Math.max(0, 6 - c.value) * 2.5;
      }
      score = Math.max(0, Math.min(100, Number(score.toFixed(1))));
      return ok<CounterfactualResponse>({ hypothetical: true, original: { score: 91.2, decision: 'BLOCK' }, result: { score, decision: decide(score), ml_index: Number(Math.max(0, (score - 35) / 0.6).toFixed(1)), policy } });
    }
    if (method === 'GET' && path === '/admin/users') {
      return ok<UserRow[]>([
        { id: 1, username: 'asha', display_name: 'Asha R.', persona: 'salaried commuter', home_city: 'Pune', role: 'customer', baseline_version: state.baselineVersion },
        { id: 2, username: 'vikram', display_name: 'Vikram S.', persona: 'frequent traveller', home_city: 'Mumbai', role: 'customer', baseline_version: 6 },
      ]);
    }
    if ((m = path.match(/^\/admin\/users\/(\d+)\/baseline$/)) && method === 'GET') return ok(baseline());
    if ((m = path.match(/^\/admin\/users\/(\d+)\/baseline\/rollback$/)) && method === 'POST') {
      const to = Number(body?.to_version);
      for (let v = to + 1; v <= state.baselineVersion; v++) state.rolledBack.push(v);
      return ok(baseline());
    }
    if (method === 'GET' && path === '/admin/evaluation') return ok(evaluation());
    if (method === 'GET' && path.startsWith('/admin/ghost/')) return err(404, 'FEATURE_DISABLED', 'Ghost Banking is disabled pending mentor approval.');
    if (method === 'GET' && path === '/lab/scenarios') return ok(SCENARIOS);
    if ((m = path.match(/^\/lab\/scenarios\/([^/]+)\/run$/)) && method === 'POST') {
      return ok(runScenario(m[1], ((body?.params ?? {}) as Record<string, number | string>)));
    }
    if (method === 'POST' && path === '/lab/reset') {
      const keep = state.session; state = seed(); state.session = keep;
      return ok<ResetResponse>({ ok: true, seed_hash: 'syn-7f3a91c2', now: state.now });
    }
    if (path === '/lab/clock') {
      if (method === 'POST') state.now = iso(state.now, Number(body?.advance_hours ?? 0) * 60);
      return ok<ClockResponse>({ now: state.now });
    }
  }
  return err(404, 'NOT_FOUND', `Mock has no handler for ${method} ${path}.`);
}
