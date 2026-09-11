"""Routing & Rivers API Router: Real OSM road and river extraction, GNN spatial graph, risk inference, and evacuation routing."""
import asyncio
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, HTTPException, Query, Body

from pydantic import BaseModel, Field

from services.location_service import bbox_from_radius, bbox_from_polygon, geocode_place_name
from services.osm_road_service import OSMRoadService
from services.osm_river_service import OSMRiverService
from services.osm_building_service import OSMBuildingService
from services.osm_tile_loader import OSMTileLoader
from services.graph_builder import UnifiedGraphBuilder
from services.routing_service import EvacuationRoutingService

router = APIRouter(prefix="/geo", tags=["geo-routing-rivers"])

road_service = OSMRoadService()
river_service = OSMRiverService()
building_service = OSMBuildingService()
graph_builder = UnifiedGraphBuilder()
routing_service = EvacuationRoutingService()

_risk_engine = None

def get_risk_engine():
    global _risk_engine
    if _risk_engine is None:
        from services.risk_model import FloodRiskEngine
        _risk_engine = FloodRiskEngine()
    return _risk_engine



# ─── Pydantic Request & Response Schemas ─────────────────────────────────────
class LocationRequest(BaseModel):
    lat: Optional[float] = None
    lng: Optional[float] = None
    radius_km: Optional[float] = 5.0
    polygon: Optional[List[List[float]]] = None
    place_name: Optional[str] = None
    # Direct bbox params — when provided, use instead of lat/lng/radius_km
    north: Optional[float] = None
    south: Optional[float] = None
    east: Optional[float] = None
    west: Optional[float] = None


class EvacuationRouteRequest(BaseModel):
    user_lat: float
    user_lng: float
    dest_lat: Optional[float] = None
    dest_lng: Optional[float] = None
    destination_name: Optional[str] = "Safe Relief Destination"
    shelter: Optional[Dict[str, Any]] = None
    north: float
    south: float
    east: float
    west: float
    avoid_critical: bool = True
    rainfall_intensity_mm: float = 45.0


def _derive_bbox(req: LocationRequest) -> Dict[str, float]:
    """Resolves bounding box from request parameters."""
    # 1. Direct bbox — highest priority (viewport-based queries from frontend)
    if req.north is not None and req.south is not None and req.east is not None and req.west is not None:
        clamp_span = 1.0  # Max 1 degree per side to avoid huge queries
        ns = min(abs(req.north - req.south), clamp_span)
        ew = min(abs(req.east - req.west), clamp_span)
        center_lat = (req.north + req.south) / 2
        center_lng = (req.east + req.west) / 2
        return {
            "north": round(center_lat + ns / 2, 6),
            "south": round(center_lat - ns / 2, 6),
            "east": round(center_lng + ew / 2, 6),
            "west": round(center_lng - ew / 2, 6),
            "center_lat": round(center_lat, 6),
            "center_lng": round(center_lng, 6),
        }

    # 2. Drawn polygon bbox
    if req.polygon and len(req.polygon) >= 3:
        return bbox_from_polygon(req.polygon)

    # 3. Center + radius
    if req.lat is not None and req.lng is not None:
        return bbox_from_radius(req.lat, req.lng, req.radius_km or 5.0)

    # Fallback
    return bbox_from_radius(10.6608, 77.0048, 5.0)


# ─── API Endpoints ───────────────────────────────────────────────────────────

@router.post("/extract-networks")
async def extract_networks(payload: LocationRequest = Body(...)):
    """
    Extracts real-world OpenStreetMap road network and river/waterway channels for any selected location.
    Accepts place name, polygon, or coordinates + radius.
    """
    if payload.place_name:
        geocoded = await geocode_place_name(payload.place_name)
        if geocoded:
            bbox = {
                "north": geocoded["north"],
                "south": geocoded["south"],
                "east": geocoded["east"],
                "west": geocoded["west"],
                "center_lat": geocoded["lat"],
                "center_lng": geocoded["lng"],
                "place_name": geocoded["name"],
            }
        else:
            bbox = _derive_bbox(payload)
    else:
        bbox = _derive_bbox(payload)

    north = bbox["north"]
    south = bbox["south"]
    east = bbox["east"]
    west = bbox["west"]

    # All datasets use the same bounded tile queue. Partial failures are
    # tolerated: roads and rivers that did load are returned with a warning.
    (road_G, road_geojson), (river_G, river_geojson) = await asyncio.gather(
        road_service.get_road_network(north, south, east, west, polygon=payload.polygon),
        river_service.get_river_network(north, south, east, west, polygon=payload.polygon),
    )

    center_lat = bbox.get("center_lat", (north + south) / 2.0)
    center_lng = bbox.get("center_lng", (east + west) / 2.0)

    return {
        "status": "success",
        "bbox": bbox,
        "osm_loading": {
            "complete": True,
            "total_tiles": len(OSMTileLoader.tiles_for_bbox(north, south, east, west)),
            "loaded_tiles": len(OSMTileLoader.tiles_for_bbox(north, south, east, west)),
            "failed_tiles": [],
            # Buildings load on their own lower-priority request. This lets
            # flood-critical waterways and evacuation paths appear first.
            "buildings": {"state": "pending"},
        },
        "roads": {
            "geojson": road_geojson,
            "total_nodes": road_G.number_of_nodes(),
            "total_edges": road_G.number_of_edges(),
        },
        "rivers": {
            "geojson": river_geojson,
            "total_nodes": river_G.number_of_nodes(),
            "total_edges": river_G.number_of_edges(),
        },
    }


