# Judge Q&A preparation

Answers are grounded in the code and the frozen report (`backend/artifacts/eval_report.json`, model `iforest-v1-956f432a`).
- **If you don't know, say so.** Never guess a number.
- **Route questions:** frontend → C · backend/security → B · ML/evaluation → D · product/limitations → A.

## Problem and product
**Q: Why isn't password + OTP enough?**
Phishing kits relay the OTP in real time, SIM swaps redirect SMS codes, and hijackers act after a genuine sign-in. The bank sees correct credentials. In our evaluation, password + TOTP alone intervened in 0 of 367 takeovers.

**Q: How is this different from static rules?**
Static rules use one global yardstick, so they interrupt 28.6% of genuine sessions and 98.6% of travellers. We score deviations from *each customer's own* trusted behaviour: higher recall (91.3% against 76.6%) at 5.2% genuine interruption.

**Q: What does the customer experience?**
- Usually nothing.
- When behaviour is unusual: a calm step-up, with a number to match on the trusted device.
- When blocked: a calm message.

Customers never see scores, thresholds or feature names; a test enforces this.

## Machine learning
**Q: Why an Isolation Forest?**
Takeover labels are rare, change constantly and are unavailable when a bank starts. An unsupervised rarity model learns legitimate behaviour. Because the features are *personal deviations*, one shared model serves every customer.
- **Configuration:** 300 trees, 512 samples per tree, fixed random seed.
- **Labels:** used only for evaluation. A test proves the inference code never reads them.

**Q: What are the features?**
Fifteen deviations from the trusted baseline, built only from history *before* the event:
- recognised browser;
- hour rarity;
- familiar city;
- distance from home;
- implied travel speed;
- amount against usual;
- transfer frequency;
- new payee;
- payee added minutes ago;
- speed from sign-in to action;
- add-then-pay sequence;
- failed sign-ins in the last 24 h;
- transfer flag;
- payee-add flag;
- verified travel window.

**Q: Is the risk score a probability of fraud?**
No. It is a rarity percentile against legitimate validation events (0–100) plus transparent policy points: `score = clip(0.8 × ML index + Σ points, 0, 100)`. Step-up is at 77.73 and block at 89.1.

**Q: How did you choose the thresholds and weight?**
On the development validation window only (seed 2026, days 60–75). The targets were intervention FPR ≤ 5% and block FPR ≤ 0.5%. They were frozen before the test set was ever generated.

**Q: Isn't 91% recall too good to be true?**
It is real **on synthetic data we designed**, and we say so on every slide.
- The protocol was pre-registered.
- The model and scoring files were frozen with SHA-256 hashes.
- The test population (seed 9091) was fresh and scored once.
- Our first protocol (v1) gave 100% recall. We withdrew it because the attacks were too easy, then made legitimate and attack behaviour overlap in v2.

**Q: Where does it fail?**
- **Familiar-device hijack** (family C): recall 58.6%. The attacker uses the customer's own device, city and hours.
- **Block FPR drift:** 0.81% against a 0.5% target.

Fixing family C needs signals beyond a personal baseline: payee and mule-account risk, and transaction intent.

**Q: Can an attacker poison the model or the baseline?**
- **Scoring:** reads only the *trusted* profile.
- **New behaviour:** goes into a candidate profile. Only an attribute verified on the trusted device is promoted, after 2 clean sessions and 24 h.
- **Verified travel:** becomes a 7-day window.
- **Blocks and denials:** void their contributions.
- **Rollback:** every version can be restored.
- **The model itself:** frozen, and not retrained online.

## Evaluation and money
**Q: Do you prevent more fraud money than static rules?**
No, and we say so.

| | Static rules | SecureSynth |
|---|---|---|
| Attack money prevented (of ₹3.10 cr) | **₹2.98 cr** | ₹2.96 cr |
| Stopped outright by BLOCK | ₹2.38 cr | **₹2.61 cr** |
| Genuine money delayed | ₹2.89 cr | **₹0.57 cr** |
| Genuine money blocked outright | **₹0.3 lakh** | ₹25.0 lakh |

