# NEXGI — Environmental Intelligence Platform

A unified environmental intelligence network for flash flood and disaster monitoring, connecting remote LoRaWAN sensors, real-time GIS mapping, satellite analysis, and 3D Digital Twins to help authorities detect, understand, and respond to environmental threats in real time.

---

## Features

- **Live Sensor Dashboard** — Real-time LoRaWAN telemetry from field nodes (water level, soil moisture, accelerometer, tilt)
- **GIS Monitoring** — Full India national map with custom area boundary drawing, 8-layer satellite analysis
- **Satellite Analysis** — Google Earth Engine layers: Elevation (SRTM 30m), Slope, NDVI, NDWI, Flood Extent, Live Rainfall, Soil Moisture
- **3D Digital Twin** — CesiumJS-powered terrain viewer with flood/landslide simulation overlays
- **SOS Alerts** — Citizen distress request management with GIS visualization
- **Risk Assessment** — Automated risk scoring from live telemetry and satellite intelligence
- **Analytics** — Hydrological vulnerability, runoff, and population exposure analysis
- **Reports** — PDF report generation with flood impact assessment

---

## Architecture

```
nexgi/
├── backend/     FastAPI + MongoDB — Python API server
├── frontend/    Vite + React + TypeScript + Leaflet + CesiumJS
└── tests/       Playwright E2E tests
```

---

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+ and Yarn
- MongoDB (local or Atlas)

### 1. Clone & Setup

```bash
git clone https://github.com/your-org/nexgi.git
cd nexgi
```

### 2. Backend Setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Copy environment config
cp .env.example .env
# Edit .env with your MongoDB URL, JWT secret, and API keys
```

### 3. Frontend Setup

```bash
cd frontend
yarn install

# Copy environment config
cp .env.example .env
# Edit .env — set VITE_API_URL if needed
```

### 4. Run Development Servers

Open two terminals:

```bash
# Terminal 1 — Backend
cd backend
uvicorn server:app --host 0.0.0.0 --port 8001 --reload

