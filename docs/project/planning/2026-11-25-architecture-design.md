# SecureSynth — Architecture & Engineering Design

Team The_Terminators · Team ID AV26-50F33FD4DE · AVISHKAR'26 · Problem #24
Status: **APPROVED 2026-11-25 with the amendments below (they override any conflicting text in this document).**

## Approved amendments (binding)

| # | Amendment | Where it lands |
|---|---|---|
| A1 | Server-issued device cookies are a **behavioural recognition signal**, not proof of device identity. Feature name is `device_recognised`; UI and docs never say "verified device" for it. | §1 #2, §7 features, §8 policy, README limitations |
| A2 | Trusted-device verification uses a **separate enrolled credential** (`trusted_device_key`, distinct from password/TOTP/session cookie) in its own auth context (`/api/device/*` authenticates only with the device credential, never the banking session cookie). Challenges are **single-use, expire in 120 s, and bound to `session_id` + `operation` (`login`/`beneficiary_add`/`transfer`) + `operation_hash`** (SHA-256 of the canonical pending operation). A banking session cannot approve its own challenge (test-enforced). | §6 device endpoints, §8, §14 |
| A3 | **No temporal leakage.** Every feature uses only events with `ts < assessment_ts`. Feature scaling, IF fit → train partition; `ml_index` calibration, `W_ml`, thresholds → validation partition; test partition read only by `make eval`, never for tuning (test asserts tuning code has no test-split access). | §7 |
| A4 | Lab endpoints: mounted **only** when `DEMO_MODE=true`; require admin role; reject non-loopback clients; validate `Origin` against the configured frontend origin; require `X-CSRF-Token` matching the session's CSRF token (double-submit) on every state-changing request. The CSRF + Origin check applies to all cookie-authenticated mutating routes, not just Lab. | §4, §6, §14 |
| A5 | **Continuous risk is mandatory**: scenario "legitimate login → suspicious activity" (login ALLOW, then rapid profile/beneficiary/transfer sequence → STEP-UP/BLOCK and backend restriction) is a P0 demo beat and an acceptance test. | §8, §14, §15 |
| A6 | **Ghost Banking disabled by default** (`GHOST_BANKING_ENABLED=false`) until mentor approval. BLOCK ⇒ `restricted` mode. Ghost module, separate ledger, labelled simulation and isolation tests are still built and tested with the flag on in tests. | §8, §9 |
| A7 | Independent verification does **not** auto-promote everything observed. Only the specific attribute bound to the verified challenge (that device / that city as a time-boxed travel window / that beneficiary) becomes a candidate; promotion still needs clean-session count + elapsed time; other novelties in the same session stay unpromoted. | §10 |
| A8 | Evaluation compares all three approaches on **identical held-out sessions** with **one shared outcome function** (`outcome(decision, scenario) → {completed, pending, restricted}` assuming the attacker fails independent verification and the legitimate user passes it). Detection metrics (precision/recall/F1/FPR) are reported separately from prevention metrics (value prevented, legitimate value delayed). | §7 |
| A9 | Reset, security tests, genuine ML evaluation and demo reliability are non-negotiable — never cut. | §16 |
| A10 | API contract frozen in `docs/architecture/API_CONTRACT.md` + `frontend/src/api/types.ts` before parallel work; backend Pydantic models must match; once the backend runs, `make types` regenerates OpenAPI types to diff against. | §6, §12 |

Legend: **[Team]** = decided in Master Prompt #01. **[Call]** = architect's call, open to correction.

---

## 1. Critical review of the proposed product

What is strong and should stay:
- Thesis "credentials ≠ customer" maps directly to the problem's *Current Challenges* line.
- Shared Isolation Forest over **personalised deviation features** is the right call: one model, enough data, and personalisation lives in the features.
- Trusted/candidate baselines (poison-resistant learning) is the genuine technical differentiator — it answers the problem's "baselines must adapt to travel and new devices" without opening a poisoning hole. Make this the second headline after the ATO block.
- Three-way evaluation (password+TOTP / static rules / SecureSynth) on identical held-out data is what Round 3 "measurable results" rewards.

Weak assumptions and fixes:

