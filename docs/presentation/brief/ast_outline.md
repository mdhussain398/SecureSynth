# AST outline (audience-state-transfer)

Initial state: "OTP handles this; ML demos overclaim."
Desired state: "This team found a real gap, closed most of it with low friction, measured honestly, and thought past the block."

| # | Slide | Audience walks in thinking | Walks out thinking |
|---|---|---|---|
| 1 | Title: SecureSynth | Another fraud demo | They're making a specific claim about identity |
| 2 | Possession isn't presence | OTP solves takeover | Phishing relay, SIM swap and hijack all pass the OTP; password + OTP stopped 0 of 367 |
| 3 | Static rules punish the wrong people | Just add rules | Rules catch 76.6% but interrupt 98.6% of travellers |
| 4 | Keep asking after sign-in | Authentication is a gate | It's a decision repeated at login, payee and transfer, enforced by the backend |
| 5 | Normal is personal | ML is a black box | Deviations from *this* customer, one shared model, written policy points, four explanation panels |
| 6 | Learning without being poisoned | Adaptive models can be trained by attackers | Candidate vs trusted profiles; verified, 24 h, rollback |
| 7 | The result | Show me numbers | 91.3% recall at 5.2% friction vs 76.6% at 28.6% |
| 8 | Where it doesn't win | They'll hide the weak spots | Same money saved overall, more genuine money blocked, 58.6% on familiar-device hijack |
| 9 | After the block | Detection is the end | Contain, collect evidence, investigate, report, recover |
| 10 | Evidence you can check | Logs can be edited | Hash-chained, encrypted, tamper-evident (not immutable) |
| 11 | Leads, not proof | Graphs accuse people | Correlations explained, graded, never auto-act |
| 12 | Live demo | It's slides | Takeover blocked live; balance unchanged |
| 13 | Built to be checked | Hackathon code is fragile | 165 tests, 5.61 ms p95, offline, frozen manifest |
| 14 | What's next | Is this production? | No; here is exactly what production needs |
| 15 | Close | | "Possession isn't presence" sticks |

Narrative arc: problem (2-3) → idea (4-6) → proof (7-8) → beyond detection (9-11) → show it (12) → credibility (13-14) → close (15).
