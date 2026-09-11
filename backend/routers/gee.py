"""
Google Earth Engine tile router — 10-layer GIS analysis.
Generates real GEE tile URLs for all supported layer types.
"""
import asyncio
import threading
from fastapi import APIRouter, HTTPException, Response
from functools import lru_cache

router = APIRouter(prefix="/gee", tags=["gee"])
GEE_PROJECT = "formal-purpose-466115-i8"

# ─── Thread-safe GEE initialisation (runs once) ──────────────────────────────
_gee_lock = threading.Lock()
_gee_ready = False


def _init_gee():
    global _gee_ready
    with _gee_lock:
        if _gee_ready:
            return
        try:
            import ee
            ee.Initialize(project=GEE_PROJECT)
            _gee_ready = True
        except Exception as exc:
            raise RuntimeError(f"GEE init failed: {exc}") from exc


def _ensure_gee():
    if not _gee_ready:
        _init_gee()


# ─── Individual cached tile URL builders ─────────────────────────────────────


@lru_cache(maxsize=2)
def _get_slope_tiles() -> dict:
    _ensure_gee()
    import ee
    dem = ee.Image("USGS/SRTMGL1_003")
    slope = ee.Terrain.slope(dem)
    tile_url = slope.getMapId({"min": 0, "max": 60, "palette": ["00A000", "FFFF00", "FF8000", "FF0000"]})["tile_fetcher"].url_format
    return {"tileUrl": tile_url, "timestamp": None}


@lru_cache(maxsize=2)
def _get_terrain_tiles() -> dict:
    _ensure_gee()
    import ee
    dem = ee.Image("USGS/SRTMGL1_003")
    terrain = ee.Terrain.products(dem)
    tile_url = terrain.select("hillshade").getMapId({"min": 0, "max": 255})["tile_fetcher"].url_format
    return {"tileUrl": tile_url, "timestamp": None}


@lru_cache(maxsize=2)
def _get_elevation_tiles() -> dict:
    _ensure_gee()
    import ee
    dem = ee.Image("USGS/SRTMGL1_003")
    tile_url = dem.getMapId({
        "min": 0, "max": 3000,
        "palette": ["000080", "0000FF", "00FFFF", "00FF00", "FFFF00", "FF8000", "FF0000", "FFFFFF"]
    })["tile_fetcher"].url_format
    return {"tileUrl": tile_url, "timestamp": None}


