# SecureSynth 3.0: handoff

**State:** uncommitted work on `feat/frontend-renaissance`, on top of commit `d2a1ab4`. Nothing is committed or pushed.

**Status labels used in this file:**
- **VERIFIED:** confirmed by automated tests and/or in a real browser.
- **TESTED:** covered by automated tests only.
- **UNVERIFIED:** not confirmed.

## 1. Completed features

### Ghost Banking runtime control (VERIFIED)
- **Where:** a persistent analyst toggle on `/soc/dashboard`.
- **Defaults and approval:**
  - The runtime setting defaults to OFF.
  - The deployment gate `SS_GHOST_BANKING_ENABLED` stays false by default.
  - Turning it on is allowed only within the gate and only with mentor approval (`SS_GHOST_BANKING_APPROVAL_REF`) or in demo mode.
- **Controls:** a reason, a fresh analyst TOTP code, and an optimistic version check. Every change is audited.
- **Safe disable:** live ghost sessions become restricted, never protected banking.
- **Persistence:** the setting is kept across restarts and across Lab resets.

### Evidence vault (VERIFIED)
- **Storage:**
  - a separate `evidence.db`;
  - Fernet-encrypted files in `backend/evidence_store/` (git-ignored, random file names);
  - SHA-256 over a canonical JSON form.
- **Hash-chained ledger:**
  - two chains, `genuine` and `lab`;
  - concurrent writes stay consistent (process lock plus a unique `(chain, seq)`).
- **Integrity verification:**
  - detects modified content, missing files, modified ledger entries and broken links;
  - records alerts and never repairs anything.
- **Chain of custody:** a full event history per incident.
- **Retention and authorised deletion:** genuine evidence can't be deleted before its retention date; Lab fixtures can be.

### Evidence collection (VERIFIED)
- **When:** on every restriction (BLOCK, or a denied trusted-device check), recorded as network, device, risk-assessment and transaction evidence.
- **IP address:** taken from the server-observed peer address. `X-Forwarded-For` counts only when the peer is in `trusted_proxies` (empty by default).
- **Classification:** IPv4/IPv6 and public/private/loopback. Lab addresses (TEST-NET) are labelled synthetic.
- **Browser and OS:** parsed from the User-Agent header for display only.
- **MAC address:** always "Unavailable — not accessible through a web browser".
- **Other evidence:** analyst decisions, verification outcomes, notes and ghost activity snapshots.

### Consent-based verification photograph (PARTLY VERIFIED)
- **Request side (VERIFIED):** the analyst sends a request, and the customer is shown a banner and a consent dialog.
- **Error handling (VERIFIED in the browser):** permission denied and decline both behave correctly.
- **Server checks (TESTED):** consent is required; the image type, file signature and size are validated; another session can't see or answer the request; the photo is encrypted at rest; downloads are audited.
- **Live camera capture with a real camera: UNVERIFIED.** The desktop app's browser pane blocks camera access. The Lab synthetic-fixture path (scenario 8) is VERIFIED.

### Investigation workspace `/soc/investigations/:id` (VERIFIED for the parts listed)
- **Overview and financial tab:** real, prevented and synthetic money are kept separate.
- **Evidence tab:**
  - network and device panels, with copy buttons;
  - MAC address status;
  - photo panel;
  - vault table with integrity verification;
  - chain of custody;
  - notes.
- **Timeline tab:** live, polled every 5 s.
- **Summary tab:** generate, edit, approve and copy, with evidence references.
- **Report tab:** see "Cybercrime reports" below.

### Unified incident timeline (VERIFIED)
Merges authentication, risk, audit, Ghost Banking, evidence-ledger and report events, with synthetic events labelled.

### Fraud correlation graph `/soc/intel` (VERIFIED)
- **Rules (R1–R3 plus corroboration):**
  - **R1 shared IP:** weak; moderate within 24 h; never above weak for loopback/private addresses.
  - **R2 shared device cookie:** moderate across different customers.
  - **R3 shared payee:** moderate across different customers.
  - **Corroboration:** two or more independent indicators make it strong.
- **Behaviour:**
  - identifiers masked by default; revealing them is audited;
  - bounded to 60 incidents and 300 nodes;
  - an SVG force layout with zoom, pan, fit, reset, search and filters, a node panel and 2-hop expansion;
  - every correlation carries explanations and limitations.

