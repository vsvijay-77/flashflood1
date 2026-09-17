import { apiPost, apiGet } from "./api";

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
  center_lat?: number;
  center_lng?: number;
  place_name?: string;
}

export interface Shelter {
  id: string;
  name: string;
  lat: number;
  lng: number;
  capacity: number;
  elevation_m?: number;
  type?: string;
  status?: string;
}

export interface RoadFeature {
  type: "Feature";
  properties: {
    id: string;
    name: string;
    road_type: string;
    length_m: number;
    speed_kmh: number;
    width_px?: number;
    is_major?: boolean;
    accessibility: "open" | "restricted" | "flooded" | "caution";
    flood_risk: number;
  };
  geometry: {
    type: "LineString";
    coordinates: [number, number][]; // [lng, lat]
  };
}

export interface RiverFeature {
  type: "Feature";
  properties: {
    id: string;
    name: string;
    waterway_type: string;
    width_m: number;
    length_m: number;
    is_water_body?: boolean;
    is_main_river?: boolean;
    flow_direction?: string;
    flood_susceptibility?: number;
  };
  geometry: {
    type: "LineString";
    coordinates: [number, number][]; // [lng, lat]
  };
}

export interface BuildingFeature {
  type: "Feature";
  id?: string;
  properties: {
    id: string;
    name?: string;
    osm_type?: "way" | "relation";
    osm_id?: number;
    building?: string;
    height?: number;
    height_m?: number;
    estimated_height?: number;
    height_category?: string;
    height_source?: string;
    area_sqm?: number;
    elevation?: number;
    elevation_m?: number;
    lat?: number;
    lon?: number;
    flood_risk?: "SAFE" | "MODERATE" | "HIGH" | "CRITICAL";
    flood_risk_score?: number;
    risk_color?: string;
    landslide_risk?: "LOW" | "MODERATE" | "HIGH";
    distance_to_river_m?: number;
    distance_from_river?: string;
    evacuation_zone?: string;
    confidence?: number;
    source?: string;
  };
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
}


export interface OsmLoadingStatus {
  complete: boolean;
  total_tiles: number;
  loaded_tiles: number;
  failed_tiles: unknown[];
}

export interface NetworkExtractionResponse {
  status: string;
  bbox: BoundingBox;
  roads: {
    geojson: {
      type: "FeatureCollection";
      features: RoadFeature[];
      metadata?: { total_nodes: number; total_edges: number };
    };
    total_nodes: number;
    total_edges: number;
  };
  rivers: {
    geojson: {
      type: "FeatureCollection";
      features: RiverFeature[];
      metadata?: { total_nodes: number; total_edges: number };
    };
    total_nodes: number;
    total_edges: number;
  };
  buildings?: {
    geojson: {
      type: "FeatureCollection";
      features: BuildingFeature[];
      metadata?: { total_buildings: number };
    };
    total_features: number;
  };
  osm_loading?: OsmLoadingStatus;
  shelters?: Shelter[];
}

export interface BuildingExtractionResponse {
  status: string;
  bbox: BoundingBox;
  buildings: NonNullable<NetworkExtractionResponse["buildings"]>;
  osm_loading?: OsmLoadingStatus;
}

export interface HighRiskZone {
  node_id: string | number;
  lat: number;
  lng: number;
  probability: number;
  severity: "low" | "medium" | "high" | "critical";
}

export interface RiskPredictionResponse {
  status: string;
  bbox: BoundingBox;
  prediction: {
    node_predictions: Record<string, any>;
    high_risk_zones: HighRiskZone[];
    overall_severity: string;
    critical_nodes_count: number;
    high_nodes_count: number;
    mean_flood_probability: number;
    model_architecture: string;
  };
}

export interface RouteSegment {
  from_node: string | number;
  to_node: string | number;
  road_name: string;
  road_type: string;
  length_m: number;
  speed_kmh: number;
  flood_risk: number;
}