@lru_cache(maxsize=2)
def _get_ndvi_tiles() -> dict:
    _ensure_gee()
    import ee
    import datetime

    # Use most recent 6-month window for latest imagery
    now = datetime.datetime.now(datetime.timezone.utc)
    end_date = now.strftime("%Y-%m-%d")
    start_date = (now - datetime.timedelta(days=180)).strftime("%Y-%m-%d")

    col = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
           .filterDate(start_date, end_date)
           .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 30))
           .sort("system:time_start", False))
    latest = col.first()
    ts = latest.get("system:time_start").getInfo()
    dt_str = datetime.datetime.fromtimestamp(ts / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")
    ndvi = col.median().normalizedDifference(["B8", "B4"])
    tile_url = ndvi.getMapId({
        "min": -0.2, "max": 0.9,
        "palette": ["d73027", "fc8d59", "ffffbf", "91cf60", "1a9641"]
    })["tile_fetcher"].url_format
    return {"tileUrl": tile_url, "timestamp": dt_str}


@lru_cache(maxsize=2)
def _get_ndwi_tiles() -> dict:
    _ensure_gee()
    import ee
    import datetime

    now = datetime.datetime.now(datetime.timezone.utc)
    end_date = now.strftime("%Y-%m-%d")
    start_date = (now - datetime.timedelta(days=180)).strftime("%Y-%m-%d")

    col = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
           .filterDate(start_date, end_date)
           .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 30))
           .sort("system:time_start", False))
    latest = col.first()
    ts = latest.get("system:time_start").getInfo()
    dt_str = datetime.datetime.fromtimestamp(ts / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")
    ndwi = col.median().normalizedDifference(["B3", "B8"])
    tile_url = ndwi.getMapId({
        "min": -0.5, "max": 0.5,
        "palette": ["8B4513", "F5DEB3", "FFFFFF", "87CEEB", "0000CD"]
    })["tile_fetcher"].url_format
    return {"tileUrl": tile_url, "timestamp": dt_str}


@lru_cache(maxsize=2)
def _get_flood_tiles() -> dict:
    _ensure_gee()
    import ee
    import datetime

    now = datetime.datetime.now(datetime.timezone.utc)
    end_date = now.strftime("%Y-%m-%d")
    start_date = (now - datetime.timedelta(days=180)).strftime("%Y-%m-%d")

    col = (ee.ImageCollection("COPERNICUS/S1_GRD")
          .filter(ee.Filter.eq("instrumentMode", "IW"))
          .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
          .filterDate(start_date, end_date)
          .select("VV")
          .sort("system:time_start", False))
    latest = col.first()
    ts = latest.get("system:time_start").getInfo()
    dt_str = datetime.datetime.fromtimestamp(ts / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")
    s1 = col.median()
    water = s1.lt(-15.5)
    masked_water = water.updateMask(water)
    tile_url = masked_water.getMapId({
        "min": 0, "max": 1,
        "palette": ["0066FF"]
    })["tile_fetcher"].url_format
    return {"tileUrl": tile_url, "timestamp": dt_str}


@lru_cache(maxsize=2)
def _get_rainfall_tiles() -> dict:
    _ensure_gee()
    import ee
    import datetime

    try:
        now = datetime.datetime.now(datetime.timezone.utc)
        # GFS is a forecast dataset — look back up to 7 days for the most recent run
        start_date = (now - datetime.timedelta(days=7)).strftime("%Y-%m-%d")
        end_date = now.strftime("%Y-%m-%d")  # cap at today — no future dates

        gfs_col = (
            ee.ImageCollection("NOAA/GFS0P25")
            .filterDate(start_date, end_date)
            .select("precipitation_rate")
        )
        latest_img = gfs_col.sort("system:time_start", False).first()
        ts = latest_img.get("system:time_start").getInfo()
        # Cap timestamp to today to avoid future forecast dates showing as "latest"
        img_dt = datetime.datetime.fromtimestamp(ts / 1000, datetime.timezone.utc)
        if img_dt > now:
            img_dt = now
        dt_str = img_dt.strftime("%Y-%m-%d")

        rain_mm_hr = latest_img.multiply(3600)
        vis = {
            "min": 0.1, "max": 15.0,
            "palette": ["08306B", "2171B5", "41B6C4", "74C476", "FFFF00", "FF7F00", "E31A1C"],
        }
        rain_masked = rain_mm_hr.updateMask(rain_mm_hr.gt(0.05))
        tile_url = rain_masked.getMapId(vis)["tile_fetcher"].url_format
        return {"tileUrl": tile_url, "timestamp": dt_str, "isForecast": True}
    except Exception:
        gpm_col = (ee.ImageCollection("NASA/GPM_L3/IMERG_V07").select("precipitation"))
        latest_gpm = gpm_col.sort("system:time_start", False).first()
        ts = latest_gpm.get("system:time_start").getInfo()
        dt_str = datetime.datetime.fromtimestamp(ts / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")
        vis = {
            "min": 0.04, "max": 2.0,
            "palette": ["08306B", "2171B5", "41B6C4", "74C476", "FFFF00", "FF7F00", "E31A1C"],
        }
        tile_url = latest_gpm.updateMask(latest_gpm.gt(0.02)).getMapId(vis)["tile_fetcher"].url_format
        return {"tileUrl": tile_url, "timestamp": dt_str, "isForecast": False}



@lru_cache(maxsize=2)
def _get_soil_moisture_tiles() -> dict:
    _ensure_gee()
    import ee
    import datetime

    now = datetime.datetime.now(datetime.timezone.utc)
    end_date = now.strftime("%Y-%m-%d")
    start_date = (now - datetime.timedelta(days=365)).strftime("%Y-%m-%d")

    col = (ee.ImageCollection("ECMWF/ERA5_LAND/MONTHLY_AGGR")
           .filterDate(start_date, end_date)
           .select("volumetric_soil_water_layer_1")
           .sort("system:time_start", False))
    latest = col.first()
    ts = latest.get("system:time_start").getInfo()
    dt_str = datetime.datetime.fromtimestamp(ts / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")
    soil = col.mean()
    tile_url = soil.getMapId({
        "min": 0.08, "max": 0.50,
        "palette": ["FFFFD4", "FED98E", "FE9929", "D95F0E", "7FCDBB", "1D91C0", "081D58"]
    })["tile_fetcher"].url_format
    return {"tileUrl": tile_url, "timestamp": dt_str}


@lru_cache(maxsize=2)
def _get_land_cover_tiles() -> dict:
    _ensure_gee()
    import ee
    lc = ee.Image("ESA/WorldCover/v200/2021")
    tile_url = lc.getMapId({"min": 10, "max": 100})["tile_fetcher"].url_format
    return {"tileUrl": tile_url, "timestamp": "2021-01-01"}


@lru_cache(maxsize=2)
def _get_change_detection_tiles() -> dict:
    _ensure_gee()
    import ee
    import datetime

    now = datetime.datetime.now(datetime.timezone.utc)
    end_year = now.year
    start_year = end_year - 4

    def get_ndvi(start, end):
        return (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
                .filterDate(start, end)
                .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 30))
                .median()
                .normalizedDifference(["B8", "B4"]))

    ndvi_old = get_ndvi(f"{start_year}-01-01", f"{start_year}-12-31")
    ndvi_new = get_ndvi(f"{end_year - 1}-01-01", f"{end_year - 1}-12-31")
    change = ndvi_new.subtract(ndvi_old)
    tile_url = change.getMapId({
        "min": -0.5, "max": 0.5,
        "palette": ["FF0000", "FF8C00", "FFFFFF", "90EE90", "006400"]
    })["tile_fetcher"].url_format
    return {"tileUrl": tile_url, "timestamp": f"{end_year - 1}-12-31"}


_LAYER_BUILDERS = {
    "slope":            _get_slope_tiles,
    "terrain":          _get_terrain_tiles,
    "elevation":        _get_elevation_tiles,
    "ndvi":             _get_ndvi_tiles,
    "ndwi":             _get_ndwi_tiles,
    "flood":            _get_flood_tiles,
    "rainfall":         _get_rainfall_tiles,
    "soil_moisture":    _get_soil_moisture_tiles,
    "land_cover":       _get_land_cover_tiles,
    "change_detection": _get_change_detection_tiles,
}

LAYER_META = {
    "slope":            {"label": "📐 Slope",           "unit": "deg"},
    "terrain":          {"label": "⛰️ Terrain",         "unit": ""},
    "elevation":        {"label": "⛰️ Elevation",       "unit": "m"},
    "ndvi":             {"label": "🌳 NDVI",            "unit": ""},
    "ndwi":             {"label": "💧 NDWI",            "unit": ""},
    "flood":            {"label": "🌊 Flood Extent",    "unit": ""},
    "rainfall":         {"label": "🌧️ Rainfall",       "unit": "mm/hr"},
    "soil_moisture":    {"label": "💦 Soil Moisture",   "unit": "m³/m³"},
    "land_cover":       {"label": "🗺️ Land Cover",     "unit": ""},
    "change_detection": {"label": "🔄 NDVI Change",    "unit": ""},
}

_LAYER_FALLBACKS = {
    "elevation": {
        "tileUrl": "https://tile.opentopomap.org/{z}/{x}/{y}.png",
        "timestamp": None,
        "isFallback": True,
    },
    "slope": {
        "tileUrl": "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
        "timestamp": None,
        "isFallback": True,
    },
    "terrain": {
        "tileUrl": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
        "timestamp": None,
        "isFallback": True,
    },
    "ndvi": {
        "tileUrl": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        "timestamp": None,
        "isFallback": True,
    },
    "ndwi": {
        "tileUrl": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        "timestamp": None,
        "isFallback": True,
    },
    "flood": {
        "tileUrl": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        "timestamp": None,
        "isFallback": True,
    },
    "rainfall": {
        "tileUrl": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        "timestamp": None,
        "isFallback": True,
    },
    "soil_moisture": {
        "tileUrl": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        "timestamp": None,
        "isFallback": True,
    },
    "land_cover": {
        "tileUrl": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
        "timestamp": None,
        "isFallback": True,
    },
    "change_detection": {
        "tileUrl": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        "timestamp": None,
        "isFallback": True,
    },
}


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/layer-tiles")
async def get_layer_tiles(layer: str, response: Response):
    """
    Return a Leaflet tile URL + timestamp for the requested GEE layer.
    Supported layers: slope, terrain, elevation, ndvi, ndwi, flood,
    rainfall, soil_moisture, land_cover, change_detection
    """
    if layer not in _LAYER_BUILDERS:
        raise HTTPException(status_code=400, detail=f"Unknown layer '{layer}'. Supported: {list(_LAYER_BUILDERS.keys())}")
    try:
        response.headers["Cache-Control"] = "public, max-age=3600"
        res = await asyncio.to_thread(_LAYER_BUILDERS[layer])
        return {**res, "layer": layer, "meta": LAYER_META.get(layer, {})}
    except Exception as exc:
        fallback = _LAYER_FALLBACKS.get(layer, {
            "tileUrl": "https://tile.opentopomap.org/{z}/{x}/{y}.png",
            "timestamp": None,
            "isFallback": True,
        })
        return {**fallback, "layer": layer, "meta": LAYER_META.get(layer, {}), "warning": str(exc)}


@router.get("/batch-tiles")
async def get_batch_tiles(response: Response, layers: str = ""):
    """
    Fetch multiple GEE layers in a single request.
    Pass ?layers=ndvi,ndwi,flood,... or omit for all 8 default layers.
    Runs all GEE calls concurrently — much faster than 8 individual requests.
    """
    requested = [l.strip() for l in layers.split(",") if l.strip()] if layers else list(_LAYER_BUILDERS.keys())
    unknown = [l for l in requested if l not in _LAYER_BUILDERS]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown layers: {unknown}")

    response.headers["Cache-Control"] = "public, max-age=3600"

    async def _fetch(layer_id: str):
        try:
            res = await asyncio.to_thread(_LAYER_BUILDERS[layer_id])
            return layer_id, {**res, "layer": layer_id, "meta": LAYER_META.get(layer_id, {})}
        except Exception as exc:
            fallback = _LAYER_FALLBACKS.get(layer_id, {
                "tileUrl": "https://tile.opentopomap.org/{z}/{x}/{y}.png",
                "timestamp": None,
                "isFallback": True,
            })
            return layer_id, {**fallback, "layer": layer_id, "meta": LAYER_META.get(layer_id, {}), "warning": str(exc)}

    results = await asyncio.gather(*[_fetch(lid) for lid in requested])
    return {lid: data for lid, data in results}


# Keep legacy endpoints for backward compatibility
@router.get("/slope-tiles")
async def get_slope_tiles():
    try:
        url = await asyncio.to_thread(_get_slope_tiles)
        return {"tileUrl": url, "layer": "slope", "project": GEE_PROJECT}
    except Exception as exc:
        return {"tileUrl": "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}", "layer": "slope", "warning": str(exc)}


@router.get("/terrain-tiles")
async def get_terrain_tiles():
    try:
        url = await asyncio.to_thread(_get_terrain_tiles)
        return {"tileUrl": url, "layer": "terrain", "project": GEE_PROJECT}
    except Exception as exc:
        return {"tileUrl": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", "layer": "terrain", "warning": str(exc)}


@lru_cache(maxsize=1024)
def _sample_cached(lat_r: float, lng_r: float):
    _ensure_gee()
    import ee
    point = ee.Geometry.Point([lng_r, lat_r])
    dem = ee.Image("USGS/SRTMGL1_003")
    slope_img = ee.Terrain.slope(dem).select(["slope"])
    combined = dem.addBands(slope_img)
    val = combined.sample(point, 30).first().getInfo()
    elevation = None
    slope_deg = None
    if val and "properties" in val:
        elevation = round(val["properties"].get("elevation", 0), 1)
        slope_deg = round(val["properties"].get("slope", 0), 1)
    return elevation, slope_deg


@router.get("/sample-values")
async def get_sample_values(lat: float, lng: float, response: Response):
    """Sample real slope (degrees) and elevation (metres) from USGS SRTM DEM with in-memory caching."""
    response.headers["Cache-Control"] = "public, max-age=86400"
    try:
        elev, slope = await asyncio.to_thread(_sample_cached, round(lat, 5), round(lng, 5))
        return {"lat": lat, "lng": lng, "elevation_m": elev, "slope_deg": slope}
    except Exception as exc:
        return {"lat": lat, "lng": lng, "elevation_m": 293.0, "slope_deg": 2.5, "fallback": True, "warning": str(exc)}
