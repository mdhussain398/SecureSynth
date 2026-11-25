# SecureSynth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Working, measured, demo-reliable risk-based authentication + ATO detection prototype.

**Architecture:** One FastAPI process (127.0.0.1:8000) over two SQLite files (`securesynth.db` protected, `ghost.db` isolated), a shared Isolation Forest over personalised deviation features plus additive policy points, and one Vite/React app (`/bank`, `/device`, `/soc`, `/lab`).

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2, Pydantic 2, PyOTP, argon2-cffi, cryptography (Fernet), scikit-learn, NumPy, Pandas (offline scripts only), pytest · React + TS + Vite, Tailwind v4, TanStack Query, Recharts, Lucide.

**Spec:** `docs/superpowers/specs/2026-11-25-securesynth-architecture-design.md` (amendments A1–A10 binding) · Contract: `docs/api-contract.md`, `frontend/src/api/types.ts`.

## Global Constraints
- Money = integer paise; timestamps from `app.services.clock.now()` only — never `datetime.now()` in app code.
- All identities/balances synthetic; account refs prefixed `SYN-`.
- `GHOST_BANKING_ENABLED=false` default; `DEMO_MODE` gates the Lab router entirely.
- No secrets in git: `.env` (gitignored) holds `SECRET_KEY`, `FERNET_KEY`; demo credentials written to `backend/artifacts/demo_credentials.json` (gitignored).
- Customer-facing text never contains scores, thresholds or feature names.
- Inference code (`app/risk`, `app/services`) never reads `scenario_labels`; tuning code never reads `split == "test"`.
- Risk index = rarity percentile, never described as a probability.

## Review Focus
1. Clock skew / duplicate submit: double-clicking Transfer must debit once (idempotency key) — test in Task 3.
2. A session in `step_up`/`restricted` calling sensitive routes directly with curl must get 403 — enforcement matrix test in Task 5.
3. Expired or reused challenge, or a challenge approved for a different operation, must not execute anything — Task 6.
4. User with almost no history (new customer) must not crash feature building (MAD = 0, empty sets) — Task 4 test `test_features_cold_start`.
5. Lab reset while a session is open: old cookies must become invalid (sessions table restored) — Task 8.

---

### Task 1 (B): Backend skeleton, config, DB, clock, errors
**Files:** `backend/app/{__init__,main,config,db,models,errors}.py`, `backend/app/services/{clock,audit}.py`, `backend/tests/conftest.py`, `backend/tests/test_health.py`, `Makefile`, `.env.example`
**Produces:** `Settings` (pydantic-settings: `database_url`, `ghost_database_url`, `secret_key`, `fernet_key`, `demo_mode`, `ghost_banking_enabled`, `allowed_origins`, `session_idle_min=15`, `session_abs_min=60`); `get_db()`; ORM models per spec §5 (+ `challenges.operation`, `challenges.operation_hash`, `challenges.consumed`, `sessions.csrf_hash`, `users.device_key_hash`); `clock.now()/set()/advance(hours)`; `ApiError(code,status,message)` → `ErrorBody`; `audit.log(db, actor, event_type, user_id, session_id, **details)` with a field allow-list.
- [ ] Test: `GET /api/health` → 200 `{"status":"ok"}`; unknown route → JSON ErrorBody 404.
- [ ] Implement; `make test` green.

### Task 2 (B): Security primitives (TDD)
**Files:** `backend/app/security/{passwords,totp,tokens,ratelimit,csrf}.py`, `backend/tests/test_security.py`
**Produces:** `hash_password/verify_password` (argon2id); `totp_verify(secret, code, last_step) -> int|None` (valid_window=1, returns matched step, rejects step ≤ last_step); `encrypt_secret/decrypt_secret` (Fernet); `new_token() -> (raw, sha256)`; `RateLimiter.hit(key) -> bool` (5 failures / 5 min → lock 5 min, sliding, clock-based); `check_origin(request, settings)`, `check_csrf(request, session)`.
- [ ] Tests: wrong password false; TOTP current code ok; **same code twice rejected**; code from 3 steps ago rejected; 6th failure blocked then unblocked after clock advance 6 min; token hash ≠ raw; bad Origin rejected; missing CSRF rejected.

