# SecureSynth handoff — stable checkpoint before the frontend redesign

Updated 2026-11-25 ~18:00 IST. **Read this first after any context reset.** Details live in the linked docs; this file holds the decisions that must not be lost.

## 1. Repository state
- **Repo:** https://github.com/mdhussain398/SecureSynth. Default branch `main` contains only the initial commit.
- **Working branch:** `feat/mvp-checkpoint`.
  - **Stable checkpoint commit `50d88ec`**, pushed. This handoff commit sits on top of it locally and is not pushed.
- **PR:** [#1](https://github.com/mdhussain398/SecureSynth/pull/1) → `main`. Open, mergeable, not reviewed, **do not merge without the team's review.** No CI is configured.
- **Git identity (repo-local, chosen by the user):** `Mohammed Hussain <160685871+mdhussain398@users.noreply.github.com>`.
  - Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Never invent other contributors.
- **History scan:** no secrets, TOTP seeds, databases or competition documents in any commit (checked 2026-11-25).
- **Untracked, gitignored, local only:**
  - `backend/.env` (secrets);
  - `backend/*.db` and `seed.db` (reset snapshot);
  - `backend/artifacts/`: `model.joblib`, `frozen_manifest.json`, `eval_report.json`, `demo_credentials.json` (mode 600), and `model-mvp-*.joblib` (v1 backup);
  - `docs/*.pdf|jpg` (competition documents);
  - `node_modules`.
- **Environment:**
  - Python 3.12.16 (Homebrew) in `.venv`; pinned `backend/requirements.txt`.
  - Node 24, exact-pinned `frontend/package-lock.json`.
  - Port 5000 is taken by macOS AirPlay; we use 8000 (API) and 5173 (UI).

## 2. Run / verify
```bash
make dev-backend
```
```bash
make dev-frontend
```
```bash
make test
```
- `make test` → **89 passed**.
- `cd frontend && npx tsc -b && npm run build` → OK, no warnings.
- Mock UI (no backend): `cd frontend && npm run dev:mock`.
- `make seed` rebuilds the demo DB, the snapshot **and new demo credentials** (re-pair devices, re-scan TOTP afterwards).
- Lab **Reset demo** restores the snapshot and keeps the presenter's admin session.

## 3. What works (verified in tests + real-browser walkthroughs)
- **Auth:**
  - Argon2id passwords.
  - TOTP ±1 step with per-user replay block. TOTP uses **real** time; everything else uses the simulated clock (`services/clock.py`).
  - Hashed opaque session tokens, rotated after TOTP; 15 min idle / 60 min absolute expiry.
  - CSRF double-submit (`X-CSRF-Token` = `ss_csrf` cookie) on every mutation; Origin allow-list; rate limits (in memory).
- **Banking:** overview, statements, payees, transfers. Idempotency key per account; the debit is a single conditional UPDATE; a funds pre-check runs before risk.
- **Risk engine (continuous):** assessed at login, payee add and transfer.
  - Scoring: `score = clip(W·ml_index + Σ policy, 0, 100)`; a hard-block rule; ALLOW / STEP_UP / BLOCK enforced by the backend.
  - Customers see only category-level messages.
- **Trusted-device step-up:**
  - `/device/*` authenticates only with `X-Device-Key` and ignores banking cookies.
  - Number matching; challenges are single-use, last 120 s, and are bound to session + operation + SHA-256 of the payload.
  - Approval executes exactly the bound payload once.
- **Session modes:**
  - pre_otp / normal / step_up / restricted / revoked. (`ghost` exists in the schema only.)
  - A **login** step-up cannot read account data.
  - An expired or denied challenge → restricted.
- **Baseline (poison-resistant):**
  - Scoring reads the trusted profile plus *verified, pending* devices (provisional recognition).
  - Promotion requires: verified on the trusted device **and** ≥ 2 clean sessions **and** ≥ 24 h.
  - Verified travel → a 7-day window, never a permanent city.
  - BLOCK or a denied challenge voids that session's contributions; auto-rollback if a promoted device is later blocked; versioned rollback.
- **Command Centre:**
  - live sessions;
  - investigation with four separate panels (ML index · deviations · exact policy points · decision), what-if marked HYPOTHETICAL, audit trail;
  - baselines + rollback;
  - **Evaluation dashboard** on the real frozen report.
- **Scenario Lab:**
  - Router mounted only when `DEMO_MODE=true`; requires admin + loopback + Origin + CSRF.
  - Simulated city is accepted only with an in-process lab token.
  - 6 scenarios drive the real API. **Deterministic:** 18 runs gave identical decisions, scores and balances.
  - Last verified live results:

    | Scenario | Result |
    |---|---|
    | normal | ALLOW |
    | takeover | BLOCK 99.5, ₹0 moved |
    | suspicious-after-login | ALLOW → STEP_UP 79.5 → 403 |
    | traveller | STEP_UP → approve → ALLOW |
    | new device | STEP_UP → approve → ALLOW |
    | unusual ₹1.5 L | ALLOW 70.2 |

## 4. Invariants — do NOT break during the redesign
1. **Frontend is presentation only.** All authorization and enforcement stay in the backend. No new backend logic for UI convenience without tests.
2. **API contract:** `docs/api-contract.md` + `frontend/src/api/types.ts` (**v1.2.0**) are the source of truth. Change them only additively and in step with `backend/app/schemas.py`, then bump `CONTRACT_VERSION`.
3. **Customer screens never show** scores, thresholds, feature names or counterfactuals.
4. **The risk index is "a rarity percentile, not a probability".** Keep that wording wherever scores appear.
5. **Decision pills always carry text** (never colour only).
6. **"Synthetic" labels stay visible:** footer marker, `SYN-` refs, the evaluation banner.
7. **Mock mode** (`src/api/mock.ts`) must keep compiling against `types.ts` and look clearly synthetic.
8. **Ghost Banking:** not implemented; `GHOST_BANKING_ENABLED=false`; the UI hides the entry point when `/admin/config` says disabled. **Do not build or enable it without explicit mentor approval** (rule-book §12 risk).
9. **Never commit** `.env`, databases, `artifacts/`, credentials or competition documents. Never print demo credentials in chat, docs or screenshots.
10. **Run regression after any change:** `make test`, `tsc -b`, `npm run build`, plus a browser check of the touched screens at 1280 px and 375 px (no horizontal page scroll).

## 5. Frozen ML — do NOT retrain or re-tune
- **Model** `iforest-v1-956f432a`; W_ml 0.8; step-up ≥ 77.73; block ≥ 89.1.
- **Frozen files** (SHA-256 in `backend/artifacts/frozen_manifest.json`): `model.joblib`, `app/risk/{features,policy,model}.py`, `ml/{generate,train}.py`. `make eval` refuses to run if any of them changes.
- **Protocol v2** (`docs/EVALUATION_PROTOCOL.md`): committed before any results.
  - Dev data seed 2026 (train days 0–60, validation 60–75); tuning on validation only.
  - **Final test = fresh seed 9091, scored once.**
  - v1 (100% recall) was withdrawn because its attacks were too easy to separate.
- **Final numbers** (`docs/EVALUATION.md`; 4,665 sessions, 367 takeovers):

  | | Static rules | SecureSynth |
  |---|---|---|
  | Recall | 0.766 | 0.913 |
  | Precision | 0.186 | 0.601 |
  | F1 | 0.299 | 0.725 |
  | Legit sessions restricted (FPR) | 28.6% | 5.2% |
  | Travellers restricted | 98.6% | 16.7% |
  | New-device sessions restricted | 27.8% | 8.7% |
  | Legit sessions blocked | 0.07% | 0.81% |
  | Total attack value prevented | ₹2.98 cr | ₹2.96 cr |
  | …stopped by BLOCK | ₹2.38 cr | ₹2.61 cr |
  | …stopped by challenge | ₹59.9 L | ₹34.8 L |
  | Legit value blocked | ₹0.3 L | ₹25.0 L |
  | Legit value challenged, then completed | ₹2.89 cr | ₹32.0 L |

  - Family C (familiar-device hijack) recall 0.59; held-out family D 0.96.
  - SecureSynth p95 latency 5.6 ms.
- **Messaging rules:**
  - Never claim SecureSynth prevents more total money than static rules.
  - Always label results synthetic.
  - Always mention the family-C limitation.
- **Changing any frozen file requires a new protocol version.** Old results are marked superseded, never deleted.

## 6. Known limitations / open issues
- Synthetic data; simulated geography, trusted device and device recognition (a cookie, not identity).
- In-memory rate limits; single-node SQLite; no TLS locally. Restriction is per session (a new login is re-assessed).
- Verified payees are never learned into the baseline (code-review nit, deliberately left; it would change frozen demo behaviour).
- "Suspicious after login" margin is thin: 79.5 vs a 77.73 step-up threshold. Report it; don't tune to it.
- Today/Yesterday grouping in statements uses the browser clock, not the simulated clock.
- oxlint warnings remaining: two `jsx-key` false positives in EvaluationPage, one Date-in-render, one only-export-components.
- A browser can hold only one signed-in role at a time (shared cookies). The demo switches customer ↔ analyst by signing out.

## 7. Competition requirements & remaining deliverables
AVISHKAR'26, Problem #24. Team The_Terminators, **AV26-50F33FD4DE**, domain AI in Cyber Security & FinTech.

**Judging:** Round 1 = 20, Round 2 = 30, Round 3 Results & Demo = 50. 10 min demo + 2 min Q&A.

**Rules that bite:**
- Build only during the event; commit history is checked.
- List every external resource with its licence (done: `docs/RESOURCES.md`).
- No real data or money.
- No compliance claims.
- The AI component must be real and evaluated, with limitations stated.
- No deception (§12) → Ghost Banking caution.
- Submission at code freeze (template schedule Day 2 11:00 — **confirm with the organisers**).

**Done:**
- README (with mermaid architecture), `docs/ARCHITECTURE.md`, `THREAT_MODEL.md`, `RESOURCES.md`, `EVALUATION*.md`, `DEMO.md` (script, offline checklist, troubleshooting), `api-contract.md`.
- Screenshots in `docs/screenshots/` (`real-*` = real backend).

**Remaining:**
1. Frontend redesign (next phase), within the invariants in §4.
2. `docs/TEAM.md`: the team must add real names and roles.
3. Slides in the official AVISHKAR'26 template (Team ID, name, domain, problem statement).
4. 2-minute fallback demo video.
5. Two timed rehearsals (`docs/DEMO.md`); a backup laptop.
6. Review + merge PR #1 before the freeze; push all later work.
7. A mentor decision on Ghost Banking.

## 8. Key decisions (why things are the way they are)
- **One React app with four route groups** (`/bank`, `/device`, `/soc`, `/lab`), not separate apps.
- **One shared Isolation Forest over personalised deviation features**, not per-user models. Labels are used only for evaluation; inference code can't read `scenario_labels` (AST test).
- **The trusted device is a separate credential, not a repeated TOTP.** Number matching defeats MFA fatigue.
- **A verified device is provisionally recognised for scoring but not trusted until promoted.** This fixed the walkthrough's double-approval friction without weakening poisoning resistance.
- **The seeded history uses the same persona hour/amount spread as the generator.** The narrow seed previously made afternoon logins look extreme.
- **Lab simulates realistic dwell time** (customers ~3–4 min, attackers ~40 s) on the simulated clock. An instant transfer after login looked attacker-like.
- **Lab TOTP** uses the next unused step within ±1 so replay protection holds during back-to-back runs. Default scenario customers differ for the same reason.
- **Presenter's admin session** survives Lab reset and clock advance.
- **Evaluation reporting** splits detection from prevention, and permanent BLOCK from challenge (which only works if the attacker fails verification).
