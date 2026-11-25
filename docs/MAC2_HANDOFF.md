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

**Master Prompt #05:** Phases 1 (logo), 2 (documentation and report) and 3 (presentation) are done on Mac 2; see §12. Phase 4 (freeze) remains (§9).

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

## 12. Mac 2 session log (2026-11-25)

### Environment on Mac 2 (verified)
- Branch `feat/frontend-renaissance`, clean, matching `origin` at `4cf178b` before this work.
- Frozen artifacts were copied from Mac 1 by hand: `model.joblib`, `frozen_manifest.json`, `eval_report.json`. The manifest check reports 6/6 OK, and `model_version` is `iforest-v1-956f432a`.
- **`make setup` was not run, because it calls `make train` and would overwrite the frozen model.** Run these instead:
  1. `python3.12 -m venv .venv`, then `pip install -r backend/requirements.txt`;
  2. `npm ci`;
  3. `make env`;
  4. `make seed`.
- Toolchain: Python 3.12.7 (Anaconda; Mac 1 used 3.12.16) and Node 22.23 (Mac 1 used 24). With these, `make test` passes 89 tests and the build passes.
- macOS **Reduce motion is ON** on this Mac (`com.apple.universalaccess reduceMotion = 1`). Pages run in their reduced-motion paths here.
- **Dev servers:** the desktop app's preview runner cannot read `~/Desktop` (macOS privacy), so `preview_start` fails with `getcwd: Operation not permitted`. Run `make dev-backend` and `make dev-frontend` from a terminal, then attach the browser pane with the `frontend-attach` launch configuration.

### Phase 1: Synth Core logo (done)

| Part | What it is |
|---|---|
| **Geometry** (`frontend/src/brand/geometry.ts`) | One source for every variant: two 250° ribbon arcs (r 13 in a 64-unit box) forming an S, plus a heater shield at the centre. |
| **Nav mark** (`brand/SynthMark.tsx`) | SVG, no WebGL. Light and dark tones. Glass ribbons (dark lensing edge, bright caustic) are masked out around a blue-white shield. Fine detail drops out below 24 px. |
| **Hero** (`brand/SynthCore.tsx` + lazy `brand/SynthCoreScene.tsx`, 2.35 KB gzip) | R3F optical-glass ribbons (transmission, IOR 1.5, dispersion) dip behind an extruded, luminous shield. Reuses the orb's procedural studio environment. |
| **Brand sheet** (`/brand`, public) | The hero, light and dark statics, and nav sizes. Query parameters: `?still=1`, `&metal=1`, `&hq=1`, `?gl=0`. |
| **Exports** (`frontend/public/brand/`) | `synth-core-{light,dark}.svg`, `synth-core-{light,dark}-1024.png` and `synth-core-light-256.png` (transparent), `synth-core-hero-2048.png` and `synth-core-hero-silver-2048.png` (high-res stills). In `frontend/public/`: `favicon.svg`, `favicon-32.png`, `apple-touch-icon.png`. |
| **Replaced** | `BrandMark` (`layouts.tsx`, now a wrapper around `SynthMark`) and the inline SVG marks in `Landing.tsx` and `Intelligence.tsx`. The behavioural orb (landing hero, Intelligence, Judge Mode) is unchanged. |

**Hero behaviour:**
- The shield turns once every 10 s with a restrained float.
- Damped pointer tilt.
- Hover or keyboard focus moves the ribbons from glass to polished silver: transmission falls from 1 to 0.03, metalness rises from 0 to 1 (damped, λ 3.2).
- Adaptive pixel ratio: at most 1.75 and at most 1100 device pixels across.
- Pauses when offscreen (IntersectionObserver) or when the tab is hidden.
- Reduced motion: no motion, renders on demand, hover change is instant.
- The SVG fallback stays until the first WebGL frame, then crossfades.

**FPS (measured, not estimated):**
- Measured in headless Google Chrome on Apple M1 (ANGLE Metal) via CDP, reading `data-fps` in one-second windows.
- Reduced motion was emulated off for the measurement.

| Viewport | Canvas | FPS |
|---|---|---|
| 1440×900 @2x | 980² | 60 |
| 1440×900 @2x, silver state | 980² | 59–60 |
| 390×844 @3x | 612² | 60 |
| 1920×1080 @2x, full-screen still | 1100² | 60 |