### SOC dashboard `/soc/dashboard` (VERIFIED)
- **Content:**
  - KPIs computed from records, with a definition for each;
  - performance figures, with "unavailable" where something can't be measured;
  - charts validated with the dataviz palette validator;
  - a live feed;
  - range filters and a Lab-data filter with a visible indicator.
- **Money buckets:** real (protected), prevented, confirmed loss and synthetic, never added together.

### Investigation summaries (VERIFIED, deterministic)
- **Generator:** `deterministic-v1` is grounded in the records. Every section is typed (fact, interpretation or recommendation) and carries evidence references.
- **Staleness:** a summary is marked stale when the evidence changes, and approval is refused until it is regenerated.
- **Optional LLM rewrite:**
  - uses the official `anthropic` SDK only if it is installed, plus `SS_AI_PROVIDER=anthropic`, `SS_AI_API_KEY` and `SS_AI_EXTERNAL_APPROVED=true`;
  - default model `claude-opus-5-5`;
  - the input is redacted, there are no tools, and the output is schema-validated;
  - if the provider fails it falls back to the deterministic summary.
  - **The LLM path is UNVERIFIED against a live API** (no key; tested with mocks).

### Cybercrime reports (VERIFIED for the demo path)
- **Draft:** a pre-filled, editable draft with preview, disclosure redaction toggles and a version number.
- **Workflow:** review, then a first confirmation (a 7-item checklist), then a final confirmation (reason, fresh TOTP and a typed phrase: `SUBMIT DEMO` or `CONFIRM REAL REPORT`).
- **Binding:** both confirmations are tied to the version, manifest hash, destination and analyst. They expire after 10 minutes, are single-use, and any edit invalidates them.
- **Demo service (`app/dummy_ccr`):**
  - a separate `demo_ccr.db`, with no network access (tested);
  - acknowledgements in the form `DEMO-CCR-YYYY-NNNNNN`;
  - duplicates are handled idempotently and concurrent submissions submit once (tested).
- **Exports:** PDF (a minimal PDF writer, no dependencies), JSON, and ZIP (with a SHA-256 manifest and the chain of custody; contains no secrets).
- **Official destination:** a manual handoff to https://cybercrime.gov.in/ (helpline 1930).
  - There is no public complaint-submission API. I4C's bank API is for onboarded institutions only, so **no official adapter is implemented**.
  - Disabled by default (`SS_OFFICIAL_REPORTING_ENABLED=false`).
  - Lab incidents are refused by the server.
  - A report is marked "Officially Confirmed" only after a genuine acknowledgement document is uploaded.
- **Tracking page:** `/soc/reports`.

### Scenario Lab scenarios 8–11 (VERIFIED in the browser)
- **Scenarios:**
  - 8: advanced escalation;
  - 9: correlated investigation;
  - 10: evidence tamper;
  - 11: live SOC.
- **Reset:** purges only Lab data (Lab evidence and files, the Lab chain, Lab reports and summaries, demo complaints). Before the ghost database is emptied, genuine ghost activity is copied into the vault.

### Bug fixes found during verification (all TESTED)
1. **Lab restrictions merged into genuine incidents:** Lab restrictions could attach to a customer's *genuine* open incident. They are now isolated by `is_lab`.
2. **Lab time shift leaked:** a scenario's `at_local_hour` shifted the **global** clock, which expired the analyst's session while the console was polling. The shift now applies only to Lab-runner requests (a `ContextVar` set by middleware from the in-process Lab token).
3. **Scenario 11 measured the wrong window:** its SOC metrics used a 1-hour window that missed Lab events dated at the simulated hour. It now uses ±13 h.
4. **Toggle dialog title flipped after saving:** fixed.
5. **Summary used the wrong reference:** it named the incident reference as the "customer reference". It now says `C000N`.

## 2. Files

### New
- **Backend services:**
  - `backend/app/evidence/{__init__,models,vault,netinfo,collect}.py`
  - `backend/app/intel/{__init__,timeline,correlation,soc,summary,reports,pdf}.py`
  - `backend/app/dummy_ccr/{__init__,service}.py`
  - `backend/app/services/{ghost_control,reauth}.py`