| # | Issue | Fix |
|---|---|---|
| 1 | **Three separate UIs** for two devs in ~20 h. | **[Call]** One Vite/React app, four route groups (`/bank`, `/device`, `/soc`, `/lab`) sharing one token set and component kit. |
| 2 | **Location/device realism.** A browser on one laptop cannot genuinely be in Dubai. If the server trusts client-sent geo, the "detection" is theatre and a spoofing hole. | Device = **server-issued random device cookie** (non-invasive, not fingerprinting). Location = synthetic IP→city table resolved **server-side**. Scenario context injection (`X-Sim-Context`) accepted **only** when `DEMO_MODE=true`, from 127.0.0.1, and only for Lab-driven sessions. Documented as a simulation limitation. |
| 3 | **Customer-facing reasons are an attacker oracle.** Detailed reasons/counterfactuals let an attacker tune their behaviour. | Customer sees category-level text ("new device and location") + next step. Scores, deviations, counterfactuals: **admin only** (backend-enforced). |
| 4 | **Lab endpoints are a backdoor** (reset DB, move clock, inject context). | Lab router mounted only when `DEMO_MODE=true`, requires admin role, server bound to 127.0.0.1. Test asserts router absent when flag off. |
| 5 | **Circular evaluation.** We generate the attacks *and* the features, so metrics can be self-fulfilling. | (a) chronological splits; (b) labels in a separate table never read by inference code (enforced by test); (c) **one attack family held out entirely from tuning** and reported separately; (d) honest limitations section. |
| 6 | **Step-up via TOTP is meaningless** — the attacker already relayed the OTP. | Step-up = **simulated trusted-device approval with number matching** (separately enrolled device key, shown on `/device`). Explicitly labelled simulated. Also defeats MFA-fatigue. |
| 7 | **Time is not controllable** — travel, baseline promotion windows and velocity need days to pass. | Central `clock` service with a simulated "now" (Lab can advance it). All engine code reads the clock, never `datetime.now()`. Makes demos deterministic. |
| 8 | **Value-prevented inflation.** | Transaction statuses: `attempted`, `pending_verification`, `restricted`, `completed`, `simulated` (ghost). Prevented value = attack transfers that ended non-completed. Legit blocked value reported separately as *legitimate value delayed*. Reported under two stated assumptions (block-only; block + failed step-up). |
| 9 | **Stack weight.** | Drop Streamlit and Pandas from runtime (Pandas only in data generation/eval scripts). Add TanStack Query (loading/error states for free) and `openapi-typescript` (types generated from FastAPI — kills contract drift). Python 3.12 via Homebrew as the team prefers; 3.14 is the fallback if the install fails. |

### Rule-book conflicts (explicit)

| Feature | Rule | Risk | Mitigation |
|---|---|---|---|
| **Ghost Banking** | §12 "Do not build or demonstrate anything intended to deceive"; §7.2.3 no harmful tools | **Medium.** Defensive deception (honeypots) is standard practice, but a literal reading of §12 could object to showing an attacker a fake ledger. | (1) `GHOST_BANKING_ENABLED` flag; (2) `GHOST_DISCLOSURE_BANNER=true` by default — the contained session shows a visible "Protected session · simulated environment" label, so it is **containment, not deception**; (3) synthetic data only, local only; (4) **ask a mentor in the first mentor slot** and record the answer. If they object, disable it — the BLOCK + quarantine path still holds the demo. |
| "Fraud Constellation" graph | none | Low | P2 only. |
| Behaviour features | §7.2.4/§12 no real personal data, no surveillance | Low | No keystroke/mouse biometrics, no browser fingerprinting, no real geolocation. All identities synthetic. |
| Claims | §7.2.8 / §12 | — | Never claim calibrated fraud probability, production readiness, RBI compliance or bank partnership. Risk index is a *rarity percentile*, not a probability. |
| Committing `docs/*.pdf|*.jpg` | competition material | — | Add to `.gitignore`; never commit. |

---

## 2. Requirement → feature mapping

| Source requirement | SecureSynth feature | Proof in demo/tests |
|---|---|---|
| PS 5.1 password + TOTP login | Argon2 passwords, PyOTP TOTP with replay guard, real authenticator app enrolment via QR | Judge logs in with phone authenticator; `test_totp_replay_rejected` |
| PS 5.2 per-user baselines from synthetic logins/devices/transactions | Behavioural Digital Twin (trusted baseline JSON per user, built from 90 days synthetic history) | SOC baseline page; persona contrast (night-shift worker vs retiree) |
| PS 5.3 takeover risk score + anomaly flags | Isolation Forest on deviation features + transparent policy points → 0–100 risk index | SOC session view; evaluation page |
| PS 5.4 step-up/block with reasons | ALLOW / STEP-UP / BLOCK, backend-enforced, reasons at two disclosure levels | Lab scenarios; `test_block_revokes_sensitive_ops` |
| PS 6 flow login→OTP→risk→decision, explainable, live UI/API | Full portal + SOC + OpenAPI | Live demo |
| PS 4 "static rules annoy users; baselines adapt to travel/new devices" | Static-rules comparison; trusted/candidate baseline with travel windows | Traveller restriction rate metric; trust-recovery scenario |
| RB 7.2.5 real, evaluated AI with dataset/model/metrics/limitations | Chronological split, validation-chosen thresholds, held-out test, held-out attack family, `EVALUATION.md` generated by script | `make eval` reproduces numbers |
| RB 2.2 threat model | `docs/architecture/THREAT_MODEL.md` (§4 below) | Slide + Q&A |
| RB 2.2 secure handling | Argon2, sessions, RBAC, validation, rate limits, audit | Security tests |
| RB 7.2.6/7 no real data | Fully synthetic generator, fake names, `SYN-` account refs | README statement |
| RB 6.2.3 licences | `README.md` resources table | Submission |
| RB 7.2.10 protect user data / prevent misuse | Disclosure levels, Lab gating, no secrets in logs, ghost isolation | Security review |
| RB 10 submission | README, runnable `make demo`, slides, 2-min fallback video | Hour 17–19 |

