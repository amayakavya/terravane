# Terravane Android App — Design

## Purpose

Terravane's operator console and consumer trace page exist today as a
working web app (`web/`) served by the REST API in `server/`. For the
SIH 2026 hackathon this needs a native Android app with full feature
parity, so judges can see a real mobile client, not just a responsive
web page.

## Scope

Full feature parity with `web/`. No new backend behavior — the app is
a pure client of the existing REST API (`server/index.js`,
`server/actions.js`). All business rules (custody transfer validity,
recall propagation, document-hash verification) stay server/contract
side; the app never re-implements ledger logic.

Out of scope: wallet UX, on-device signing, offline write queue,
push notifications (backend has no push infra), iOS.

## Stack

- **Language/UI:** Kotlin, Jetpack Compose, Material 3
- **Networking:** Retrofit + OkHttp, kotlinx.serialization for JSON
- **Async/state:** Coroutines + StateFlow, MVVM (one ViewModel per screen)
- **Navigation:** Navigation Compose, single-activity
- **QR scanning:** CameraX + ML Kit Barcode Scanning (on-device, no network dependency for the scan itself)
- **QR generation (pack label):** reuse server's `/api/qr/:id` SVG endpoint, rendered via Coil (SVG decoder)
- **Local persistence:** Jetpack DataStore — stores selected org/role/base-URL only, no offline data cache in v1
- **Min SDK:** 24 (Android 7.0) — broad device coverage for a demo without excluding common hackathon-judge phones

## Connectivity

Base URL is a Settings-screen field, defaulting to the deployed
`render.yaml` API origin. This lets the demo run against either the
deployed backend or a laptop-hosted stack on the same WiFi by editing
one field — no rebuild needed. A connectivity banner shows chain head
/ indexed block from `/api/health`, matching the web app's readiness
signal.

## Identity / sign-in

Mirrors the web model exactly: no wallet, no password. Sign-in screen
fetches the enrolled organisation/role list (same data the web sign-in
page uses) and lets the user pick org + role. The node signs
server-side on behalf of the selected participant. Selected org/role
persisted in DataStore so relaunching the app skips back to the
dashboard.

## Screens

Each maps 1:1 to an existing `web/*.html` page and calls the same
`/api/*` endpoints that page's JS calls.

| Screen | Source parity | Key endpoints |
|---|---|---|
| Sign-in | `index.html` | org/role enrollment list |
| Dashboard | `dashboard.html` | `/api/stats`, `/api/batches`, `/api/notifications` |
| Lot dossier (6 tabs: overview, route, timeline, lineage, cold chain, actions) | `lot.html` | `/api/batches/:id`, `/api/batches/:id/lineage` |
| Register produce | `register.html` | `/api/actions/harvest`, `/api/documents` |
| Inspect produce | `inspect.html` | `/api/actions/inspect` |
| Handover (propose/accept) | part of `lot.html` actions tab | `/api/actions/transfer`, `/api/actions/accept`, `/api/actions/cancel` |
| Inventory | `inventory.html` | `/api/batches?q=&stage=&flag=` |
| Global search | `search.html` | `/api/batches?q=` |
| Notifications | `notifications.html` | `/api/notifications?as=` |
| Regulator view (admin) | `regulator.html` | region-scoped recall/breach/food-miles data |
| Consumer trace (QR scan) | `trace.html` | CameraX scan → `/api/trace/:id`, no sign-in |
| Pack label | `label.html` | `/api/batches/:id`, `/api/qr/:id` |

## Architecture

```
app/
  data/          Retrofit API interface, DTOs (kotlinx.serialization), repository layer
  domain/        plain Kotlin models (mapped from DTOs), shared with all screens
  ui/
    signin/  dashboard/  lot/  register/  inspect/  handover/
    inventory/  search/  notifications/  regulator/  trace/  label/  settings/
    common/      shared Compose components (status chips, map view, icon set)
  nav/           NavHost + route definitions
```

One `TerravaneApi` Retrofit interface for all endpoints. One
`Repository` layer wrapping it (mockable for tests). ViewModels depend
on the repository, never on Retrofit directly.

## Localization

English + Hindi via Android's standard `strings.xml` / `strings-hi/`
resource qualifiers, matching the two languages already in `web/`.

## Error handling

Reverts decoded server-side already return names like `NotCustodian`;
the app surfaces that string directly in a snackbar/dialog rather than
a generic "action failed" — same behavior as the web console.

## Testing

- Unit tests on ViewModels with a fake Repository (no real network)
- No new server/contract tests needed — this app touches no chain logic

## Build/demo notes

- `local.properties` or a Settings-screen field holds the API base URL — never hardcoded per-environment, so switching between deployed and laptop demo needs no rebuild
- App icon/theme: same green/gold agriculture palette as the SIH pitch deck and `tailwind.config.cjs` web theme, for visual consistency across web, deck and app
