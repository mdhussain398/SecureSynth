# SecureSynth frontend

Vite + React + TypeScript single app with four route groups that share one token set and component kit:

| Route group | Audience | Notes |
|---|---|---|
| `/login`, `/login/verify`, `/login/approve` | everyone | password → TOTP → (optional) trusted-device number match. Role decides redirect: admin → `/soc`, customer → `/bank`. |
| `/bank/*` | customer | overview, transactions, payees, transfer. Never shows scores, thresholds, feature names or counterfactuals. |
| `/device` | trusted device (simulated) | authenticates only with `X-Device-Key` (stored in `localStorage.ss_device_key`), no cookies. |
| `/soc/*`, `/lab` | admin | Security Command Centre and Scenario Lab. |

## Run

```bash
npm install
npm run dev        # http://localhost:5173, proxies /api → http://127.0.0.1:8000 (backend must be running)
npm run dev:mock   # same UI against the in-browser mock backend (no backend needed)
npm run build      # type-check + production build
```

Mock mode (`VITE_USE_MOCKS=true`, set by `.env.mock`) uses clearly synthetic data (`SYN-` refs).
Mock logins use password `demo` and any 6-digit code except `000000`:
`asha` (ALLOW), `vikram` (STEP-UP — approve on `/device` with any device key), `imran` (BLOCK → restricted), `admin` (Command Centre + Lab).
Mock state is kept in `localStorage.ss_mock_state` so the `/device` tab and the banking tab share challenges; clear it to start fresh.

## Types

`src/api/types.ts` is the frozen hand-written contract (v1.0.0) — do not edit without agreeing a contract bump.
Once the backend runs, regenerate OpenAPI types to diff against it:

```bash
npm run types      # openapi-typescript http://127.0.0.1:8000/openapi.json -o src/api/openapi.d.ts
```

## Layout

```
src/api/        client.ts (fetch wrapper, CSRF, ApiError), mock.ts, queries.ts (TanStack Query hooks), types.ts (frozen)
src/design/     tokens.css (colour/space/radius/type, light + dark), components.tsx (Button, Card, Badge, DecisionPill,
                RiskGauge, Stat, DataTable, EmptyState, ErrorState, Skeleton, Banner, Timeline, Money)
src/layout/     Auth, Portal and Console shells (route guards are UX only — the backend enforces)
src/features/   bank/, device/, soc/, lab/
```

Fonts (IBM Plex Sans, Source Serif 4) are bundled from `@fontsource-variable/*`; nothing is fetched from a CDN at runtime.