---

## 3. Simplest reliable architecture

```
┌──────────────── Browser (Vite React, :5173) ─────────────────┐
│ /bank (customer)   /device (trusted-device sim)              │
│ /soc  (analyst)    /lab   (scenario lab, DEMO_MODE only)     │
└───────────────┬──────────────────────────────────────────────┘
                │ same-origin via Vite proxy /api → :8000, HttpOnly cookies
┌───────────────▼──────────── FastAPI (:8000, 127.0.0.1) ─────────────────────┐
│ routers: auth · bank · device · admin · lab · eval                           │
│ deps:    current_session → mode dispatch (normal | step_up | restricted | ghost)
│ services: ledger · risk_engine · features · baseline · ghost · clock · audit │
│ ml: model.joblib (IsolationForest + calibration tables), loaded at startup   │
└──────┬───────────────────────────────┬───────────────────────┬──────────────┘
  securesynth.db (protected)      ghost.db (separate engine)   artifacts/ (model, eval report)
```

- Single process, synchronous SQLAlchemy 2.0, SQLite in WAL mode. No Redis/Docker/queues. **[Team]**
- Continuous trust = re-scoring at **checkpoints** (post-TOTP login, beneficiary add, transfer, profile change) plus a cheap per-request session-behaviour update. No background workers needed.
- Lab runner drives scenarios through the **real HTTP API** in-process (`httpx.ASGITransport`), so every scenario exercises auth, risk, enforcement and the ledger — nothing is mocked.
- Reset = copy a pristine `seed.db` snapshot over `securesynth.db`, wipe `ghost.db`, reset clock. Sub-second and deterministic.
- Model artefact is regenerated deterministically by `make train` (fixed seeds); not committed.

---

## 4. Threat model & trust boundaries

**Protected assets:** customer ledger balances; beneficiary list; trusted baseline (it is a security control — poisoning it is an attack); session tokens; TOTP seeds and trusted-device keys; audit log integrity.

**Attacker capabilities (in scope):** knows password (phishing/stuffing/leak); has a valid TOTP at login time (real-time phishing relay or SIM-swap-assisted reset); can use a new device, VPN/new city, or a proxy near the victim; acts fast (add beneficiary → drain); may try slow, low-value activity to make the baseline accept them (poisoning); may hijack a session after a legitimate login.

**Assumptions:** the attacker does **not** control the separately enrolled trusted device; the server and database are not compromised; TLS would terminate in front in production (out of scope locally).

**Trust boundaries:**
1. Browser ↔ API — everything from the client is untrusted, validated by Pydantic; authorization in FastAPI dependencies, never the UI.
2. Customer ↔ admin roles — separate role column and router-level dependency.
3. Protected domain ↔ ghost domain — separate DB file, engine and service module; the ghost module cannot import the protected ledger (test-enforced).
4. Inference ↔ labels — inference code cannot read `scenario_labels` (test-enforced).
5. Demo controls ↔ product — Lab gated by `DEMO_MODE` + admin + localhost.

**Defences:** Argon2id; TOTP ±1 step with per-user last-used-step replay block; rate limiting per username and per IP with progressive lockout; opaque random session tokens (stored hashed), rotated after TOTP (no fixation), idle and absolute expiry, revocation; HttpOnly + SameSite=Strict cookies; JSON-only API (CSRF mitigation with same-site cookies); atomic ledger transactions with integer paise and idempotency keys; audit log with an explicit allow-list of fields (never passwords, OTPs, seeds, tokens); TOTP seeds encrypted at rest with Fernet (key from `.env`).

**Out of scope:** malware on the victim's device, server compromise, insider DB access, real network/geo intelligence, ML adversarial robustness beyond the poisoning defence.

---

## 5. Database schema (SQLite)

`securesynth.db` (protected):

