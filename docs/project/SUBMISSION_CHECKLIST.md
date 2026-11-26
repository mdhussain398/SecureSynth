# Submission checklist — AVISHKAR'26, problem 24

Tick an item only after doing it on the presentation machine. Items marked **TEAM** need a human decision or information we must not invent.

## Code and evidence
- [ ] `feat/frontend-renaissance` is pushed. Not merged into `main` (PR #1 stays under review).
- [x] `make test`: 89 passed (Mac 2, 2026-11-25).
- [x] `cd frontend && npx tsc -b && npm run build`: passes.
- [x] Frozen manifest: 6/6 hashes match, model `iforest-v1-956f432a`. Never run `make train` on a machine whose artifacts came from Mac 1.
- [x] All six Scenario Lab scenarios give the outcomes in `docs/guides/DEMO.md` (real API, Mac 2).
- [ ] Judge Mode: R runs the scenario, Esc exits; full screen works in the presentation browser.
- [x] `/brand` shows the Synth Core logo. `?gl=0` shows the SVG fallback.
- [ ] Offline: turn Wi-Fi off and repeat the demo; no request leaves `localhost`.
- [ ] Demo reset done (Lab → *Reset demo* → *Confirm reset*) right before presenting.
- [x] Secrets scan clean. No `.env`, databases, `backend/artifacts/`, credentials or official competition files are tracked.

## Documents
- [ ] `README.md`, `docs/architecture/ARCHITECTURE.md`, `docs/architecture/API.md`, `docs/evaluation/EVALUATION.md`, `docs/architecture/THREAT_MODEL.md`, `docs/evaluation/KNOWN_LIMITATIONS.md`, `docs/guides/DEMO.md` and `docs/project/RESOURCES.md` are current.
- [x] Technical report: `docs/report/PROJECT_REPORT.md`, `.docx` and `.pdf`.
- [ ] **TEAM:** `docs/project/TEAM.md` has real names, roles and contributions for all four members.
- [ ] **TEAM:** mentor and institution details filled in wherever the report or slides say TBD.

## Presentation
- [x] The competition deck is built on the official template `Avishkar26_Design_F_Subtle_Domain.pptx`, which stays unchanged outside Git.
- [ ] Vector PDF exported from PowerPoint (a raster backup exists in `submission/`); the PDF backup of the deck is copied to the presentation laptop and a USB stick.
- [ ] **TEAM:** speaker assignments confirmed. Each member has rehearsed their part.
- [ ] **TEAM:** at least two full timed rehearsals within the time limit.
- [ ] Judge Q&A document (`docs/presentation/JUDGE_QA.md`) read by every member.
- [ ] **TEAM:** two-minute fallback recording made (script: `docs/presentation/FALLBACK_STORYBOARD.md`).

## On the day
- [ ] Laptop on mains power; sleep and notifications off; browser zoom 100%.
- [ ] Authenticator app holds the TOTP entries for `asha` and `analyst`. The credentials file is never shown on screen.
- [ ] `/device` is paired in a separate tab.
- [ ] A backup laptop is set up the same way.
