# SecureSynth 3.0: architecture and operations

Lifecycle: **DETECT → CONTAIN → COLLECT EVIDENCE → CORRELATE → VERIFY → ANALYSE → INVESTIGATE → REPORT → RECOVER.**

## Stores (separate SQLite files, separate engines and metadata)

| Store | File | Contents |
|---|---|---|
| Protected banking | `securesynth.db` | Accounts, sessions, risk assessments, incidents (with `ref` and `ghost`), runtime settings and their history, audit log |
| Ghost Banking | `ghost.db` | Synthetic accounts, payees, transactions and an event log, one set per contained session. Exists only inside the deployment gate |
| Evidence vault | `evidence.db` + `evidence_store/` | Evidence items, the hash-chained ledger, photo requests, summaries, reports, confirmations, integrity alerts. Files are Fernet-encrypted |
| Demo reporting | `demo_ccr.db` | Simulated complaints (`DEMO-CCR-…`). Never contacts any external system |

Startup refuses to run if any two stores share a URL.

**Schema changes:**
- **How they're applied:** additive and idempotent, at startup and after a demo reset (`app/state.py::ensure_schema`).
- **Protected database:** new tables `runtime_settings` and `config_changes`; new columns `security_incidents.ref` (backfilled) and `security_incidents.ghost`.

## Ghost Banking runtime control
- **Deployment gate:** `SS_GHOST_BANKING_ENABLED` (default false), plus mentor approval (`SS_GHOST_BANKING_APPROVAL_REF`), or demo mode for local demonstrations.
- **Runtime toggle:** on `/soc/dashboard`.
  - The setting is persistent and defaults to OFF.
  - Changing it needs a reason, a fresh TOTP code and the current version (to catch conflicting edits).
  - Changes are kept in a history and written to the audit log.
- **Disable policy:** every live ghost session becomes `restricted` (never protected banking), and evidence is kept.

## Evidence
- **Collection:** `app/evidence/collect.py` runs on every restriction. It records:
  - **network:** the server-observed peer IP (`trusted_proxies` decides when forwarded headers count), its version and scope, and a caveat;
  - **device:** the registered device cookie, its trust status, the browser and OS parsed from the User-Agent for display only, and the MAC address shown as unavailable;
  - **risk assessment and transaction attempt.**

  Analyst decisions, verification outcomes, notes, consented photos and ghost snapshots are added as they happen.
- **Classification:** each item is `observed`, `derived` or `synthetic`. Everything from the Lab is synthetic.
- **MAC addresses:** browsers do not expose them. SecureSynth never fabricates them, scans for them or fingerprints devices; the registered device cookie is the correlation key.
- **Photographs:**
  - only on an analyst's request, and only with explicit consent in the customer's own browser (`getUserMedia` in a secure context);
  - preview, retake, confirm or decline, with the camera stream always stopped;
  - validated by type, file signature and size limit, then encrypted;
  - viewable only by analysts, with every access and download recorded;
  - no facial recognition, and never treated as proof of identity.

## Vault integrity (threat model)
- **Content hashes:** SHA-256 over canonical JSON or over the file bytes.
- **Ledger:** each entry hashes the canonical entry including the previous entry's hash, on two chains (`genuine`, `lab`). Writes are serialised.
- **Verification:**
  - detects modified content, missing files, modified ledger entries and broken links;
  - records alerts and marks the incident unread;
  - **never repairs anything**.
- **Limits:** this is **tamper-evident, not immutable**. Someone who controls the whole storage can rewrite the data and its hashes together. Stronger guarantees need checkpoints anchored outside the system.
- **Legal status:** the system does not establish legal admissibility.

## Fraud correlation (`app/intel/correlation.py`)

| Rule | Indicator | Strength |
|---|---|---|
| R1 | Shared IP | Weak; moderate within 24 h; loopback/private addresses never above weak |
| R2 | Shared device cookie | Moderate across different customers |
| R3 | Shared payee reference | Moderate across different customers |
| Corroboration | Two or more independent indicators | Strong |

- **Limits:** at most 60 incidents and 300 nodes; 2-hop expansion.
- **Privacy:** identifiers are masked by default, and revealing them is audited.
- **Use:** correlations are leads only. Nothing blocks a user, blacklists a payee or files a report automatically.

## SOC metrics (`app/intel/soc.py`)
- **Source:** computed from records on every request, with definitions included in the response.
- **Money buckets:** protected-completed, prevented exposure (each stopped transaction counted once), confirmed loss (completed transfers by sessions an analyst retained or revoked) and synthetic value. They are never summed together.
- **Lab data:** can be filtered out.
- **Not measurable:** notification delay (polling interval ≤ 4 s).

## Investigation summaries (`app/intel/summary.py`)
- **Default generator:** `deterministic-v1`.
  - Each section is typed (fact, interpretation or recommendation) and carries evidence references.
  - Summaries never accuse anyone and never take actions.
  - A summary goes stale when the evidence version changes, and approval requires a fresh one.
- **Optional LLM rewrite:**
  - **Configuration:** official `anthropic` SDK, plus `SS_AI_PROVIDER=anthropic`, `SS_AI_API_KEY`, `SS_AI_MODEL` (default `claude-opus-5-5`) and `SS_AI_EXTERNAL_APPROVED=true`.
  - **Safeguards:** IP addresses and payee references are redacted from the input; evidence text is passed as data; there are no tools; the output is schema-validated and must cover every section.
  - **Labelling:** the result is labelled `llm:<model>`.
  - **Fallback:** if the provider fails, the deterministic summary is used and the failure is noted.
  - **Rate limit:** 20 generations per analyst per minute.

