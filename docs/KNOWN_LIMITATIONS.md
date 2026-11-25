# Known limitations

This is a single honest list of what SecureSynth does not do or has not proven. Sources:
- the frozen report (`backend/artifacts/eval_report.json`, model `iforest-v1-956f432a`);
- the code;
- the verification logs in the handoffs.

## Evidence and evaluation
| Limitation | Detail |
|---|---|
| **Synthetic data only** | Customers, devices, locations, drift and all five attack families were authored by the team (`backend/ml/generate.py`). The results show the method works on this data, not how it performs in the real world. No real bank data has been used, and no real-world validation has been carried out. |
| **Risk index is not a probability** | It is a rarity percentile against legitimate validation events (0–100), plus transparent policy points. It must never be read as "x% chance of fraud". |
| **Familiar-device takeover** | Family C (session hijack on the customer's own recognised device, home city, usual hour) has recall **0.586** for SecureSynth and 0.600 for static rules. A personal behaviour baseline has little to separate on here. |
| **Total money prevented** | Static rules prevent slightly **more** attack value in total: ₹2,98,14,878.70 against SecureSynth's ₹2,95,78,945.52, of ₹3,10,38,426.98 attempted. They do so by challenging almost everyone: 28.6% of genuine sessions and 98.6% of travellers. |
| **More legitimate value blocked outright** | SecureSynth blocks ₹25,02,367.27 of legitimate value outright, against ₹30,773.98 for static rules. Its legitimate block rate is 0.81% against 0.07%. This is the real cost of its higher block recall. |
| **Block FPR drift** | Validation targeted a block FPR of ≤ 0.5%. On the fresh test population it was 0.81%. |
| **Prevention assumption** | "Prevented by challenge" assumes the attacker cannot pass trusted-device verification. "Prevented by BLOCK" does not depend on that assumption. The two are reported separately. |
| **Latency scope** | p50 5.48 ms and p95 5.61 ms are in-process scoring on one laptop. They exclude network and database time. |
| **Fairness** | Restriction rates are reported for travellers and new-device customers. No demographic fairness audit has been done, and none is possible on synthetic personas. |

## Signals and infrastructure (prototype)
- **Location** comes from a synthetic IP-to-city table. There is no real geolocation or IP intelligence.
- **Trusted device** is a web page (`/device`) holding a separate credential. There is no real push channel, no secure enclave and no device attestation.
- **Device recognition** uses a random server-issued cookie. It is a behavioural signal, not proof of identity. There is no fingerprinting.
- **Single node:**
  - SQLite (WAL);
  - in-memory rate limits, reset on restart;
  - local dev servers without TLS.
- **Restriction is per session.** A blocked attacker can sign in again, but every new login is re-assessed and needs the trusted device.

## Not implemented
- **Ghost Banking** (an isolated decoy ledger for blocked sessions) is designed, but only stubs exist:
  - a disabled flag;
  - a `ghost` mode in the schema;
  - an endpoint that always returns 404;
  - a hidden UI shell.

  There is no ghost ledger or database. It is off pending mentor approval.
- **Lab demo-credentials endpoint:** listed in the old contract, never built.
- **Production concerns:** KYC, real payment rails, regulatory compliance, HSM or KMS key management, horizontal scaling and monitoring are out of scope.

## Frontend
- **The Synth Core logo holds 60 FPS on one machine only:** Apple M1 in Chrome, at three viewport sizes. Projectors, Intel GPUs and Safari were not measured.
- **The behavioural orb's lazy chunk is 244 KB gzip.** Vite prints a size advisory. It is loaded only on pages that show the orb.
- **Judge Mode full screen** did not engage inside the desktop app's embedded browser pane. Use Chrome or Safari, or F11.
- **Reduced motion:** the Synth Core logo was checked with the macOS Reduce motion setting **on**. The orb and logo were also checked under Chrome's emulated `prefers-reduced-motion: reduce`; both render a static WebGL frame. The orb has not yet been checked under the real OS setting in Safari.
- **Fallback recording:** not yet made; see `docs/presentation/FALLBACK_STORYBOARD.md`.
