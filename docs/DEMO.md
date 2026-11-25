# Demo guide — 10 minutes + 2 minutes Q&A

## Before the judges arrive (offline checklist)
- [ ] Laptop on mains power; sleep and notifications off; browser zoom 100%; dark/light theme chosen.
- [ ] **No network needed.** Turn Wi-Fi off once to prove it, then decide whether to leave it off.
- [ ] Two terminals:
  ```bash
  make dev-backend
  ```
  ```bash
  make dev-frontend
  ```
- [ ] `curl -s http://127.0.0.1:8000/api/health` returns `{"status":"ok"}`.
- [ ] `make test` is green (87 tests, ~12 s).
- [ ] Browser tabs open:
  - **Tab 1** http://localhost:5173/login (customer);
  - **Tab 2** http://localhost:5173/device (trusted device, paired with the customer's `trusted_device_key`);
  - **Tab 3** Command Centre, analyst already signed in and device-approved.
- [ ] Authenticator app on two phones with the `asha` and `analyst` TOTP entries (from `backend/artifacts/demo_credentials.json`; never show this file on screen).
- [ ] In Tab 3, open the Lab and click **Reset demo**. The presenter stays signed in.
- [ ] A backup laptop has the same setup, and the 2-minute fallback video is on the desktop.
- [ ] **TOTP replay protection is real:** one code works once. If you just used a code, wait for the next one.

## Judge Mode run order (verified 2026-11-25)
Open `/judge` signed in as analyst. Press **R** to run the selected scenario live, and **Esc** to exit. Full screen: use the button, or F11 if the browser blocks it. Press *Reset demo* in the Lab before you start; the analyst stays signed in.

| # | Scenario | Verified outcome |
|---|---|---|
| 1 | Normal customer | Allowed; asha pays ₹2,500 with no friction |
| 2 | Takeover despite password + TOTP | Blocked, session restricted; ravi's ₹96,200 unchanged |
| 3 | Suspicious activity after a legitimate login | Sign-in allowed, then step-up and restriction; balance unchanged |
| 4 | Genuine traveller | Step-up, approved on the trusted device, transfer completes (₹2,500) |
| 5 | Customer on a new device | Step-up, approved, transfer completes |
| 6 | Unusual but legitimate transfer | Allowed at the default ₹1,50,000; vary the amount in the Lab to show friction growing |

Suggested story:
1. Show 1 (the baseline).
2. Then 2, the headline: a correct password and OTP, still stopped.
3. Then 3, continuous checks after login.
4. Then 4, which shows low friction for real customers.
5. Close on the Evaluation page.

Run 5 and 6 only if there is time.

## Script
| Time | Beat | What to show |
|---|---|---|
| 0:00–0:40 | **Hook** | "Correct password. Correct OTP. Still not the customer." One line of threat model: phishing, OTP relay, SIM swap. |
| 0:40–2:00 | **Genuine login** | Tab 1: asha signs in with password + phone TOTP. The new browser gets STEP-UP → number on screen → approve in Tab 2 → dashboard. Pay the landlord ₹2,500 → it goes straight through, because the device was verified once. |
| 2:00–3:30 | **Takeover despite password + TOTP** | Lab → *Takeover despite password + TOTP* (victim ravi, Pune, 03:00) → BLOCK at the TOTP step; payee add and transfer get 403; protected balance unchanged. Click "Open in Command Centre". |
| 3:30–5:00 | **Why — explainability** | Investigation page, four separate panels: ML anomaly index (a rarity percentile, not a probability), deviations vs this customer's baseline, exact policy points, decision formula. Then open **What-if**, edit one feature → HYPOTHETICAL recompute. Point out that customers never see this. |
| 5:00–6:15 | **Continuous risk** | Lab → *Suspicious activity after a legitimate login* → login ALLOW, then the new payee gets STEP-UP and the next transfer gets 403. "Authentication isn't a single gate." |
| 6:15–7:15 | **Trust recovery, not friction** | Lab → *Genuine traveller* (meera, Singapore) → STEP-UP → trusted-device approval → next transfer ALLOWed via the 7-day travel window. Baseline page: trusted vs candidate, nothing learned from blocked sessions, rollback. |
| 7:15–9:00 | **Evidence** | Command Centre → Evaluation: three approaches on a fresh synthetic population scored once with a frozen model. Recall 0.91 vs 0.77, legit friction 5.2% vs 28.6%. Then say plainly: total money prevented is about the same as static rules; the weakness is familiar-device hijack (0.59). |
| 9:00–10:00 | **Close** | Architecture diagram (README), security controls, limitations, future work (payee-risk signals, real push channel, Ghost Banking sandbox subject to approval). |

## Likely questions
- **Why Isolation Forest?** Labels for takeovers are rare and evolving. An unsupervised rarity model over *personalised deviations* lets one shared model serve every customer. Labels are used only for evaluation.
- **Is 0.91 recall real?** It is real on synthetic data we designed. The protocol was committed before results; the model was frozen; the test population was fresh and scored once. Real-world performance would differ.
- **What if the attacker controls the trusted device?** Out of scope by assumption. That is the residual risk, alongside familiar-device hijack.
- **Can an attacker train the model to accept them?** No. Scoring uses the trusted profile. Unverified novelty is never learned, and verified changes need clean sessions + 24 h. Blocks void contributions, and analysts can roll back.
- **Why does the risk index differ for the same action?** It's personalised: a 02:00 login is normal for the night-shift customer and rare for the 9-to-5 one.

## Troubleshooting
| Symptom | Fix |
|---|---|
| `INVALID_TOTP` / `TOTP_REPLAY` | The code was already used, or the phone clock has drifted. Wait for the next 30 s code; check automatic time on the phone. |
| `RATE_LIMITED` | 5 failures in 5 min. Restart the backend (limits are in memory) or wait 5 min. |
| Login stuck on "Approve on your registered device" | Tab 2 isn't paired with *this* customer's device key, or the 120 s request expired. Re-pair, then sign in again. |
| Session shows "Your account is protected" | Expected after a BLOCK or a denied/expired challenge. Sign out and sign in again. |
| Lab says "not available" | Backend not started with `SS_DEMO_MODE=true` (`make env` writes it), or you're not signed in as `analyst`. |
| Evaluation page says not found | Run `make eval` (needs `make train` first; refuses if frozen files changed). |
| `Model artefact missing` on backend start | Run `make train`. |
| Port 5173 / 8000 busy | `lsof -nP -iTCP:5173 -sTCP:LISTEN`, then stop that process. macOS AirPlay uses 5000, which we avoid. |
| Credentials no longer work | `make seed` regenerates the demo DB *and* new credentials. Re-scan TOTP and re-pair devices. |
| UI needs to be shown without the backend | `cd frontend && npm run dev:mock` (clearly synthetic mock data). |