- Static rules challenge almost everyone, which is why they prevent slightly more in total.
- We stop more attack money outright, and delay far less genuine money.
- We also block more genuine money outright.

**Q: What does "prevented by step-up" assume?**
That the attacker cannot pass independent verification on the trusted device. BLOCK prevention does not depend on that assumption; we report the two separately.

**Q: How fast is it?**
p50 5.48 ms and p95 5.61 ms, in-process on one laptop. This excludes network and database time.

**Q: Was the data biased in your favour?**
It is synthetic and authored by the team; that is the main limitation. We mitigated it in three ways:
- pre-registering the protocol;
- a held-out attack family (D, low-and-slow, recall 96.3%) that was never used in tuning;
- one-shot scoring of a fresh population.

Real-world validation is the first next step.

## Backend and security
**Q: Is the decision enforced, or just displayed?**
Enforced by the backend.
- **BLOCK:** the session becomes `restricted`, and payee add and transfer return 403.
- **Login step-up:** account data cannot be read until it is approved.

Frontend route guards are UX only. The tests cover each case.

**Q: How do you stop the attacker approving their own step-up?**
- **Separate credential:** the trusted device authenticates only with `X-Device-Key` and ignores banking cookies.
- **Bound challenges:**
  - single use;
  - expire after 120 s;
  - bound to the session, the operation and a SHA-256 of the payload.
- **Number matching:** picking a wrong number denies the challenge and restricts the session.

**Q: What other security controls exist?**
- Argon2id passwords, with the same error and timing for an unknown user.
- TOTP with ±1 step and replay protection.
- Fernet-encrypted TOTP seeds.
- Hashed, rotating session tokens with idle and absolute expiry.
- `SameSite=Strict` cookies, a CSRF double-submit header and an Origin allow-list.
- Rate limiting.
- An idempotent, atomic conditional debit.
- Ownership checks against IDOR.
- An allow-listed audit log that never holds secrets.

**Q: What is Ghost Banking?**
A design for sending blocked sessions to an isolated decoy ledger. **It is not implemented:**
- the flag is off;
- the endpoint returns 404;
- only schema and UI stubs exist.

It waits for mentor approval, because deception raises rule-book concerns.

**Q: What is out of scope?**
- Malware on the customer's device.
- A compromised trusted device.
- Server or database compromise.
- Insiders.
- Network attacks (no TLS in the local prototype).
- Real geolocation.

## Frontend and demo
**Q: What is the orb? Is it the model?**
No. It visualises backend output for one session:
- **inclusions:** the signal keys of the assessment;
- **colours:** the backend's deviation severity;
- **state:** the decision.

The page says so in writing.

**Q: Is the demo scripted?**
The scenarios are scripted inputs, but every step is a real API call through the same engine, and the resulting balances are real ledger values. Judge Mode reveals the recorded steps one at a time so the audience can follow them.

**Q: Does it need the internet?**
No. Fonts and assets are bundled, and the product calls no external or AI service at runtime.

**Q: Performance of the 3D logo and orb?**
- **Synth Core logo:** measured at 60 FPS in Chrome on an Apple M1 (1440×900@2x, 390×844@3x, 1920×1080@2x), with an adaptive pixel-ratio cap.
- **Without WebGL:** both the logo and the orb fall back to SVG/CSS.
- **Reduced motion:** respected.
- **Not measured:** other GPUs and Safari.

## Team and process
**Q: Did you use AI tools?**
Yes, Claude Code helped write code, tests and documentation, as permitted after confirming with the organisers. Design decisions, review and the demo are ours, and every member can explain the design. The product itself calls no AI service.

**Q: What would you do next?**
1. Validate on consented, labelled bank data, with fairness and drift monitoring.
2. Build a real trusted-device app with attestation.
3. Add payee and mule-risk signals for family C.
4. Move to production infrastructure: PostgreSQL, distributed rate limiting, TLS, KMS.
