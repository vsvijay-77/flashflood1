import json
import os
import math
from pathlib import Path
import sys

# Ensure backend root is on sys.path
root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir / "backend"))

from services.osm_road_service import OSMRoadService
from services.osm_river_service import OSMRiverService
from routers.routing_and_rivers import _generate_fallback_buildings

areas = [
    {
        "id": "0004ccb1-ebc6-4c8c-90f6-06ebe52a2e42",
        "name": "Monitored Zone 2",
        "lat": 31.0649,
        "lng": 78.8176,
        "polygon": [[31.218673801364655,78.6126708984375],[30.9128292266562,78.61129760742188],[30.9187201197222,79.02877807617189],[31.209277877460135,79.01779174804689]]
    },
    {
        "id": "af991cda-e647-4b00-86ed-8449feceaf8c",
        "name": "Monitored Zone 1",
        "lat": 11.3814,
        "lng": 76.7452,
        "polygon": [[11.586010207110014,76.89489745069295],[11.548339011444835,76.53784178663045],[11.133625233016879,76.57629393506795],[11.257563688455736,76.97180174756797]]
    },
    {
        "id": "4296f934-e469-428c-a8db-1148d3a881d1",
        "name": "test",
        "lat": 11.4162,
        "lng": 76.7108,
        "polygon": [[11.4391424938366,76.68594360351564],[11.39455234546395,76.68577194213869],[11.395730288497965,76.74190521240236],[11.435440937074928,76.72971725463869]]
    },
    {
        "id": "6bf42e33-648f-42ae-b249-7ac90aa791cf",
        "name": "Monitored Zone 4",
        "lat": 27.0146,
        "lng": 75.0059,
        "polygon": [[27.02434226359164,74.98460769653322],[27.00530232425826,74.98400688171388],[27.003237558678705,75.02760887145998],[27.025489144860245,75.02735137939455]]
    }
]

road_svc = OSMRoadService()
river_svc = OSMRiverService()

backend_dir = root_dir / "backend" / "data" / "prebaked_zones"
frontend_dir = root_dir / "frontend" / "public" / "prebaked_zones"
backend_dir.mkdir(parents=True, exist_ok=True)
frontend_dir.mkdir(parents=True, exist_ok=True)

for a in areas:
    polygon = a["polygon"]
    lats = [p[0] for p in polygon]
    lngs = [p[1] for p in polygon]
    bbox = {
        "north": max(lats),
        "south": min(lats),
        "east": max(lngs),
        "west": min(lngs),
    }

    _, roads_gj = road_svc.generate_fallback_roads(bbox["north"], bbox["south"], bbox["east"], bbox["west"], polygon)
    _, rivers_gj = river_svc.generate_fallback_rivers(bbox["north"], bbox["south"], bbox["east"], bbox["west"], polygon)
    buildings_gj = _generate_fallback_buildings(bbox, polygon)

    payload = {
        "status": "success",
        "bbox": bbox,
        "osm_loading": {
            "complete": True,
            "total_tiles": 2,
            "loaded_tiles": 2,
            "failed_tiles": [],
            "failed_layers": [],
            "source": "prebaked_cache"
        },
        "roads": {
            "geojson": roads_gj,
            "total_nodes": roads_gj.get("metadata", {}).get("total_nodes", len(roads_gj["features"])*2),
            "total_edges": len(roads_gj["features"])
        },
        "rivers": {
            "geojson": rivers_gj,
            "total_nodes": rivers_gj.get("metadata", {}).get("total_nodes", len(rivers_gj["features"])*2),
            "total_edges": len(rivers_gj["features"])
        },
        "buildings": {
            "geojson": buildings_gj,
            "total_features": len(buildings_gj["features"])
        }
    }

    aid = a["id"]
    aname = a["name"]
    # Save by area id
    for out_dir in (backend_dir, frontend_dir):
        (out_dir / f"{aid}.json").write_text(json.dumps(payload, indent=2))
        if "Zone 2" in aname:
            (out_dir / "zone2.json").write_text(json.dumps(payload, indent=2))
            (out_dir / "default.json").write_text(json.dumps(payload, indent=2))

    num_roads = len(roads_gj["features"])
    num_rivers = len(rivers_gj["features"])
    num_bldgs = len(buildings_gj["features"])
    print(f"Prebaked {aname} ({aid}): {num_roads} roads, {num_rivers} rivers, {num_bldgs} buildings")