- **Backend router:** `backend/app/routers/investigation.py`
- **Ghost Banking (from the previous task, still uncommitted):** `backend/app/ghost/*`, `backend/tests/test_ghost.py`
- **Tests:** `backend/tests/test_investigation.py`
- **Frontend:**
  - `frontend/src/api/investigation.ts`
  - `frontend/src/features/investigation/{ConfirmDialog,SocDashboard,FraudIntel,InvestigationPage,ReportsPage}.tsx`
  - `frontend/src/features/bank/PhotoVerification.tsx`
- **Docs:** `docs/features/GHOST_BANKING.md`, `docs/handoffs/SECURESYNTH_3_HANDOFF.md` (this file)

### Modified
- **Backend app:** `backend/app/{config,state,models,main}.py`
- **Backend services:** `backend/app/services/{incidents,enforcement,challenges,audit,sessions,clock}.py`
- **Backend routers:** `backend/app/routers/{admin,auth,bank,lab}.py`
- **Other backend:** `backend/app/lab/scenarios.py`, `backend/app/security/secrets_box.py`
- **Frontend:**
  - `frontend/src/{App.tsx,api/types.ts,api/queries.ts,layout/layouts.tsx}`
  - `frontend/src/features/soc/{GhostPage,IncidentsPage,NotificationBell}.tsx`
  - `frontend/src/renaissance/RunSequence.tsx`
  - `frontend/src/design/tokens.css` (adds `--series-aqua`)
- **Docs and config:** `docs/{API,KNOWN_LIMITATIONS}.md`, `.gitignore` (adds `backend/evidence_store/`)

### Schema
- **Protected database (additive and idempotent, via `state.ensure_schema` at startup and after a reset):**
  - new tables `runtime_settings` and `config_changes`;
  - new columns `security_incidents.ghost` and `security_incidents.ref`, with existing rows backfilled.
- **New databases:** `evidence.db` and `demo_ccr.db`, created automatically next to `securesynth.db`. Tests use temporary directories.

## 3. Test results
- **Backend:** see section 7 for the latest full run. The baseline before 3.0 was 127. The new tests are in `test_investigation.py`.
- **Frontend:** `tsc -b` and `npm run build` pass. `oxlint` reports warnings only; some predate this work, and the graph's warnings come from an intentional mutable layout cache.

## 4. Browser verification

Run in the desktop app's browser pane, with the analyst at `127.0.0.1:5174` and the customer at `localhost:5173`.

