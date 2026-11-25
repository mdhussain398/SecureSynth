# SecureSynth: presentation script, timing and live demo

- **Deck:** `submission/SecureSynth_AVISHKAR26_Presentation.pptx`, with a PDF backup alongside. It is built on the official AVISHKAR'26 template and kept outside Git.
- **Rebuild:** `docs/presentation/tools/build_deck.py`. Every metric is read from the frozen `eval_report.json`.
- **Speaker notes** are also embedded in each slide.

> **TEAM:** before rehearsing, replace `[Member 2]`, `[Member 3]` and `[Member 4]` on slide 1 and in this file with real names. Confirm the speaker assignments and the official time limit. The plan below assumes **10 minutes plus Q&A**, as in `docs/DEMO.md`; rescale it if the official limit differs.

## Running order (10:00)
| Time | Speaker | Slide | Beat |
|---|---|---|---|
| 0:00–0:40 | **A** · Mohammed Hussain | 1 Project | Team, institution, problem 24, SecureSynth; the one-line thesis |
| 0:40–1:40 | **A** | 2 Problem | 0 of 367 takeovers stopped by password + TOTP; static rules interrupt 28.6% of genuine sessions; success criteria fixed in advance |
| 1:40–2:40 | **B** · [Member 2] | 3 Approach | Four stages; personalised and continuous; bound approvals; safe baseline adaptation; constraints |
| 2:40–3:40 | **B** | 4 Architecture | React → FastAPI → engine → SQLite and the frozen model; why each technology; 89 tests, 6/6 hashes, 5.61 ms |
| 3:40–4:25 | **C** · [Member 3] | 5 Implementation | Data flow of one transfer; real screenshots; key features |
| 4:25–7:40 | **C** | **Live demo** | Judge Mode: scenarios 1 → 2 → 3 → 4, then the Command Centre (below) |
| 7:40–9:10 | **D** · [Member 4] | 6 Results | 91.3% vs 76.6% recall at 5.2% vs 28.6% interruption; what we do *not* claim |
| 9:10–10:00 | **D** | 7 Impact | Applications, scaling, honest next step, closing line |
| Q&A | all | — | Route by topic: frontend → C · backend/security → B · ML/evaluation → D · product/limitations → A |

## Live demo walkthrough (speaker C, about 3:15)
**Before the session:**
- Lab → **Reset demo** → **Confirm reset**.
- The analyst is signed in and device-approved.
- `/judge` is open full screen in Chrome or Safari, with F11 as the fallback.
- `/device` is open in another tab.
- Wi-Fi is off (the demo is fully offline).

| # | Action | Say | Expected (verified) |
|---|---|---|---|
| 1 | Select *Normal customer*, press **R** | "A genuine payment from a familiar device." | ALLOW; asha pays ₹2,500 with no friction |
| 2 | *Takeover despite password + TOTP*, **R** | "Correct password. Correct OTP. Still not the customer." | BLOCK at the TOTP step (≈99); payee add and transfer get **403**; ravi's ₹96,200 unchanged |
| 3 | *Suspicious activity after a legitimate login*, **R** | "Authentication is not a single gate." | Sign-in allowed, then step-up and restriction; balance unchanged |
| 4 | *Genuine traveller*, **R** | "Low friction for real customers." | Step-up, approved on the trusted device, ₹2,500 completes |
| 5 | **Esc** → Command Centre | "Every decision is explained in four separate parts; the index is a rarity percentile, not a probability." | Digital Twin, risk bezel with thresholds, signal inspector |

**If something goes wrong:**
- **A run stalls:** click **Show all steps**. The run is recorded server-side.
- **Full screen is refused:** press F11.
- **The laptop fails:** play the 2-minute fallback recording, or use the screenshots on slide 5.
- **`TOTP_REPLAY` at sign-in:** wait for the next 30-second code.

## Speaker notes (as embedded in the deck)
### Slide 1 · Speaker A
1. Introduce the team: The_Terminators, team AV26-50F33FD4DE, Adichunchanagiri Institute of Technology.
2. Name the problem: Statement 24, in the domain AI in Cyber Security and FinTech.
3. Introduce SecureSynth and its logo: two glass ribbons around a shield, standing for who the customer says they are and how they behave.
4. Thesis: *"A correct password and a correct OTP are not proof that the customer is present."*

