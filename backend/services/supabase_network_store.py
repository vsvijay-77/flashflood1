"""Supabase persistence for Digital Twin paths and water features."""
from __future__ import annotations

import hashlib
import json
import os
from typing import Any, Dict, List, Optional

import httpx
from dotenv import load_dotenv
from services.osm_river_service import relation_water_body_features
from services.location_service import point_in_polygon

ROOT_DIR = os.path.dirname(os.path.dirname(__file__))
load_dotenv(os.path.join(ROOT_DIR, ".env"))

WATER_BODY_TYPES = {"water", "lake", "reservoir", "pond", "basin", "riverbank", "lagoon", "oxbow"}


def _geometry_points(geometry: Dict[str, Any]) -> List[List[float]]:
    """Flatten GeoJSON coordinates into [lng, lat] points."""
    points: List[List[float]] = []

    def walk(value: Any) -> None:
        if isinstance(value, (list, tuple)):
            if len(value) >= 2 and all(isinstance(item, (int, float)) for item in value[:2]):
                points.append([float(value[0]), float(value[1])])
                return
            for child in value:
                walk(child)

    walk(geometry.get("coordinates") if isinstance(geometry, dict) else None)
    return points


def _geometry_sequences(geometry: Dict[str, Any]) -> List[List[List[float]]]:
    """Return line/ring sequences from any GeoJSON line or polygon geometry."""
    gtype = geometry.get("type") if isinstance(geometry, dict) else ""
    coords = geometry.get("coordinates") if isinstance(geometry, dict) else None
    if gtype == "LineString":
        return [coords] if isinstance(coords, list) else []
    if gtype == "MultiLineString":
        return [line for line in (coords or []) if isinstance(line, list)]
    if gtype == "Polygon":
        return [ring for ring in (coords or []) if isinstance(ring, list)]
    if gtype == "MultiPolygon":
        return [ring for polygon in (coords or []) for ring in (polygon or []) if isinstance(ring, list)]
    return []


def _point_in_ring(point: List[float], ring: List[List[float]]) -> bool:
    if len(ring) < 3:
        return False
    x, y = point
    inside = False
    for index in range(len(ring)):
        x1, y1 = ring[index - 1][:2]
        x2, y2 = ring[index][:2]
        if (y1 > y) != (y2 > y):
            crossing = (x2 - x1) * (y - y1) / (y2 - y1) + x1
            if x < crossing:
                inside = not inside
    return inside


def _segment_intersects(a: List[float], b: List[float], c: List[float], d: List[float]) -> bool:
    def orient(p: List[float], q: List[float], r: List[float]) -> float:
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

    def on_segment(p: List[float], q: List[float], r: List[float]) -> bool:
        return (
            abs(orient(p, q, r)) < 1e-12
            and min(p[0], r[0]) - 1e-12 <= q[0] <= max(p[0], r[0]) + 1e-12
            and min(p[1], r[1]) - 1e-12 <= q[1] <= max(p[1], r[1]) + 1e-12
        )

    oa, ob = orient(a, b, c), orient(a, b, d)
    oc, od = orient(c, d, a), orient(c, d, b)
    return (oa * ob < 0 and oc * od < 0) or on_segment(a, c, b) or on_segment(a, d, b) or on_segment(c, a, d) or on_segment(c, b, d)


def feature_overlaps_area(
    feature: Dict[str, Any],
    bbox: Optional[Dict[str, Any]] = None,
    polygon: Optional[List[List[float]]] = None,
) -> bool:
    """Check that a cached feature actually intersects the requested area."""
    geometry = feature.get("geometry") or {}
    points = _geometry_points(geometry)
    if not points:
        return False
    if bbox:
        min_lng, max_lng = float(bbox["west"]), float(bbox["east"])
        min_lat, max_lat = float(bbox["south"]), float(bbox["north"])
        if max(point[0] for point in points) < min_lng or min(point[0] for point in points) > max_lng:
            return False
        if max(point[1] for point in points) < min_lat or min(point[1] for point in points) > max_lat:
            return False
    if not polygon or len(polygon) < 3:
        return True

    area_ring = [[float(lng), float(lat)] for lat, lng in polygon]
    if any(point_in_polygon(point[1], point[0], polygon) for point in points):
        return True
    geometry_type = geometry.get("type") if isinstance(geometry, dict) else ""
    if geometry_type in {"Polygon", "MultiPolygon"} and any(_point_in_ring(vertex, points) for vertex in area_ring):
        return True
    area_segments = list(zip(area_ring, area_ring[1:] + area_ring[:1]))
    for sequence in _geometry_sequences(geometry):
        for start, end in zip(sequence, sequence[1:]):
            if any(_segment_intersects(start, end, area_start, area_end) for area_start, area_end in area_segments):
                return True
    return False


