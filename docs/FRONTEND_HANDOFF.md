# Frontend Renaissance — handoff (Master Prompt #04)

**Status: WIP prototype, awaiting the user's visual approval.** Do not extend the redesign to other pages until it is approved.
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

## Pending before the approval checkpoint
- [ ] Mobile 375 px for both pages.
- [ ] `prefers-reduced-motion` check.
- [ ] `?gl=0` fallback check.
- [ ] Production build: chunk sizes and the three.js chunk lazy-loaded only on `/` and `/soc/intelligence`.
- [ ] `make test` (89) and the frozen-manifest check.
- [ ] Offline check: no external requests.
- [ ] Screenshots into `docs/screenshots/renaissance/`.

## Next steps after approval (not started)
1. Apply the system to the customer portal: floating glass nav, balance typography, step-up focus experience.
2. Trusted-device page.
3. Scenario Lab as an event-sequence visualisation.
4. Evaluation as editorial data story.
5. Full-screen Judge Mode.
6. Retire the legacy `design/` styles.
7. Update `RESOURCES.md`.

All of this sits within the `team-handoff.md` §4 invariants: frontend only, contract v1.2.0, no scores on customer screens, Ghost Banking off.
