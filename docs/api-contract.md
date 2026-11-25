# SecureSynth API Contract — v1.1.0 (2026-11-25)

> 1.1.0 additive change: `AdminSessionRow.user_id`, `RiskAssessment.features` (counterfactual feature names = its keys). Transfer/beneficiary STEP_UP sets session mode `step_up` until the challenge resolves. `ChallengeStatus.consumed` is unused (approved challenges stay `approved`).

Shapes: `frontend/src/api/types.ts` is the source of truth for JSON bodies. Backend Pydantic models in `backend/app/schemas.py` mirror it. Changes need both developers to agree; bump `CONTRACT_VERSION`.

## Transport rules
- Base path `/api`. Backend on `127.0.0.1:8000`; Vite dev server proxies `/api` so the browser is same-origin.
- Banking/admin auth: opaque session cookie `ss_session` (HttpOnly, SameSite=Strict, Path=/api).
- CSRF: cookie `ss_csrf` (readable by JS) is set at login. **Every mutating request (POST/PUT/DELETE) with a session must send header `X-CSRF-Token: <ss_csrf>`**, else 403 `CSRF_FAILED`.
- If an `Origin` header is present on a mutating request it must equal a configured frontend origin (default `http://localhost:5173`, `http://127.0.0.1:5173`), else 403 `ORIGIN_REJECTED`.
- Trusted device auth: header `X-Device-Key: <device key>` only. `/api/device/*` ignores banking cookies completely.
- Errors: `ErrorBody` with codes listed in `types.ts`. Validation errors → 422 `VALIDATION_ERROR`.
- Money is integer paise. Timestamps are ISO-8601 **UTC with explicit offset** (e.g. `2026-11-25T08:19:52Z`), from the simulated clock. `PolicyContribution.category` (optional) groups rules for customer-safe messaging.

## Endpoints

| Method & path | Auth | Request | Success | Notable errors |
|---|---|---|---|---|
| POST `/auth/login` | none | `LoginRequest` | 200 `LoginResponse` (sets pre-OTP cookie + csrf) | 401 INVALID_CREDENTIALS, 429 RATE_LIMITED |
| POST `/auth/totp` | pre-OTP | `TotpRequest` | 200 `TotpResponse` (session token rotated) | 401 INVALID_TOTP / TOTP_REPLAY, 429 |
| GET `/auth/me` | session | — | 200 `SessionInfo` | 401 |
| GET `/auth/challenge/{id}` | session (owner) | — | 200 `ChallengeStatusResponse` | 404 |
| POST `/auth/logout` | session | — | 204 | — |
| GET `/bank/overview` | session (normal/step_up/restricted*) | — | 200 `OverviewResponse` | 401, 403 SESSION_RESTRICTED |
| GET `/bank/transactions?limit=50` | session | — | 200 `Transaction[]` | |
| GET `/bank/beneficiaries` | session | — | 200 `Beneficiary[]` | |
| POST `/bank/beneficiaries` | session normal | `AddBeneficiaryRequest` | 201/202 `SensitiveActionResponse` | 403 RISK_BLOCKED / SESSION_RESTRICTED / STEP_UP_REQUIRED |
| POST `/bank/transfers` | session normal | `TransferRequest` | 201/202 `SensitiveActionResponse` | 403 RISK_BLOCKED, 422 INSUFFICIENT_FUNDS |
| GET `/device/pending` | X-Device-Key | — | 200 `DeviceChallenge[]` | 401 DEVICE_UNAUTHENTICATED |
| POST `/device/respond` | X-Device-Key | `DeviceRespondRequest` | 200 `DeviceRespondResponse` | 400 CHALLENGE_INVALID |
| GET `/admin/config` | admin | — | `AppConfig` | 403 FORBIDDEN |
| GET `/admin/sessions?decision=&limit=` | admin | — | `AdminSessionRow[]` | |
| GET `/admin/sessions/{id}` | admin | — | `SessionDetail` | 404 |
| POST `/admin/sessions/{id}/revoke` | admin | — | `{ "mode": "revoked" }` | |
| POST `/admin/assessments/{id}/counterfactual` | admin | `CounterfactualRequest` | `CounterfactualResponse` | |
| GET `/admin/users` | admin | — | `UserRow[]` | |
| GET `/admin/users/{id}/baseline` | admin | — | `BaselineView` | |
| POST `/admin/users/{id}/baseline/rollback` | admin | `{ "to_version": 3 }` | `BaselineView` | |
| GET `/admin/evaluation` | admin | — | `EvaluationReport` | 404 if `make eval` not run |
| GET `/admin/ghost/{session_id}` | admin | — | `GhostCompare` | 404 FEATURE_DISABLED (default) |
| GET `/lab/scenarios` | lab** | — | `Scenario[]` | 404 when DEMO_MODE off |
| POST `/lab/scenarios/{id}/run` | lab** | `{ "params": {...} }` | `ScenarioRun` | |
| POST `/lab/reset` | lab** | — | `ResetResponse` | |
| GET/POST `/lab/clock` | lab** | POST `{ "advance_hours": 72 }` | `ClockResponse` | |
| GET `/lab/demo-credentials/{username}` | lab** | — | `{ "totp_uri": "...", "device_key": "..." }` | |

\* `restricted` sessions may read a masked overview only; all sensitive routes return 403.
\** lab = `DEMO_MODE=true` (otherwise router not mounted → 404) + admin session + loopback client + Origin check + CSRF.

## Session modes & what they allow
| mode | reads | beneficiary add / transfer | notes |
|---|---|---|---|
| pre_otp | none | no | only `/auth/totp` |
| normal | yes | yes (risk-checked) | |
| step_up | yes | no (403 STEP_UP_REQUIRED) until challenge approved | |
| restricted | masked overview | no | result of BLOCK when Ghost Banking disabled |
| ghost | ghost ledger only | ghost ledger only | only when `GHOST_BANKING_ENABLED=true` |
| revoked | none | no | |

## Customer message rule
Customer-facing `customer_message` is category-level ("new device and location"), never scores, thresholds, feature names or counterfactuals.