```
users(id PK, username UNIQUE, display_name, role CHECK in('customer','admin'),
      password_hash, totp_secret_enc, totp_last_step INT, trusted_device_key_hash,
      persona, home_city, status CHECK in('active','locked'), created_at)
devices(id PK, user_id FK, token_hash UNIQUE, label, first_seen, last_seen,
        trust CHECK in('trusted','candidate','revoked'))
sessions(id PK, token_hash UNIQUE, user_id FK, device_id FK, ip, city,
         mode CHECK in('pre_otp','normal','step_up','restricted','ghost','revoked'),
         risk_current REAL, created_at, last_seen, expires_at, is_lab BOOL)
login_attempts(id PK, username, ip, stage CHECK in('password','totp'), success, reason, ts)
accounts(id PK, user_id FK UNIQUE, account_ref, balance_paise INT CHECK >= 0)
beneficiaries(id PK, user_id FK, name, account_ref, created_at,
              trust CHECK in('trusted','candidate','blocked'))
transactions(id PK, account_id FK, beneficiary_id FK NULL, amount_paise INT CHECK > 0,
             direction, status CHECK in('attempted','pending_verification','restricted','completed'),
             session_id FK, assessment_id FK, idempotency_key UNIQUE, created_at)
risk_assessments(id PK, session_id FK, user_id FK,
                 checkpoint CHECK in('login','beneficiary_add','transfer','profile_change'),
                 features_json, deviations_json, ml_raw REAL, ml_index REAL,
                 policy_json, risk_score REAL, decision CHECK in('ALLOW','STEP_UP','BLOCK'),
                 model_version, latency_ms REAL, ts)
challenges(id PK, session_id FK, assessment_id FK, kind='trusted_device', number_match INT,
           status CHECK in('pending','approved','denied','expired'), expires_at)
baselines(user_id PK, version INT, trusted_json, candidate_json, updated_at)
baseline_versions(id PK, user_id, version, diff_json, reason, source_assessment_id,
                  ts, rolled_back BOOL)
audit_events(id PK, ts, actor, user_id, session_id, event_type, details_json)
history_events(id PK, user_id, session_ref, ts, event_type, device_ref, city,
               amount_paise, beneficiary_ref, seconds_since_login)   -- synthetic training history
scenario_labels(session_ref PK, label CHECK in('legit','ato'), attack_family, split)  -- eval only
```

`ghost.db` (separate engine, separate file): `ghost_sessions`, `ghost_accounts`, `ghost_beneficiaries`, `ghost_transactions`, `ghost_audit`. It has no foreign keys into the protected DB; it only stores the protected session id as an opaque string for correlation.

---

## 6. API contracts (prefix `/api`, JSON, cookie auth)

Errors use one envelope: `{"error": {"code": "RISK_BLOCKED", "message": "...", "request_id": "..."}}`.

**Auth**
- `POST /auth/login` `{"username":"asha","password":"..."}` → `200 {"stage":"totp_required"}` (sets a pre-OTP cookie) | `401 INVALID_CREDENTIALS` | `429 RATE_LIMITED`
- `POST /auth/totp` `{"code":"492051"}` → runs the login checkpoint →
  `200 {"decision":"ALLOW","session":{"mode":"normal","expires_at":"..."},"user":{"display_name":"Asha R."}}`
  `200 {"decision":"STEP_UP","challenge":{"id":"c_91","number_match":47,"expires_at":"..."},"customer_message":"New device and location. Approve on your registered device."}`
  `200 {"decision":"BLOCK","customer_message":"Sign-in restricted for your protection.","session":{"mode":"ghost|restricted"}}`
- `GET /auth/challenge/{id}` → `{"status":"pending|approved|denied|expired"}` (polled every 1.5 s)
- `POST /auth/logout` → 204
- `GET /auth/enrolment/qr` (seed/demo only) → PNG for authenticator enrolment.

**Trusted device (simulated)**
- `GET /device/pending` (device cookie) → `[{"challenge_id":"c_91","context":"Login · Dubai · new device","options":[12,47,83]}]`
- `POST /device/respond` `{"challenge_id":"c_91","number":47,"approve":true}` → `{"status":"approved"}`

**Banking** (mode-dispatched: ghost sessions hit the ghost DB with identical shapes)
- `GET /bank/overview` → `{"account":{"ref":"SYN-0042","balance_paise":18450000},"recent":[...]}`
- `GET /bank/transactions?limit=50`
- `GET /bank/beneficiaries`
- `POST /bank/beneficiaries` `{"name":"R Kumar","account_ref":"SYN-9911"}` → `201` | `202 {"decision":"STEP_UP","challenge":{...}}` | `403 RISK_BLOCKED`
- `POST /bank/transfers` `{"beneficiary_id":7,"amount_paise":5000000,"idempotency_key":"uuid"}` → `201 {"status":"completed","txn_id":..}` | `202 {"status":"pending_verification","challenge":{...}}` | `403 {"status":"restricted"}`