### Slide 2 · Speaker A
- **How attacks get through:** OTP relay, SIM swap and session hijack all present correct credentials.
- **Evidence:** in the synthetic evaluation, password + TOTP alone intervened in **0 of 367** takeovers.
- **Root cause:** sign-in is treated as a one-time gate.
- **Static rules are no fix:** they interrupted **28.6%** of genuine sessions and **98.6%** of travellers.
- **Challenges and stakeholders:** walk through the four challenges in priority order, then the stakeholders.
- **Success criteria were fixed before results:** intervention FPR ≤ 5% and block FPR ≤ 0.5% were targets.

### Slide 3 · Speaker B
**The four stages:**
1. **Authenticate:** Argon2id and TOTP with replay protection; the token rotates.
2. **Assess:** 15 deviations from *this* customer's trusted baseline, scored by the Isolation Forest, plus policy points.
3. **Decide:** 0.8 × ML index + points. Step-up at 77.73, block at 89.1. Enforced by the backend.
4. **Verify and adapt:** a trusted-device number match. The challenge is single use, valid for 120 s, and bound to the session, operation and payload hash.

**Innovation:**
- **Personalisation:** 02:00 is normal for a night-shift worker and rare for a 9-to-5 customer.
- **Continuous checks** at sign-in, payee add and every transfer.
- **Bound approvals.**
- **A baseline an attacker cannot train:**
  - new behaviour stays in a candidate profile;
  - an attribute is promoted only after verification, 2 clean sessions and 24 h;
  - blocked sessions void their contributions;
  - every change can be rolled back.

**Constraints:**
- synthetic data only;
- offline;
- frozen model;
- the index is not a probability;
- Ghost Banking is not implemented and is off.

### Slide 4 · Speaker B
1. Walk the diagram top to bottom.
2. Explain each technology choice in one line.
3. Give the evidence:
   - 89 tests;
   - 6/6 frozen hashes;
   - p95 5.61 ms, in-process on one laptop, excluding network and database time.

### Slide 5 · Speaker C
1. Trace one transfer: request → checks → features from past history only → score → enforce and audit.
2. Point out that the screenshots are real captures from the running product.
3. Switch to the live demo.

### Slide 6 · Speaker D
**Method:**
- pre-registered protocol;
- frozen model;
- fresh population of 240 customers, 4,665 sessions and 367 takeovers, scored once.

**Results:**
- Recall 91.3% against 76.6%.
- Genuine sessions interrupted: 5.2% against 28.6%.
- Precision 60.1% against 18.6%; F1 72.5% against 29.9%.
- Travellers interrupted: 16.7% against 98.6%.

**What we do not claim:**
- Static rules prevent slightly more attack money: ₹2.98 cr against ₹2.96 cr.
- We delay far less genuine money (₹0.57 cr against ₹2.89 cr), but block more of it outright (₹25.0 lakh against ₹0.3 lakh).
- Familiar-device hijack recall is 58.6%.
- Block FPR was 0.81% against a 0.5% target.
- All of this is synthetic: it is not real-world validation.

### Slide 7 · Speaker D
1. **Impact:** step-up only when behaviour is unusual for this customer, with continuous checks where accounts are drained.
2. **Scaling:**
   - stateless API and scorer;
   - PostgreSQL, TLS, KMS;
   - an attested trusted-device app;
   - payee and mule-risk signals.
3. **First step:** validate on consented, labelled bank data.
4. **Close:** *"A correct password and OTP prove possession, not presence. SecureSynth keeps checking, explains every decision, and asks the real customer when it is unsure. Thank you."*

## Rehearsal checklist
- [ ] Two full timed run-throughs within the limit, including the live demo.
- [ ] Every speaker can explain every slide; any judge may ask anyone.
- [ ] Demo reset immediately before presenting.
- [ ] Never show `backend/artifacts/demo_credentials.json` or the authenticator app on the projector.
