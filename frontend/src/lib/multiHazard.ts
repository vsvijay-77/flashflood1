export type MultiHazardModelInfo = {
  status: "checkpoint_missing" | "checkpoint_invalid" | "model_loaded" | "model_ready";
  ready: boolean;
  calibrated: boolean;
  reason: string | null;
  model_version: string | null;
  trained_at: string | null;
  temporal_context_hours: number;
  forecast_horizon_hours: number;
  architecture: { temporal: string; spatial: string; heads: string[] };
  heatmap: { format: string; endpoint: string; colors: Record<string, string> };
};

export const MULTI_HAZARD_COLORS = {
  LOW: "#22c55e",
  MODERATE: "#eab308",
  HIGH: "#f97316",
  CRITICAL: "#dc2626",
} as const;

export type MultiHazardFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    node_id: string;
    timestamp: string;
    model_version: string;
    flood_probability: number;
    landslide_probability: number;
    combined_risk: number;
    confidence: number | null;
    lead_time_minutes: number | null;
    risk_class: keyof typeof MULTI_HAZARD_COLORS;
    color?: string;
    area_id?: string | null;
  };
};

export type MultiHazardHeatmap = {
  type: "FeatureCollection";
  features: MultiHazardFeature[];
  metadata?: {
    timestamp?: string | null;
    model_version?: string | null;
    area_id?: string | null;
    stale?: boolean;
    reason?: string | null;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Reject malformed responses rather than converting missing predictions to zero. */
export function parseMultiHazardHeatmap(value: unknown): MultiHazardHeatmap {
  if (!isRecord(value) || value.type !== "FeatureCollection" || !Array.isArray(value.features)) {
    throw new Error("The prediction service returned invalid GeoJSON.");
  }
  for (const feature of value.features) {
    const geometry = isRecord(feature) && isRecord(feature.geometry) ? feature.geometry : null;
    const properties = isRecord(feature) && isRecord(feature.properties) ? feature.properties : null;
    const coordinates = geometry?.coordinates;
    if (!isRecord(feature) || feature.type !== "Feature" || !geometry || geometry.type !== "Point" || !Array.isArray(coordinates) || coordinates.length < 2
      || !coordinates.slice(0, 2).every(v => typeof v === "number" && Number.isFinite(v))
      || Math.abs(coordinates[0]) > 180 || Math.abs(coordinates[1]) > 90
      || !properties || typeof properties.node_id !== "string" || !properties.node_id
      || typeof properties.timestamp !== "string" || !Number.isFinite(Date.parse(properties.timestamp))
      || typeof properties.model_version !== "string" || !properties.model_version
      || !isProbability(properties.flood_probability) || !isProbability(properties.landslide_probability)
      || !isProbability(properties.combined_risk)
      || !(properties.confidence === null || isProbability(properties.confidence))
      || !(properties.lead_time_minutes === null || (typeof properties.lead_time_minutes === "number"
        && Number.isFinite(properties.lead_time_minutes) && properties.lead_time_minutes >= 0))
      || typeof properties.risk_class !== "string" || !Object.hasOwn(MULTI_HAZARD_COLORS, properties.risk_class)) {
      throw new Error("The prediction service returned incomplete or invalid node predictions.");
    }
  }
  return value as MultiHazardHeatmap;
}

// Area polygons in this application are [latitude, longitude]; GeoJSON is the reverse.
function pointInArea(lng: number, lat: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ay, ax] = polygon[j];
    const [by, bx] = polygon[i];
    const cross = (lng - ax) * (by - ay) - (lat - ay) * (bx - ax);
    if (Math.abs(cross) < 1e-12 && lng >= Math.min(ax, bx) - 1e-10 && lng <= Math.max(ax, bx) + 1e-10
      && lat >= Math.min(ay, by) - 1e-10 && lat <= Math.max(ay, by) + 1e-10) return true;
    if ((ay > lat) !== (by > lat) && lng < (bx - ax) * (lat - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

/** Defense in depth against showing a cached snapshot for another selected area/model. */
export function selectAreaPredictions(
  heatmap: MultiHazardHeatmap,
  areaId?: string,
  polygon?: [number, number][],
  modelVersion?: string | null,
): MultiHazardFeature[] {
  const hasPolygon = Boolean(polygon && polygon.length >= 3);
  if ((!areaId && !hasPolygon) || heatmap.metadata?.stale) return [];
  if (areaId && heatmap.metadata?.area_id && heatmap.metadata.area_id !== areaId) return [];
  if (modelVersion && heatmap.metadata?.model_version && heatmap.metadata.model_version !== modelVersion) return [];
  return heatmap.features.filter(feature => {
    const { properties, geometry: { coordinates: [lng, lat] } } = feature;
    if (modelVersion && properties.model_version !== modelVersion) return false;
    if (areaId && properties.area_id && properties.area_id !== areaId) return false;
    if (hasPolygon) return pointInArea(lng, lat, polygon!);
    return properties.area_id === areaId || heatmap.metadata?.area_id === areaId;
  });
}

export function formatHazardProbability(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
}

export function formatHazardLeadTime(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(0)} min` : "—";
}
