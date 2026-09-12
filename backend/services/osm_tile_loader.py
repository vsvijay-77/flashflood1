"""Reliable, tile-cached Overpass loading shared by the road and water services."""
from __future__ import annotations

import asyncio
import hashlib
import json
import math
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable, Iterable

import httpx


CACHE_ROOT = Path(__file__).parent.parent / "cache" / "osm_tiles"
CACHE_ROOT.mkdir(parents=True, exist_ok=True)
CACHE_TTL_SECONDS = 24 * 60 * 60
MAX_CONCURRENCY = 6
# Keep a new-area request responsive. Endpoint failover is still used, but a
# dead Overpass mirror must not hold the Digital Twin risk panel for minutes.
REQUEST_TIMEOUT_SECONDS = 20.0
MAX_ATTEMPTS = 2

ENDPOINTS = (
    # Fast, worldwide Overpass mirrors with reliable global coverage
    "https://overpass.openstreetmap.fr/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
)


class OSMTileLoadError(RuntimeError):
    def __init__(self, failures: list[str]):
        super().__init__("; ".join(failures))
        self.failures = failures


@dataclass(frozen=True)
class Tile:
    north: float
    south: float
    east: float
    west: float

    @property
    def key(self) -> str:
        return f"{self.north:.5f}:{self.south:.5f}:{self.east:.5f}:{self.west:.5f}"

    def as_dict(self) -> dict[str, float]:
        return {"north": self.north, "south": self.south, "east": self.east, "west": self.west}