### Task 3 (B): Auth + banking routes, ledger
**Files:** `backend/app/routers/{auth,bank}.py`, `backend/app/services/{sessions,ledger}.py`, `backend/app/schemas.py`, `backend/app/seed.py`, tests `test_auth_flow.py`, `test_ledger.py`
**Produces:** `sessions.current(request, db, allowed_modes)` dependency; `ledger.transfer(db, account_id, beneficiary_id, amount_paise, idempotency_key, status) -> Transaction` inside one `BEGIN IMMEDIATE`; `seed.build(db, n_customers)` creating users, accounts, beneficiaries, devices + demo credentials file.
- [ ] Tests: login → totp → `/auth/me` normal; token rotated after TOTP; pre-OTP cookie can't read `/bank/overview`; customer → `/admin/*` 403; transfer debits once with duplicate idempotency key; insufficient funds 422 + balance unchanged; amount ≤ 0 → 422; logout invalidates token.

### Task 4 (B): Synthetic data + features + model (TDD on hygiene)
**Files:** `backend/ml/{generate,features,train,evaluate}.py`, `backend/app/risk/{features,model,engine,policy,explain}.py`, tests `test_features.py`, `test_ml_hygiene.py`
**Produces:** `generate(seed=2026, n_customers=240, days=90) -> (history_events, sessions, labels)`; `build_features(history_before: list[Event], event: Event, baseline: Baseline) -> dict[str,float]` (feature list spec §7, `device_recognised` per A1); `ModelBundle{iforest, scaler, val_legit_scores, w_ml, t_step, t_block, version}` saved to `backend/artifacts/model.joblib`; `engine.assess(db, session, checkpoint, pending_op) -> Assessment`.
- [ ] Tests: feature for event at t ignores events with ts ≥ t; cold-start user returns finite features; `make train` twice → identical model hash; tuning functions receive no test-split rows; same transfer scores differently for `night_shift` vs `retiree` personas; ml_index ∈ [0,100].

### Task 5 (B): Decisions & enforcement
**Files:** `backend/app/risk/decide.py`, `backend/app/services/enforcement.py`, test `test_enforcement.py`
**Produces:** `decide(score, policy_hits, thresholds) -> Decision` (hard-block rule spec §8); `enforce(db, session, decision, pending_op) -> SensitiveActionResponse`.
- [ ] Tests: route × mode matrix; BLOCK → session `restricted` (ghost disabled) and later transfer 403; **legit login ALLOW then rapid beneficiary-add + large transfer → STEP_UP/BLOCK (A5)**; customer_message has no digits/feature names.

### Task 6 (B): Trusted device step-up
**Files:** `backend/app/routers/device.py`, `backend/app/services/challenges.py`, test `test_challenges.py`
**Produces:** `create_challenge(db, session, operation, operation_payload) -> ChallengeRef` (120 s, operation_hash); `respond(db, device_key, challenge_id, number, approve)`; on approve of transfer/beneficiary → execute exactly the bound payload once.
- [ ] Tests: banking cookie alone → 401 on `/device/*`; wrong number → denied; reuse → CHALLENGE_INVALID; expired (clock +3 min) → invalid; other user's device key → 404; approved transfer executes once with the stored payload.

### Task 7 (B): Baselines (trusted/candidate) + rollback
**Files:** `backend/app/services/baseline.py`, test `test_baseline.py` — algorithm spec §10 + A7.
- [ ] Tests: BLOCK/restricted session never updates; verified city → travel window only; unverified device never promoted; verified device promoted only after 2 clean sessions + 24 h; other novelties in the verified session stay pending; poisoning run (10 low-value sessions new device) leaves trusted version unchanged; rollback restores exact prior JSON.

### Task 8 (B): Admin + Lab routers, reset, counterfactuals
**Files:** `backend/app/routers/{admin,lab}.py`, `backend/app/lab/scenarios.py`, test `test_lab_admin.py`
- [ ] Tests: lab 404 when `DEMO_MODE=false`; non-admin 403; non-loopback 403; reset restores seed hash and invalidates old cookies; each scenario's final decision in expected set; counterfactual equals direct engine call.

### Task 9 (B): Ghost Banking (flag off by default)
**Files:** `backend/app/ghost/{models,service,router}.py`, test `test_ghost_isolation.py` — six isolation tests from spec §9 with flag forced on in test.

### Task 10 (B): Evaluation
**Files:** `backend/ml/evaluate.py` → `backend/artifacts/eval_report.json` + `docs/EVALUATION.md`; shared `outcome()` per A8; three approaches + ablations on identical test sessions.
- [ ] Test: report has all three approaches and every metric key; tuning code never reads test split.

### Frontend tasks (A) — see Developer A prompt; order: client+mocks → portal auth flow → bank pages → device → SOC session investigation → lab → evaluation → baseline → polish.

### Integration checkpoints
M0 contract frozen ✅ · M1 auth+ledger live against real backend · M2 risk engine + SOC session (MVP) · M3 step-up, baselines, lab, ghost(flag) · M4 eval page + 2 clean demo runs · M5 tests/security/code review · M6 polish, README, video.
