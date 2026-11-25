/**
 * SecureSynth shared API contract — FROZEN v1 (2026-11-25).
 * Source of truth together with docs/api-contract.md.
 * Backend Pydantic models in backend/app/schemas.py must match these shapes exactly.
 * Changes: announce to both developers first, bump CONTRACT_VERSION, update both sides in one merge.
 * All money is integer paise (INR × 100). All timestamps are ISO-8601 strings (simulated clock).
 */
export const CONTRACT_VERSION = "1.1.0"; // 1.1.0 (additive): AdminSessionRow.user_id, RiskAssessment.features

// ---------- common ----------
export type Decision = "ALLOW" | "STEP_UP" | "BLOCK";
export type SessionMode = "pre_otp" | "normal" | "step_up" | "restricted" | "ghost" | "revoked";
export type Role = "customer" | "admin";
export type Operation = "login" | "beneficiary_add" | "transfer";
export type Checkpoint = "login" | "beneficiary_add" | "transfer" | "profile_change";
export type ActionResult = "completed" | "pending_verification" | "restricted";
export type ChallengeStatus = "pending" | "approved" | "denied" | "expired" | "consumed";

export type ErrorCode =
  | "INVALID_CREDENTIALS" | "RATE_LIMITED" | "INVALID_TOTP" | "TOTP_REPLAY"
  | "UNAUTHENTICATED" | "FORBIDDEN" | "CSRF_FAILED" | "ORIGIN_REJECTED"
  | "RISK_BLOCKED" | "SESSION_RESTRICTED" | "STEP_UP_REQUIRED"
  | "VALIDATION_ERROR" | "INSUFFICIENT_FUNDS" | "NOT_FOUND"
  | "CHALLENGE_INVALID" | "FEATURE_DISABLED" | "DEVICE_UNAUTHENTICATED";

export interface ErrorBody {
  error: { code: ErrorCode; message: string; request_id: string };
}

// ---------- auth ----------
export interface LoginRequest { username: string; password: string }
export interface LoginResponse { stage: "totp_required" }

export interface TotpRequest { code: string }

export interface SessionInfo {
  username: string;
  display_name: string;
  role: Role;
  mode: SessionMode;
  expires_at: string;
  simulated_context: { city: string; device_recognised: boolean };
}

/** number_match is shown on the banking screen; the user picks it on the trusted device. */
export interface ChallengeRef {
  id: string;
  operation: Operation;
  number_match: number;
  expires_at: string;
}

export interface TotpResponse {
  decision: Decision;
  session: SessionInfo;
  challenge: ChallengeRef | null;
  /** Safe, category-level text. Never contains scores or thresholds. */
  customer_message: string;
}

export interface ChallengeStatusResponse {
  id: string;
  operation: Operation;
  status: ChallengeStatus;
}

// ---------- banking ----------
export interface AccountSummary {
  account_ref: string;
  balance_paise: number;
  currency: "INR";
  simulated: true;
}

export type TxnStatus = "attempted" | "pending_verification" | "restricted" | "completed";

export interface Transaction {
  id: number;
  created_at: string;
  amount_paise: number;
  direction: "debit" | "credit";
  counterparty: string;
  status: TxnStatus;
  description: string;
}

export interface Beneficiary {
  id: number;
  name: string;
  account_ref: string;
  created_at: string;
  trust: "trusted" | "candidate" | "blocked";
}

export interface OverviewResponse {
  account: AccountSummary;
  recent: Transaction[];
  session: SessionInfo;
}

export interface AddBeneficiaryRequest { name: string; account_ref: string }
export interface TransferRequest {
  beneficiary_id: number;
  amount_paise: number;
  note?: string;
  idempotency_key: string;
}

/** 201 completed · 202 pending_verification. A BLOCK returns 403 ErrorBody{code:"RISK_BLOCKED"}. */
export interface SensitiveActionResponse {
  result: ActionResult;
  decision: Decision;
  customer_message: string;
  transaction: Transaction | null;
  beneficiary: Beneficiary | null;
  challenge: ChallengeRef | null;
}

// ---------- trusted device (separate credential: header X-Device-Key; banking cookie is ignored) ----------
export interface DeviceChallenge {
  id: string;
  operation: Operation;
  context_summary: string; // e.g. "Transfer ₹95,000 to new payee · Dubai (simulated)"
  created_at: string;
  expires_at: string;
  options: number[]; // three numbers, one equals number_match
}
export interface DeviceRespondRequest { challenge_id: string; selected_number: number; approve: boolean }
export interface DeviceRespondResponse { status: ChallengeStatus }

// ---------- admin / security command centre ----------
export interface Deviation {
  feature: string;
  label: string;
  observed: string;
  baseline: string;
  severity: "low" | "medium" | "high";
}
export interface PolicyContribution { rule: string; label: string; points: number; category?: string }

