# Submission checklist — AVISHKAR'26, problem 24

Tick an item only after doing it on the presentation machine. Items marked **TEAM** need a human decision or information we must not invent.

## Code and evidence
- [ ] `feat/frontend-renaissance` is pushed. Not merged into `main` (PR #1 stays under review).
- [ ] `make test`: 89 passed.
- [ ] `cd frontend && npx tsc -b && npm run build`: passes.
- [ ] Frozen manifest: 6/6 hashes match, model `iforest-v1-956f432a`. Never run `make train` on a machine whose artifacts came from Mac 1.
- [ ] All six Scenario Lab scenarios give the outcomes in `docs/DEMO.md`.
- [ ] Judge Mode: R runs the scenario, Esc exits; full screen works in the presentation browser.
- [ ] `/brand` shows the Synth Core logo. `?gl=0` shows the SVG fallback.
- [ ] Offline: turn Wi-Fi off and repeat the demo; no request leaves `localhost`.
- [ ] Demo reset done (Lab → *Reset demo* → *Confirm reset*) right before presenting.
- [ ] Secrets scan clean. No `.env`, databases, `backend/artifacts/`, credentials or official competition files are tracked.

## Documents
- [ ] `README.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/EVALUATION.md`, `docs/THREAT_MODEL.md`, `docs/KNOWN_LIMITATIONS.md`, `docs/DEMO.md` and `docs/RESOURCES.md` are current.
- [ ] Technical report: `docs/report/PROJECT_REPORT.md`, `.docx` and `.pdf`.
- [ ] **TEAM:** `docs/TEAM.md` has real names, roles and contributions for all four members.
- [ ] **TEAM:** mentor and institution details filled in wherever the report or slides say TBD.

## Presentation
- [ ] The competition deck is built on the official template `Avishkar26_Design_F_Subtle_Domain.pptx`, which stays unchanged outside Git.
- [ ] The PDF backup of the deck is copied to the presentation laptop and a USB stick.
- [ ] **TEAM:** speaker assignments confirmed. Each member has rehearsed their part.
- [ ] **TEAM:** at least two full timed rehearsals within the time limit.
- [ ] Judge Q&A document read by every member.
- [ ] **TEAM:** two-minute fallback recording made, or the storyboard used as a script.

## On the day
- [ ] Laptop on mains power; sleep and notifications off; browser zoom 100%.
- [ ] Authenticator app holds the TOTP entries for `asha` and `analyst`. The credentials file is never shown on screen.
- [ ] `/device` is paired in a separate tab.
- [ ] A backup laptop is set up the same way.