- Before the pixel-ratio cap, the full-screen 1920×1080 case rendered a 1890² canvas at 37–40 FPS. That is why the cap exists.
- First-second windows (shader compile) read 57–58.
- Not measured: projectors, Intel or other GPUs, and Safari.

**Other checks:**
- `?gl=0`: 0 canvases, three.js and the scene never fetched, no off-host requests.
- The landing orb is still WebGL and the landing page does not fetch the logo scene.
- 375 px brand sheet renders cleanly.
- `tsc -b` and the build pass; `make test` 89 passed; manifest OK.

**Two rendering fixes found along the way:**
- **Tone mapping.** R3F's `onCreated` tone-mapping assignment was unreliable for this scene, so the logo now sets `toneMapping` in the `gl` props. Shield colours were tuned toward cyan so the blue-white does not read as lavender under Neutral tone mapping.
- **Reduced-motion redraw.** `StudioEnvironment` (shared with the orb) now calls `invalidate()` once its environment map exists. Without this, on-demand (reduced-motion) scenes could keep a first frame drawn without reflections. This is a render-only change; the orb's behaviour is otherwise untouched.

**Screenshots:** `docs/screenshots/brand/` (brand sheet at desktop and mobile; landing with the new mark).

### Phase 3 input received
- The user supplied the official reference deck: `~/Downloads/Avishkar26_Design_F_Subtle_Domain.pptx`. Its SHA-256 at receipt was `5a357159…5db43a`.
- **Keep the original unchanged. Never commit it.** Save the populated deck separately.
- **Requirements:** keep all 7 slides and their order, the institutional branding, AVISHKAR logo, header and footer, the black-and-red theme, slide numbering, section headings and slide dimensions.
- **Slide content:**
  1. Project and team.
  2. Problem.
  3. Approach and innovation.
  4. Architecture and stack, with an editable diagram.
  5. Implementation, with real screenshots.
  6. Results, with exact frozen metrics.
  7. Impact and next steps.
- **Also deliver:** a PDF backup, speaker notes for four members, a timed demo walkthrough, and judge Q&A.

### Ghost Banking status (read-only audit)
- **Not implemented.** The flag defaults to off (`config.py`) and `.env` sets it false.
- `GET /admin/ghost/{id}` returns 404: `FEATURE_DISABLED` by default, or "not implemented yet" even if the flag is on.
- The `ghost` session mode exists in the schema only.
- `GhostPage` is a UI shell, hidden while the flag is off.
- There is no `app/ghost` module and no ghost DB.

### Phase 2: documentation and technical report (done)

**New documents:**

| Document | Contents |
|---|---|
| `docs/API.md` | Generated from the live OpenAPI schema (28 paths) and reconciled with the contract |
| `docs/KNOWN_LIMITATIONS.md` | Every known limitation in one place |
| `docs/SUBMISSION_CHECKLIST.md` | Pre-submission and on-the-day checks |
| `docs/report/PROJECT_REPORT.md`, `.docx` (native Word, 14 tables, 9 images) and `.pdf` (14 A4 pages) | Full technical report |

**Report figures** (`docs/report/figures/`):
- Four charts, generated by `docs/report/tools/charts.py` **directly from `eval_report.json`**.
- An architecture diagram, from `tools/architecture.html`.
- The report also uses real product screenshots.

**Rebuild:** use a scratch environment with `markdown`, `python-docx`, `matplotlib` and `pypdfium2`. These are not product dependencies.
1. Run `tools/charts.py`.
2. Run `tools/build_report.py`.
3. Print the HTML to PDF with headless Chrome (`Page.printToPDF`).

**Updated documents:** README, ARCHITECTURE, EVALUATION, DEMO, RESOURCES, TEAM and `api-contract.md`.
- README: product screens, logo, the retraining warning, test count 89, links to the new documents.
- ARCHITECTURE: a frontend architecture section.
- `api-contract.md`: v1.2.0, and the stale endpoint marked.

**Discrepancies found and corrected:**
- **Latency:** `EVALUATION.md` quoted p50 5.46 / p95 5.59 ms. The frozen report says 5.48 / 5.61 ms; latency is the only non-deterministic metric, so it changed between runs. Docs now quote the artifact.
- **Contract version:** `api-contract.md` was headed v1.1.0, but `types.ts` is at v1.2.0. The backend's OpenAPI `info.version` still says 1.1.0; this is backend code and was left untouched.
- **Missing endpoint:** `GET /lab/demo-credentials/{username}` was documented but never implemented.
- **Test count:** README and DEMO said 87 tests; it is 89.