export interface RiskAssessment {
  id: number;
  ts: string;
  checkpoint: Checkpoint;
  risk_score: number; // 0–100 risk index, NOT a probability
  decision: Decision;
  ml: { raw: number; index: number }; // index = rarity percentile vs legitimate validation events
  deviations: Deviation[]; // observed differences from baseline (not IF feature importance)
  policy: PolicyContribution[]; // exact additive contributions
  ml_weight: number;
  thresholds: { step_up: number; block: number };
  model_version: string;
  latency_ms: number;
  customer_message: string;
  /** Numeric feature vector used for scoring; keys are the only valid counterfactual feature names. */
  features: Record<string, number>;
}

export interface AdminSessionRow {
  id: string;
  user_id: number;
  username: string;
  display_name: string;
  mode: SessionMode;
  created_at: string;
  last_seen: string;
  city: string;
  device_recognised: boolean;
  latest_score: number | null;
  latest_decision: Decision | null;
  assessments_count: number;
  is_lab: boolean;
}

export interface AuditEvent {
  id: number;
  ts: string;
  actor: string;
  event_type: string;
  details: Record<string, string | number | boolean | null>;
}

export interface SessionDetail {
  session: AdminSessionRow;
  assessments: RiskAssessment[];
  audit: AuditEvent[];
}

export interface CounterfactualRequest { changes: { feature: string; value: number }[] }
export interface CounterfactualResponse {
  hypothetical: true;
  original: { score: number; decision: Decision };
  result: { score: number; decision: Decision; ml_index: number; policy: PolicyContribution[] };
}

export interface UserRow {
  id: number;
  username: string;
  display_name: string;
  persona: string;
  home_city: string;
  role: Role;
  baseline_version: number;
}

export interface CandidateItem {
  kind: "device" | "city" | "beneficiary";
  value: string;
  verified_by: string | null; // challenge id
  clean_sessions: number;
  first_seen: string;
  status: "pending" | "promoted" | "rejected" | "travel_window";
  reason: string;
}

export interface BaselineView {
  user_id: number;
  version: number;
  trusted: {
    devices: string[];
    cities: string[];
    travel_windows: { city: string; until: string }[];
    hour_profile: number[]; // 24 probabilities
    amount_median_paise: number;
    amount_mad_paise: number;
    beneficiaries: string[];
  };
  candidate: CandidateItem[];
  versions: { version: number; ts: string; reason: string; diff: Record<string, unknown>; rolled_back: boolean }[];
  rejected_count: number;
}

export interface AppConfig { ghost_banking_enabled: boolean; demo_mode: boolean; model_version: string }

export interface GhostCompare {
  protected: { account: AccountSummary; transactions: Transaction[] };
  ghost: { account: AccountSummary; transactions: Transaction[]; label: string };
}

// ---------- evaluation ----------
export interface DetectionMetrics {
  precision: number; recall: number; f1: number; fpr: number;
  tp: number; fp: number; tn: number; fn: number;
}
export interface ApproachResult {
  name: "password_totp" | "static_rules" | "securesynth";
  label: string;
  intervention: DetectionMetrics; // positive = STEP_UP or BLOCK
  block_only: DetectionMetrics;   // positive = BLOCK
  traveller_restriction_rate: number;
  prevention: {
    attack_value_attempted_paise: number;
    attack_value_prevented_paise: number;
    attack_value_completed_paise: number;
    legit_value_delayed_paise: number;
  };
  latency_ms: { p50: number; p95: number };
  per_family_recall: Record<string, number>;
}
export interface EvaluationReport {
  generated_at: string;
  model_version: string;
  dataset: { customers: number; sessions_test: number; attacks_test: number; held_out_family: string; seed: number };
  approaches: ApproachResult[];
  assumptions: string[];
  limitations: string[];
}

// ---------- scenario lab (DEMO_MODE + admin + localhost + Origin + CSRF) ----------
export interface ScenarioParam {
  key: string;
  label: string;
  type: "number" | "select";
  value: number | string;
  options?: string[];
  min?: number;
  max?: number;
}
export interface Scenario { id: string; title: string; narrative: string; expected: string; params: ScenarioParam[] }
export interface ScenarioStep {
  n: number;
  actor: "customer" | "attacker" | "trusted_device" | "system";
  action: string;
  http: { method: string; path: string; status: number };
  decision: Decision | null;
  risk_score: number | null;
  note: string;
}
export interface ScenarioRun {
  scenario_id: string;
  username: string;
  session_id: string | null;
  steps: ScenarioStep[];
  final_decision: Decision | null;
  protected_balance_before_paise: number;
  protected_balance_after_paise: number;
}
export interface ResetResponse { ok: true; seed_hash: string; now: string }
export interface ClockResponse { now: string }
