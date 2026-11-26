# SecureSynth threat model

## What we protect
| Asset | Why it matters |
|---|---|
| Customer ledger and balances | Direct financial loss |
| Payee list | Adding a mule payee is the usual first step of a drain |
| Trusted behavioural baseline | It is a security control. Poisoning it would make an attacker "normal". |
| Session tokens, TOTP seeds, trusted-device keys | Each grants a level of access |
| Audit trail and risk assessments | Investigation, explainability, accountability |

## Who we defend against (in scope)
| Attacker | Capability assumed |
|---|---|
| Phisher / credential stuffer | Knows the password |
| Real-time OTP relay / SIM swap | Also has a valid TOTP at login time |
| Remote operator | New browser, VPN or nearby city, odd hours; acts fast (add payee → drain) |
| Session hijacker | Takes over after a legitimate login |
| Low-and-slow mule operator | Small amounts, patient, may use a familiar device |
| Baseline poisoner | Repeated quiet sessions to make their device and behaviour look normal |

**Assumptions:**
- The attacker does **not** control the separately enrolled trusted device.
- The server and database are not compromised.
- Production would add TLS in front.

## Trust boundaries
1. **Browser → API:** every input is untrusted.
   - Pydantic validation; ORM-only queries.
   - Authorization enforced in FastAPI dependencies, never in the UI.
2. **Customer ↔ analyst:** role checked on every admin and lab route.
3. **Banking session ↔ trusted device:** `/device/*` authenticates only with `X-Device-Key`. Banking cookies are ignored, so a suspicious session can never approve its own challenge.
4. **Inference ↔ labels:** scoring code cannot read evaluation labels (test-enforced). Tuning refuses test data.
5. **Product ↔ demo controls:** the Lab router exists only when `DEMO_MODE=true`, and requires an admin, a loopback client, Origin and CSRF.

## Controls
| Threat | Control | Evidence |
|---|---|---|
| Stolen password | Argon2id; unknown user and wrong password get the same error and timing; rate limit 5 / 5 min | `test_security.py`, `test_auth_flow.py` |
| Relayed or replayed OTP | ±1 step window; per-user last step, so a reused code is rejected | `test_totp_replay_rejected` |
| Correct password + OTP, wrong person | Continuous risk at login, payee add and transfer; STEP_UP to trusted device; BLOCK → restricted | `test_continuous_risk_*`, live Lab |
| Login awaiting approval reading data | Reads refused until the login step-up is approved; an expired challenge restricts the session | `test_unverified_login_step_up_cannot_read_account_data` |
| Challenge abuse | Separate credential; single use; 120 s; bound to session + operation + SHA-256 of the payload; wrong number denies and restricts | `test_challenges.py` |
| Session theft / fixation | Opaque random tokens stored hashed; rotated after TOTP; 15 min idle / 60 min absolute; logout and analyst revoke | `test_auth_flow.py`, `test_admin.py` |
| CSRF | SameSite=Strict cookies; `X-CSRF-Token` double-submit on every mutation; Origin allow-list | `test_totp_without_csrf_header_rejected`, `test_foreign_origin_rejected_on_mutation` |
| Double spend / race | Idempotency key per account; balance debit is one conditional UPDATE | `test_ledger.py` |
| IDOR | Payee and challenge ownership checked against the session user | `test_cannot_transfer_to_other_users_beneficiary`, `test_other_users_device_cannot_approve` |
| Baseline poisoning | Scoring reads the trusted profile only; unverified novelty never learned; verified attribute promoted only after 2 clean sessions + 24 h; BLOCK / denial voids contributions; versioned rollback | `test_baseline.py` |
| Customer-side oracle | Customers get category-level messages only. Scores, thresholds, features and counterfactuals are admin-only. | `test_customer_message_reveals_no_scores_or_feature_names` |
| Secrets leakage | Seeds encrypted with Fernet; audit log has a field allow-list; secrets live in a gitignored `.env`; demo credentials file is mode 600 and gitignored; git history scanned | `audit.py`, `.gitignore` |
| Demo backdoor | Lab not mounted outside demo mode; admin + loopback + Origin + CSRF; simulated context needs the in-process token | `test_lab.py` |

## Out of scope
- Malware on the customer's own device.
- Compromise of the trusted device.
- Server or database compromise.
- Insider access.
- Network-level attacks (no TLS in the local prototype).
- Real geolocation / IP intelligence.
- Adversarial ML beyond baseline poisoning.
- Ghost Banking, which is not implemented.

## Residual risks
- **Familiar-device takeover** (family C) is detected only 59% of the time in evaluation.
- **Restriction is per session.** A blocked attacker can sign in again, but every new login is re-assessed and needs the trusted device.
- **Rate limits are in memory** and reset on restart.
- **Device recognition** is a cookie: a signal, not identity.
- **Fairness:** risk decisions differ by persona by design (personalisation). We report restriction rates for travellers and new-device customers, but have not audited fairness across demographic groups, since the data is synthetic.
