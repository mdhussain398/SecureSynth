# Frontend Renaissance — handoff (Master Prompt #04)

**Status: WIP. Execution approved 2026-11-25; the redesign covers every page and every page has now been checked in the browser (see "Full redesign"). Reduced motion still needs a real-OS check.** Do not extend the redesign to other pages until it is approved.
**Branch:** `feat/frontend-renaissance` (from the stable MVP `313db81` on `feat/mvp-checkpoint`).
- Push only to this branch.
- Never merge into `feat/mvp-checkpoint` or `main` without explicit approval.

Read `docs/team-handoff.md` first (MVP invariants, frozen ML). Everything there still applies.

## Resume on another machine
```bash
git fetch origin && git switch feat/frontend-renaissance
```
```bash
make setup
```
```bash
make dev-backend
```
```bash
make dev-frontend
```
- `make setup` installs the pinned Python and npm dependencies, generates the local `backend/.env`, trains the model (deterministic) and seeds the demo database.
- **Credentials:** synthetic demo credentials are written to `backend/artifacts/demo_credentials.json`, which is local only and gitignored.
  - Sign in as `analyst` for the Command Centre.
  - A new browser triggers a trusted-device step-up: pair `/device` with the account's `trusted_device_key`.
- No other local configuration is needed. No secrets live in the repo.

## Creative direction (approved brief, as implemented)
- **Reference studied:** landonorris.com. Ideas taken, not assets:
  - one central subject with a tactile reveal;
  - topographic contour lines;
  - huge condensed type as composition;
  - sparse chrome pinned to the corners.
- **SecureSynth translation:** contour lines = **behavioural topography**. In the Command Centre they are computed from the customer's real 24-hour activity profile (`baseline.trusted.hour_profile`). The glass **identity orb** is the single focal subject.
- **Palette** (`src/renaissance/rn.css`):

  | Role | Hex |
  |---|---|
  | Porcelain | `#F5F7FA` |
  | Crystal | `#FFFFFF` |
  | Silver | `#C0C7D1` |
  | Electric | `#005BFF` |
  | Graphite | `#101828` |
  | Step-up (amber) | `#B54708` |
  | Block (red) | `#C01048` |

  Amber and red are used only for security states.
- **Type:**
  - Archivo Variable, condensed (`wdth` 66, weight 760), sentence case, for display.
  - Geist Variable for UI, with tabular numerals.
  - Both OFL, bundled locally via @fontsource.
- **Glass:** only on floating navigation and focused overlays (`.rn-glass`), never as a generic card.
- **Motion:**
  - one orchestrated entrance per page;
  - spring-based navigation indicator;
  - animated risk number;
  - decision-word transition;
  - orb colour lerps between states;
  - reduced motion respected (CSS durations become 1 ms; motion hooks skip; the orb renders on demand with no idle animation).

## Dependencies added (exact pins, all MIT/OFL)
| Package | Version | Licence |
|---|---|---|
| `three` | 0.187.0 | MIT |
| `@react-three/fiber` | 9.8.2 | MIT |
| `motion` | 14.14.0 | MIT |
| `@fontsource-variable/archivo` | 5.3.0 | OFL-1.1 |
| `@fontsource-variable/geist` | 5.3.0 | OFL-1.1 |
| `@types/three` (dev) | 0.187.0 | MIT |

- No drei and no GSAP, to avoid overlapping libraries.
- No runtime network assets: the environment map is `RoomEnvironment` (procedural) and the core glow is a canvas texture.
- **TODO:** add these to `docs/RESOURCES.md` once approved.

