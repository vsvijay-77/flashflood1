"""Area-owned Digital Twin snapshots; only Supabase is authoritative."""
from __future__ import annotations

import asyncio
import json
import math
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import HTTPException
from shapely import make_valid
from shapely.geometry import Polygon, box, mapping, shape
from shapely.errors import GEOSException

from services.supabase_building_store import supabase_building_store as buildings
from services.supabase_network_store import supabase_network_store as networks


def area_polygon(area: dict) -> list[list[float]]:
    value = area.get("shape") or ""
    try:
        points = json.loads(value.removeprefix("Polygon:"))
        if isinstance(points, list) and len(points) >= 3:
            return [[float(lat), float(lng)] for lat, lng in points]
    except (ValueError, TypeError):
        pass
    lat, lng = float(area["lat"]), float(area["lng"])
    return [[lat + 1200 / 111320 * math.sin(i * math.tau / 16),
             lng + 1200 / (111320 * math.cos(math.radians(lat))) * math.cos(i * math.tau / 16)]
            for i in range(16)]


def tight_bbox(polygon: list[list[float]]) -> dict:
    lats, lngs = zip(*polygon)
    return {"north": max(lats), "south": min(lats), "east": max(lngs), "west": min(lngs),
            "center_lat": (min(lats) + max(lats)) / 2, "center_lng": (min(lngs) + max(lngs)) / 2}


def clip_features(features: list[dict], bbox: dict, polygon: list | None) -> list[dict]:
    """Cut geometry at the boundary, preserving holes and crossing features."""
    selection = make_valid(Polygon([(lng, lat) for lat, lng in polygon])) if polygon else box(
        bbox["west"], bbox["south"], bbox["east"], bbox["north"])
    result = []
    for feature in features:
        try:
            original = make_valid(shape(feature["geometry"]))
            clipped = original.intersection(selection)
            allowed = ("Polygon", "MultiPolygon") if "Polygon" in original.geom_type else ("LineString", "MultiLineString")
            parts = list(clipped.geoms) if clipped.geom_type in ("GeometryCollection", "MultiLineString", "MultiPolygon") else [clipped]
            for index, part in enumerate(parts):
                if part.is_empty or part.geom_type not in allowed:
                    continue
                props = dict(feature.get("properties") or {})
                if len(parts) > 1:
                    props["id"] = f"{props.get('id', feature.get('id', 'feature'))}-{index}"
                result.append({**feature, "id": props.get("id", feature.get("id")), "properties": props, "geometry": mapping(part)})
        except (ValueError, TypeError, KeyError, GEOSException):
            continue
    return result


class SelectedAreaStore:
    def __init__(self):
        self.locks: dict[str, asyncio.Lock] = {}

    async def request(self, method: str, table: str, **kwargs) -> Any:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.request(method, f"{networks.url}/rest/v1/{table}",
                                            headers={**networks._headers(), "Prefer": "resolution=merge-duplicates,return=representation"}, **kwargs)
        if not response.is_success:
            raise HTTPException(503, "Supabase could not complete the area data operation. Please retry.")
        return response.json() if response.content else []

    async def get_area(self, area_id: str) -> dict:
        rows = await self.request("GET", "custom_areas", params={"id": f"eq.{area_id}", "select": "*"})
        if not rows:
            raise HTTPException(404, "This monitored area has been deleted.")
        return rows[0]

    @asynccontextmanager
    async def writing(self, key: str, area_id: str | None):
        async with self.locks.setdefault(key, asyncio.Lock()):
            # A request that finished downloading after deletion must not recreate data.
            if area_id:
                await self.get_area(area_id)
            yield

    async def network_state(self, key: str) -> dict | None:
        rows = await self.request("GET", "simulations", params={"id": f"eq.{key}:networks", "select": "summary"})
        return json.loads(rows[0]["summary"]) if rows else None

    async def save_network_state(self, key: str, area_id: str | None, roads: int, rivers: int, polygon: list | None = None):
        await self.request("POST", "simulations", json={
            "id": f"{key}:networks", "zone_id": area_id or key, "zone_name": "Digital Twin Networks",
            "scenario": "digital_twin_network", "severity": "stored", "steps": [],
            "summary": json.dumps({"complete": True, "roads": roads, "rivers": rivers, "polygon": polygon}),
        })

    async def delete(self, area_id: str, user: dict) -> dict:
        key = f"dt-area-{area_id}"
        async with self.locks.setdefault(key, asyncio.Lock()):
            area = await self.get_area(area_id)
            if area.get("user_id") and area["user_id"] != user.get("id") and user.get("role") != "admin":
                raise HTTPException(403, "You cannot delete another user's monitored area.")
            # Delete owned layers first. On failure, keep the parent visible for retry.
            await self.request("DELETE", "digital_twin_network_features", params={"area_key": f"eq.{key}"})
            await self.request("DELETE", "simulations", params={"zone_id": f"eq.{area_id}"})
            await self.request("DELETE", "custom_areas", params={"id": f"eq.{area_id}"})
            return {"status": "deleted", "area_id": area_id}


selected_area_store = SelectedAreaStore()
