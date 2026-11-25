# SecureSynth progress log

## 2026-11-25 — autonomous session 1 (≈13:27–14:05 IST)

### Done (all verified by running it)
- **Specs:** spec amended with A1–A10; implementation plan written; API contract v1.1.0 in `docs/api-contract.md` + `frontend/src/api/types.ts`. The v1.1.0 changes are additive:
  - `AdminSessionRow.user_id`
  - `RiskAssessment.features`
  - `PolicyContribution.category`
  - UTC timestamps with an explicit offset
- **Environment:**
  - Python 3.12.16 (Homebrew) with `.venv`; pinned `backend/requirements.txt`.
  - Frontend deps pinned exactly in `frontend/package-lock.json`.
  - `make setup|env|train|eval|seed|test|dev-backend|dev-frontend|types`.
- **Git hygiene:** the following are gitignored:
  - private competition docs;
  - `backend/.env` (generated secrets);
  - local DBs and `seed.db`;
  - `artifacts/` (model, eval report, demo credentials, mode 600);
  - `node_modules`.

  A scan of untracked files found no secrets.

**Backend (TDD; each test seen failing first):**
- **Security:**
  - Argon2id passwords; TOTP with ±1 step and replay protection (real wall clock); Fernet-encrypted TOTP seeds.
  - Hashed opaque session tokens, rotated after TOTP; idle and absolute expiry; logout/revoke.
  - Rate limits; Origin guard; CSRF double-submit; role separation; security headers.
- **Banking:** overview, transactions, payees, transfers. Transfers use idempotency keys, an atomic conditional debit and a funds pre-check.
- **Live risk engine:**
  - Shared personalised features: one implementation for both training and serving.
  - Isolation Forest + validation-percentile index + transparent policy points, including a −15 verified-travel credit.
  - Hard-block rule; ALLOW/STEP_UP/BLOCK enforced by the backend.
  - Safe customer messages; analyst view keeps ML index, deviations, policy and decision separate.
- **Continuous risk:** re-scored at login, payee add and transfer.
- **Trusted-device step-up (A2):**
  - Separate `X-Device-Key` credential.
  - Challenges are single-use, last 120 s and are bound to session + operation + payload hash, with number matching.
  - Approval executes exactly the bound payload, once.
- **Poison-resistant baseline (A7):**
  - Trusted vs candidate states. Only the challenge-bound attribute is learned.
  - Promotion requires 2 clean sessions + 24 h. Verified travel gives a 7-day window, never a permanent city.
  - Blocked sessions void contributions, and auto-rollback applies if a promoted device is later involved in a BLOCK.
  - Every change is versioned and can be rolled back exactly.
- **Admin API:** sessions, session detail, revoke, counterfactual (re-runs the real scoring path, labelled hypothetical), users, baseline, rollback, evaluation, ghost (404 `FEATURE_DISABLED`).
- **Scenario Lab (A4):**
  - Mounted only when `DEMO_MODE=true`; admin + loopback + Origin + CSRF required.
  - Simulated city is accepted only with an in-process lab token the browser never sees.
  - 6 scenarios driven through the real HTTP API; reset from snapshot; simulated clock.
- **ML:**
  - Deterministic generator: 240 customers, 90 days, 7 personas, legitimate drift, ATO families A–D, with D held out of validation.
  - Chronological splits; tuning refuses test rows; evaluation harness uses one shared outcome function.

**Frontend (subagent, Developer A track):**
- Vite/React/TS/Tailwind v4/TanStack Query/Recharts app covering the customer portal, trusted-device simulator, Command Centre (sessions, investigation, what-if, baseline, evaluation, ghost placeholder) and Lab.
- Mock mode via `npm run dev:mock`. Build passes with zero TypeScript errors.
- Every endpoint verified against the real backend via a script.

### Test results (actual)
- `make test` → **75 passed**, 0 failed.
- `npx tsc -b` (frontend) → no errors; `npm run build` → built (bundle-size warning only).

### Live scenario runs (real API, after `POST /lab/reset`; model `iforest-v1-1b15b837`, ML weight 0.4, step-up ≥ 38.21, block ≥ 51.84)
| Scenario | Path (decision and score at each checkpoint) | Protected balance |
|---|---|---|
| Normal customer | login ALLOW 12.3 → transfer ALLOW 31.0 | −₹2,500 (legit) |
| Takeover despite password + TOTP | login BLOCK 59.9 → payee 403 → transfer 403 | unchanged |
| Suspicious after legit login | login ALLOW 12.3 → new payee STEP_UP 39.8 → transfer 403 | unchanged |
| Genuine traveller (Singapore) | login STEP_UP 47.8 → device approve → transfer ALLOW 23.4 (travel window) | −₹2,500 |
| New device | login STEP_UP 49.9 → approve → transfer STEP_UP 50.1 → approve | −₹2,500 |
| Unusual legit ₹1.5 lakh (farhan) | login ALLOW 12.3 → transfer ALLOW 34.7 | −₹1,50,000 |