export interface EvacuationRouteResponse {
  status: "success" | "no_path" | "error";
  route_status?: "SAFE" | "CAUTION" | "HAZARDOUS";
  message?: string;
  origin?: { lat: number; lng: number };
  shelter?: Shelter;
  destination_name?: string;
  destination?: { lat: number; lng: number };
  total_distance_km?: number;
  total_distance_m?: number;
  estimated_time_minutes?: number;
  max_flood_risk_encountered?: number;
  path_nodes_count?: number;
  coordinates?: [number, number][]; // [lat, lng]
  segments?: RouteSegment[];
  avoided_blocked_edges?: number;
}

export async function extractNetworks(params: {
  lat?: number;
  lng?: number;
  radius_km?: number;
  place_name?: string;
  polygon?: number[][];
  // Direct viewport bbox — use when passing Cesium camera viewport
  north?: number;
  south?: number;
  east?: number;
  west?: number;
  area_id?: string;
  area_key?: string;
}, signal?: AbortSignal): Promise<NetworkExtractionResponse> {
  return apiPost<NetworkExtractionResponse>("/geo/extract-networks", params, { signal });
}

export async function extractBuildings(params: {
  lat?: number;
  lng?: number;
  radius_km?: number;
  polygon?: number[][];
  north?: number;
  south?: number;
  east?: number;
  west?: number;
  area_id?: string;
  area_key?: string;
}, signal?: AbortSignal): Promise<BuildingExtractionResponse> {
  return apiPost<BuildingExtractionResponse>("/geo/extract-buildings", params, { signal });
}

export async function predictRisk(params: {
  lat?: number;
  lng?: number;
  radius_km?: number;
  rainfall_intensity_mm?: number;
  soil_saturation_pct?: number;
}): Promise<RiskPredictionResponse> {
  return apiPost<RiskPredictionResponse>("/geo/predict-risk", params);
}

export async function calculateEvacuationRoute(params: {
  north: number;
  south: number;
  east: number;
  west: number;
  user_lat: number;
  user_lng: number;
  dest_lat?: number;
  dest_lng?: number;
  destination_name?: string;
  shelter?: Shelter;
  avoid_critical?: boolean;
  rainfall_intensity_mm?: number;
}): Promise<EvacuationRouteResponse> {
  return apiPost<EvacuationRouteResponse>("/geo/evacuation-route", params);
}

export async function getEmergencyShelters(lat?: number, lng?: number): Promise<{ shelters: Shelter[] }> {
  const query = lat !== undefined && lng !== undefined ? `?lat=${lat}&lng=${lng}` : "";
  return apiGet<{ shelters: Shelter[] }>(`/geo/shelters${query}`);
}

export interface MicrosoftBuildingsResponse {
  type: "FeatureCollection";
  features: BuildingFeature[];
  metadata: {
    source: string;
    total_buildings: number;
    safe: number;
    moderate: number;
    high: number;
    critical: number;
    bbox: { min_lat: number; min_lon: number; max_lat: number; max_lon: number };
    retrieved_at?: string;
  };
}

export async function fetchMicrosoftBuildings(
  params: {
    minLat: number;
    minLon: number;
    maxLat: number;
    maxLon: number;
    water_level_m?: number;
    max_buildings?: number;
    polygon?: [number, number][];
  },
  signal?: AbortSignal
): Promise<MicrosoftBuildingsResponse> {
  if (params.polygon && params.polygon.length >= 3) {
    return apiPost<MicrosoftBuildingsResponse>(
      "/buildings",
      {
        minLat: params.minLat,
        minLon: params.minLon,
        maxLat: params.maxLat,
        maxLon: params.maxLon,
        water_level_m: params.water_level_m ?? 0.0,
        max_buildings: params.max_buildings ?? 2500,
        polygon: params.polygon,
      },
      { signal }
    );
  }

  const query = new URLSearchParams({
    minLat: params.minLat.toFixed(6),
    minLon: params.minLon.toFixed(6),
    maxLat: params.maxLat.toFixed(6),
    maxLon: params.maxLon.toFixed(6),
    ...(params.water_level_m !== undefined ? { water_level_m: params.water_level_m.toString() } : {}),
    ...(params.max_buildings ? { max_buildings: params.max_buildings.toString() } : {}),
  });

  return apiGet<MicrosoftBuildingsResponse>(`/buildings?${query.toString()}`, { signal });
}


