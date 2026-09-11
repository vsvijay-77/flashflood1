# Environmental Intelligence Network — living spec

National environmental-hazard monitoring and disaster early-warning platform for Indian
government authorities. FastAPI + MongoDB backend, React 19 + TypeScript + Tailwind v4 +
shadcn/ui frontend, Leaflet/OpenStreetMap GIS.

## Auth & RBAC
- Sessions are httpOnly JWT cookies (`ein_session` access 8h, `ein_refresh` 30d) set by
  `/api/auth/login`. No tokens ever travel in JSON. `GET /api/auth/me` answers "who am I".
- **Sessions persist until an explicit logout.** `frontend/src/lib/api.ts` intercepts any
  401, calls `POST /api/auth/refresh` once (single-flight, shared by all concurrent
  requests) and replays the original request. Each refresh re-issues BOTH cookies, so the
  30-day window rolls forward on every use — an active officer is never bounced to /login,
  and cookies are Max-Age based so they survive a browser restart. Only
  `Sign Out` (→ `endSession()` → `POST /api/auth/logout`) ends a session.
  Credential endpoints (login/logout/refresh/register/forgot-password) are excluded from
  the retry so a genuine 401 is not looped.
- Passwords are pbkdf2_sha256 (120k iterations, per-user salt) in `backend/lib/auth.py`.
- Rate limiting on register / login / forgot-password (in-memory, per client host).
- Four internal roles: `admin`, `gov_officer`, `field_officer`, `viewer`.
- Registration designations map onto roles: Administrator→admin; Government Official and
  Disaster Management Officer→gov_officer; Forest Officer and Environmental Officer→field_officer.
- New registrations land as `status: pending` and CANNOT log in until an admin activates
  them from User Management (login returns 403 with the awaiting-verification message).
- Route access (frontend `RoleBasedRoute` + backend `require_roles`):
  - all roles: /dashboard, /gis, /reports, /settings, /profile
  - admin + gov_officer: /digital-twin, /risk, /analytics
  - admin + gov_officer + field_officer: /environmental, /alerts
  - admin only: /sensors, /users
- An authenticated user hitting a route outside their clearance sees the 403 ACCESS
  RESTRICTED screen (`AccessRestricted` in components/routing/Guards.tsx).

## Data model (backend/models/schemas.py ↔ frontend/src/lib/types.ts)
`User`, `Sensor`, `Gateway`, `Zone`, `NetworkStats`, `TelemetrySeries`/`TelemetryPoint`,
`Alert`, `RiskAssessment`/`RiskFactor`, `SimulationResult`/`SimulationStep`,
`Notification`, `Report`. All ids are string uuid4; all datetimes are aware UTC.

## API surface (all on api_router under /api)
- auth: POST /auth/register, /auth/login, /auth/logout, /auth/refresh,
  /auth/forgot-password, /auth/change-password; GET+PATCH /auth/me
- network: GET /zones, /zones/{id}, /gateways, /sensors (filters: zone_id, sensor_type,
  status), /stats, /telemetry (zone_id, hours); POST /sensors (admin);
  PATCH /sensors/{id} (admin, field_officer); DELETE /sensors/{id} (admin)
- alerts: GET /alerts (filters: risk_level, hazard_type, status, location),
  GET /alerts/{id}, POST /alerts, POST /alerts/{id}/action
  (acknowledge | assign | resolve), DELETE /alerts/{id} (admin)
- intelligence: GET /risk, GET /risk/{zone_id}, POST /simulations
  (admin+gov_officer), GET /simulations
- admin: GET /users, PATCH /users/{id}, DELETE /users/{id} (admin only);
  GET /notifications, POST /notifications/read-all; GET+POST /reports

## Risk & simulation engine
Deterministic, computed server-side in `backend/routers/intelligence.py` — NO external LLM.
Risk score = weighted rainfall + soil moisture + water level + historical hazard pattern +
thermal stress, capped 0-100; level thresholds 75/55/30. Digital Twin simulation derives
peak impact from the scenario's driver parameters and ramps it over a 12-hour curve.

## Seed data (backend/seed.py — idempotent, wipes then reinserts)
6 monitoring zones (Chamoli Slope Alpha/Uttarakhand, Wayanad Ghat Sector/Kerala,
Brahmaputra Flood Belt/Assam, Bandipur Forest Block/Karnataka, Nilgiri Watershed/Tamil Nadu,
Delhi NCR Air Corridor/Delhi), 6 gateways (5 online, Delhi offline), 36 sensors,
4 alerts (EIN-CRT-0001 open critical, EIN-HGH-0002 open high, EIN-MED-0003 acknowledged,
EIN-LOW-0004 resolved), 4 notifications (3 unread), 2 reports, 4 user accounts.
Re-seed with `cd /app/backend && python seed.py`.

## Key flows
1. Public landing (/) → animated `EnvironmentalNetworkAnimation` SVG hero (8 LoRa nodes →
   LoRaWAN gateway → network/cloud → GIS+AI platform), 6-step workflow, 5-layer architecture.
2. Login → /dashboard: 5 KPI cards, Leaflet hazard map, live alerts panel, 4 Recharts trends.
3. GIS Monitoring: layer checkboxes (sensors, rainfall, hazard zones, satellite basemap,
   boundaries) + selected-location telemetry panel.
4. Digital Twin: zone + scenario + 4 parameter sliders → RUN SIMULATION → severity KPIs,
   summary and propagation chart.
5. Alerts Center: 4 filters → acknowledge / assign officer / resolve.
6. AI Risk Assessment: zone list → risk gauge, factor weights, recommendation, confidence,
   data sources, models, human-authority disclaimer.
7. Sensor Management (admin): commission + decommission nodes. User Management (admin):
   role reassignment + verify/suspend.

## Known deviations from the original request
- Stack is FastAPI + MongoDB (pod template), not Node/Express + PostgreSQL. Same REST
  contract, JWT auth and RBAC.
- UI is Tailwind v4 + shadcn/ui styled to a Material-grade government aesthetic, not MUI.
- Fonts are Inter (headings) + IBM Plex Sans (body); Roboto is not in the pod's font manifest.
- AI risk scoring is a deterministic model, not an LLM/LangChain/Qdrant deployment (user
  chose "not now" for a real LLM). Architecture section documents the intended stack.