**Every report figure was checked against the paise values in `eval_report.json`.** The report keeps these distinctions explicit:
- synthetic evaluation versus real-world validation;
- the risk index is not a probability;
- static rules prevent slightly more money in total;
- SecureSynth blocks more legitimate value outright;
- family C recall is 58.6%;
- block FPR drifted to 0.81%.

**Team, mentor and institution details are marked TBD**, not invented.

### Phase 3: competition presentation (done)

**Base:** the official template `~/Downloads/Avishkar26_Design_F_Subtle_Domain.pptx`.
- It was **never modified**: its SHA-256 is still `5a357159…5db43a`. The build asserts it never overwrites it.
- All 7 slides, their order, the branding, AVISHKAR logo, header, footer, black-and-red theme, `0N / 07` numbering, section headings and 13.33×7.5 in size are preserved.
- Content is added inside the template's panels.

**Deliverables:** in `submission/`, which is **gitignored** because it contains the official template.

| File | What it is |
|---|---|
| `SecureSynth_AVISHKAR26_Presentation.pptx` | Editable deck with embedded speaker notes for 4 speakers |
| `SecureSynth_AVISHKAR26_Presentation.pdf` | Backup: 7 pages from 2400 px Quick Look renders |

**Built by:** `docs/presentation/tools/build_deck.py` (`python-pptx`).
- Every metric is read from the frozen `eval_report.json`, rounded half-up.
- **Editable content:**
  - a native architecture diagram (shapes);
  - a native data-flow chevron row;
  - a native clustered column chart;
  - real screenshots.
- Added text uses Arial for reliable fit. The template's own text stays in Poppins, which this Mac does not have.

**Screenshots** (`docs/screenshots/presentation/`, fresh from the running product with the new logo):

| Screenshot | What it shows |
|---|---|
| Command Centre | Ravi BLOCK 99.5 |
| Judge Mode takeover | Blocked 99.1, ₹96,200 unchanged; 403 on payee add and transfer |
| Trusted device | A real pending payee step-up with number matching |

They were captured with headless Chrome after a scripted sign-in of the synthetic `analyst` and `asha` through the local API. Credentials were read locally and never printed, and the temporary cookie and device-key files were deleted.
- Side effect: extra lab sessions and one pending (now expired) payee challenge for asha.
- **Reset the demo before presenting.**
- **Security check seen during capture:** Judge Mode correctly refused a run when the injected CSRF cookie was not readable by the page ("Missing or invalid CSRF token").

**Documents:**
- `docs/presentation/SPEAKER_NOTES.md`: 10-minute running order for speakers A–D, the live-demo walkthrough with fallbacks, a rehearsal checklist.
- `docs/presentation/JUDGE_QA.md`: questions and answers on the problem, ML, evaluation and money, backend and security, frontend and demo, and team.

**QA:**
- The skill's `validate.py --original` reports **All validations PASSED**.
- No leftover stock placeholder text.
- Every slide was rendered and inspected. Fixed: wrapped members line, chevron wrap, crowded captions, tech-stack wrap, chart number format and rounding (96.3%).

**Rendering limits** (honest):
- There is no LibreOffice. The Homebrew install was refused by the permission classifier.
- PowerPoint export via AppleScript is blocked by two **"Grant File Access"** sandbox dialogs that the user must answer.
- QA therefore used **macOS Quick Look**. Its chart renderer ignores some properties: it shows a white chart frame and labels without "%". The XML is correct (no chart-area line, white labels, `0.0"%"` format).

**TEAM / user actions before submission:**
1. **Team names:** replace `[Member 2–4]` on slide 1 and in the notes.
2. **Vector PDF:** in PowerPoint, answer the Grant File Access prompts, then *File → Export → PDF*. This replaces the raster backup.
3. **Poppins:** confirm the font is installed on the presentation machine, or accept PowerPoint's substitute. The template's look depends on it.
4. **Time limit:** confirm the official limit; the script assumes 10 minutes plus Q&A.
5. **Pending check:** one earlier headless Judge Mode capture stayed on "Running against the API". It could not be reproduced: three runs at 1× and 2× completed in about 11 s. Re-check in Phase 4.