## Component architecture (`frontend/src/renaissance/`)
| File | Role |
|---|---|
| `rn.css` | Design tokens and base styles, scoped to `.rn` inside Tailwind's `components` layer, so utilities override. Legacy pages are untouched. |
| `primitives.tsx` | `AnimatedNumber`, `Stagger`, `usePointerField`, `CursorLight`, `GlassNav` (layoutId pill), `Contours` (marching squares, deterministic). |
| `orb/types.ts` | Signal and state types, colours, `webglAvailable()` (`?gl=0` forces the fallback), fibonacci placement. |
| `orb/OrbScene.tsx` | R3F scene: glass shell (back face + clear-coat front), fresnel rim shader, procedural glow, orbit rings, identity core, signal nodes with nearest-neighbour edges. Dashed edges animate around deviating signals. Lazy-loaded chunk. |
| `orb/IdentityOrb.tsx` | Chooses WebGL or the CSS `OrbFallback`. The fallback stays visible until the first WebGL frame, then crossfades. An error boundary keeps the fallback if WebGL fails. |
| `Landing.tsx` | Route `/`: headline, hero orb (illustrative watched-signal categories, **no customer data**), glass nav, CTA to `/login`, live `/api/health` status. |
| `Intelligence.tsx` | Route `/soc/intelligence` (admin only; redirects to `/login` or `/bank`). |

`Intelligence.tsx` in detail:
- **Live session stream** from `/admin/sessions`; the presenter's own session is filtered out.
- **Digital Twin:** signals = keys of `assessment.features`; levels = backend `deviations[].severity`; state = `decision`. This is a visualisation of backend output, **not the model**, and the page says so.
- **Big animated risk index** with the decision word.
- **Signal inspector** (observed vs usual).
- **Expandable technical details** (ML × weight, policy points, model, latency).
- **Checkpoint telemetry strip** and a link to the full investigation.

**Other edits:**
- `App.tsx`: lazy routes for `/` (previously a redirect to `/login`) and `/soc/intelligence`.
- `api/queries.ts`: `enabled: !!id` on `useSessionDetail` and `useBaseline`. Harmless for existing pages.

## Verified so far (real backend, built-in browser)
- `npx tsc -b`: clean.
- **Landing** at 800 px and 1440 px: composition renders; the WebGL orb takes over from the CSS fallback.
- **Intelligence** at 1440 px with real data:
  - Ravi, BLOCK 99.5: red state, Browser signal (high) ringed, Location (medium) amber.
  - Meera, ALLOW 61.3: calm blue; checkpoint strip shows Sign-in 88 Step-up → Transfer 61 Allowed.
- **Auth guard:** an expired session is sent to `/login`.
- **Console:** no JS errors. The only error lines are HTTP 401/403 statuses from earlier sessions.
- **Bugs found and fixed:**
  - Tailwind v4 ambiguous `text-[var(--x)]` / `border-[var(--x)]` → explicit `color:` / `length:` hints.
  - Unlayered CSS beating utilities → moved into `@layer components`.
  - `.rn a` specificity hid the primary button label.
  - Glass washed out to white with transmission on a transparent canvas → thin reflective shell.
  - Over-strong rim → toned down.
- **Environment note:** the browser pane throttles `requestAnimationFrame` to about 2 fps when unfocused (measured). First screenshots can predate the WebGL frame. This is not a product bug.

## Prototype checkpoint verification (actual results, 2026-11-25)
| Check | Result |
|---|---|
| `npx tsc -b` | clean |
| `npm run build` | OK, no warnings. Three.js + scene isolated in the lazy `OrbScene` chunk (**245 KB gzip**), loaded only where an orb renders. Main `index` 78 KB gzip; `primitives` (motion) 57 KB gzip. |
| `make test` (backend) | **89 passed** |
| Frozen manifest | verified, `iforest-v1-956f432a` (no ML or backend files touched) |
| Mobile 375 px | landing and Command Centre: no horizontal scroll. Console nav moves to a floating bottom glass bar on phones; the hero orb moves to the upper right so the type stays legible. |
| Desktop 1440 px and 800 px | landing and Command Centre render as designed |
| WebGL fallback (`?gl=0`) | CSS orb shown; **0 canvases; three.js never downloaded**; real signals and state still shown |
| Fallback → WebGL crossfade | CSS orb shown until the first WebGL frame (`data-ready`), then crossfades; error boundary keeps the fallback on GL failure |
| Offline | every request goes to `localhost:5173` only; fonts load locally (`geist-latin-wght`, `archivo-latin-wdth`) |
| Real data | Ravi BLOCK 99.5 (red; Browser high; Location medium); Meera ALLOW 61.3 (blue; Sign-in 88 Step-up → Transfer 61) |
| Auth | expired session → `/login`; a customer is redirected to `/bank` (route guard is UX only; backend enforces) |
| Console | no JS errors (only HTTP status lines from earlier sessions; a three `Clock` deprecation warning from inside r3f) |
| Reduced motion | **code-level only**; the browser pane cannot emulate `prefers-reduced-motion`. Paths: `useReducedMotion` disables entrances, the cursor light and number tweening; the orb uses `frameloop="demand"` with no idle rotation, pulse or dash animation; the CSS rule cuts transitions to 1 ms. **Re-check on a real browser with OS reduced motion enabled.** |

