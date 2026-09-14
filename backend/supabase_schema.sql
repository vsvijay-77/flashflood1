-- ==============================================================================
-- FLASH FLOOD INTELLIGENCE & DIGITAL TWIN — SUPABASE SCHEMA DDL
-- Project: https://pffdafhrhtevdboxqztn.supabase.co
-- Run this in your Supabase Dashboard: SQL Editor -> New Query -> Run
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. CUSTOM MONITORED AREAS (GIS & Digital Twin)
CREATE TABLE IF NOT EXISTS public.custom_areas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    district TEXT DEFAULT 'Western Ghats',
    area_type TEXT DEFAULT 'Forest',
    risk_category TEXT DEFAULT 'Medium',
    priority TEXT DEFAULT 'Normal',
    description TEXT DEFAULT '',
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    shape TEXT NOT NULL,
    user_id UUID,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. USERS (Officers, Admins, Viewers)
CREATE TABLE IF NOT EXISTS public.users (
    id TEXT PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT DEFAULT '',
    organization TEXT DEFAULT '',
    designation TEXT DEFAULT '',
    role TEXT DEFAULT 'viewer',
    state TEXT DEFAULT '',
    district TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    verified BOOLEAN DEFAULT FALSE,
    password_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. ZONES (Risk Monitoring Basins)
CREATE TABLE IF NOT EXISTS public.zones (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    state TEXT NOT NULL,
    district TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    radius_km DOUBLE PRECISION DEFAULT 8.0,
    hazard_type TEXT DEFAULT 'landslide',
    risk_level TEXT DEFAULT 'low',
    risk_score INTEGER DEFAULT 0,
    rainfall_mm DOUBLE PRECISION DEFAULT 0.0,
    temperature_c DOUBLE PRECISION DEFAULT 0.0,
    humidity_pct DOUBLE PRECISION DEFAULT 0.0,
    water_level_m DOUBLE PRECISION DEFAULT 0.0,
    soil_moisture_pct DOUBLE PRECISION DEFAULT 0.0,
    sensor_count INTEGER DEFAULT 0
);

-- 4. GATEWAYS (LoRaWAN Master/Slave Nodes)
CREATE TABLE IF NOT EXISTS public.gateways (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    zone_name TEXT DEFAULT '',
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    status TEXT DEFAULT 'online',
    connected_nodes INTEGER DEFAULT 0,
    uplink_rate DOUBLE PRECISION DEFAULT 99.0
);

-- 5. SENSORS (IoT Telemetry Stations)
CREATE TABLE IF NOT EXISTS public.sensors (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    sensor_type TEXT NOT NULL,
    zone_id TEXT REFERENCES public.zones(id) ON DELETE SET NULL,
    zone_name TEXT DEFAULT '',
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    status TEXT DEFAULT 'online',
    battery INTEGER DEFAULT 100,
    signal_dbm INTEGER DEFAULT -80,
    last_value DOUBLE PRECISION DEFAULT 0.0,
    unit TEXT DEFAULT '',
    gateway_id TEXT,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. ALERTS (Incident Warnings & Response Tasks)
CREATE TABLE IF NOT EXISTS public.alerts (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    zone_id TEXT DEFAULT '',
    location TEXT NOT NULL,
    hazard_type TEXT NOT NULL,
    risk_level TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT DEFAULT '',
    status TEXT DEFAULT 'open',
    assigned_to TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. SIMULATIONS (Flood Runoff & AI Model Output)
CREATE TABLE IF NOT EXISTS public.simulations (
    id TEXT PRIMARY KEY,
    zone_id TEXT NOT NULL,
    zone_name TEXT NOT NULL,
    scenario TEXT NOT NULL,
    severity TEXT NOT NULL,
    peak_impact_pct DOUBLE PRECISION DEFAULT 0.0,
    affected_area_km2 DOUBLE PRECISION DEFAULT 0.0,
    population_at_risk INTEGER DEFAULT 0,
    evacuation_time_min INTEGER DEFAULT 0,
    steps JSONB DEFAULT '[]'::jsonb,
    summary TEXT DEFAULT '',
    run_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7b. DIGITAL TWIN BUILDING FOOTPRINT SNAPSHOTS
-- Each area query stores one deterministic row. The ``steps`` JSONB array holds
-- the GeoJSON features and ``summary`` stores source/count/bbox metadata, so the
-- viewer has no local GeoJSON dependency.
CREATE INDEX IF NOT EXISTS idx_simulations_building_footprints
    ON public.simulations (scenario, zone_id)
    WHERE scenario = 'building_footprints';

-- 8. DIGITAL TWIN NETWORK FEATURES (Paths, Rivers & Water Bodies)
-- One row is stored per OSM feature for each requested area. Geometry and
-- source tags remain queryable JSONB without requiring PostGIS.
CREATE TABLE IF NOT EXISTS public.digital_twin_network_features (
    id TEXT PRIMARY KEY,
    area_key TEXT NOT NULL,
    feature_id TEXT NOT NULL,
    feature_type TEXT NOT NULL CHECK (feature_type IN ('path', 'waterway', 'water_body')),
    name TEXT DEFAULT '',
    geometry JSONB NOT NULL,
    properties JSONB DEFAULT '{}'::jsonb,
    bbox JSONB DEFAULT '{}'::jsonb,
    source TEXT DEFAULT 'OpenStreetMap',
    observed_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_digital_twin_network_area
    ON public.digital_twin_network_features(area_key, feature_type);

-- 9. REPORTS (Assessments & Summaries)
CREATE TABLE IF NOT EXISTS public.reports (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    report_type TEXT NOT NULL,
    period TEXT NOT NULL,
    zone_name TEXT DEFAULT '',
    status TEXT DEFAULT 'ready',
    size_kb INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 10. NOTIFICATIONS (System & Warning Dispatches)
CREATE TABLE IF NOT EXISTS public.notifications (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 11. STATUS CHECKS (Health Monitoring)
CREATE TABLE IF NOT EXISTS public.status_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    status TEXT NOT NULL,
    details JSONB DEFAULT '{}'::jsonb
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_sensors_zone_id ON public.sensors(zone_id);
CREATE INDEX IF NOT EXISTS idx_sensors_status ON public.sensors(status);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON public.alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_risk_level ON public.alerts(risk_level);
CREATE INDEX IF NOT EXISTS idx_simulations_zone_id ON public.simulations(zone_id);
CREATE INDEX IF NOT EXISTS idx_simulations_run_at ON public.simulations(run_at DESC);

-- ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.custom_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gateways ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sensors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.simulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digital_twin_network_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_checks ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t text;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "Public access policy" ON public.%I;', t);
        EXECUTE format('CREATE POLICY "Public access policy" ON public.%I FOR ALL TO public USING (true) WITH CHECK (true);', t);
    END LOOP;
END $$;