class OSMTileLoader:
    """Downloads bounded OSM queries with cache, retries and endpoint failover."""

    def __init__(self) -> None:
        self._semaphore = asyncio.Semaphore(MAX_CONCURRENCY)
        self._unhealthy_until: dict[str, float] = {}
        self._inflight: dict[str, asyncio.Future] = {}

    @staticmethod
    def tiles_for_bbox(north: float, south: float, east: float, west: float) -> list[Tile]:
        lat_span, lng_span = abs(north - south), abs(east - west)
        # A normal selected area (up to roughly 6 km across) fits safely in one
        # bounded query. Splitting it into four requests was slower and made
        # the viewer wait unnecessarily. Larger AOIs still use small tiles.
        # Keep ordinary drawn/saved areas to a small number of requests. The
        # previous 0.20° cutoff split a perfectly valid 15–20 km area into
        # 88 tiles, making a new-area selection appear stuck in the viewer.
        target_span = 0.10 if max(lat_span, lng_span) <= 0.50 else 0.025
        rows = max(1, math.ceil(lat_span / target_span))
        cols = max(1, math.ceil(lng_span / target_span))
        lat_step = lat_span / rows
        lng_step = lng_span / cols
        return [
            Tile(
                north=min(north, south + (row + 1) * lat_step),
                south=south + row * lat_step,
                east=min(east, west + (col + 1) * lng_step),
                west=west + col * lng_step,
            )
            for row in range(rows)
            for col in range(cols)
        ]

    @staticmethod
    def _cache_path(dataset: str, tile: Tile) -> Path:
        digest = hashlib.sha256(f"v1:{dataset}:{tile.key}".encode()).hexdigest()
        return CACHE_ROOT / dataset / f"{digest}.json"

    def _read_cache(self, dataset: str, tile: Tile) -> list[dict[str, Any]] | None:
        path = self._cache_path(dataset, tile)
        try:
            if not path.exists() or time.time() - path.stat().st_mtime > CACHE_TTL_SECONDS:
                return None
            data = json.loads(path.read_text())
            elements = data.get("elements")
            return elements if isinstance(elements, list) else None
        except (OSError, ValueError, TypeError):
            return None

    def _write_cache(self, dataset: str, tile: Tile, elements: list[dict[str, Any]]) -> None:
        path = self._cache_path(dataset, tile)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({"elements": elements, "cached_at": time.time()}))
        except OSError:
            pass

    def _endpoint_order(self, attempt: int) -> Iterable[str]:
        now = time.monotonic()
        healthy = [url for url in ENDPOINTS if self._unhealthy_until.get(url, 0) <= now]
        candidates = healthy or list(ENDPOINTS)
        offset = attempt % len(candidates)
        return candidates[offset:] + candidates[:offset]

    async def _request_tile(self, dataset: str, tile: Tile, query: str) -> tuple[list[dict[str, Any]], bool]:
        cached = self._read_cache(dataset, tile)
        if cached is not None:
            return cached, True

        key = f"{dataset}:{tile.key}"
        if key in self._inflight:
            # Another coroutine is already fetching this exact tile — await its result
            return await self._inflight[key]

        loop = asyncio.get_running_loop()
        future: asyncio.Future = loop.create_future()
        self._inflight[key] = future

        try:
            res = await self._fetch_tile_from_endpoints(dataset, tile, query)
            if not future.done():
                future.set_result(res)
            return res
        except BaseException as exc:
            if not future.done():
                future.set_exception(exc)
            raise
        finally:
            self._inflight.pop(key, None)

    async def _fetch_tile_from_endpoints(self, dataset: str, tile: Tile, query: str) -> tuple[list[dict[str, Any]], bool]:
        headers = {"User-Agent": "FlashFloodDigitalTwin/1.0 (contact: admin@ein.gov.in)"}
        errors: list[str] = []

        for attempt in range(MAX_ATTEMPTS):
            if attempt:
                await asyncio.sleep(2 ** (attempt - 1))
            endpoints = list(self._endpoint_order(attempt))
            for idx, endpoint in enumerate(endpoints):
                try:
                    async with self._semaphore:
                        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS, headers=headers) as client:
                            response = await client.post(endpoint, data={"data": query})
                    if response.status_code in (429, 502, 503, 504):
                        self._unhealthy_until[endpoint] = time.monotonic() + 60
                        errors.append(f"{tile.key} {response.status_code} {endpoint}")
                        continue
                    response.raise_for_status()
                    payload = response.json()
                    elements = payload.get("elements")
                    if not isinstance(elements, list):
                        raise ValueError("response did not contain an elements list")
                    # Authoritative OSM response received: cache and return immediately
                    self._write_cache(dataset, tile, elements)
                    return elements, False
                except (httpx.HTTPError, ValueError, json.JSONDecodeError) as exc:
                    self._unhealthy_until[endpoint] = time.monotonic() + 30
                    errors.append(f"{tile.key} {endpoint}: {exc}")
        raise OSMTileLoadError(errors or [f"{tile.key} failed without a response"])

    async def load(
        self,
        dataset: str,
        north: float,
        south: float,
        east: float,
        west: float,
        selectors: str,
        on_progress: Callable[[dict[str, Any]], Awaitable[None] | None] | None = None,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        """Load every tile or raise with exact failed tile bounds.

        ``on_progress`` is deliberately optional: streaming endpoints can publish
        tile completion immediately, while ordinary API calls still get a fully
        validated, merged result.
        """
        tiles = self.tiles_for_bbox(north, south, east, west)

        def make_query(tile: Tile) -> str:
            bbox = f"({tile.south},{tile.west},{tile.north},{tile.east})"
            # Each statement inside an Overpass union must end in a semicolon.
            # Keeping it here avoids a subtle parse error on the final selector.
            selected = selectors.format(bbox=bbox).rstrip(";") + ";"
            return f"[out:json][timeout:20];({selected});out body;>;out skel qt;"

        async def load_one(tile: Tile) -> tuple[Tile, list[dict[str, Any]] | None, bool, Exception | None]:
            try:
                elements, from_cache = await self._request_tile(dataset, tile, make_query(tile))
                return tile, elements, from_cache, None
            except Exception as exc:
                return tile, None, False, exc

        tasks = [asyncio.create_task(load_one(tile)) for tile in tiles]
        results: list[list[dict[str, Any]]] = []
        failures: list[dict[str, Any]] = []
        completed = 0
        cached_tiles = 0
        for task in asyncio.as_completed(tasks):
            tile, elements, from_cache, error = await task
            if error is None and elements is not None:
                results.append(elements)
                cached_tiles += int(from_cache)
                state = "success"
            else:
                failures.append({"tile": tile.as_dict(), "error": str(error)})
                state = "failed"
            completed += 1
            if on_progress:
                update = {
                    "dataset": dataset,
                    "completed_tiles": completed,
                    "total_tiles": len(tiles),
                    "cached_tiles": cached_tiles,
                    "state": state,
                    "tile": tile.as_dict(),
                }
                outcome = on_progress(update)
                if asyncio.iscoroutine(outcome):
                    await outcome
        # Never cache or report an incomplete network as a successful empty map.

        if failures:
            raise OSMTileLoadError([failure["error"] for failure in failures])

        unique: dict[tuple[str, int], dict[str, Any]] = {}
        for elements in results:
            for element in elements:
                element_type, osm_id = element.get("type"), element.get("id")
                if element_type in {"node", "way", "relation"} and isinstance(osm_id, int):
                    unique[(element_type, osm_id)] = element
        loaded_count = len(tiles) - len(failures)
        return list(unique.values()), {
            "dataset": dataset,
            "total_tiles": len(tiles),
            "loaded_tiles": loaded_count,
            "cached_tiles": cached_tiles,
            "failed_tiles": failures,
            "complete": len(failures) == 0,
        }


osm_tile_loader = OSMTileLoader()
