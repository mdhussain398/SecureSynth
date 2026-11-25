# Mac 2 handoff — SecureSynth (AVISHKAR'26, problem 24, team The_Terminators)

Read this first on a fresh machine or in a fresh Claude session. It is self-contained.

## 1. Where the code is
- **Repository:** https://github.com/mdhussain398/SecureSynth
- **Branch:** `feat/frontend-renaissance`. Never merge into `main` or `feat/mvp-checkpoint` without the owner's explicit approval. No force-push.
- **Verified checkpoint:** see the latest commit on the branch. At the time of writing, Phase 0 builds on `c5f312d`; the commit that adds this file is the new head.
- **Other branches:**
  - `feat/mvp-checkpoint`: the stable MVP.
  - `main`: untouched.
  - PR #1 (`feat/mvp-checkpoint` → `main`) is open and must not be merged without review.

## 2. Status (2026-11-25)
**Complete and verified:**

| Area | State |
|---|---|
| Backend | FastAPI, SQLite, auth (Argon2id passwords, TOTP with replay protection, rotating sessions, CSRF), risk engine, trusted-device challenges, Scenario Lab |
| ML | Frozen Isolation Forest `iforest-v1-956f432a` |
| Frontend | Renaissance redesign across every page; Judge Mode at `/judge` |
| Backend tests | 89 passed |
| Frontend | `tsc -b` and `npm run build` pass |
| Frozen manifest | 6/6 SHA-256 hashes match |
| Scenarios | All six Lab scenarios checked in the browser |
| Demo data | Reset afterwards |

- **Ghost Banking:** disabled and unimplemented (needs mentor approval).
- **Detailed history:** `docs/FRONTEND_HANDOFF.md` (frontend), `docs/team-handoff.md` (MVP invariants, frozen ML), `docs/progress-log.md`.