**Admin / SOC** (role=admin)
- `GET /admin/sessions?decision=BLOCK` → session list with latest risk
- `GET /admin/sessions/{id}` → `{"session":{...},"timeline":[{"ts":..,"checkpoint":"transfer","risk_score":91.2,"decision":"BLOCK"}],"latest":{"ml":{"raw":-0.183,"index":96.4,"meaning":"rarer than 96.4% of legitimate validation events"},"deviations":[{"feature":"travel_speed_kmh","observed":4210,"baseline":"≤ 60","severity":"high"}],"policy":[{"rule":"new_beneficiary_fast_transfer","points":20}],"score":91.2,"decision":"BLOCK","thresholds":{"step_up":38.0,"block":71.5}}}`
- `POST /admin/assessments/{id}/counterfactuals` `{"changes":[{"feature":"device_known","value":1}]}` → `{"hypothetical":true,"original":{"score":91.2,"decision":"BLOCK"},"result":{"score":54.0,"decision":"STEP_UP"}}`
- `POST /admin/sessions/{id}/revoke`
- `GET /admin/users/{id}/baseline` → trusted, candidate, versions
- `POST /admin/users/{id}/baseline/rollback` `{"to_version":3}`
- `GET /admin/ghost/{session_id}` → `{"protected":{"balance_paise":..,"txns":[..]},"ghost":{"balance_paise":..,"txns":[..]}}`
- `GET /admin/evaluation` → contents of `artifacts/eval_report.json`

**Lab** (DEMO_MODE + admin)
- `GET /lab/scenarios` → `[{"id":"ato_relay","title":"Takeover despite password + TOTP","params":{"city":"Dubai","amount_paise":9500000,"device":"new"}}]`
- `POST /lab/scenarios/{id}/run` `{"params":{...}}` → `{"steps":[{"call":"POST /auth/totp","decision":"ALLOW","risk":34.1},...],"session_id":..}`
- `POST /lab/reset` · `POST /lab/clock` `{"advance_hours":72}`

---

## 7. ML: features, training, evaluation

**Synthetic data** (`ml/generate.py`, seed 2026): ~240 customers × 90 days, 7 personas (salaried commuter, student, frequent traveller, small-business owner, retiree, night-shift worker, NRI-linked family sender) with persona-specific hour, city, amount and beneficiary distributions.
- *Legitimate drift:* trips with feasible travel speeds, phone replacement, one-off large legitimate payments (rent deposit, fees), new legitimate beneficiaries.
- *ATO families:* (A) credential + SIM-swap, foreign new device, fast drain; (B) real-time OTP relay from a nearby city, new device, odd hour, fast beneficiary→transfer; (C) mid-session hijack after a legitimate login; (D) low-and-slow mule drip; (E) poisoning attempts.
- **Family D is held out from validation** (appears only in test) to measure generalisation.