class SupabaseNetworkStore:
    """Stores one row per extracted path/water feature for an area."""

    def __init__(self) -> None:
        self.url = os.environ.get("SUPABASE_URL", "").rstrip("/")
        self.key = (
            os.environ.get("SUPABASE_SECRET_KEY")
            or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
            or os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
        )
        self.table_url = f"{self.url}/rest/v1/digital_twin_network_features" if self.url else ""

    @property
    def available(self) -> bool:
        return bool(self.table_url and self.key)

    def area_key(
        self,
        north: float,
        south: float,
        east: float,
        west: float,
        polygon: Optional[List[List[float]]] = None,
    ) -> str:
        value = json.dumps(
            {
                "north": round(north, 6),
                "south": round(south, 6),
                "east": round(east, 6),
                "west": round(west, 6),
                "polygon": polygon or [],
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        return f"dt-network-{hashlib.sha256(value.encode()).hexdigest()[:48]}"

    def _headers(self) -> Dict[str, str]:
        return {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        }

    @staticmethod
    def _feature_type(feature: Dict[str, Any], default: str) -> str:
        props = feature.get("properties") or {}
        waterway = str(props.get("waterway_type") or props.get("waterway") or "").lower()
        if default == "waterway" and (props.get("is_water_body") or waterway in WATER_BODY_TYPES):
            return "water_body"
        return default

    async def load(
        self,
        area_key: str,
        bbox: Optional[Dict[str, Any]] = None,
        polygon: Optional[List[List[float]]] = None,
    ) -> Optional[Dict[str, Any]]:
        if not self.available:
            return None
        params = {
            "area_key": f"eq.{area_key}",
            "select": "feature_id,feature_type,name,geometry,properties,bbox,source",
            "order": "feature_type,feature_id",
            "limit": "1000",
        }
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                rows: List[Dict[str, Any]] = []
                offset = 0
                while True:
                    response = await client.get(
                        self.table_url,
                        headers=self._headers(),
                        params={**params, "offset": str(offset)},
                    )
                    if response.status_code != 200:
                        return None
                    page = response.json()
                    if not isinstance(page, list) or not page:
                        break
                    rows.extend(page)
                    if len(page) < 1000:
                        break
                    offset += len(page)
            if not rows:
                return None
            roads: List[Dict[str, Any]] = []
            rivers: List[Dict[str, Any]] = []
            requested_bbox = bbox
            stored_bbox: Optional[Dict[str, float]] = None
            source = "Supabase"
            for row in rows:
                feature = {
                    "type": "Feature",
                    "id": row.get("feature_id"),
                    "properties": row.get("properties") or {},
                    "geometry": row.get("geometry") or {},
                }
                if not feature_overlaps_area(feature, requested_bbox, polygon):
                    continue
                if row.get("feature_type") == "path":
                    roads.append(feature)
                else:
                    rivers.append(feature)
                if stored_bbox is None and isinstance(row.get("bbox"), dict):
                    stored_bbox = row["bbox"]
                source = row.get("source") or source
            if not roads and not rivers:
                return None
            return {"roads": roads, "rivers": rivers, "bbox": stored_bbox or requested_bbox, "source": source}
        except Exception:
            return None

    async def save(
        self,
        area_key: str,
        bbox: Dict[str, Any],
        roads: List[Dict[str, Any]],
        rivers: List[Dict[str, Any]],
        polygon: Optional[List[List[float]]] = None,
        replace_all: bool = False,
    ) -> bool:
        if not self.available:
            return False
        rows: List[Dict[str, Any]] = []
        filtered_roads = [feature for feature in roads if feature_overlaps_area(feature, bbox, polygon)]
        filtered_rivers = [feature for feature in rivers if feature_overlaps_area(feature, bbox, polygon)]
        for index, feature in enumerate([*filtered_roads, *filtered_rivers]):
            default_type = "path" if index < len(filtered_roads) else "waterway"
            props = feature.get("properties") or {}
            feature_type = self._feature_type(feature, default_type)
            feature_id = str(feature.get("id") or props.get("id") or f"feature-{index}")
            rows.append(
                {
                    "id": f"{area_key}:{feature_type}:{feature_id}",
                    "area_key": area_key,
                    "feature_id": feature_id,
                    "feature_type": feature_type,
                    "name": str(props.get("name") or ""),
                    "geometry": feature.get("geometry") or {},
                    "properties": props,
                    "bbox": bbox,
                    "source": "OpenStreetMap",
                }
            )
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                types_to_replace = set()
                if roads or replace_all:
                    types_to_replace.add("path")
                if rivers or replace_all:
                    types_to_replace.update({"waterway", "water_body"})
                if types_to_replace:
                    type_filter = ",".join(sorted(types_to_replace))
                    deleted = await client.delete(
                        self.table_url,
                        headers=self._headers(),
                        params={"area_key": f"eq.{area_key}", "feature_type": f"in.({type_filter})"},
                    )
                    if not deleted.is_success:
                        return False
                if not rows:
                    return True
                for start in range(0, len(rows), 250):
                    response = await client.post(
                        self.table_url,
                        headers={
                            **self._headers(),
                            "Prefer": "resolution=merge-duplicates,return=minimal",
                        },
                        json=rows[start : start + 250],
                    )
                    if response.status_code not in (200, 201, 204):
                        return False
            return True
        except Exception:
            return False

    async def delete_area(self, area_key: str) -> bool:
        if not self.available or not area_key:
            return False
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.delete(
                    self.table_url,
                    headers=self._headers(),
                    params={"area_key": f"eq.{area_key}"},
                )
            return response.status_code in (200, 204)
        except Exception:
            return False


supabase_network_store = SupabaseNetworkStore()


def water_elements_to_features(elements: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Convert raw OSM water elements into the GeoJSON rows used by the map."""
    nodes = {
        item.get("id"): (float(item["lon"]), float(item["lat"]))
        for item in elements
        if item.get("type") == "node" and item.get("lon") is not None and item.get("lat") is not None
    }
    relation_features, relation_way_ids = relation_water_body_features(
        elements,
        {int(node_id): (lat, lng) for node_id, (lng, lat) in nodes.items()},
    )
    features: List[Dict[str, Any]] = list(relation_features)
    for item in elements:
        if item.get("type") != "way":
            continue
        if item.get("id") in relation_way_ids:
            continue
        tags = dict(item.get("tags") or {})
        waterway = str(tags.get("waterway") or tags.get("water") or tags.get("natural") or tags.get("landuse") or "").lower()
        is_water_body = bool(
            tags.get("natural") == "water"
            or tags.get("water")
            or tags.get("landuse") in ("reservoir", "basin")
            or waterway in WATER_BODY_TYPES
        )
        if not (is_water_body or tags.get("waterway")):
            continue
        coords = [list(nodes[node_id]) for node_id in item.get("nodes", []) if node_id in nodes]
        if len(coords) < 2:
            continue
        is_closed = len(coords) >= 4 and coords[0] == coords[-1]
        geometry = {"type": "Polygon", "coordinates": [coords]} if is_water_body and is_closed else {"type": "LineString", "coordinates": coords}
        raw_width = tags.get("width")
        try:
            width_m = float(str(raw_width).split()[0]) if raw_width is not None else (18 if waterway == "river" else 5)
        except (TypeError, ValueError):
            width_m = 18 if waterway == "river" else 5
        props = {
            **tags,
            "id": f"way-{item.get('id')}",
            "name": tags.get("name", ""),
            "waterway_type": waterway or "stream",
            "is_water_body": is_water_body,
            "width_m": width_m,
        }
        features.append({
            "type": "Feature",
            "id": props["id"],
            "properties": props,
            "geometry": geometry,
        })
    return features
