/**
 * TIN Terrain Service & Types
 *
 * Interfaces and API client for fetching Triangulated Irregular Network (TIN)
 * terrain data generated from Copernicus DEM (COP30) via the backend OpenTopography pipeline.
 */

export interface TinTerrainFeatures {
  mean_slope_deg: number;
  max_slope_deg: number;
  min_slope_deg: number;
  mean_aspect_deg: number;
  mean_gradient: number;
  max_gradient: number;
  gnn_node_attributes?: {
    feature_names: string[];
    node_count: number;
  };
  flow_direction?: any;
  flow_accumulation?: any;
  curvature?: any;
  drainage_connectivity?: any;
}

export interface TinGnnData {
  status: "connected" | "empty" | "disconnected";
  graph_count: number;
  node_count: number;
  edge_count: number;
  feature_dim: number;
  feature_names: string[];
  architecture: string;
  mean_node_risk: number;
  high_risk_node_count: number;
  node_scores: number[];
}

export interface TinTerrainData {
  dem_source: string;
  vertex_count: number;
  triangle_count: number;
  min_elevation: number;
  max_elevation: number;
  vertices: [number, number, number][]; // [longitude, latitude, elevation]
  triangles: [number, number, number][]; // [i, j, k]
  terrain_features?: TinTerrainFeatures;
  gnn?: TinGnnData;
}

export interface TinBoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

/**
 * Fetch TIN terrain data for the given bounding box from the FastAPI backend.
 * The OpenTopography API key is kept secure on the backend and never exposed.
 */
export async function fetchTinTerrain(
  bounds: TinBoundingBox,
  refresh = false,
  maxVertices = 25000,
  demType = "COP30"
): Promise<TinTerrainData> {
  const params = new URLSearchParams({
    north: bounds.north.toFixed(6),
    south: bounds.south.toFixed(6),
    east: bounds.east.toFixed(6),
    west: bounds.west.toFixed(6),
    dem_type: demType,
    max_vertices: maxVertices.toString(),
  });

  if (refresh) {
    params.set("refresh", "true");
  }

  const res = await fetch(`/api/digital-twin/tin?${params.toString()}`);
  if (!res.ok) {
    let errMsg = `Failed to fetch TIN terrain (${res.status})`;
    try {
      const errJson = await res.json();
      if (errJson?.detail) errMsg = errJson.detail;
    } catch {
      // fallback to status code
    }
    throw new Error(errMsg);
  }

  return (await res.json()) as TinTerrainData;
}
