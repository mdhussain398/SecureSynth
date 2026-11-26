# Ghost Banking

**Status: implemented and tested behind `GHOST_BANKING_ENABLED`, which is OFF by default.**
Turning it on for the competition still needs **mentor approval**: it deceives the session holder, which the rule book (§12) treats with caution. With the flag off, nothing below runs, no ghost database is created, and a BLOCK restricts the session exactly as before.

## What it does
When the risk engine returns BLOCK and the flag is on, the session becomes `ghost` instead of `restricted`.

**What the session holder sees:**
- An ordinary-looking bank, backed **entirely** by synthetic data.
- The sign-in answers like a normal one, and `/auth/me` reports `normal`.
- A random balance, invented payees and a few weeks of invented history. Nothing is copied or derived from the real account.

**What still works, all on the ghost ledger:**
- the overview, transactions and payee screens;
- adding payees;
- transfers, which are idempotent per key and cannot overdraw the synthetic balance under concurrent requests.

**The analyst:**
- is alerted automatically, through the same incident, bell and toast as any restriction, marked **Ghost Banking**;
- watches the session live on `/soc/ghost/{session_id}`;
- decides what happens next with a mandatory reason, and every decision is audited.

## Isolation (backend-enforced, test-covered)
- **Separate database.** The ghost ledger is its own SQLite file (`Settings.ghost_database_url`, default `backend/ghost.db`). It has its own engine and its own `DeclarativeBase`, and startup refuses to run if it would share the protected database URL.
- **Separate code.** The data-access boundary is `app/ghost/`, which never imports the protected tables or the protected ledger. A test scans the source to enforce this. Callers pass only plain ids.
- **Every bank route checks the mode.**
  - Ghost sessions are served **only** from the ghost ledger.
  - If the flag is later turned off, a ghost session is refused (403); it is never shown protected data.
- **No protected side effects.** Ghost operations are never risk-assessed and never write protected transactions, payees, history events or baseline changes. This also keeps baseline poisoning impossible.
- **Per-session data.** Ghost data is keyed by session. Another session's ghost payees, and protected payee ids, are not found (404).
- **Security unchanged.** RBAC, CSRF, the Origin allow-list, TOTP and trusted-device checks all apply as before. There is no payment integration of any kind.

## Exit and recovery
- **Never restored in place.** `unblock_session` refuses a ghost session, because its banking view was synthetic.
- **Resolve and recover** (`clear_user`, which needs a fresh analyst TOTP code):
  - ends the ghost session; the old token is dead;
  - the customer signs in afresh and is assessed normally;
  - nothing is migrated, and nothing simulated becomes real;
  - ghost data stays in the ghost database as evidence.
- **Other decisions:**
  - `keep_restricted` keeps the session contained and monitored.
  - `revoke_session` ends it.
  - `request_verification` shows a number on the ghost screen as a generic "security check from your bank", for the registered device to match.
- **New suspicious activity** opens a new incident.

## Analyst monitor
`GET /admin/ghost/{session_id}` (admin only) returns:
- the incident and the triggering assessment (ML index, policy points, deviations);
- the ghost account, payees, transactions and live event timeline;
- totals: simulated transfers and value, refused attempts, payees added;
- **protected integrity**: completed protected transfers by this session since containment (always 0), payees added since then, and whether the balance is unchanged since entry.

The protected balance at entry is recorded in the **protected** audit log (`ghost.entered`), never in the ghost database. With `?compare=true` the response also carries a labelled side-by-side of the PROTECTED and SYNTHETIC ledgers; each such view is audited as `ghost.compare_viewed`.

## Scenario Lab
- **New scenario:** *Ghost Banking containment*. An attacker is blocked at sign-in, contained, adds a payee, sends ₹40,000 and checks history; the protected balance is unchanged.
- **Existing scenarios:** the six keep their outcomes. With the flag on, the takeover's later steps are labelled "simulated in Ghost Banking".
- **Reset demo:** also empties the ghost database.

## Limitations
- **Mid-session containment changes what the session sees.** If the BLOCK happens on a transfer after the session has already seen the real balance, the triggering request is still refused, and later screens show the synthetic balance instead. Containment at sign-in, the takeover case, shows no such switch.
- **Misclassified genuine customers see synthetic data until an analyst resolves the incident.** This, and the deception itself, are why mentor approval is required.
- **One analyst team.** Read/unread state is shared, and the monitor refreshes by polling every 3 s.
