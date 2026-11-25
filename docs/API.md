# SecureSynth API reference

**Version:** contract **v1.2.0**.
- `frontend/src/api/types.ts` (`CONTRACT_VERSION`) holds the JSON shapes and is the source of truth.
- `backend/app/schemas.py` mirrors it in Pydantic.

**This reference was generated from the running backend's OpenAPI schema** (`GET /openapi.json`, 2026-11-25) and reconciled with `docs/api-contract.md`.
- The interactive docs are at http://127.0.0.1:8000/docs while `make dev-backend` runs.
- The OpenAPI `info.version` string still reads `1.1.0`. The 1.2.0 changes are additive fields on the evaluation report, so the paths are identical.

## Transport and security rules
| Rule | Detail |
|---|---|
| Base path | `/api` on `127.0.0.1:8000`. Vite proxies `/api`, so the browser is same-origin. |
| Session | Opaque cookie `ss_session`: HttpOnly, `SameSite=Strict`, `Path=/api`. The token is stored hashed and rotated after TOTP. Idle expiry 15 min, absolute 60 min. |
| CSRF | Cookie `ss_csrf` is set at login. Every mutating request with a session must send `X-CSRF-Token`, or it gets 403 `CSRF_FAILED`. |
| Origin | If `Origin` is present on a mutation, it must be an allowed frontend origin, or it gets 403 `ORIGIN_REJECTED`. |
| Trusted device | `/api/device/*` authenticates **only** with the `X-Device-Key` header and ignores banking cookies, so a suspicious session can never approve its own challenge. |
| Money and time | Money is in integer paise. Timestamps are ISO-8601 UTC with an explicit offset, from the simulated clock. TOTP uses real time. |
| Errors | `ErrorBody { code, message }`. Validation failures return 422 `VALIDATION_ERROR`. |
| Customer messages | Category-level only. Scores, thresholds, feature names and counterfactuals are never sent to customers (test-enforced). |

## Endpoints (all 28 paths exposed by the backend)
### Health and authentication
| Method | Path | Auth | Success | Notable errors |
|---|---|---|---|---|
| GET | `/health` | none | `{status:"ok"}` | — |
| POST | `/auth/login` | none | `LoginResponse`; sets the pre-OTP cookie and CSRF | 401 `INVALID_CREDENTIALS` (same response for an unknown user), 429 `RATE_LIMITED` (5 / 5 min) |
| POST | `/auth/totp` | pre-OTP | `TotpResponse` with the decision; token rotated | 401 `INVALID_TOTP` / `TOTP_REPLAY` |
| GET | `/auth/me` | session | `SessionInfo` (role, mode) | 401 |
| GET | `/auth/challenge/{id}` | session (owner) | `ChallengeStatusResponse` | 404 |
| POST | `/auth/logout` | session | 204 | — |

### Banking (customer)
| Method | Path | Auth | Success | Notable errors |
|---|---|---|---|---|
| GET | `/bank/overview` | session | `OverviewResponse` (masked if restricted) | 403 `SESSION_RESTRICTED`, 403 `STEP_UP_REQUIRED` (login step-up pending) |
| GET | `/bank/transactions` | session | `Transaction[]` | as above |
| GET | `/bank/beneficiaries` | session | `Beneficiary[]` | as above |
| POST | `/bank/beneficiaries` | session `normal` | 201 done, or 202 `SensitiveActionResponse` with a challenge | 403 `RISK_BLOCKED` / `STEP_UP_REQUIRED` / `SESSION_RESTRICTED` |
| POST | `/bank/transfers` | session `normal` | 201 or 202 (idempotency key required) | 403 as above; 422 `INSUFFICIENT_FUNDS` |

Every payee add and transfer is **risk-assessed by the backend before it executes**. A STEP_UP returns a challenge; the bound payload executes only after trusted-device approval.

### Trusted device (simulated)
| Method | Path | Auth | Success | Notable errors |
|---|---|---|---|---|
| GET | `/device/pending` | `X-Device-Key` | `DeviceChallenge[]` | 401 `DEVICE_UNAUTHENTICATED` |
| POST | `/device/respond` | `X-Device-Key` | `DeviceRespondResponse` | 400 `CHALLENGE_INVALID`; a wrong number denies and restricts |

**Challenges:**
- single use;
- expire after 120 s;
- bound to the session, the operation and the SHA-256 hash of the payload.

### Security Command Centre (admin)
| Method | Path | Success |
|---|---|---|
| GET | `/admin/config` | `AppConfig` (`ghost_banking_enabled` is false) |
| GET | `/admin/sessions` | `AdminSessionRow[]` (`?decision=&limit=`) |
| GET | `/admin/sessions/{id}` | `SessionDetail`: assessments, features, deviations, ML index, policy points, decision |
| POST | `/admin/sessions/{id}/revoke` | `{mode:"revoked"}` |
| POST | `/admin/assessments/{id}/counterfactual` | `CounterfactualResponse`: re-runs the real scoring path, labelled hypothetical, never persisted |
| GET | `/admin/users` | `UserRow[]` |
| GET | `/admin/users/{id}/baseline` | `BaselineView` (trusted vs candidate, versions) |
| POST | `/admin/users/{id}/baseline/rollback` | `BaselineView` |
| GET | `/admin/evaluation` | `EvaluationReport` (the frozen `eval_report.json`; 404 if `make eval` has not been run) |
| GET | `/admin/ghost/{session_id}` | **always 404**: `FEATURE_DISABLED` by default; "not implemented" even if the flag is set |

All admin routes require an admin session and return 403 `FORBIDDEN` otherwise.

### Scenario Lab (demo only)
| Method | Path | Success |
|---|---|---|
| GET | `/lab/scenarios` | `Scenario[]` (the six scripted scenarios) |
| POST | `/lab/scenarios/{id}/run` | `ScenarioRun`: steps, decisions, risk index, before and after balances |
| POST | `/lab/reset` | `ResetResponse`: restores `seed.db` and the clock; keeps the presenter's admin session |
| GET / POST | `/lab/clock` | `ClockResponse` (POST `{advance_hours}`) |

**Lab routers are mounted only when `SS_DEMO_MODE=true`;** otherwise every Lab path returns 404. Requests also need all of:
- an admin session;
- a loopback client;
- Origin and CSRF checks.

## Session modes
| Mode | Reads | Payee add / transfer | Entered by |
|---|---|---|---|
| `pre_otp` | — | — | correct password |
| `normal` | yes | yes (risk-checked) | TOTP + ALLOW, or approved step-up |
| `step_up` | yes, unless the step-up is for the login itself | no, until approved | STEP_UP decision |
| `restricted` | masked overview | no | BLOCK, a denied challenge or an expired challenge |
| `revoked` | — | — | logout, expiry, analyst revoke, Lab reset |
| `ghost` | — | — | **schema only.** Never entered while Ghost Banking is disabled (the default) |

## Corrections to the older contract document
- **`GET /lab/demo-credentials/{username}`** appears in `api-contract.md` but is **not implemented** (it is absent from OpenAPI). Demo credentials exist only in the local, gitignored `backend/artifacts/demo_credentials.json`.
- **Version:** the `api-contract.md` header was updated from v1.1.0 to v1.2.0 to match `types.ts`.