Screenshots: `docs/screenshots/renaissance/` (landing desktop and mobile; intelligence BLOCK, ALLOW, mobile and no-WebGL).

Known issues:
- The three `Clock` deprecation warning comes from r3f internals.
- In the browser pane, unfocused frames are throttled to 2 fps (measured), so first screenshots can predate the WebGL frame.
- Legacy pages (`/login`, `/bank`, old `/soc/*`, `/lab`) still use the old design.
- The landing "Scenario Lab" entry goes to the legacy Lab.

## Refinement pass (user review, 2026-11-25)
The user approved the direction but asked for a refinement pass first. What changed:
- **Orb → optical glass sculpture** (`orb/OrbScene.tsx`, rewritten):
  - Solid sphere with real `transmission`, IOR 1.32, dispersion and light absorption.
  - Reflections come from a procedural studio environment of softbox strips plus an electric-blue fill (no assets).
  - An opaque backdrop (page-matched porcelain, an electric glow and faint etched contours) gives the glass something to refract. The canvas edge is feathered with a CSS radial mask so it melts into the page.
  - Removed the orbit rings, the node-and-edge network and the neon rim (the "atom diagram" look).
  - Signals are small inclusions inside the glass; deviating ones glow in their severity colour, and a hairline runs from each one to the identity core.
  - The selection ring always faces the viewer. Hit targets are generous.
  - Motion: only the inner inclusions rotate (0.035 rad/s); the pointer tilt is damped (λ 1.6) and small; the core breathes ±6% (BLOCK: faster, ±10%).
  - `NeutralToneMapping` keeps the whites clean.
- **CSS fallback** restyled as glass (absorption edge, electric caustic, softbox highlights); no rings.
- **Background depth:** a top light falls to a deeper porcelain (`.rn` background). Stage light sits behind the orb, with a contact shadow beneath it.
- **Contours:** opacity 0.40–0.45, thinner strokes, and a `clearAt` radial mask so they fade out around the focal subject.
- **Type:** the secondary scale was raised:

  | Token | Size |
  |---|---|
  | xs | 13 px |
  | sm | 15 px |
  | base | 17 px |
  | md | 19 px |
  | lg | 24 px |

  `--graphite-3` was darkened to `#4A5466` (7.4:1).
- **Liquid glass nav** (`.rn-glass`):
  - Heavier blur and saturation, a specular top line, a gradient lensing edge (`::before` mask), and a blue-tinted float shadow.
  - The active item is a raised crystal lens (`.rn-lens`) instead of a black fill.
- **Command Centre composition** (`Intelligence.tsx`):
  - The orb sits on an **instrument bezel** (`Bezel`). Its arc is the real risk index (0–100), and amber and red ticks mark the real step-up and block thresholds.
  - **Deviating** signals are called out on the ring, in diagonal slots (`RING_SLOTS`, up to 8) so they stay clear of the side columns. Signals within normal behaviour are listed under the orb. Both select the signal. On narrow screens the callouts wrap below the orb.
  - Inclusions sit at 0.72 of the radius, because points near the glass edge were distorted by refraction.
  - The stage glow is tinted by the decision. Labels were shortened to fit the ring.

