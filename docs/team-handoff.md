# SecureSynth team handoff (2026-11-25)

## 1. One-time commands — each developer, on their own laptop, with their OWN details
```bash
git config --global user.name "Your Real Name"
git config --global user.email "your-github-email@example.com"
```
```bash
git clone https://github.com/mdhussain398/SecureSynth.git && cd SecureSynth
```
```bash
brew install python@3.12
```
```bash
make setup
```
- `make setup` creates `.venv` and installs `backend/requirements.txt` + `frontend` (npm ci).
- It then trains the model and seeds the demo DB, generating `backend/.env` locally.
- Run it on a hotspot.

Daily:
```bash
make dev-backend
```
```bash
make dev-frontend
```
```bash
make test
```
- Demo credentials for your machine are in `backend/artifacts/demo_credentials.json` (never commit, never paste in chat).
- Scan the `totp_uri` into an authenticator app as a QR code.

## 2. Branch strategy
- `main` = always demo-able. Merge only after `make test` + `npm run build` pass, at milestone checkpoints.
- **Developer B (backend):** `feat/backend-<topic>`.
- **Developer A (frontend):** `feat/frontend-<topic>`.
- Branches are short-lived (≤ 3 h); open a PR to `main`; the other developer skims it.
- **First commit:** the work currently on the Mac goes in as reviewed commits on a branch. Split it by area (backend core, ML, lab, frontend, docs) and commit as the person who did/reviewed it. Then open a PR. No fabricated history and no back-dating.
- Never commit: `backend/.env`, `*.db`, `artifacts/`, `docs/*.pdf|jpg`, `node_modules`.

## 3. Shared contract
`docs/api-contract.md` + `frontend/src/api/types.ts` (v1.1.0).
- Change protocol: agree in chat → update both files + `backend/app/schemas.py` in one PR → bump `CONTRACT_VERSION` → `make types`.

## 4. Developer A prompt (frontend)
> You own `frontend/**` of SecureSynth. Read `docs/superpowers/specs/2026-11-25-securesynth-architecture-design.md` (amendments A1–A10 binding), `docs/api-contract.md`, `frontend/src/api/types.ts` and `docs/progress-log.md`.
>
> Use the `frontend-design`, `dataviz` and `verification-before-completion` skills. Never edit backend code or `types.ts` without the contract protocol.
>
> Tasks in order:
> 1. Signed-in walkthrough against the real backend (`make dev-backend`): customer login → trusted-device approval → bank pages → transfer; analyst → SOC session investigation → what-if → baseline + rollback → evaluation → Lab (run all 6 scenarios, reset, clock). Fix what breaks.
> 2. Lab results: render a "simulated time" step (`http.status === 0`) as a time marker, not an HTTP call.
> 3. Baseline page: show `candidate[]` with status/reason, `rejected_count` as "changes refused", and the travel windows.
> 4. Lazy-load the SOC and Lab routes (bundle warning).
> 5. Check every customer page at 375 px.
> 6. A presenter mode for the demo: protected balance next to the Lab step log.
>
> Report actual results only.

## 5. Developer B prompt (backend / ML / security)
> You own `backend/**`, `Makefile` and the ML pipeline of SecureSynth. Read the spec (A1–A10 binding), the plan in `docs/superpowers/plans/`, `docs/progress-log.md` and `docs/api-contract.md`.
>
> Use the `test-driven-development`, `systematic-debugging` and `verification-before-completion` skills. Write a failing test first for every behaviour change.
>
> Tasks in order:
> 1. **Generator hardening** — decide and write it down BEFORE re-running `make eval`:
>    - hijack via an existing payee;
>    - low-and-slow from a recognised browser;
>    - legitimate fast new-payee transfers;
>    - a legitimate new-device customer adding a payee.
>
>    Then `make train eval`. Never tune on test.
> 2. **Reduce legit friction:**
>    - investigate BLOCK on payee-add right after an approved new-device login;
>    - investigate meera's BLOCK on a fresh browser.
>
>    Use systematic debugging with the per-assessment features/policy from `/admin/sessions/{id}`.
> 3. Beneficiary-candidate promotion (verified payee + clean transfer + 24 h).
> 4. Ghost Banking module behind `GHOST_BANKING_ENABLED` (default false):
>    - separate `ghost.db` engine;
>    - mode dispatch in `/bank/*`;
>    - the six isolation tests in spec §9, including the AST import test.
> 5. `docs/THREAT_MODEL.md`, a README with the licences table, and `docs/EVALUATION.md` generated from `eval_report.json`.
> 6. Run the `security-review` and `code-review` skills, and fix findings.
>
> Report actual test output.

## 6. Estimates from now (two developers, realistic)
| Milestone | Status / ETA |
|---|---|
| Integrated MVP (auth+TOTP, risk engine, enforcement, banking, SOC, lab) | **Backend done and tested; UI built.** Signed-in browser walkthrough + fixes: +1–1.5 h |
| Generator hardening + honest re-evaluation | +1.5 h |
| Ghost Banking (flagged) + isolation tests | +2 h |
| Polish: baseline UI, presenter mode, mobile | +2–3 h (parallel with the above) |
| Security/code review + fixes, README, threat model | +2 h |
| Complete demo, rehearsed twice | ≈ hour 9–10 from now, leaving ~8 h for slides, video, rehearsal and buffer |

## 7. Critical blockers / dependencies
1. **Git identity:** no commits can be made until each developer configures their own.
2. **Mentor decision on Ghost Banking:** the flag stays off until then.
3. **The official slide template, and the confirmed code-freeze time.**
4. **Present synthetic evaluation numbers only after generator hardening.**
