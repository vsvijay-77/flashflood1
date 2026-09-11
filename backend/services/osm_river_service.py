"""OSM River Service: Extracts rivers, streams, canals, and water bodies from OpenStreetMap.
GeoJSON output uses full OSM way coordinates for continuous polylines.
"""
import asyncio
import json
import hashlib
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
import networkx as nx
from services.location_service import bbox_from_radius, haversine_distance_m, point_in_polygon
from services.osm_tile_loader import osm_tile_loader

CACHE_DIR = Path(__file__).parent.parent / "cache" / "rivers"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Water body type → display width (pixels)
WATERWAY_WIDTHS = {
    "river": 7.0, "canal": 6.0, "stream": 3.0, "drain": 2.0,
    "ditch": 1.5, "riverbank": 8.0, "water": 8.0, "lake": 8.0,
    "reservoir": 9.0, "pond": 6.0, "basin": 6.0, "lagoon": 7.0, "oxbow": 5.0,
}

WATER_BODY_TYPES = {"water", "lake", "reservoir", "pond", "basin", "riverbank", "lagoon", "oxbow"}


class OSMRiverService:
    def __init__(self):
        pass

    def _cache_key(self, north: float, south: float, east: float, west: float) -> Path:
        key_str = f"river_{north:.4f}_{south:.4f}_{east:.4f}_{west:.4f}"
        hash_val = hashlib.md5(key_str.encode()).hexdigest()
        return CACHE_DIR / f"{hash_val}.json"

    def _load_cached_network(self, cache_file: Path, polygon: Optional[List[List[float]]] = None) -> Optional[Tuple[nx.DiGraph, Dict[str, Any]]]:
        """Loads a cached full water network and scopes it to a selected polygon."""
        if not cache_file.exists():
            return None
        try:
            with open(cache_file, "r") as f:
                cached = json.load(f)
            geojson = cached["geojson"]
            if polygon and len(polygon) >= 3:
                geojson = {
                    **geojson,
                    "features": [
                        feature for feature in geojson.get("features", [])
                        if any(
                            point_in_polygon(lat, lng, polygon)
                            for lng, lat in feature.get("geometry", {}).get("coordinates", [])
                        )
                    ],
                }
                geojson["metadata"] = {
                    **geojson.get("metadata", {}),
                    "total_edges": len(geojson["features"]),
                }
            return self._reconstruct_graph(cached), geojson
        except Exception as e:
            print(f"River cache read error: {e}")
            return None

    async def fetch_waterway_elements_overpass(
        self, north: float, south: float, east: float, west: float
    ) -> List[Dict[str, Any]]:
        """Loads complete waterways through the shared tile cache and queue."""
        elements, _ = await osm_tile_loader.load(
            "waterways",
            north,
            south,
            east,
            west,
            'way["waterway"]{bbox};relation["waterway"]{bbox};way["natural"="water"]{bbox};relation["natural"="water"]{bbox};way["water"]{bbox};way["landuse"~"^(reservoir|basin)$"]{bbox}',
        )
        return elements

    async def get_river_network(
        self,
        north: float,
        south: float,
        east: float,
        west: float,
        polygon: Optional[List[List[float]]] = None,
    ) -> Tuple[nx.DiGraph, Dict[str, Any]]:
        """Downloads waterways for bbox, builds DiGraph + full-way GeoJSON."""
        cache_file = self._cache_key(north, south, east, west)
        cached = self._load_cached_network(cache_file, polygon)
        if cached:
            return cached

        # Reuse an existing complete 5 km area cache whenever it contains the
        # selected polygon. This avoids a slow live Overpass request on repeat
        # Digital Twin visits while retaining every waterway in the area.
        if polygon and len(polygon) >= 3:
            center_lat = sum(point[0] for point in polygon) / len(polygon)
            center_lng = sum(point[1] for point in polygon) / len(polygon)
            broad_bbox = bbox_from_radius(center_lat, center_lng, 5.0)
            broad_cache = self._load_cached_network(
                self._cache_key(broad_bbox["north"], broad_bbox["south"], broad_bbox["east"], broad_bbox["west"]),
                polygon,
            )
            if broad_cache:
                return broad_cache

        elements = await self.fetch_waterway_elements_overpass(north, south, east, west)
        if not elements:
            G = nx.DiGraph()
            geojson = {"type": "FeatureCollection", "features": [], "metadata": {"total_nodes": 0, "total_edges": 0}}
            return G, geojson

        # Build node lookup
        nodes_dict: Dict[int, Tuple[float, float]] = {}
        for el in elements:
            if el.get("type") == "node":
                nodes_dict[el["id"]] = (float(el["lat"]), float(el["lon"]))

        # Generate full-way GeoJSON — all nodes per way → continuous polylines
        features = []
        seen_way_ids = set()

        for el in elements:
            if el.get("type") != "way" or el["id"] in seen_way_ids:
                continue
            tags = el.get("tags", {})

            # Accept waterways, natural water, and water landuse
            is_waterway = bool(tags.get("waterway"))
            is_natural_water = tags.get("natural") == "water"
            has_water_tag = bool(tags.get("water"))
            is_water_landuse = tags.get("landuse") in ("reservoir", "basin")

            if not (is_waterway or is_natural_water or has_water_tag or is_water_landuse):
                continue

            seen_way_ids.add(el["id"])
            node_refs = el.get("nodes", [])

            # Collect all node coordinates in order
            coords = []
            for nid in node_refs:
                if nid in nodes_dict:
                    lat, lon = nodes_dict[nid]
                    coords.append([lon, lat])  # GeoJSON: [lng, lat]

            if len(coords) < 2:
                continue

            # Keep the visual water network scoped to the selected polygon,
            # rather than returning every waterway in its enclosing bbox.
            if polygon and len(polygon) >= 3:
                if not any(point_in_polygon(lat, lng, polygon) for lng, lat in coords):
                    continue

            # Determine waterway type and classification
            ww_type = (
                tags.get("water")
                or tags.get("waterway")
                or (tags.get("natural") if is_natural_water else None)
                or tags.get("landuse")
                or "stream"
            )
            is_water_body = bool(
                is_natural_water or has_water_tag or is_water_landuse
                or ww_type in WATER_BODY_TYPES
            )
            is_main_river = ww_type in ("river", "canal") and not is_water_body
            name = tags.get("name", "")

            features.append({
                "type": "Feature",
                "properties": {
                    "id": f"way-{el['id']}",
                    "name": name,
                    "waterway_type": ww_type,
                    "is_water_body": is_water_body,
                    "is_main_river": is_main_river,
                    "width_m": WATERWAY_WIDTHS.get(ww_type, 3.0),
                    "length_m": 0.0,  # Computed client-side if needed
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": coords,
                },
            })

        geojson = {
            "type": "FeatureCollection",
            "features": features,
            "metadata": {"total_nodes": len(nodes_dict), "total_edges": len(features)},
        }

        # Build NetworkX graph for risk/routing analysis
        G = self._build_graph(elements, nodes_dict, north, south, east, west, polygon)

        if not polygon:
            self._save_cache(cache_file, G, geojson)

        return G, geojson

    def _build_graph(
        self,
        elements: List[Dict[str, Any]],
        nodes_dict: Dict[int, Tuple[float, float]],
        north: float, south: float, east: float, west: float,
        polygon: Optional[List[List[float]]] = None,
    ) -> nx.DiGraph:
        G = nx.DiGraph()
        for el in elements:
            if el.get("type") != "way":
                continue
            tags = el.get("tags", {})
            if not (tags.get("waterway") or tags.get("natural") == "water" or tags.get("water") or tags.get("landuse") in ("reservoir", "basin")):
                continue
            ww_type = tags.get("waterway") or tags.get("water") or tags.get("natural") or tags.get("landuse") or "stream"
            name = tags.get("name", "Unnamed Waterway")
            width_m = WATERWAY_WIDTHS.get(ww_type, 3.0)
            node_refs = el.get("nodes", [])
            for i in range(len(node_refs) - 1):
                u_id, v_id = node_refs[i], node_refs[i + 1]
                if u_id not in nodes_dict or v_id not in nodes_dict:
                    continue
                u_lat, u_lng = nodes_dict[u_id]
                v_lat, v_lng = nodes_dict[v_id]
                u_in = (south <= u_lat <= north) and (west <= u_lng <= east)
                v_in = (south <= v_lat <= north) and (west <= v_lng <= east)
                if not (u_in or v_in):
                    continue
                if polygon and len(polygon) >= 3:
                    if not (point_in_polygon(u_lat, u_lng, polygon) or point_in_polygon(v_lat, v_lng, polygon)):
                        continue
                for nid, nlat, nlng in [(u_id, u_lat, u_lng), (v_id, v_lat, v_lng)]:
                    if nid not in G:
                        G.add_node(nid, lat=nlat, lng=nlng, type="river_junction")
                length_m = haversine_distance_m(u_lat, u_lng, v_lat, v_lng)
                if length_m < 0.1:
                    continue
                G.add_edge(u_id, v_id, name=name, waterway=ww_type, width_m=width_m,
                           length=round(length_m, 2), osm_way_id=el["id"],
                           is_water_body=ww_type in WATER_BODY_TYPES)
        return G

    # Kept for backward compat
    def graph_to_geojson(self, G: nx.DiGraph) -> Dict[str, Any]:
        features = []
        for u, v, data in G.edges(data=True):
            coords = [[G.nodes[u]["lng"], G.nodes[u]["lat"]], [G.nodes[v]["lng"], G.nodes[v]["lat"]]]
            ww = data.get("waterway", "stream")
            features.append({
                "type": "Feature",
                "properties": {
                    "id": f"river-{u}-{v}", "name": data.get("name", ""),
                    "waterway_type": ww,
                    "is_water_body": data.get("is_water_body", False),
                    "is_main_river": ww in ("river", "canal"),
                    "width_m": data.get("width_m", 3.0),
                    "length_m": data.get("length", 0.0),
                },
                "geometry": {"type": "LineString", "coordinates": coords},
            })
        return {"type": "FeatureCollection", "features": features,
                "metadata": {"total_nodes": G.number_of_nodes(), "total_edges": G.number_of_edges()}}

    def _save_cache(self, cache_file: Path, G: nx.DiGraph, geojson: Dict[str, Any]):
        if not geojson.get("features"):
            return
        try:
            nodes_data = {str(n): {"lat": d["lat"], "lng": d["lng"]} for n, d in G.nodes(data=True)}
            edges_data = [
                {"u": str(u), "v": str(v), **{k: val for k, val in data.items() if k != "coordinates"}}
                for u, v, data in G.edges(data=True)
            ]
            with open(cache_file, "w") as f:
                json.dump({"nodes": nodes_data, "edges": edges_data, "geojson": geojson}, f)
        except Exception as e:
            print(f"Failed to save river cache: {e}")

    def _reconstruct_graph(self, cached: Dict[str, Any]) -> nx.DiGraph:
        G = nx.DiGraph()
        for node_id, data in cached.get("nodes", {}).items():
            nid = int(node_id) if node_id.isdigit() else node_id
            G.add_node(nid, lat=data["lat"], lng=data["lng"])
        for edge in cached.get("edges", []):
            u = int(edge["u"]) if str(edge["u"]).isdigit() else edge["u"]
            v = int(edge["v"]) if str(edge["v"]).isdigit() else edge["v"]
            if u in G.nodes and v in G.nodes:
                attrs = {k: val for k, val in edge.items() if k not in ("u", "v")}
                G.add_edge(u, v, **attrs)
        return G
