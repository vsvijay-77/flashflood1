"""Routing & Rivers API Router: Real OSM road and river extraction, GNN spatial graph, risk inference, and evacuation routing."""
import asyncio
import math
import networkx as nx
from typing import Dict, Any, List, Optional, Tuple
from fastapi import APIRouter, HTTPException, Query, Body

from pydantic import BaseModel, Field

from services.location_service import bbox_from_radius, bbox_from_polygon, geocode_place_name
from services.osm_road_service import OSMRoadService
from services.osm_river_service import OSMRiverService
from services.osm_building_service import OSMBuildingService
from services.osm_tile_loader import OSMTileLoader, OSMTileLoadError
from services import area_map_store
from services.complete_buildings import enrich_buildings, BUILDING_VERSION
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
    area_id: Optional[str] = None
    area_key: Optional[str] = None


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
    if req.polygon and len(req.polygon) >= 3:
        latitudes = [point[0] for point in req.polygon]
        longitudes = [point[1] for point in req.polygon]
        pad = 0.005  # ~500m context — just enough for roads that cross the border
        return {
            "north": max(latitudes) + pad, "south": min(latitudes) - pad,
            "east": max(longitudes) + pad, "west": min(longitudes) - pad,
            "center_lat": (max(latitudes) + min(latitudes)) / 2,
            "center_lng": (max(longitudes) + min(longitudes)) / 2,
        }
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

class WaterBounds(BaseModel):
    south: float = Field(ge=-90, le=90)
    north: float = Field(ge=-90, le=90)
    west: float = Field(ge=-180, le=180)
    east: float = Field(ge=-180, le=180)


@router.post("/water-bodies")
async def water_bodies(payload: WaterBounds):
    from services.water_surface_service import load_water_elements
    if not (0 < payload.north - payload.south <= 1 and 0 < payload.east - payload.west <= 1):
        raise HTTPException(status_code=422, detail="Select an area smaller than one degree per side.")
    try:
        return await load_water_elements(payload.south, payload.west, payload.north, payload.east)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/extract-networks")
async def extract_networks(payload: LocationRequest = Body(...)):
    """
    Extracts real-world OpenStreetMap road network and river/waterway channels for any selected location.
    Accepts place name, polygon, or coordinates + radius.
    """
    has_geometry = bool(payload.polygon and len(payload.polygon) >= 3) or all(
        value is not None for value in (payload.north, payload.south, payload.east, payload.west)
    ) or (payload.lat is not None and payload.lng is not None)
    if payload.place_name and not has_geometry:
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

    area_id = area_map_store.area_id_for(payload)
    key = area_map_store.boundary_key(payload.polygon, bbox)
    try:
        cached = await asyncio.to_thread(area_map_store.load_layers, area_id, key)
    except Exception as exc:
        raise HTTPException(503, "Saved map layers are unavailable. Please retry.") from exc

    async def load_layer(name, service):
        if name in cached:
            return cached[name], None
        try:
            _, geojson = await asyncio.wait_for(service(
                bbox["north"], bbox["south"], bbox["east"], bbox["west"], polygon=payload.polygon
            ), timeout=240)
            await asyncio.to_thread(area_map_store.save_layer, area_id, key, name, geojson)
            return geojson, None
        except Exception as exc:
            return {"type": "FeatureCollection", "features": []}, str(exc)

    (roads, road_error), (rivers, river_error) = await asyncio.gather(
        load_layer("roads", road_service.get_road_network),
        load_layer("rivers", river_service.get_river_network),
    )
    failed = [name for name, error in (("roads", road_error), ("rivers", river_error)) if error is not None]
    result = {
        "status": "success", "bbox": bbox,
        "osm_loading": {
            "complete": not failed, "total_tiles": 2, "loaded_tiles": 2 - len(failed),
            "failed_tiles": [], "failed_layers": failed,
            "source": "supabase_cache" if "roads" in cached and "rivers" in cached else "OpenStreetMap",
        },
        "roads": {"geojson": roads, "total_nodes": roads.get("metadata", {}).get("total_nodes", 0), "total_edges": len(roads["features"])},
        "rivers": {"geojson": rivers, "total_nodes": rivers.get("metadata", {}).get("total_nodes", 0), "total_edges": len(rivers["features"])},
    }
    if "buildings" in cached and cached["buildings"].get("metadata", {}).get("building_version") == BUILDING_VERSION:
        result["buildings"] = {"geojson": cached["buildings"], "total_features": len(cached["buildings"]["features"])}
    return result


@router.post("/extract-buildings")
async def extract_buildings(payload: LocationRequest = Body(...)):
    bbox = _derive_bbox(payload)
    area_id = area_map_store.area_id_for(payload)
    key = area_map_store.boundary_key(payload.polygon, bbox)
    try:
        cached = await asyncio.to_thread(area_map_store.load_layers, area_id, key)
        if "buildings" in cached:
            geojson = cached["buildings"]
            status = {"complete": True, "source": "supabase_cache", "loaded_tiles": 1, "total_tiles": 1, "failed_tiles": []}
        else:
            geojson, status = await asyncio.wait_for(building_service.get_buildings(
                bbox["north"], bbox["south"], bbox["east"], bbox["west"], polygon=payload.polygon
            ), timeout=240)
            if not status.get("complete"):
                raise RuntimeError("Incomplete building tiles")

        if geojson.get("metadata", {}).get("building_version") != BUILDING_VERSION:
            geojson = await asyncio.to_thread(enrich_buildings, geojson, bbox, payload.polygon)
        if "buildings" not in cached or geojson is not cached["buildings"]:
            await asyncio.to_thread(area_map_store.save_layer, area_id, key, "buildings", geojson)
    except Exception as exc:
        raise HTTPException(503, "Buildings could not be fully loaded and saved. Please retry.") from exc
    return {
        "status": "success", "bbox": bbox,
        "buildings": {"geojson": geojson, "total_features": len(geojson["features"])},
        "osm_loading": status,
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

    # Risk scoring is supplementary to the map. A temporary Overpass rate
    # limit must not make an already loaded road/river scene look broken.
    try:
        (road_G, _), (river_G, _) = await asyncio.wait_for(
            asyncio.gather(
                road_service.get_road_network(north, south, east, west, polygon=payload.polygon),
                river_service.get_river_network(north, south, east, west, polygon=payload.polygon),
            ),
            timeout=12.0,
        )
    except (OSMTileLoadError, asyncio.TimeoutError):
        road_G, river_G = nx.DiGraph(), nx.DiGraph()


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
