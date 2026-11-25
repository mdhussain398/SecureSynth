# SecureSynth evaluation protocol (pre-registered 2026-11-25, before generator v2 results were seen)

## Why v2
The v1 held-out run gave SecureSynth 100% recall, including the held-out family. That means the v1 synthetic attacks were trivially separable:
- every attack added a new payee;
- most attacks used an unrecognised browser;
- legitimate customers never paid a new payee quickly.

v2 makes the legitimate and malicious distributions overlap. The changes below were fixed **before** any v2 numbers were produced, and they are not tuned toward an outcome.

## Generator v2 changes
**Legitimate behaviour (harder negatives):**
- 30% of legitimate new-payee events are paid within 1–8 minutes (previously always 5–240 min).
- Secondary household device: 5% of sessions come from an unrecognised "family laptop".
- Phone replacement for 30% of customers (previously 25%).
- Unusual spend: 3% of transfers at 6× median, plus 1% at 15× median (large purchases).
- Gradual drift:
  - 30% of customers' typical amount grows 1%/week;
  - 10% of night-shift and salaried customers shift their login hours by +6 h at a random day (shift change).
- Travel: domestic trips added; trip probability unchanged per persona.
- 3% of legitimate sessions follow 1–2 failed sign-ins (typos).

**Attack families (harder positives):**
| Family | v2 behaviour | Splits |
|---|---|---|
| A credential + SIM swap | new device; city 50% foreign / 50% other Indian city; new payee; 8–25× amount | val, test |
| B real-time OTP relay | new device; victim's home or nearby city; hour drawn from the victim's own profile 60% of the time; new payee; 3–10× | val, test |
| C session hijack on familiar device | recognised device, home city, usual hour; **50% pay an existing payee**; 3–8×; 5–30 min after login | val, test |
| E remote-access takeover | recognised device, home city, usual hour; new payee paid 30–180 min later; 1–4× | val, test |
| D low-and-slow mule (**held out**) | 50% recognised device; new payee paid 20–120 min later; 0.5–1.5× | **test only** |

Attack prevalence stays around 1–2% of sessions.

## Product-consistency assumption
In the live product, a device approved through independent verification counts as provisionally recognised. The training/eval baseline mirrors this: a device seen in one prior legitimate (verified) session counts as recognised.

## Protocol
1. **Development dataset** (seed 2026): train days 0–60 and validation days 60–75.
   - The Isolation Forest is fit on train.
   - Calibration, ML weight and thresholds are chosen on validation only, with targets:
     - intervention FPR ≤ 5%;
     - block FPR ≤ 0.5%.
2. **Freeze.** `artifacts/frozen_manifest.json` records SHA-256 hashes of:
   - the model;
   - `features.py`, `policy.py`, `generate.py`;
   - the thresholds.
3. **Final test dataset:** a **fresh, separately seeded population** (seed 9091), never used during development.
   - Only its days 75–90 are scored; earlier days only build baselines.
   - It is evaluated **once**. The script refuses to run if any frozen file's hash differs from the manifest.
4. **Reporting** covers all three approaches on identical sessions with one outcome function:
   - confusion matrices, precision, recall, F1, FPR;
   - legitimate restriction rates (overall / travellers / new-device sessions);
   - p50/p95 latency;
   - attack value attempted / prevented / completed, and legitimate value delayed.

   Detection metrics are kept separate from prevention metrics.

Any later change to frozen files requires a new protocol version. The old final numbers are then marked superseded, not deleted.
