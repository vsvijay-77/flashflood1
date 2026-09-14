"""Persistent digital-twin building storage in Supabase.

The existing ``simulations.steps`` JSONB column is used as a compatibility
container so this works with the current Supabase schema.  Each footprint query
gets a deterministic row, allowing the viewer to load houses from the cloud
without reading bundled GeoJSON or local cache files.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from typing import Any, Dict, List, Optional

import httpx
from dotenv import load_dotenv

logger = logging.getLogger("supabase_building_store")

ROOT_DIR = os.path.dirname(os.path.dirname(__file__))
load_dotenv(os.path.join(ROOT_DIR, ".env"))


class SupabaseBuildingStore:
    def __init__(self) -> None:
        self.url = os.environ.get("SUPABASE_URL", "").rstrip("/")
        self.key = (
            os.environ.get("SUPABASE_SECRET_KEY")
            or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
            or os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
        )
        self.table_url = f"{self.url}/rest/v1/simulations" if self.url else ""

    @property
    def available(self) -> bool:
        return bool(self.table_url and self.key)

    def row_id(self, min_lat: float, min_lon: float, max_lat: float, max_lon: float,
               polygon: Optional[List[List[float]]]) -> str:
        key = json.dumps({
            "min_lat": round(min_lat, 6), "min_lon": round(min_lon, 6),
            "max_lat": round(max_lat, 6), "max_lon": round(max_lon, 6),
            "polygon": polygon or [],
        }, sort_keys=True, separators=(",", ":"))
        return f"dt-buildings-{hashlib.sha256(key.encode()).hexdigest()[:48]}"

    def _headers(self) -> Dict[str, str]:
        return {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        }

    async def load(self, row_id: str) -> Optional[Dict[str, Any]]:
        if not self.available:
            return None
        params = {"id": f"eq.{row_id}", "scenario": "eq.building_footprints", "select": "steps,summary", "limit": "1"}
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                response = await client.get(self.table_url, headers=self._headers(), params=params)
            if response.status_code != 200:
                return None
            rows = response.json()
            if not rows:
                return None
            steps = rows[0].get("steps") or []
            metadata = json.loads(rows[0].get("summary") or "{}") if isinstance(rows[0].get("summary"), str) else (rows[0].get("summary") or {})
            if not isinstance(steps, list):
                return None
            if not isinstance(metadata, dict):
                metadata = {}
            metadata.setdefault("source", "Supabase")
            metadata.setdefault("total_buildings", len(steps))
            return {"type": "FeatureCollection", "features": steps, "metadata": metadata, "source": "Supabase"}
        except Exception:
            return None

    async def save(self, row_id: str, result: Dict[str, Any], area_id: Optional[str] = None) -> bool:
        if not self.available:
            return False
        metadata = result.get("metadata") or {}
        payload = {
            "id": row_id,
            "zone_id": area_id or row_id,
            "zone_name": "Digital Twin Building Footprints",
            "scenario": "building_footprints",
            "severity": "stored",
            "peak_impact_pct": 0,
            "affected_area_km2": 0,
            "population_at_risk": 0,
            "evacuation_time_min": 0,
            "steps": result.get("features") or [],
            "summary": json.dumps({**metadata, "source": "Supabase"}, separators=(",", ":")),
        }
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    self.table_url,
                    headers={**self._headers(), "Prefer": "resolution=merge-duplicates,return=minimal"},
                    json=payload,
                )
            return response.status_code in (200, 201, 204)
        except Exception as e:
            logger.error(f"[supabase_building_store] Save error: {e}")
            return False

    async def delete(self, row_id: str) -> bool:
        if not self.available or not row_id:
            return False
        params = {"id": f"eq.{row_id}", "scenario": "eq.building_footprints"}
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.delete(self.table_url, headers=self._headers(), params=params)
            return response.status_code in (200, 204)
        except Exception as e:
            logger.error(f"[supabase_building_store] Delete error: {e}")
            return False


supabase_building_store = SupabaseBuildingStore()