**Not done** (Master Prompt #05, phases 1–4): see §9.

## 3. Requirements
- **Python 3.12** (verified 3.12.16). The Makefile calls `python3.12`.
- **Node 24** (verified v24.14.1) with npm.
- macOS. Everything runs offline after setup; setup itself needs network for pip and npm.

## 4. Install and run
Run each command from the repository root.

```bash
git clone https://github.com/mdhussain398/SecureSynth.git
```
```bash
cd SecureSynth && git switch feat/frontend-renaissance
```
```bash
make setup
```
`make setup` does the following:
- creates `.venv`;
- installs `backend/requirements.txt`;
- runs `npm ci` in `frontend/`;
- runs `make env`, which writes `backend/.env` with fresh random secrets;
- runs `make train`, a deterministic synthetic dataset plus the Isolation Forest;
- runs `make seed`, which builds the demo DB, a pristine snapshot and local demo credentials.

Start the two servers in separate terminals:
```bash
make dev-backend
```
```bash
make dev-frontend
```
Open http://localhost:5173. The API listens on 127.0.0.1:8000 and Vite proxies `/api`.

## 5. Local-only files (never committed; Git will not bring them)

| File | Created by | Notes |
|---|---|---|
| `backend/.env` | `make env` | `SS_SECRET_KEY`, `SS_FERNET_KEY`, `SS_DEMO_MODE=true`, `SS_GHOST_BANKING_ENABLED=false` |
| `backend/securesynth.db` | `make seed` | The live demo DB, and its WAL files |
| `backend/seed.db` | `make seed` | The pristine snapshot the Lab reset restores |
| `backend/artifacts/` | `make train` / `make seed` / `make eval` | `model.joblib`, `frozen_manifest.json`, `eval_report.json`, `demo_credentials.json` (mode 600) |
| `docs/*.pdf` and official competition images | — | Restricted; ignored. Copy them by hand if needed. |

- **The frozen model and manifest:** they are produced by `make train` on Mac 1.
  - If Mac 2 retrains, compare the model hash against `iforest-v1-956f432a` before trusting the evaluation figures.
  - The safest route is to copy `backend/artifacts/model.joblib`, `frozen_manifest.json` and `eval_report.json` from Mac 1 (AirDrop or USB).
  - **Do not copy `demo_credentials.json`.** Let `make seed` create fresh credentials on Mac 2.
  - **Never retrain to "improve" results.** `make eval` refuses to run if a frozen file changed.

## 6. Demo accounts and TOTP (synthetic; no secrets in this document)
- `make seed` writes `backend/artifacts/demo_credentials.json`. It holds every synthetic user's ID, password, `totp_uri` and the trusted-device key: customers `asha`, `ravi`, `meera`, `farhan` and others, and the admin `analyst`.
- **Enrol TOTP:** add each `totp_uri` to an authenticator app (scan it as a QR code, or paste the URI). Or print a current code locally:
  ```bash
  .venv/bin/python -c "import json,pyotp;c=json.load(open('backend/artifacts/demo_credentials.json'))['analyst'];print(pyotp.parse_uri(c['totp_uri']).now())"
  ```
- **First sign-in in a new browser:** this triggers a trusted-device step-up.
  1. Open `/device` in another tab.
  2. Pair it with that account's `trusted_device_key`.
  3. Choose the number shown on the sign-in screen.
- Never paste credentials into chat, docs, commits or screenshots.

## 7. Reset and verification
- **Reset demo data:** signed in as `analyst`, open Scenario Lab, click **Reset demo**, then **Confirm reset**. This restores `seed.db`, resets the simulated clock, and keeps your analyst session. Do it before every presentation.
- **Full re-seed:** `make seed`. This rotates the credentials; re-enrol TOTP afterwards.
- **Verification commands:**
  ```bash
  make test
  ```
  ```bash
  cd frontend && npx tsc -b && npm run build
  ```
  ```bash
  .venv/bin/python -c "import json,hashlib,pathlib;m=json.load(open('backend/artifacts/frozen_manifest.json'));f=m.get('files',m);print([k for k,v in f.items() if isinstance(v,str) and len(v)==64 and hashlib.sha256(((pathlib.Path('backend')/k) if (pathlib.Path('backend')/k).exists() else pathlib.Path(k)).read_bytes()).hexdigest()!=v] or 'manifest OK')"
  ```

## 8. The six Scenario Lab scenarios (verified outcomes)

| # | Scenario | Expected | Verified |
|---|---|---|---|
| 1 | Normal customer | ALLOW, no friction | Allowed; asha −₹2,500 |
| 2 | Takeover despite password + TOTP | STEP_UP or BLOCK; balance unchanged | Blocked (99.x), session restricted; ravi ₹96,200 unchanged |
| 3 | Suspicious activity after a legitimate login | Login ALLOW, then STEP_UP/BLOCK and restriction | Step-up; balance unchanged |
| 4 | Genuine traveller | STEP_UP, approved on the trusted device, completes | Step-up, approved, −₹2,500 |
| 5 | Customer on a new device | STEP_UP, approved, then ALLOW | Step-up, approved, −₹2,500 |
| 6 | Unusual but legitimate transfer | Friction grows with the amount | Allowed at the ₹1,50,000 default |

**Judge order:** 1 → 2 → 3 → 4, then the Evaluation page (`docs/DEMO.md`).

## 9. Remaining execution plan (Master Prompt #05)
Work in small phases. After each one: update this file, commit, and push to `feat/frontend-renaissance`.

**Phase 1 — Synth Core logo.** An S-shaped pair of interlocking optical-glass ribbons around a floating, luminous blue-white shield.
- **Scope:** the logo only. Keep the behavioural orb in Intelligence and Judge Mode.
- **Variants:**
  - an R3F hero logo with shield rotation of about 10 s per turn, restrained float, pointer tilt, glass → polished silver on hover, DPR cap, pause when offscreen or hidden, and reduced motion respected;
  - a compact nav mark as SVG, with no WebGL;
  - static SVG, light and dark;
  - transparent PNGs, a favicon and a high-res still;
  - a no-WebGL fallback.
- **Replace** `BrandMark` in `frontend/src/layout/layouts.tsx` and the inline SVGs in `Landing.tsx` and `Intelligence.tsx`.
- **Measure FPS** in a real browser and report it honestly.

**Phase 2 — Documentation** grounded in the code.
- **Files:**

  | | | |
  |---|---|---|
  | README | `PROJECT_REPORT.md` (+ DOCX and PDF) | ARCHITECTURE |
  | EVALUATION | THREAT_MODEL | API (from `api-contract.md` and OpenAPI) |
  | DEMO | RESOURCES | TEAM |
  | KNOWN_LIMITATIONS | both handoffs | SUBMISSION_CHECKLIST |
- **Figures:** read every one from `backend/artifacts/eval_report.json`. Reference values to verify, not copy: recall 91.3% vs static 76.6%; genuine-session restriction 5.2% vs 28.6%; precision 60.1%; F1 72.5%; family C about 59%.
- **Honesty:**
  - Label the evaluation synthetic.
  - Separate detection from block, step-up and money prevented.
  - Static rules prevent slightly more money in total.
  - The risk index is not a probability.
- **Do not invent** team, mentor or institution details; mark them TBD.

**Phase 3 — Presentation.**
- Use the official AVISHKAR'26 template if it can be found. If not, report that and label the deck provisional.
- Produce a `.pptx` and a PDF: 11 slides (narrative in Master Prompt #05), speaker notes for four speakers with editable assignments, real screenshots, and a separate judge Q&A doc.
- Never commit official templates.

**Phase 4 — Freeze.**
- Re-run: tests, build, manifest, six scenarios, Judge Mode, logo FPS, no-WebGL, offline, mobile and reduced motion.
- Reset the demo.
- Build a submission folder.
- Make a two-minute fallback recording, or a storyboard marked pending.
- Run a secrets scan.
- Update both handoffs, then commit and push. **No merge.**

## 10. Known limitations and blockers
- **Evaluation:** synthetic data only. Weak on session hijack from a familiar device (family C, recall about 0.59).
- **Judge Mode full screen:** the button did not engage inside the Claude desktop browser pane. Test it in Chrome or Safari; F11 or the green window button is the fallback.
- **Reduced motion:** checked in code only, not yet with the real OS setting.
- **Bundle size:** the OrbScene chunk is 244 KB gzip, lazy-loaded; Vite prints an advisory about it.
- **Open team items:** real names in `TEAM.md`, the official slides template, the fallback video, rehearsals, PR #1 review, and the mentor decision on Ghost Banking.

## 11. Continuation prompt for a fresh Claude session on Mac 2
> You are continuing SecureSynth (AVISHKAR'26, problem 24) on branch `feat/frontend-renaissance` of https://github.com/mdhussain398/SecureSynth. Read `docs/MAC2_HANDOFF.md`, `docs/FRONTEND_HANDOFF.md` and `docs/team-handoff.md` first, then run the verification in §7 and report the results. Then continue Master Prompt #05 from the first unfinished phase in §9: Synth Core logo, then documentation and report, then presentation, then the final freeze. Rules:
> - Push only to `feat/frontend-renaissance`. Do not merge or force-push.
> - Do not retrain or tune the frozen model, change backend or ML behaviour, or enable Ghost Banking.
> - Never commit `.env`, databases, `backend/artifacts/`, credentials or official competition files.
> - After each phase, update this handoff, commit and push.
> - Report measured results only.