| # | Step | Result |
|---|---|---|
| 1 | Analyst signs in | PASS |
| 2 | Ghost Banking configuration inspected (OFF, approval status, policy) | PASS |
| 3 | Enabled with a reason and fresh TOTP | PASS |
| 4–5 | Customer signs in; protected balance recorded (₹12,75,000) | PASS |
| 6–8 | ₹3,00,000 transfer → BLOCK 92.3 → session contained (`ghost`) | PASS |
| 9 | Protected funds unchanged by the contained session | PASS (via ghost monitor integrity facts; the balance later changed only through Lab scenario 6's legitimate transfer on the same demo account) |
| 10 | Analyst notified (bell, incident `INC-A424FF136C`) | PASS |
| 11–14 | IP `127.0.0.1` loopback (server-observed), device `dev-8`, Chrome/macOS, MAC unavailable | PASS |
| 15 | Synthetic payee added and ₹75,000 sent via the UI | PASS |
| 16 | Unified timeline with synthetic labels | PASS |
| 17 | Photo request | PASS |
| 18 | Consent and permission-denied handling | PASS |
| — | Live camera capture | NOT RUN (camera blocked in the pane) |
| 19 | Synthetic photo fixture | PASS (scenario 8) |
| 20–21 | Evidence stored; integrity verified (both chains) | PASS |
| 22–24 | Graph rendered (35 nodes, 61 edges); node panel; explanations | PASS |
| 25–26 | SOC dashboard KPIs identical to the API; 4 charts | PASS |
| 27–28 | Summary generated with evidence references | PASS |
| 29 onwards | See section 7 | — |

**Lab scenarios, run in the browser with Ghost Banking ON:**

| Scenario | Result | Detail |
|---|---|---|
| 1 Normal customer | PASS | ALLOW 25.3 |
| 2 Takeover despite password + TOTP | PASS | 99.5, contained, ₹96,200 unchanged |
| 3 Suspicious activity after a legitimate login | PASS | STEP-UP 79.5 |
| 4 Genuine traveller | PASS | 87.7, approved |
| 5 Customer on a new device | PASS | 82.8, approved |
| 6 Unusual but legitimate transfer | PASS | ALLOW 74.0 |
| 7 Ghost Banking containment | PASS | 100.0 |
| 8 Advanced escalation | PASS | DEMO-CCR-2026-000001; duplicate idempotent; ZIP; resolved |
| 9 Correlated investigation | PASS | 3 incidents; strong correlations (IP + cookie + payee) |
| 10 Evidence tamper | PASS | verified → MISMATCH detected and alerted |
| 11 Live SOC | PASS after fix | metrics 20→23 sessions, 14→16 suspicious; summary; draft |

**UI regressions (scroll-hiding header; Intelligence ↔ Sessions transition):** verified in the previous session (commit `d2a1ab4`). The 3.0 work added only nav items and these components were not changed, but they have **not been re-verified** since.

## 5. Remaining tasks and known issues
- **Browser steps not yet run:** see section 7 for the final list.
- **Live camera capture:** test in Safari or Chrome directly (`http://localhost:5173`). The browser pane can't do it.
- **Fresh-TOTP friction:** Lab scenarios drive analyst steps through the service layer, so the fresh-TOTP step isn't exercised there. It is enforced on the API and tested.
- **Display-only User-Agent parsing:** the client can spoof it, and the UI says so.
- **Notification delay:** not measurable server-side (polling every 4 s).
- **Session-mode ghost limitation:** containment mid-session changes the displayed balance (see `docs/features/GHOST_BANKING.md`).
- **Lint:** warnings only.

## 6. How to continue
```bash
cd ~/Desktop/SecureSynth   # Mac 1: /Users/shivakumar/Desktop/SecureSynth
make test
cd frontend && npx tsc -b && npm run build
# Local demo, with the Ghost Banking gate on for this process only (still requires the analyst toggle at runtime):
cd .. && SS_GHOST_BANKING_ENABLED=true make dev-backend     # second terminal: make dev-frontend
```
- **Accounts:** analyst at http://localhost:5173/login. Credentials are in the local `backend/artifacts/demo_credentials.json` (never commit or show it).
- **Turning Ghost Banking on:** SOC → Ghost Banking control → toggle (reason plus TOTP).
- **Lab:** `/lab` lists 11 scenarios. Reset demo keeps genuine evidence and the runtime configuration.

## Configuration and approvals (current)
- **Defaults:** `SS_GHOST_BANKING_ENABLED=false`, `SS_OFFICIAL_REPORTING_ENABLED=false`, `SS_AI_PROVIDER=none`, `SS_TRUSTED_PROXIES=[]`, `SS_EVIDENCE_RETENTION_DAYS=365`.
- **The running local backend** was started with `SS_GHOST_BANKING_ENABLED=true` and an origin allow-list covering ports 5173 and 5174. `.env` was not changed.
- **Outstanding approvals:**
  1. Mentor approval for Ghost Banking (it deceives the session holder; rule book §12).
  2. Institutional onboarding with I4C before any official integration; until then, official reporting is a manual handoff only.
  3. Explicit approval and a DPA-style review before enabling any external LLM.
  4. Legal review before any real use of photographic evidence.

## 7. Latest run (Mac 1, 2026-11-26; transferred from Mac 2)

**Environment:**
- **Location:** `/Users/shivakumar/Desktop/SecureSynth`, user `shivakumar`. The previous Mac 1 copy is kept at `~/Desktop/SecureSynth-Mac1-Backup-20261126-044241`.
- **Reinstalled:** `.venv` (Python 3.12.16, from `backend/requirements.txt`) and `frontend/node_modules` (`npm ci`), because neither was in the archive. `anthropic` is not installed (optional), so summaries use the deterministic generator.
- **Kept as transferred:** `.env`, the credentials, the model and manifest, all databases and the evidence files. Nothing was regenerated.
- **Integrity:** `PRAGMA integrity_check` is `ok` on `securesynth`, `evidence`, `demo_ccr`, `seed` and `ghost`.
- **Ghost Banking gate:** the backend was started with the default configuration, so the gate is **off**. Starting it with the gate on was refused by the local permission system; mentor approval is still outstanding.

**Test results:**

| Check | Result |
|---|---|
| Backend `make test` | **163 passed** (run twice) |
| Frontend `tsc -b` | pass |
| Frontend `npm run build` | pass |

**Bugs fixed in this session:**
6. **Complaint text named the incident as the "customer reference"** (`app/intel/reports.py`). It now reads "customer reference C0005 (incident INC-…)", the same correction already made in the summary generator.
7. **The dashboard said "Active ghost sessions: 7" while the gate is off** (`SocDashboard.tsx`). Those sessions get 403 on every banking route. The label now says "Sessions left in ghost mode (refused while the gate is off)".

**Browser verification, steps 29 onwards:**

| # | Step | Result |
|---|---|---|
| 29–30 | Summary v2 approved; complaint draft `RPT-E25A21C9` created | PASS (previous session) |
| 31 | Complaint description edited and saved | PASS. The interrupted edit had left the analyst note mid-sentence; it was repaired and saved as **v3**, and the change persisted after reload. |
| 32 | Preview, copy, disclosure | Present |
| 33–35 | Exports (fetched in the page, not saved to disk) | PASS. PDF v3 (`%PDF-1.4`, 17.7 KB). JSON v3 (integrity and manifest fields). ZIP with report PDF, incident, transactions, timeline, custody, notes, correlations, README and manifest; no secrets. |
| 36 | Submit for review | PASS (Draft → Awaiting Review) |
| 37 | First confirmation | PASS. Confirm was disabled until all 7 checklist items were ticked. |
| 38 | Final confirmation | PASS. Disabled with a wrong phrase and without a code; the analyst entered a fresh code with `SUBMIT DEMO`. |
| 39 | Acknowledgement | PASS: **DEMO-CCR-2026-000002**, status "Submitted — Demo", both confirmations consumed |
| 40 | Duplicate and late actions | PASS. Review, first confirmation and edit are refused with 409 `REPORT_LOCKED`. A resubmission with a consumed confirmation is refused (403, fresh code required). The acknowledgement is unchanged. Idempotent resubmission is also covered in scenario 8. |
| 41 | Official route on a Lab incident | PASS: 403 `LAB_REPORTING_FORBIDDEN`, nothing created |
| 42 | Official route on a genuine incident with the gate off | PASS: 403 `FEATURE_DISABLED`, nothing created |
| 43 | Protected balance integrity | PASS. farhan was ₹11,25,000 = ₹12,75,000 − ₹1,50,000 (scenario 6, legitimate); the blocked ₹3,00,000 and the contained ₹75,000 never touched it. |
| 44 | Resolution options for a ghost incident | PASS. "Unblock session" is disabled ("Ghost sessions are never restored"). "Clear user restriction" requires a reason and a fresh code. |
| 45 | Analyst resolution (clear user) | PASS. The analyst entered a fresh code. `INC-A424FF136C` → `user_cleared`, reason recorded, resolved by analyst. Ghost session `133a…` **revoked, not restored**. Customer status active. Balance ₹9,75,000 (₹11,25,000 − ₹1,50,000 from the scenario 6 re-run). |
| 46 | Customer recovery (fresh sign-in after clearance) | PASS. farhan signed in afresh on `127.0.0.1:5173`, a separate cookie host so the analyst session was kept. New genuine session `dd2a…` in mode `normal`. `/api/bank/overview` returns 200 from the protected ledger, ₹9,75,000, and the page shows "Protected sign-in" with no restriction notice. |
| 47 | Ghost Banking toggle with the gate off | PASS. OFF and disabled, with the reason shown; the API returns `FEATURE_DISABLED`. The stored runtime value is still "on" from the Mac 2 run but has no effect. |
| 48 | Ghost Banking toggle with the gate on | NOT RUN (gate off on this machine; needs mentor approval or an explicit decision) |
| 49 | Orb on Intelligence | PASS (WebGL ready, 1 canvas) |
| 50 | Intelligence ↔ Sessions navigation | PASS |
| 51 | Scroll-responsive brand | PASS (opacity 0 and −10 px when scrolling down; restored when scrolling up) |
| 52 | All 11 Lab scenarios | PASS (see below) |
| 53 | Scenario 11 window | **RESOLVED.** Metrics moved with the run: sessions 34→37, suspicious 25→27. |

**Lab scenarios, run with the gate off** (numbered as in section 4; the Lab page lists "Unusual but legitimate transfer" last):

| # | Scenario | Result |
|---|---|---|
| 1 | Normal customer | ALLOW, −₹2,500 |
| 2 | Takeover despite password + TOTP | BLOCK, ₹93,700 unchanged |
| 3 | Suspicious activity after a legitimate login | STEP-UP, balance unchanged |
| 4 | Genuine traveller | ALLOW, −₹2,500 (the baseline now knows the travel) |
| 5 | Customer on a new device | STEP-UP, approved, −₹2,500 |
| 6 | Unusual but legitimate transfer | ALLOW, −₹1,50,000 |
| 7 | Ghost Banking containment | BLOCK. With the gate off, the session is **restricted** (403 on overview, payee and history) rather than contained, as the scenario narrative states; balance unchanged |
| 8 | Advanced escalation | BLOCK; summary approved; **DEMO-CCR-2026-000003**; duplicate idempotent; tracking moved to under review; balance unchanged |
| 9 | Correlated investigation | 3 incidents; strong correlations (shared TEST-NET IP plus shared device cookie), with limitations stated |
| 10 | Evidence tamper | Verified → **MISMATCH** detected (EV-8827AE645C2A), alert recorded |
| 11 | Live SOC | Metrics moved (sessions 34→37, suspicious 25→27); summary with evidence references; draft RPT-64A70043 (not submitted) |

**Demo state now:** testing changed balances and added Lab incidents, reports and demo complaints. Use **Reset demo** in the Lab before presenting. It keeps genuine evidence, the genuine report `RPT-E25A21C9` and the runtime configuration.

**Still to do:**
- Step 48 (only if Ghost Banking is approved).
- Live camera capture in Safari or Chrome.
- Reset demo.
- Commit and push once the owner approves; nothing is committed in this session.

## 8. Apple HIG pass (Mac 1, 2026-11-26; uncommitted)

**Touch targets (44 × 44 pt minimum):**
- **Buttons, tabs, switches and nav/header links** get an invisible, centred 44 px hit area through a zero-specificity `::after` rule in `renaissance/rn.css`. Their visual size is unchanged. Inline text links are excluded, and `.no-hit` opts an element out.
- **Glass nav items:** `min-h-11`.
- **Console inputs:** 44 px minimum height.
- **Dropdowns and text fields:** at least 44 px tall (`index.css`); the forced `!min-h-8` heights in 6 files became `!min-h-11`.
- **Checkboxes and radio buttons:** 20 px; the rest of their row is clickable through their labels.

**Text:** nothing renders below 12 px.
- `text-[0.6875rem]` (11 px) → `0.75rem`.
- Chart axis and reference labels 10–11 → 12 (`SessionPage`, `BaselinePage`, `SocDashboard`).
- Fraud graph labels `12/√k`.

**Verified in the browser pane:** 0 text elements under 12 px on 9 pages; all form controls 44 px; no horizontal scroll; Reports and Fraud intel visually intact. `tsc -b` and `npm run build` pass.

**Remaining exceptions:**
- **Adjacent compact controls**, such as the session filter pills, share their overlapping hit areas, so each gets slightly less than the full 44 px.
- **Orb fallback nodes:** these signal dots belong to the CSS fallback orb. They are inert while the WebGL orb is shown.

**Skills installed globally:** transitions-dev and transitions-polish, web-design-guidelines, pick-ui-library, design-taste-frontend (one scanner rated it "Critical Risk"; its Chrome/server scripts have not been run), and Impeccable (no hooks, telemetry off).
- **Not installed:** the Apple HIG upstream bundle (blocked by the permission system).
- **For the user to run:** Mobbin, through `/plugin`.

## 9. Apple typography pass (Mac 1, 2026-11-26; uncommitted)

**Font:** the whole site uses Apple's system font stack: `-apple-system, BlinkMacSystemFont, "SF Pro Display"` for display text and `"SF Pro Text"` for UI text.
- It renders as SF Pro on macOS, iOS and iPadOS, and as the platform's native font elsewhere.
- SF Pro cannot be bundled with a website (Apple's licence), so no font is downloaded. The site stays offline.
- Archivo and Geist were removed: the imports and both `@fontsource-variable` packages.

**Titles** (`.rn-display`, `.serif`): Apple's Large Title style. Bold 700, tracking −0.025em, line height 1.07, with the condensed width axis removed.

**Root cause of the cramped page titles:** unlayered `p { margin: 0 }` and `h1, h2, h3 { margin: 0 }` in `index.css` overrode every Tailwind `mt-*`/`mb-*` on paragraphs and headings across the site.
- Those resets now sit in `@layer base`, so spacing utilities apply as written.
- Example: the page subtitle gap went from 0 px to 14 px.

**Resized for SF Pro's wider letterforms:**
- landing headline: `clamp(2.75rem, min(8.2vw, 13vh), 8.5rem)`;
- bank balance: `clamp(2.75rem, 8.5vw, 6.5rem)`;
- phone hero orb: moved up and made smaller so it no longer sits behind the headline.

**Verified:**
- 12 routes have no horizontal scroll and no overflowing titles at 1440 px (6 at 375 px).
- Landing and Intelligence checked visually, desktop and phone.
- `tsc -b` and `npm run build` pass; the build contains no font files.

**Documentation note:** `docs/project/RESOURCES.md` still lists Archivo and Geist and should be updated before submission.

## 10. HIG detail and polish pass (Mac 1, 2026-11-26; uncommitted)

**Icon placement:**
- **Logo frame:** the Synth Core artwork fills only x 16–48 of its 64-unit square, so in a 28 px slot the visible S sat about 7 px right of the content edge and looked undersized. Inline marks now use a tight frame (`viewBox 13 3 38 58`, width = height × 38/58). Hero and app-icon uses keep the square frame (`square` prop). The favicon is framed on the artwork too.
- **Header controls:** one 44 × 44 round `.rn-icon-btn` with an 18 px glyph for the bell, theme and sign-out. Before, they ranged from 36 × 36 to 45 × 36 with 15–16 px glyphs.
- **Device link:** 44 px tall.
- **Notification badge:** sits inside the button frame instead of hanging off it.
- **Icon weight:** one stroke weight for every lucide icon (1.75, like SF Symbols regular).

**Performance:**
- **Identity orb:** now pauses rendering (`frameloop="never"`) when it is off screen (IntersectionObserver) or the tab is hidden. Before, the GPU worked every frame even in a background tab.
- **Pixel ratio:** device pixel ratio capped at 1.75.

**HIG polish:**
- **Meta tags:** `viewport-fit=cover`, `theme-color`, `color-scheme`, `apple-mobile-web-app-title`, and phone-number detection off.
- **Bottom glass navs** clear the iPhone home indicator (`.safe-bottom` with `env(safe-area-inset-bottom)`).
- **Controls:**
  - no tap highlight or 300 ms tap delay;
  - no text selection on controls;
  - brand-blue selection and caret;
  - overlays contain their scrolling;
  - the page behind an open modal does not scroll.
- **Accessibility settings:**
  - `prefers-reduced-transparency` makes glass solid;
  - `prefers-contrast: more` darkens secondary text and hairlines.
- **Decorative glows:** the blue radial glows were toned down by about 40 % (deference). The Impeccable URL scan had flagged them as decorative spotlight glows.
- **Landing:**
  - the tablet-width orb no longer collides with the Sign in pill;
  - the footer stacks until `md`, so "Risk engine online on this machine" no longer wraps mid-phrase.

**Verified:**
- Landing at 375, ~800 and 1440 px.
- Sign-in and device pages: logo at x = 32 aligned with the content edge, lucide stroke 1.75, no horizontal scroll, orb `data-active` set.
- `tsc -b` and `npm run build` pass.

**Console header (verified after the analyst signed in again):**
- **Icon buttons:** bell, theme and sign-out are 44 × 44 with 18 px glyphs, exactly centred (dy 0). The Device link is 44 px tall. The badge sits inside the bell. Icon stroke is 1.75.
- **One left edge:** the header's padding now sits inside the same 1400 px (console) or 6xl (portal) column as `<main>`, so the logo and page titles share one left edge. At 1440 px the logo and title are both at x 52 on 5 pages, and the last header icon ends at the mirrored right margin (1388).
- **Incidents table:** the table column is wider (`1.3fr / 1fr`) and names do not wrap, so the table no longer scrolls sideways and the "Last activity" column is fully visible.
- **No hidden navigation items:** the 10-item console nav silently scrolled items out of view below about 1440 px. The top glass nav now shows only at 1400 px and above; below that, the floating bottom bar (all 10 items fit at 1280 px) takes over. Nav item padding is tighter below 2xl.
- **Footers:** they clear the floating bottom bar (console below 1400 px, portal on phones). Measured: footer text ends at 688, bar starts at 728.
- **Intelligence:** orb ready and active; no horizontal scroll.

## 11. Previously untested items, now tested (Mac 1, 2026-11-26)

**Ghost Banking on (step 48).** The owner confirmed mentor approval. The backend is running with `SS_GHOST_BANKING_ENABLED=true` for this process only; `.env` is unchanged, and no `SS_GHOST_BANKING_APPROVAL_REF` is recorded yet, so the status reads "allowed in the local demo environment only".
- **Containment (scenario 7):** blocked at 100.0. The attacker saw an ordinary sign-in, and the overview, payee add, ₹40,000 transfer and history were all served from the ghost ledger. farhan's protected balance was unchanged (₹8,75,000).
- **Turning it off (analyst code):** runtime `off`, version 2. All **8 live ghost sessions were restricted** (0 left in ghost mode; none moved to protected banking). The reason was audited.
- **Turning it on (analyst code):** runtime `on`, version 3. Containment verified again with the scenario, balance unchanged.
- **Earlier ₹1,00,000 drop on farhan:** a genuine completed transfer ("trial ghosting", 00:08 UTC) by the owner's own session, which then tried ₹5,00,000 ("ghost trial 2", blocked). Not a ghost leak.

**Live camera capture (Safari, real camera).**
- **Flagged session:** asha was signed in in Safari. ₹3,00,000 was refused for insufficient funds (the balance check runs before risk). ₹1,50,000 → BLOCK 100.0, contained in Ghost Banking, `INC-32CFD343BC`; real balance unchanged at ₹1,72,000.
- **Request and capture:** the analyst requested a photo (`PR-98CCF0C9256E`). The customer consented, allowed the camera and captured. Status `submitted`, consent `1`.
- **Storage:** evidence `EV-91CD6A3E479C`, `verification_photo`, JPEG 57,839 bytes, SHA-256 recorded, retention one year.
  - The file in `evidence_store/` is Fernet-encrypted: it starts `gAAAAA` and contains no JPEG header.
  - Ledger: genuine chain, seq 40, "collected".
- **Integrity:** the photo is `verified`, and both chains are verified.
  - The only mismatches were the 2 Lab tamper fixtures (scenario 10, intentional). Reset purged them.
- **Analyst view:** decrypted JPEG with `no-store`, audited as `evidence.accessed`.

**Not run (owner's choice):**
- Reduced motion with the real macOS setting.
- Judge Mode full screen in Safari.
- External LLM summaries (kept on the built-in generator).

**Reset demo (end of session):** seed `59aff8dfce5d8c27`. Seed hashes differ between machines because each `seed.db` was generated separately.
- **Restored:** balances (asha ₹1,84,500, farhan ₹12,75,000, meera ₹3,12,000, ravi ₹96,200). The only session left is the analyst's (kept signed in); protected-DB incidents cleared.
- **Kept:** genuine evidence (21 items, including the photo), the genuine report `RPT-E25A21C9` with `DEMO-CCR-2026-000002`, and the Ghost Banking runtime setting (`on`, v3).
- **Purged:** Lab evidence, Lab reports and Lab demo complaints.

**Docs:** `docs/project/RESOURCES.md`, `README.md` and `docs/handoffs/FRONTEND_HANDOFF.md` now name the Apple system font instead of Archivo and Geist.

**Note for restarts:** `make dev-backend` without `SS_GHOST_BANKING_ENABLED=true` turns the gate off again, so blocked sessions are restricted instead of contained.
