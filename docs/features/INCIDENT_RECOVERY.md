# Analyst-assisted recovery for restricted customers

## Why this exists: the confirmed root cause
Before this feature, a genuine customer who was blocked could stay locked out for up to 24 hours. Nobody was notified. This was reproduced on a copy of the demo database, for example with Farhan on an unrecognised browser retrying a ₹3,00,000 transfer after each sign-in:

| Round | Sign-in decision (score) | `txn_velocity_ratio` at sign-in | Transfer |
|---|---|---|---|
| 1 | STEP_UP 84.6 | 0.00 | BLOCK |
| 2 | STEP_UP 86.1 | 2.05 | BLOCK |
| 3 | STEP_UP 88.3 | 4.09 | BLOCK |
| 4 | **BLOCK 89.4** | 6.14 | — (stuck) |

The lockout had two causes acting together.

**1. Blocked attempts counted as transfers.**
- Every assessment writes a `history_events` row, including a BLOCKed transfer that never moved money.
- `txn_velocity_ratio` counts transfers in the last 24 hours. Each retry therefore raised the velocity seen by the *next sign-in* by about 2×, until the sign-in itself crossed the block threshold (89.1).
- A blocked sign-in cannot be stepped up, so the customer stayed blocked until the attempts aged out after 24 hours.

**2. A BLOCK voids the browser's trust.**
- `baseline.reject_session` marks the browser's verified-device candidate as rejected. This is deliberate poison resistance.
- Every re-login therefore scored "browser not recognised" (+12 points).

**Not causes:** stale frontend state and Scenario Lab context were ruled out. Lab sessions are isolated by `is_lab` and by the lab token.

Training (`ml/train.py`) also counts unexecuted attempts in velocity, so the model is consistent with this behaviour. Rapid retries are a genuine fraud signal, and that signal is **kept**.

## What changed
- **Incidents.**
  - Whenever enforcement restricts a session, the backend opens a security incident. That covers any risk-engine BLOCK, and a denied trusted-device check.
  - Later restrictions for the same customer attach to the one unresolved incident, so the analyst sees one alert, not many.
  - The analyst console polls `GET /admin/incidents/summary` every 4 s. That drives the bell, the unread count and a toast, with no page refresh.
- **Analyst decisions** (`POST /admin/incidents/{id}/actions`). Every decision needs a reason of at least 8 characters and is written to the audit log.

  | Action | Level | Effect |
  |---|---|---|
  | `unblock_session` | session | Restores *this* session only if it is still within its lifetime **and its sign-in was verified** (ALLOW, or STEP_UP approved). Needs a fresh analyst TOTP code. |
  | `clear_user` | customer | Ends every session in the incident (tokens are never reactivated). The customer signs in afresh and is re-assessed. Needs a fresh analyst TOTP code. |
  | `keep_restricted` | decision | The restriction stays; the customer is told to contact the bank. |
  | `revoke_session` | session | Terminates every session in the incident. |
  | `request_verification` | evidence | Number-matching check on the trusted device, with the number shown on the customer's restricted screen. The result is evidence only: it never unlocks anything. |

- **Velocity.** Never-executed transfer attempts in a *cleared* incident are marked `outcome = reviewed`.
  - They stay in the table as evidence, but stop counting as velocity.
  - Every other attempt still counts. That includes attempts under a retained restriction, which is the same as in training.
  - Live history rows now record `outcome`: completed, pending, blocked, denied or reviewed.
- **Customer screen.** The restricted screen polls `GET /auth/incident`, which is read-only, and shows the case status:
  - pending analyst review;
  - additional verification required;
  - access restored;
  - restriction retained.

  On restoration it refreshes its auth and bank state and continues, or asks the customer to sign in again, without loops.

## Security properties (each covered by `backend/tests/test_incidents.py`)
- **Backend enforcement.** Only admins can list or act on incidents; customers get 403. Every mutation needs CSRF and the Origin allow-list.
- **Fresh authentication.** Lifting a restriction needs a fresh analyst TOTP code, with replay protection and rate limiting. Analysts cannot resolve incidents on their own account.
- **No token reuse.** A blocked or unverified sign-in is never restored, and an expired or revoked token is never reactivated.
- **Blocked transfers never execute.** They stay `restricted`, and an idempotent replay of one stays blocked and adds no velocity.
- **No whitelist.** Clearance only reviews the incident's attempts. New suspicious activity raises a new BLOCK and a new incident.
- **No automatic clearance.** Re-login, timers and demo customers never clear an incident.
- **Idempotent and race-safe.** Resolution is a conditional UPDATE on (version, open status). A repeated decision is echoed idempotently; a conflicting one gets 409.
- **Full audit.** The log records the analyst, timestamp, reason, previous state, resulting state, and session modes before and after.
- **Scenario Lab.** Lab runs create incidents flagged `is_lab`. *Reset demo* restores the snapshot, which recreates an empty incident table; it is separate from customer recovery.

## Schema changes (additive and idempotent)
- **New table:** `security_incidents`.
- **New nullable columns:** `history_events.outcome` and `history_events.assessment_id`.
- `app/state.py::ensure_schema` applies them at startup and after every demo reset. No data is dropped or rewritten.

## Limitations
- **Near-real-time only.** Notifications use 4-second polling, not push or SSE.
- **Shared read state.** Read/unread is shared by all analysts; this is a single-team prototype.
- **Re-verification after clearance.** Clearance does not restore the browser's device trust. The customer re-verifies on the trusted device at the next sign-in, which preserves poison resistance.