### Held-out evaluation (test days 75–90; 4,641 sessions, 294 attacks) — NOT PRESENTABLE YET
| Approach | P | R | F1 | FPR | Block R | Traveller restricted | Attack value prevented | Legit value delayed | p95 latency |
|---|---|---|---|---|---|---|---|---|---|
| Password + TOTP | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0% | ₹0 of ₹2.97 cr | ₹0 | – |
| Static rules | 0.180 | 0.918 | 0.301 | 0.282 | 0.531 | 96.2% | ₹2.91 cr | ₹2.73 cr | – |
| SecureSynth | 0.569 | 1.000 | 0.725 | 0.051 | 0.871 | 21.1% | ₹2.97 cr | ₹32.8 lakh | 6.0 ms |

**Honesty notes:**
- **100% recall, including held-out family D, means the synthetic attacks are too easy to separate.** Fix this before presenting (see Unresolved #2).
- **The test split has been evaluated twice.**
  - The second run followed a model change: adding the spec'd verified-travel-window feature, which the spec required but I had left out.
  - That change was not driven by test results. Thresholds were re-tuned on validation only.

### Unresolved / blockers
1. **Git identity not configured → no commits made.** Each developer must set their own name/email (see report). Everything is currently untracked on `main`.
2. **Generator hardening** (decide *before* the next test evaluation and record it):
   - hijack using an existing payee;
   - low-and-slow from a recognised browser;
   - legitimate "new payee then quick transfer" confounders;
   - a legitimate new-device customer adding a payee.
3. **Friction on legit new devices is too high:**
   - The frontend agent saw a payee add BLOCKed after an approved new-device login.
   - meera on a fresh browser was BLOCKed at login (before the latest retrain; re-check).
   - The "suspicious after login" score is 39.8 against a 38.2 threshold — a thin margin.
4. Logged-in browser walkthrough of the UI against the real backend has not been done (the agent was correctly not permitted to read demo passwords). Needs a human sign-in in the browser pane.
5. Not built yet:
   - Ghost Banking module and isolation tests (flag off; mentor approval pending);
   - beneficiary-candidate promotion;
   - `/lab/demo-credentials` (deliberately skipped: it would expose secrets over HTTP);
   - README with licences, threat-model doc, slides, fallback video;
   - code review and security review passes.
6. The frontend bundle is 834 kB; lazy-load the SOC and Lab routes.

## 2026-11-25 — Master Prompt #02 session (≈14:10–14:45 IST)

### Done (all verified)
- **Git:** repo-local identity set as chosen by the user (Mohammed Hussain, GitHub noreply address).
  - Branch `feat/mvp-checkpoint` has 11 commits, split by area.
  - No secrets, databases or private documents are tracked.
  - MVP model backed up as `artifacts/model-mvp-iforest-v1-1b15b837.joblib` (local only).
- **Browser walkthrough** (built-in browser, real backend, synthetic accounts):
  - **Customer:** login → TOTP → device step-up → number-match approval → dashboard → transfer → add payee (step-up, approved) → large transfer to the new payee → BLOCK → restricted screen. A direct API call confirmed the restriction is enforced by the backend (403 SESSION_RESTRICTED).
  - **Analyst:** wrong TOTP shows an error banner → login → SOC list → session investigation (chart, 4 panels, audit trail) → what-if → Lab takeover run → reset.
- **Fixed from the walkthrough:**
  - A verified device is now provisionally recognised. Before this, a normal payment needed a second approval right after login approval.
  - Seed history now uses realistic hour and amount spread and shows statements. Before this, a verified customer adding a payee was BLOCKed in the afternoon.
  - Reset keeps the presenter signed in.
  - Ghost button hidden while disabled; Lab shows simulated-time steps; tests pinned to 09:xx local time.
- **ML (protocol v2, pre-registered and committed before results):**
  - Overlapping legit/attack behaviour; frozen manifest.
  - Fresh final population (seed 9091), evaluated once.
  - Results in `docs/EVALUATION.md`.
- **Security review:** 1 candidate, rated 6/10 by the false-positive check, so it didn't make the formal report's ≥8 cutoff. It was fixed anyway: a login awaiting step-up could read account data, and expired step-ups were never restricted.
  - Also fixed: a denied challenge now voids that session's baseline contributions.
- **Code review (medium):** 6 findings. 3 important ones fixed:
  - clock advance logged the presenter out;
  - replaying a blocked transfer reported "pending";
  - a funds failure lost audit rows.

  3 nits skipped.

### Test results
- Backend: **87 passed**, 0 failed.
- Frontend: `npm run build` OK.
- Live lab: all 6 scenarios behave as documented.

### Final evaluation (seed 9091; 4,665 sessions; 367 takeovers)
- **SecureSynth:**
  - P 0.601, R 0.913, F1 0.725, FPR 5.2%;
  - block R 0.619 at FPR 0.81%;
  - travellers restricted 16.7%, new-device sessions restricted 8.7%;
  - ₹2.96 cr of ₹3.10 cr prevented, ₹57 lakh legitimate value delayed;
  - p95 latency 5.6 ms.
- **Static rules:** P 0.186, R 0.766, FPR 28.6%, travellers restricted 98.6%, ₹2.98 cr prevented, ₹2.89 cr legitimate value delayed.
- **Weakness:** familiar-device hijack (family C) recall 0.59.

### Open
- Ghost Banking still not started (mentor approval).
- Skipped nits:
  - rejected_count inflation;
  - verified-payee learning;
  - admin list filtering after LIMIT.
- "Suspicious after login" margin is thin (79.5 vs 77.7).
- Bundle-size warning.
- Still to do: README with licences, threat-model doc, slides, fallback video.
