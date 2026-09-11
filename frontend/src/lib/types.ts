// Hand-written mirrors of the Pydantic models in backend/models/schemas.py.
// Keep both sides in sync in the same edit — nothing infers across the HTTP boundary.

export type Role = "admin" | "gov_officer" | "field_officer" | "viewer";
export type RiskLevel = "critical" | "high" | "medium" | "low";

export interface User {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  organization: string;
  designation: string;
  role: Role;
  state: string;
  district: string;
  status: string;
  verified: boolean;
  created_at: string;
}

export interface MessageResponse {
  message: string;
}

export interface RegisterResponse {
  message: string;
  requires_verification: boolean;
  user: User;
}

export interface Sensor {
  id: string;
  code: string;
  name: string;
  sensor_type: string;
  zone_id: string;
  zone_name: string;
  lat: number;
  lng: number;
  status: string;
  battery: number;
  signal_dbm: number;
  last_value: number;
  unit: string;
  gateway_id: string;
  updated_at: string;
}

export interface Gateway {
  id: string;
  code: string;
  name: string;
  zone_name: string;
  lat: number;
  lng: number;
  status: string;
  connected_nodes: number;
  uplink_rate: number;
}

export interface Zone {
  id: string;
  name: string;
  state: string;
  district: string;
  lat: number;
  lng: number;
  radius_km: number;
  hazard_type: string;
  risk_level: RiskLevel;
  risk_score: number;
  rainfall_mm: number;
  temperature_c: number;
  humidity_pct: number;
  water_level_m: number;
  soil_moisture_pct: number;
  sensor_count: number;
}

export interface CustomArea {
  id: string;
  name: string;
  district: string;
  type: string;
  risk: string;
  priority: string;
  description: string;
  bounds?: any;
  date: string;
  lat: number;
  lng: number;
  shape: string;
  polygon: [number, number][];
  areaSqMeters: number;
  user_id?: string | null;
  monitoring_type?: "flood" | "landslide" | "combined";
  area_size_km?: number;
}

export interface NetworkStats {
  active_sensors: number;
  total_sensors: number;
  online_gateways: number;
  active_alerts: number;
  monitoring_zones: number;
  data_streams: number;
  national_hazard_level: string;
}

export interface TelemetryPoint {
  label: string;
  rainfall_mm: number;
  water_level_m: number;
  temperature_c: number;
  soil_moisture_pct: number;
  packet_rate: number;
}

export interface TelemetrySeries {
  zone_id: string | null;
  points: TelemetryPoint[];
}

export interface Alert {
  id: string;
  code: string;
  zone_id: string;
  location: string;
  hazard_type: string;
  risk_level: RiskLevel;
  title: string;
  detail: string;
  status: string;
  assigned_to: string;
  created_at: string;
  updated_at: string;
}

export interface RiskFactor {
  name: string;
  weight: number;
  value: string;
}

export interface RiskAssessment {
  zone_id: string;
  zone_name: string;
  risk_score: number;
  risk_level: RiskLevel;
  confidence: number;
  factors: RiskFactor[];
  recommendation: string;
  data_sources: string[];
  models_used: string[];
  analyzed_at: string;
  disclaimer: string;
}

export interface SimulationStep {
  hour: number;
  impact_pct: number;
  affected_area_km2: number;
}

export interface SimulationResult {
  id: string;
  zone_id: string;
  zone_name: string;
  scenario: string;
  severity: string;
  peak_impact_pct: number;
  affected_area_km2: number;
  population_at_risk: number;
  evacuation_time_min: number;
  steps: SimulationStep[];
  summary: string;
  run_at: string;
}

export interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
}

export interface Report {
  id: string;
  title: string;
  report_type: string;
  period: string;
  zone_name: string;
  status: string;
  size_kb: number;
  created_at: string;
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrator",
  gov_officer: "Government Officer",
  field_officer: "Field Officer",
  viewer: "Viewer",
};

export const RISK_STYLES: Record<RiskLevel, { bg: string; text: string; dot: string; label: string }> = {
  critical: { bg: "bg-red-50 border-red-200", text: "text-red-800", dot: "bg-red-600", label: "CRITICAL" },
  high: { bg: "bg-orange-50 border-orange-200", text: "text-orange-800", dot: "bg-orange-500", label: "HIGH" },
  medium: { bg: "bg-amber-50 border-amber-200", text: "text-amber-800", dot: "bg-amber-500", label: "MEDIUM" },
  low: { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-800", dot: "bg-emerald-600", label: "LOW" },
};

export const HAZARD_LABELS: Record<string, string> = {
  landslide: "Landslide",
  flood: "Flood",
  air_quality: "Air Quality",
};

export const SENSOR_LABELS: Record<string, string> = {
  rainfall: "Rainfall",
  soil_moisture: "Soil Moisture",
  temperature: "Temperature",
  water_level: "Water Level",
  smoke: "Smoke / Fire",
  air_quality: "Air Quality",
  tilt: "Tilt / Landslide",
};