Screenshots: `docs/screenshots/renaissance/refine-*.jpg`: landing desktop and mobile; Command Centre BLOCK, ALLOW, mobile and no-WebGL.

**Refinement verification (actual, 2026-11-25):**

| Check | Result |
|---|---|
| `tsc -b` | clean |
| Build | OK; `OrbScene` lazy chunk 244 KB gzip. Vite prints its >500 kB chunk-size advisory for this lazy chunk; it is expected. |
| `make test` | **89 passed** (no backend or ML files touched) |
| Ravi | BLOCK 99.5: red arc nearly full; Browser (high) and Location (medium) on the ring; Travel speed (low) |
| Meera | ALLOW 61.3: blue arc to 61; threshold ticks visible; checkpoint strip Sign-in 88 → Transfer 61 |
| 375 px | no horizontal scroll on landing or the Command Centre |
| `?gl=0` | 0 canvases, OrbScene never fetched, no off-host requests |
| Console | only HTTP 401s from before sign-in |

- **Bugs found and fixed in the pass:**
  - Scripted CSS edit corrupted `rn.css` (an empty slice) → restored from git and reapplied.
  - Risk arc drawn as dashes (`vector-effect: non-scaling-stroke` breaks `pathLength` dashing) → viewBox-unit stroke.
  - Bezel covered by the canvas → drawn above it.
  - Bezel offset on mobile → anchored to the orb square.
  - Edge inclusions smeared by refraction → moved inward.
- **Still not verified:** reduced motion in a real browser with the OS setting on.

## Full redesign (after approval, 2026-11-25)
**One design system everywhere.**
- `design/tokens.css` now holds the Renaissance tokens on `:root`, and the legacy names (`--ink`, `--surface`, `--accent`…) resolve to them. Every legacy screen inherits the palette, Geist and Archivo, and the radius hierarchy (10/18/28) without a rewrite.
- `.serif` headings render in condensed Archivo.
- IBM Plex Sans and Source Serif 4 are uninstalled; fonts are imported once in `index.css`.
- **Dark mode:** light is the default; dark is an explicit toggle in the console, with explicit dark tokens and smoked glass. Old `auto` preferences fall back to light.

| Area | What changed |
|---|---|
| Components (`design/components.tsx`) | Graphite pill primary buttons, crystal panels with a soft shadow, pill badges, larger type. |
| Shells (`layout/layouts.tsx`) | Floating `GlassNav` in the portal and the console, bottom glass nav on phones, `BrandMark`. Sign-in screens sit on the behavioural topography. Console nav adds Intelligence and Judge mode (`consoleNav` is shared with the Intelligence page). |
| Bank overview | The balance is the composition: large Archivo figure, account context, two actions. Activity sits in a crystal panel. |
| Step-up focus experience (`ApprovalWaiting`) | Full-screen frosted overlay. The number to match is the subject, with a slow waiting halo that is static under reduced motion. No countdown, because challenge expiry is backend time. |
| Sign-in, restricted and outcome screens | Glass focus panels with display headings. |
| Trusted device (`/device`) | Graphite device frame and large number-match buttons. |
| Scenario Lab | Results are an event sequence (`renaissance/RunSequence.tsx`): a stage rail (Authentication → Behavioural assessment → Risk evaluation → Decision → Outcome), steps with actor, request, risk index and decision, simulated-time markers on the spine, and an outcome panel with real before and after balances. |
| Evaluation | Editorial lead (recall and genuine-session interruption vs static rules, straight from the frozen report), display section headings. Chart comparators are graphite and silver; amber and red stay reserved for security states. |
| **Judge Mode (`/judge`)** | Full screen, admin only. Pick a scenario; **Run live** calls the real Lab API, and the recorded steps are revealed one at a time (all at once under reduced motion). The orb shows the session assessment whose backend score matches the latest revealed checkpoint. Keys: R runs, Esc exits; there is a full-screen toggle. |
| `renaissance/signals.ts` | Shared signal mapping, also used by Intelligence. |