**Features — each computed only from history strictly before the event (no leakage):**
`device_known`, `device_age_days`, `hour_rarity` (1 − smoothed p(hour bucket | user)), `city_known`, `log_km_from_home`, `travel_speed_kmh` (since the user's previous session), `amount_robust_z` (log amount vs user median/MAD), `amount_to_balance`, `txn_velocity_ratio` (1 h count / user typical), `beneficiary_new`, `beneficiary_age_min`, `secs_login_to_sensitive`, `sensitive_seq_score` (profile change → beneficiary add → transfer within session), `failed_auth_24h`, `session_action_rate`. Fields that don't apply at a checkpoint get a neutral value.

**Model:** a single shared `IsolationForest(n_estimators=300, random_state=2026)` on deviation features, trained on the **train window (days 1–60), legitimate-labelled events only**. Labels are used only for filtering and evaluation, never as features.
- `ml_index` = empirical percentile of the raw score against the **validation-window legitimate** score distribution (0–100). It means "rarer than X% of legitimate events" — explicitly **not a probability**.

**Splits:** train days 1–60 · validation 61–75 (thresholds and weights) · test 76–90 (touched once, by `make eval`).

**Evaluation (`ml/evaluate.py` → `artifacts/eval_report.json` + `docs/evaluation/EVALUATION.md`), unit = session:**
- Approaches compared:
  1. **Password + TOTP only** — always ALLOW.
  2. **Static rules** — fixed a priori, global, non-personalised: new device → STEP-UP; city ≠ home → STEP-UP; amount > ₹50,000 → STEP-UP; 00:00–05:00 → STEP-UP; new beneficiary + transfer within 10 min → BLOCK.
  3. **SecureSynth.**
- Plus ablations: IF-only and policy-only.
- Metrics:
  - precision, recall, F1 and FPR for "intervention" (STEP-UP or BLOCK) and separately for BLOCK;
  - legitimate-traveller restriction rate;
  - p50/p95 decision latency, measured;
  - simulated unauthorised value prevented, under two stated assumptions;
  - legitimate value delayed.
- Per-attack-family recall, including held-out family D.
- Numbers are whatever the script produces — nothing hand-edited, nothing preselected.

---

## 8. Risk scoring & enforcement

```
score = clip( W_ml · ml_index + Σ policy_points , 0, 100 )
```

**Policy points** (transparent, exact contributions):

| Rule | Points |
|---|---|
| `new_device` | +12 |
| `impossible_travel` (> 900 km/h) | +30 |
| `new_beneficiary_fast_transfer` (< 10 min) | +20 |
| `amount_beyond_user_p99` | +15 |
| `sensitive_sequence` | +15 |
| `recent_auth_failures` | +8 |
| `verified_travel_window` | −15 (only from an independently verified travel window) |

**Hard rule:** `impossible_travel ∧ new_device ∧ sensitive checkpoint` → BLOCK regardless of score.

**Tuning on validation only:** `W_ml` ∈ {0.4 … 0.8} and the thresholds:
- `t_step` = maximise intervention recall subject to legitimate FPR ≤ 5%;
- `t_block` = legitimate block rate ≤ 0.5%.

**Decisions and enforcement (backend):**
- **ALLOW** → proceed. The event becomes eligible for candidate learning.
- **STEP-UP** → the sensitive action becomes `pending_verification` and a challenge is created. Session mode is `step_up`: reads are allowed; beneficiary add and transfer return 202 until the challenge is approved. Approved → the action completes and the session returns to normal. Denied or expired → the action is `restricted` and the session becomes `restricted`.
- **BLOCK** → the protected session is **revoked at once** and sensitive ops return 403.
  - If Ghost Banking is enabled, a new ghost-mode session is issued (see §9).
  - If not, the session is `restricted`: read-only masked overview, no sensitive ops, customer told to verify on their trusted device.
  - "Quarantine" is this enforcement state, not a fourth decision. **[Team]**

**Implementation:** a single FastAPI dependency `require_mode({...})` guards every sensitive route. A test matrix checks route × mode.

**Disclosure:** the customer sees a category message. The analyst sees ML index, deviations (observed vs baseline), policy points, thresholds and the decision, as **separate panels**. Deviations are labelled "observed differences from baseline", **never** as "IF feature importance". Counterfactuals rerun the real engine with edited features and are labelled *Hypothetical*.

---

## 9. Ghost Banking isolation

- **Separate SQLite file and engine** (`ghost.db`), separate SQLAlchemy `Base`, separate `services/ghost.py`.
  - The ghost module may import only `ghost_models`, `clock` and `audit`.
  - A test parses the AST of the `ghost` package and fails if it imports `models`, `ledger` or `baseline`.
- **On BLOCK:** the protected session is revoked and a new opaque token with `mode=ghost` is issued. Ghost data is seeded per session: a synthetic balance that is plausible but different, plus synthetic beneficiaries.
- **Mode dispatch:** the `/bank/*` handlers dispatch on session mode **before** touching any repository. A ghost session never obtains a protected-DB `Session` object.
- **Disclosure banner** on by default (see §1). Ghost actions write `ghost_audit` and are mirrored as protected-side audit events of type `ghost.*` that hold only ids and counts, never ledger writes.
- **The baseline learner rejects any event** whose session mode ∈ {ghost, restricted, step_up-denied}.
- **Isolation tests:**
  1. 50 random ghost transfers, then the SHA-256 of all protected `accounts` and `transactions` rows is unchanged.
  2. Baseline `version` is unchanged.
  3. `users.totp_last_step`, sessions and devices for that user are unchanged.
  4. A ghost token gets 403 on `/admin/*` and can't reach protected rows by id.
  5. The AST import test passes.
  6. With the flag off, BLOCK leads to `restricted`, never `ghost`.
- **SOC side-by-side page:** protected account (unchanged balance) next to the ghost ledger (attacker's simulated drains).

---

## 10. Trusted / candidate baseline update (poison-resistant)

Per user there is a `trusted` baseline (used for scoring) and a `candidate` baseline (observations awaiting trust).

1. **Eligibility.** Only events from sessions whose decision was ALLOW, or STEP-UP followed by **trusted-device approval**, may enter the candidate. Excluded: BLOCK, ghost, restricted, denied or expired step-ups, and any session with a later BLOCK in the same session (applied retroactively at session end).
2. **Categorical novelty (device, city, beneficiary)** enters the candidate with `verified_by` = challenge id, or `null`.
   - A device or beneficiary is promoted to trusted only if it was independently verified, **and** has ≥ 2 further clean ALLOW sessions, **and** ≥ 24 simulated hours have passed.
   - A verified new city creates a **time-boxed travel window** (7 days) rather than permanent trust. The city becomes permanent only after 3 separate verified trips.
3. **Continuous statistics (hour histogram, amount median/MAD, velocity)** are updated by EWMA, α = 0.05, only from ALLOW sessions with score < `t_step`. Per-day movement is capped: median amount ≤ 10%/day, and the hour histogram can shift at most 5% probability mass per day.
4. Every promotion writes `baseline_versions(diff, reason, source_assessment_id)` and an audit event.
5. **Rollback:** an admin can revert to version *k*. **Auto-rollback** happens if a promoted device or beneficiary is later involved in a BLOCK.
6. **Poisoning demo:** an attacker with stolen credentials makes 10 small "normal-looking" sessions from a new device.
   - None of them can promote the device without trusted-device approval.
   - The amount cap prevents gradual drift.
   - The SOC shows "candidate changes rejected: 10" with reasons.

Repeating the original TOTP never counts as independent verification. **[Team]**

---

## 11. Frontend structure

```
frontend/src/
  api/            client.ts (fetch wrapper, error envelope), schema.d.ts (generated), queries.ts (TanStack Query hooks)
  design/         tokens.css (colour/space/type/radius, light+dark), components: Button, Card, Badge, DecisionPill,
                  RiskGauge, Stat, Table, EmptyState, ErrorState, Skeleton, Banner, Dialog, Timeline
  features/bank/  LoginPage, TotpPage, StepUpWaiting, Overview, Transactions, Beneficiaries, TransferForm, RestrictedNotice, GhostBanner
  features/device/ TrustedDevicePage (number matching)
  features/soc/   SocOverview (live session feed, decision mix), SessionInvestigation (timeline, ML/deviation/policy panels,
                  counterfactual drawer, revoke), GhostCompare, BaselinePage (trusted vs candidate, versions, rollback), EvaluationPage
  features/lab/   ScenarioGrid, ScenarioRunner (editable params → step log → "open in SOC"), ResetBar (clock + reset)
  App.tsx         routes + role guards (UX only; the backend enforces)
```

**Design direction:**
- Portal: calm, institutional (warm neutral canvas, one deep accent, serif/sans pairing).
- SOC: dense, dark-capable analyst console with tabular numerals.
- Decision colours are reserved: ALLOW, STEP-UP and BLOCK each have their own colour, always paired with a text label.
- Charts only where they answer a question: score timeline, deviation bars vs baseline, evaluation comparison bars, latency distribution.

The `frontend-design`, `dataviz` and `apple-hig` skills are loaded at the start of frontend work.

---

## 12. File ownership

| Area | Owner |
|---|---|
| `backend/**`, `ml/**`, `backend/tests/**`, `Makefile`, `.env.example` | **Dev B** |
| `frontend/**` | **Dev A** |
| `docs/architecture/API_CONTRACT.md`, `backend/app/schemas.py` | Dev B writes, Dev A reviews; changes announced before merging |
| `frontend/src/api/schema.d.ts` | generated by `make types`, never hand-edited |
| `README.md`, `docs/architecture/THREAT_MODEL.md`, `docs/evaluation/EVALUATION.md` | Dev B drafts, both edit at hour 15+ |
| Slides | Dev A, hour 17+ |

**Branches:**
- `feat/backend-*` and `feat/frontend-*`, short-lived, merged to `main` only at milestones after tests pass.
- Each developer commits under their own git identity. No squashing away authorship, no rewritten history.

---

## 13. Integration milestones (T = hours after approval)

| M | T | Done means |
|---|---|---|
| M0 | +0.75 | Repo scaffolds, `.env.example`, Makefile, FastAPI stubs returning schema-valid fixtures for every endpoint, generated TS types. Frontend unblocked. |
| M1 | +3 | Real auth (Argon2, TOTP, sessions, rate limit), ledger, beneficiaries, transfers. Portal login → overview → transfer working end-to-end. **Merge.** |
| M2 | +6 | Generator, features, IF trained, risk engine at login/beneficiary/transfer, ALLOW/STEP-UP/BLOCK enforced, SOC session view. **MVP merge.** |
| M3 | +9.5 | Trusted-device step-up, continuous checkpoints, baseline trusted/candidate, Ghost Banking + isolation tests, Lab scenarios + reset + clock. **Merge.** |
| M4 | +12 | `make eval` → evaluation page; counterfactuals; full demo script runs twice in a row from reset. **Merge, tag `demo-1`.** |
| M5 | +15 | Full test suite green, `security-review` + `code-review` findings fixed, browser E2E pass. |
| M6 | +17 | UI polish, README/licences, fallback video recorded. Then slides, rehearsal, buffer. |

---

## 14. Automated acceptance tests (pytest; written test-first for critical paths)

- **Auth:** wrong password → 401; 6 failures → 429; valid TOTP → session; **same TOTP reused → rejected**; token rotated after TOTP; expired/revoked token → 401; customer token → 403 on `/admin/*`.
- **Ledger:** transfer is atomic (forced failure mid-way leaves balances unchanged); insufficient funds → 422; duplicate idempotency key → same result, single debit; negative or zero amount → 422.
- **Enforcement matrix:** for each mode × sensitive route, the expected status code.
- **ML hygiene:** feature builder ignores future events (property test); inference package never references `scenario_labels` (AST test); thresholds come from a validation artefact; `make train` is deterministic (same hash twice).
- **Risk:** the same transfer scores differently for two personas (personalisation); counterfactual recompute equals a direct engine call with the edited features.
- **Ghost:** all six isolation tests in §9.
- **Baseline:** a blocked session never changes the trusted baseline; an unverified new device is never promoted; a verified traveller gets a travel window; the poisoning run leaves the trusted version unchanged; rollback restores the exact prior JSON.
- **Lab:** absent when `DEMO_MODE=false`; reset restores the seed hash; every scenario returns its expected decision **range** (asserting ranges, not hardcoded scores).
- **Evaluation:** the report contains all required metrics for all three approaches; the test split is not used during tuning.
- **E2E (browser tools):** login → TOTP → overview; ATO scenario → SOC shows BLOCK → ghost compare; traveller → device approval → allow.

---

## 15. Demonstration strategy (10 min + 2 min Q&A)

| Time | Beat |
|---|---|
| 0:00–0:40 | Hook: "Correct password. Correct OTP. Still not the customer." One-line threat model. |
| 0:40–1:50 | Normal customer: a judge logs in with a phone authenticator → ALLOW, zero friction; SOC shows a low score with reasons. |
| 1:50–3:40 | **ATO despite password + TOTP** (relay attack): login passes with moderate risk; within 40 s a new beneficiary and max transfer → BLOCK → **Ghost Banking side-by-side**: attacker's sandbox drains, the protected balance doesn't move. |
| 3:40–5:10 | **Genuine traveller**, same city as the attacker: STEP-UP → number match on the trusted device → ALLOW → travel window created. Same action, different person, different outcome. |
| 5:10–6:10 | **Poisoning attempt**: ten low-key attacker sessions are rejected from learning; show one rollback. |
| 6:10–7:20 | **Judge's turn in the Lab**: change the amount or city → live recompute; counterfactual panel labelled hypothetical. |
| 7:20–9:00 | **Evaluation**: three approaches on the same held-out data (precision, recall, FPR, traveller friction, latency, value prevented), including held-out attack family D. Limitations stated plainly. |
| 9:00–10:00 | Architecture in one diagram, security controls, future scope. |

**Reliability measures:**
- Lab reset before each run.
- Everything runs locally with no internet needed.
- A second laptop with an identical setup.
- Recorded 2-minute fallback video.
- Pre-enrolled authenticator on two phones.
- Rehearse ≥ 3 times against a timer.

**Q&A prep sheet:** why Isolation Forest, why no per-user models, what the index means, attacker who also owns the trusted device, false-positive cost, scaling.

---

## 16. Limitations & cut list

**Limitations, stated in the README and on a slide:**
- Synthetic data authored by the team; real attacker behaviour is more varied.
- Simulated geography and devices.
- The trusted device is simulated, not a real push channel.
- The risk index is a rarity percentile, not a calibrated probability.
- Rate limits are in memory and reset on restart.
- Single-node SQLite.
- Policy weights tuned on synthetic validation data.
- No fairness audit beyond persona-level FPR comparison (we report FPR per persona).

**Cut order if behind:**
1. Fraud Constellation (P2).
2. Counterfactual UI polish (keep the API plus a simple table).
3. SOC overview charts beyond the decision mix.
4. Gradual EWMA statistics (keep categorical trusted/candidate + travel window + rollback).
5. Ghost Banking reduced to a read-only sandbox, or disabled.

**Never cut:** auth + TOTP, the risk engine, enforcement, the three-way evaluation, isolation and enforcement tests, reset, README licences.

---

## 17. Exact first implementation steps (after approval)

1. **Prerequisites (each developer, their own details):**
   - `git config user.name "<name>"` and `git config user.email "<email>"`
   - `brew install python@3.12` (fallback: Python 3.14)
   - Do all downloads on a hotspot.
2. `.gitignore`: add `.DS_Store`, `*.db`, `*.db-wal`, `*.db-shm`, `artifacts/`, `docs/*.pdf`, `docs/*.jpg`, `frontend/node_modules/`, `.env`.
3. **Dev B:**
   - `python3.12 -m venv .venv`
   - install `fastapi uvicorn[standard] sqlalchemy pydantic pydantic-settings pyotp argon2-cffi cryptography qrcode scikit-learn numpy pandas joblib httpx pytest`
   - `pip freeze > backend/requirements.txt` (exact pins)
   - Write `schemas.py` + stub routers from §6.
   - `make types`.
4. **Dev A:**
   - `npm create vite@latest frontend -- --template react-ts`
   - add `react-router-dom @tanstack/react-query recharts lucide-react tailwindcss @tailwindcss/vite`, plus dev dependency `openapi-typescript`
   - commit the lockfile; proxy `/api` → `:8000`; tokens + component kit; screens against stub responses.
5. **Dev B, test-first:** password hashing, TOTP replay, session rotation and revocation, ledger atomicity — then the generator, features and training.
6. **At M0, both:** run the stub flow end-to-end in the browser, then merge to `main`.
7. **Mentor slot 1:** confirm Ghost Banking framing, code-freeze time and the slide template.

Next process step after approval: turn §13 milestones into a task-level implementation plan (writing-plans), then execute with test-driven development, with subagents in parallel only where file ownership doesn't overlap.