# Terminal 2 — Frontend
cd frontend
yarn dev
```

Frontend: http://localhost:3000  
Backend API: http://localhost:8001/api

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Description | Required |
|---|---|---|
| `SUPABASE_URL` | Supabase project URL | ✅ |
| `SUPABASE_SECRET_KEY` | Backend secret key (`SUPABASE_SERVICE_ROLE_KEY` is also supported) | ✅ |
| `SENSOR_DB_URL` | External PostgreSQL connection string for LoRa telemetry | ✅ |
| `MONGO_URL` | Optional local legacy MongoDB fallback | Optional |
| `DB_NAME` | Legacy MongoDB database name | Optional |
| `JWT_SECRET` | JWT signing secret (min 32 chars) | ✅ |
| `CORS_ORIGINS` | Allowed origins (comma-separated or `*`) | ✅ |
| `APP_URL` | Public app URL | ✅ |
| `OPENWEATHER_API_KEY` | OpenWeatherMap API key | Optional |
| `QDRANT_URL` | Qdrant vector store URL (for chatbot) | Optional |
| `QDRANT_API_KEY` | Qdrant API key | Optional |
| `TWILIO_ACCOUNT_SID` | Twilio SID (for SMS alerts) | Optional |
| `TWILIO_AUTH_TOKEN` | Twilio auth token | Optional |
| `TWILIO_PHONE_NUMBER` | Twilio phone number | Optional |

### Frontend (`frontend/.env`)

| Variable | Description | Required |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL | Optional |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key | Optional |

The backend stores application data and saved map layers in Supabase. The frontend
Supabase variables are optional for OAuth; they do not replace backend credentials.

### Deploying to Vercel

Use the repository root as the Vercel Root Directory, with the root `vercel.json`.
Deploying only `frontend/` omits the Python API. Set `SUPABASE_URL`,
`SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`), `SENSOR_DB_URL`, and
`JWT_SECRET` in Vercel's Environment Variables for the deployment environment.
Set `APP_URL` to the deployed URL. Local `.env` files are excluded from deployment.
Keep secret/service-role keys on the backend; never prefix them with `VITE_`.
The `area_map_layers` table requires the backend key to access saved geometry.

Keep the lightweight `backend/ml` Python source in the function bundle: API routers
import its schemas and loaders even when inference is disabled. Only checkpoints
are excluded. Heavy ML packages remain optional. A missing imported module causes
`FUNCTION_INVOCATION_FAILED` on every API route, including `/api/health`.

Redeploy after code or environment changes. Verify `/api/health`, `/api/stats`,
`/api/external-sensors/history?limit=1`, and `/api/external-sensors/packets?limit=1`,
then open a saved digital twin area. Map requests allow up to 180 seconds to fetch
OSM data within the configured 300-second function limit, and reuse saved Supabase
layers. A sensor outage returns 503 for history/packets and an offline summary.

For sensor 503s, check `/api/external-sensors/summary`: `error_code` distinguishes
configuration, driver, authentication, DNS, schema, and timeout failures without
exposing credentials. History/packet responses also include `X-Sensor-Error`.
An error referring to `/var/run/postgresql/.s.PGSQL.5432` means libpq was given an
empty connection string and tried a local Unix socket. Blank or quoted-empty
`SENSOR_DB_URL` values now use the existing configured default instead; set an
explicit PostgreSQL URI in Vercel to select your deployment's database.
Telemetry polls every five seconds and backs off to thirty seconds during outages.

---

## Monitored Zone 2 bundled map

`frontend/public/prebaked_zones/0004ccb1-ebc6-4c8c-90f6-06ebe52a2e42.json`
contains **2,647 building footprints, 194 roads/paths, and 349 water features**
exported from the saved Supabase layers for Zone 2's exact polygon. The source
layers were saved on September 18, 2026; export timestamps and attribution are
inside the file. These are all available saved features, not a guarantee that
every physical house has been mapped. No generated fallback structures are included.

The browser loads this file before calling the API. Vite copies it into `dist`,
so hosting the frontend also hosts the map. A matching backend copy serves the
same data through `/api/geo/extract-networks` and `/api/geo/extract-buildings`.
Loading these layers needs no Supabase or OSM connection; other application
features, basemaps, and terrain can still need their services. Changed boundaries
use the normal API flow. The manifest checksum versions the static URL and browser
map cache to replace the old 30-building snapshot.

To refresh the snapshot from the saved layers:

```sh
.venv/bin/python scripts/export_monitored_area.py 0004ccb1-ebc6-4c8c-90f6-06ebe52a2e42
```

Commit both geometry copies and both generated manifests after refreshing, then
build/deploy normally. Use this exporter for Zone 2; the legacy `prebake_zones*.py`
scripts generate fallback buildings and must not overwrite this snapshot.

## Demo Access

A pre-configured demo account is available on the login page:

- **Email:** `test@gmail.com`
- **Password:** `12345678`

Click **"⚡ Fill Demo Credentials"** on the login page to auto-fill.

---

## Deployment on Vercel

The frontend is a standard Vite SPA — deploy it directly to Vercel.

### 1. Deploy Frontend to Vercel

```bash
cd frontend
vercel --prod
```

Or connect your GitHub repository in the Vercel dashboard with:
- **Framework Preset:** Vite
- **Build Command:** `yarn build`
- **Output Directory:** `dist`
- **Root Directory:** `frontend`

### 2. Deploy Backend

The FastAPI backend can be deployed to:
- **Railway** — `railway up` from the `backend/` directory
- **Render** — Connect repo, set build command to `pip install -r requirements.txt`, start command to `uvicorn server:app --host 0.0.0.0 --port $PORT`
- **AWS / GCP / DigitalOcean** — Any VPS with Python 3.11+

### 3. Configure API Proxy

Update `frontend/vite.config.ts` proxy target to point to your deployed backend URL, or set `VITE_API_URL` in your Vercel environment variables.

---

## API Overview

| Endpoint | Description |
|---|---|
| `GET /api/` | Health check |
| `POST /api/auth/login` | Login |
| `POST /api/auth/register` | Register |
| `GET /api/zones` | Monitoring zones |
| `GET /api/sensors` | Sensor nodes |
| `GET /api/alerts` | Active alerts |
| `GET /api/gee/batch-tiles` | Multi-layer satellite tiles |
| `GET /api/gee/tiles/{layer}/{z}/{x}/{y}.png` | Individual GEE tile |
| `GET /api/areas` | Custom monitored areas |
| `POST /api/areas` | Create monitored area |
| `GET /api/digital-twin/flood-simulation` | Flood simulation |

Full API docs available at `http://localhost:8001/docs` (Swagger UI) when running the backend.

---

## Testing

### Backend (pytest)

```bash
cd backend
pytest
```

### Frontend (Playwright E2E)

```bash
cd tests
npx playwright test
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Vite |
| UI | Tailwind CSS v4 + shadcn/ui |
| Maps | Leaflet.js + CesiumJS |
| 3D | CesiumJS terrain viewer |
| Backend | FastAPI + Python 3.11 |
| Database | MongoDB (Motor async driver) |
| Satellite | Google Earth Engine API |
| Radar | RainViewer live precipitation |
| Auth | JWT + optional Supabase OAuth |
| Deployment | Vercel (frontend) + Railway/Render (backend) |

---

## License

MIT