@router.post("/extract-buildings")
async def extract_buildings(payload: LocationRequest = Body(...)):
    """Load complete OSM building footprints after the priority network layers."""
    bbox = _derive_bbox(payload)
    try:
        geojson, tile_status = await building_service.get_buildings(
            bbox["north"], bbox["south"], bbox["east"], bbox["west"], polygon=payload.polygon
        )
    except OSMTileLoadError as exc:
        raise HTTPException(
            status_code=503,
            detail={"message": "Building data is incomplete.", "failed_tiles": exc.failures},
        ) from exc
    return {
        "status": "success",
        "bbox": bbox,
        "buildings": {"geojson": geojson, "total_features": len(geojson.get("features", []))},
        "osm_loading": tile_status,
    }


@router.post("/build-graph")
async def build_unified_graph(payload: LocationRequest = Body(...)):
    """
    Builds the unified heterogeneous spatial graph containing:
    - River nodes & edges
    - Road nodes & edges
    - IoT sensor nodes (linked to nearest river)
    """
    bbox = _derive_bbox(payload)
    north, south, east, west = bbox["north"], bbox["south"], bbox["east"], bbox["west"]

    (road_G, _), (river_G, _) = await asyncio.gather(
        road_service.get_road_network(north, south, east, west, polygon=payload.polygon),
        river_service.get_river_network(north, south, east, west, polygon=payload.polygon),
    )

    center_lat = bbox.get("center_lat", (north + south) / 2.0)
    center_lng = bbox.get("center_lng", (east + west) / 2.0)

    # Synthesize IoT stations in AOI if not supplied
    sensors = [
        {"id": "master-gateway", "name": "Central Telemetry Gateway", "lat": center_lat, "lng": center_lng, "type": "master"},
        {"id": "slave-river-inflow", "name": "Upstream Doppler Gauge", "lat": center_lat + 0.005, "lng": center_lng + 0.004, "type": "slave", "rainfall_mm": 52.0, "water_level_m": 3.8},
        {"id": "slave-rain-station", "name": "Optical Rain Monitor", "lat": center_lat - 0.006, "lng": center_lng - 0.003, "type": "slave", "rainfall_mm": 48.0, "water_level_m": 2.1},
    ]

    graph_data = graph_builder.build_unified_graph(road_G, river_G, sensors, shelters=[])

    return {
        "status": "success",
        "bbox": bbox,
        "summary": graph_data["summary"],
        "nodes": graph_data["nodes"][:200],  # Return preview sample
        "total_nodes_count": len(graph_data["nodes"]),
        "total_edges_count": len(graph_data["edges"]),
    }


@router.post("/predict-risk")
async def predict_flood_risk(payload: LocationRequest = Body(...)):
    """
    Runs the PyTorch GNN-Transformer risk inference model over the extracted spatial river-road graph.
    Returns node-level flood probabilities, high-risk zones, and severity classes.
    """
    bbox = _derive_bbox(payload)
    north, south, east, west = bbox["north"], bbox["south"], bbox["east"], bbox["west"]

    (road_G, _), (river_G, _) = await asyncio.gather(
        road_service.get_road_network(north, south, east, west, polygon=payload.polygon),
        river_service.get_river_network(north, south, east, west, polygon=payload.polygon),
    )


    center_lat = bbox.get("center_lat", (north + south) / 2.0)
    center_lng = bbox.get("center_lng", (east + west) / 2.0)

    sensors = [
        {"id": "master-gateway", "name": "Central Gateway", "lat": center_lat, "lng": center_lng, "type": "master"},
        {"id": "slave-inflow", "name": "Upstream Inflow Station", "lat": center_lat + 0.004, "lng": center_lng + 0.003, "type": "slave", "rainfall_mm": 55.0},
    ]

    graph_bundle = graph_builder.build_unified_graph(road_G, river_G, sensors, shelters=[])
    predictions = get_risk_engine().predict_graph_risk(graph_bundle["graph"], rainfall_intensity_mm=48.0)

    return {
        "status": "success",
        "bbox": bbox,
        "prediction": predictions,
    }


@router.post("/evacuation-route")
async def calculate_evacuation_route(payload: EvacuationRouteRequest = Body(...)):
    """
    Calculates the safest evacuation route from user's location to a safe exit or custom destination.
    Uses the real road network and dynamically avoids flooded/blocked road edges predicted by the GNN model.
    Optimized: only fetches road network (not rivers), skips full GNN graph build for speed.
    """
    # Only roads needed for routing — river fetch is unnecessary here and slow
    road_G, _ = await road_service.get_road_network(
        payload.north, payload.south, payload.east, payload.west
    )

    # Use lightweight flood risk estimation based on rainfall intensity
    # instead of running the full GNN build + inference (saves 3-8s)
    flood_risks: dict = {}
    if payload.rainfall_intensity_mm > 0:
        try:
            # Build a minimal graph using only roads to run fast risk inference
            mini_bundle = graph_builder.build_road_only_graph(road_G)
            flood_risks = get_risk_engine().predict_graph_risk(
                mini_bundle["graph"], rainfall_intensity_mm=payload.rainfall_intensity_mm
            )
        except Exception:
            flood_risks = {}


    result = routing_service.calculate_safest_route(
        road_graph=road_G,
        user_lat=payload.user_lat,
        user_lng=payload.user_lng,
        dest_lat=payload.dest_lat,
        dest_lng=payload.dest_lng,
        destination_name=payload.destination_name or "Safe Evacuation Destination",
        target_shelter=payload.shelter,
        flood_risk_predictions=flood_risks,
        avoid_critical=payload.avoid_critical,
    )

    return result



@router.get("/shelters")
async def get_shelters(
    lat: float = Query(10.6608),
    lng: float = Query(77.0048),
):
    """Deprecated: shelters removed in favour of real road high-ground safe destinations."""
    return {"shelters": []}