**Verified (actual):**
- `tsc -b` is clean and the build passes (JudgeMode chunk 2.9 KB gzip; OrbScene unchanged).
- `make test`: 89 passed.
- Browser at 1440 px: Sessions, Evaluation, Lab, trusted device, Sign in and Judge Mode. In Judge Mode the takeover run played through to Blocked 99.1; the protected balance was unchanged; the orb showed the matched assessment's signals.
- 375 px: no horizontal scroll on `/login`, `/device`, `/soc`, `/soc/evaluation`, `/lab`, `/judge`, `/soc/users`.

**Customer portal check (user signed in as Meera, 2026-11-25):**
- Overview, Transactions, Payees, Transfer and the transfer outcome render in the system at 1440 px.
- Adding a new payee produced a real STEP_UP; the full-screen focus overlay showed the backend's number to match. The challenge was left unanswered, so it expires and the payee is not added.
- 375 px: overview, transactions, payees and transfer have no horizontal scroll. Fixed: the decorative glow overflowed (the shells now use `overflow-x-clip`), and the phone nav is tighter so its four items fit.
- **Demo state changed by testing:**
  - A ₹45,000 transfer from Meera to her trusted payee was allowed and completed (synthetic money).
  - Several lab sessions were created.
  - Use *Reset demo* in the Lab (it restores the pristine snapshot) before presenting.

**Not verified:** reduced motion with the real OS setting on.

Screenshots: `docs/screenshots/renaissance/` (`judge-mode-takeover`, `evaluation-desktop`, `sessions-desktop`, `bank-overview-desktop`, `bank-overview-mobile`, `bank-step-up-focus`, plus the earlier `refine-*`).

## Remaining work
1. Reset the demo data, then check reduced motion with the real OS setting on.
2. Rehearse Judge Mode on the presentation machine (full screen, projector contrast).
3. Optional: give the session investigation page (`/soc/sessions/:id`) and Baselines bespoke layouts; they currently inherit the system.

## Next steps after approval (superseded by the section above)
1. Apply the system to the customer portal: floating glass nav, balance typography, step-up focus experience.
2. Trusted-device page.
3. Scenario Lab as an event-sequence visualisation.
4. Evaluation as editorial data story.
5. Full-screen Judge Mode.
6. Retire the legacy `design/` styles.
7. Update `RESOURCES.md`.

All of this sits within the `team-handoff.md` §4 invariants: frontend only, contract v1.2.0, no scores on customer screens, Ghost Banking off.

## Competition-readiness check (2026-11-25)
| Check | Result |
|---|---|
| `make test` | 89 passed |
| `npm run build` | OK |
| Frozen manifest | 6/6 hashes match, `iforest-v1-956f432a` |
| All six Lab scenarios | Outcomes match their expected text (see `docs/DEMO.md`) |
| Judge Mode | Steps reveal one by one; R runs; Esc exits to Intelligence |
| Full-screen button | Did not engage inside the desktop app's browser pane (Fullscreen API likely blocked there). Check it in Chrome; F11 works as a fallback. |
| Reset demo | Ran afterwards (seed `518023119e69b9c4`); only the analyst session remains |

## Later fixes and continuation (2026-11-25)
- `c5f312d`: the landing headline size is now capped by viewport height (`min(10.5vw,15vh)`), so it no longer overlaps the header in short or narrow Safari windows.
- Cross-machine continuation and the rest of Master Prompt #05 (Synth Core logo, documentation, presentation, freeze): see `docs/MAC2_HANDOFF.md`.

## Synth Core logo (Master Prompt #05, Phase 1, 2026-11-25)
The new brand system lives in `frontend/src/brand/`:
- SVG nav mark;
- lazy R3F glass hero at `/brand`;
- static SVG and PNG exports and favicons in `frontend/public/`.

It replaces `BrandMark` and the inline landing and Intelligence marks; the behavioural orb is unchanged. Measured FPS, fixes and details: `docs/MAC2_HANDOFF.md` §12.
