# SecureSynth evaluation (protocol v2, final)

Model `iforest-v1-956f432a`, frozen before evaluation (`backend/artifacts/frozen_manifest.json`; the script refuses to run if any frozen file changed).

**Final test population:**
- seed 9091: a fresh synthetic population, never used during development;
- 240 customers;
- days 75–90 scored: 4,665 sessions, 367 account takeovers.

Tuning used only the development validation window (seed 2026, days 60–75): ML weight 0.8, step-up ≥ 77.73, block ≥ 89.1. Reproduce with `make train eval`.

## Detection (unit: session; positive = account takeover)
Intervention = the session reached STEP-UP or BLOCK.

| Approach | TP | FP | FN | TN | Precision | Recall | F1 | FPR (legit sessions restricted) |
|---|---|---|---|---|---|---|---|---|
| Password + TOTP only | 0 | 0 | 367 | 4,298 | 0.000 | 0.000 | 0.000 | 0.0% |
| Static global rules | 281 | 1,230 | 86 | 3,068 | 0.186 | 0.766 | 0.299 | 28.6% |
| **SecureSynth** | **335** | **222** | **32** | **4,076** | **0.601** | **0.913** | **0.725** | **5.2%** |

Block only:

| Approach | TP | FP | FN | TN | Precision | Recall | FPR |
|---|---|---|---|---|---|---|---|
| Static global rules | 159 | 3 | 208 | 4,295 | 0.982 | 0.433 | 0.07% |
| SecureSynth | 227 | 35 | 140 | 4,263 | 0.866 | 0.619 | 0.81% |

## Legitimate customer friction
| Approach | All legit sessions restricted | Travellers restricted | New-device sessions restricted | Legit sessions blocked |
|---|---|---|---|---|
| Static global rules | 28.6% | 98.6% | 27.8% | 0.07% |
| SecureSynth | 5.2% | 16.7% | 8.7% | 0.81% |

## Recall by attack family
| Family | Static rules | SecureSynth |
|---|---|---|
| A credential + SIM swap | 1.00 | 1.00 |
| B real-time OTP relay | 1.00 | 1.00 |
| C session hijack on familiar device | 0.60 | **0.59** |
| E remote-access takeover | 0.45 | 1.00 |
| D low-and-slow (held out of validation) | 0.73 | 0.96 |

## Simulated financial outcome (assumption: attackers fail independent verification, genuine customers pass)
| Approach | Attack value attempted | Prevented | Completed (lost) | Legitimate value delayed |
|---|---|---|---|---|
| Password + TOTP only | ₹3.10 cr | ₹0 | ₹3.10 cr | ₹0 |
| Static global rules | ₹3.10 cr | ₹2.98 cr | ₹12.2 lakh | ₹2.89 cr |
| SecureSynth | ₹3.10 cr | ₹2.96 cr | ₹14.6 lakh | ₹57.0 lakh |

### Blocked vs challenged
"Prevented" includes money stopped by a step-up challenge, on the assumption that the attacker cannot pass trusted-device verification. The split:

| Approach | Attack value stopped by BLOCK (permanent) | Stopped by challenge (assumes attacker fails it) | Legit value blocked | Legit value challenged, then completed |
|---|---|---|---|---|
| Static global rules | ₹2.38 cr | ₹59.9 lakh | ₹0.3 lakh | ₹2.89 cr |
| SecureSynth | ₹2.61 cr | ₹34.8 lakh | ₹25.0 lakh | ₹32.0 lakh |

- SecureSynth stops more attack money outright (₹2.61 cr vs ₹2.38 cr) and relies less on the verification assumption.
- It also blocks more legitimate money outright (₹25 lakh vs ₹0.3 lakh). That is the real cost of its higher block rate.

## Latency
SecureSynth in-process decision: p50 5.46 ms, p95 5.59 ms. This is single-event scoring on a laptop and excludes network and database time.

## Honest reading
- **The main result is friction, not catch rate.** SecureSynth catches more takeovers than static rules (91% vs 77%) while restricting about 5× fewer legitimate sessions (5.2% vs 28.6%), and delaying about 5× less legitimate money.
- **It does not prevent more money than static rules.** It prevents slightly less (₹2.96 cr vs ₹2.98 cr), because static rules step up almost everything.
- **Its weakness is takeovers on the customer's own familiar device** (family C, 59%). Personal behaviour baselines cannot separate an attacker who mimics the customer's device, place and hour; this needs other signals.
- **The block false-positive rate drifted** from the 0.5% validation target to 0.81% on the fresh population.
- **Every number is from synthetic data designed by the team.** Real attacker behaviour is more varied. The risk index is a rarity percentile, not a calibrated probability.
- **Superseded results:** protocol v1 reported 100% recall. It was withdrawn because v1's attacks were too easy to separate (see `EVALUATION_PROTOCOL.md`).