## Cybercrime reporting (`app/intel/reports.py`)

**Stages:**
1. Draft (editable, with disclosure toggles)
2. Review
3. First confirmation (7-item checklist)
4. Final confirmation (reason, fresh TOTP and a typed phrase: `SUBMIT DEMO` or `CONFIRM REAL REPORT`)
5. Submission (demo) or handoff (official)

**Confirmation safeguards:**
- Each confirmation is bound to the report version, the evidence-manifest hash, the destination and the analyst.
- It expires after 10 minutes and can be used once; any edit invalidates it.
- Single submission is enforced with conditional updates.

**Destinations:**
- **Demo (default):** a local service. Every screen and file says "DEMONSTRATION ONLY — NO REAL GOVERNMENT COMPLAINT WILL BE FILED."
- **Official:** the National Cyber Crime Reporting Portal (https://cybercrime.gov.in/, helpline 1930, I4C, Ministry of Home Affairs).
  - There is no public complaint-submission API, so SecureSynth never submits. The authorised complainant files on the portal themselves (login, OTP, CAPTCHA), and the analyst then records the acknowledgement.
  - Without the acknowledgement document the report stays "Official Submission Unverified".
  - Disabled by default (`SS_OFFICIAL_REPORTING_ENABLED`). Lab incidents are refused by the server.

**Exports:**
- **Formats:** PDF, JSON and ZIP (report, metadata, transactions, timeline, custody, notes, correlations, a consented photo only if the analyst includes it, and a SHA-256 manifest).
- **Exclusions:** no passwords, OTP secrets, tokens or keys (tested).

## Scenario Lab
- **Scenarios:** 11. Scenarios 8–11 cover escalation, correlation, tamper detection and the live SOC.
- **Simulated time:** a scenario's shift applies only to its own requests, which are marked by the in-process Lab token.
- **Separation:** Lab restrictions never attach to genuine incidents.
- **Reset:** purges only Lab investigation data. Genuine evidence and the runtime configuration are kept, and genuine ghost activity is copied into the vault first.

## New API routes (admin unless noted)

| Area | Routes |
|---|---|
| Ghost Banking control | `GET/PUT /admin/ghost-config` |
| Evidence | `GET /admin/incidents/{id}/evidence`<br>`GET /admin/evidence/{eid}/content[?download=true]`<br>`POST /admin/evidence/verify`<br>`GET /admin/incidents/{id}/custody`<br>`GET /admin/integrity/alerts`<br>`POST /admin/evidence/{eid}/delete`<br>`POST /admin/incidents/{id}/notes` |
| Photographs (analyst) | `POST /admin/incidents/{id}/photo-request`<br>`POST /admin/photo-requests/{pid}/cancel` |
| Photographs (customer, own session only) | `GET /auth/photo-request`<br>`POST /auth/photo-request/{pid}/submit`<br>`POST /auth/photo-request/{pid}/decline` |
| Timeline, graph, SOC | `GET /admin/incidents/{id}/timeline`<br>`GET /admin/intel/graph`<br>`GET /admin/soc/metrics` |
| Summaries | `GET/POST /admin/incidents/{id}/summary`<br>`PUT /admin/summaries/{sid}`<br>`POST /admin/summaries/{sid}/approve` |
| Reports | `POST /admin/incidents/{id}/reports`<br>`GET /admin/reports`<br>`GET/PUT /admin/reports/{rid}`<br>`POST .../review`<br>`POST .../confirm-first`<br>`POST .../confirm-final`<br>`POST .../official-ack`<br>`POST .../cancel`<br>`POST .../demo-status`<br>`GET .../export?format=pdf\|json\|zip` |

## New environment variables (safe defaults)
```
SS_GHOST_BANKING_APPROVAL_REF=        # mentor approval reference; empty = not approved
SS_EVIDENCE_DATABASE_URL=             # default: evidence.db next to the protected DB
SS_EVIDENCE_STORE_DIR=                # default: evidence_store/ next to the protected DB
SS_DEMO_CCR_DATABASE_URL=             # default: demo_ccr.db next to the protected DB
SS_EVIDENCE_RETENTION_DAYS=365
SS_EVIDENCE_MAX_UPLOAD_BYTES=3000000
SS_TRUSTED_PROXIES=[]                 # JSON list of reverse-proxy IPs allowed to set X-Forwarded-For
SS_OFFICIAL_REPORTING_ENABLED=false
SS_REPORTING_INSTITUTION=SecureSynth Demo Bank (synthetic institution)
SS_AI_PROVIDER=none                   # or "anthropic" (requires the official SDK + approval)
SS_AI_API_KEY=
SS_AI_MODEL=
SS_AI_EXTERNAL_APPROVED=false
```

**No new dependencies.** The PDF writer is internal; the graph is plain SVG; the charts use the existing `recharts`.

## Production considerations (not done in this prototype)
- **Storage and keys:** a managed database with encryption at rest, and KMS-held keys instead of the Fernet key in `.env`.
- **Network:** TLS, plus a real reverse-proxy configuration for `trusted_proxies`.
- **Integrity anchoring:** external checkpoints for the evidence ledger.
- **Retention:** retention jobs and legal holds.
- **Access control:** role separation (for example, report approvers who are not the investigating analyst).
- **Notifications:** real-time push instead of polling.
- **Approvals:** mentor approval for Ghost Banking, and I4C onboarding for any official integration.
