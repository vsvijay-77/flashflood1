"""Export all saved map features for one exact monitored boundary, without row caps.

Run: .venv/bin/python scripts/export_monitored_area.py AREA_UUID
Requires backend/.env Supabase credentials. Only public map geometry is exported.
"""
import argparse
import gzip
import hashlib
import json
import sys
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from lib.db import get_supabase
from services.area_map_store import boundary_key


def export(area_id):
    client = get_supabase()
    area = client.table("custom_areas").select("id,name,shape").eq("id", area_id).single().execute().data
    polygon = json.loads(area["shape"].split(":", 1)[1])
    key = boundary_key(polygon, {})
    rows = client.table("area_map_layers").select("layer,geojson,updated_at").eq("area_id", area_id).eq("boundary_key", key).execute().data
    layers = {row["layer"]: row for row in rows}
    if set(layers) != {"roads", "rivers", "buildings"}:
        raise ValueError("All three saved layers are required for this exact boundary")
    counts = {}
    for name, row in layers.items():
        geojson = row["geojson"]
        features = geojson.get("features")
        if geojson.get("type") != "FeatureCollection" or not isinstance(features, list):
            raise ValueError(f"Invalid {name} layer")
        for feature in features:
            identity = str(feature.get("id") or feature.get("properties", {}).get("id", ""))
            if "fallback" in identity or not feature.get("geometry", {}).get("coordinates"):
                raise ValueError(f"Generated or invalid feature in {name}: {identity}")
        counts[name] = len(features)
    bbox = {"north": max(p[0] for p in polygon), "south": min(p[0] for p in polygon),
            "east": max(p[1] for p in polygon), "west": min(p[1] for p in polygon)}
    metadata = {"schema_version": 1, "area_id": area_id, "name": area["name"],
                "polygon": polygon, "boundary_key": key, "counts": counts,
                "exported_at": datetime.now(timezone.utc).isoformat(),
                "layer_updated_at": {name: row["updated_at"] for name, row in layers.items()},
                "coverage": "All features in the saved area layers; mapping coverage is not a survey of every physical house.",
                "attribution": ["© OpenStreetMap contributors (ODbL)", "Microsoft Global ML Building Footprints (CDLA Permissive 2.0)"]}
    payload = {"status": "success", "snapshot": metadata, "bbox": bbox,
               "osm_loading": {"complete": True, "total_tiles": 3, "loaded_tiles": 3,
                               "failed_tiles": [], "failed_layers": [], "source": "bundled_snapshot"}}
    for name, row in layers.items():
        payload[name] = {"geojson": row["geojson"]}
        if name == "buildings":
            payload[name]["total_features"] = counts[name]
        else:
            payload[name].update(total_edges=counts[name], total_nodes=row["geojson"].get("metadata", {}).get("total_nodes", 0))
    content = json.dumps(payload, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
    filename = f"{area_id}.json"
    entry = {"area_id": area_id, "polygon": polygon, "file": filename,
             "sha256": hashlib.sha256(content).hexdigest(), "counts": counts}
    backend_directory = ROOT / "backend/data/prebaked_zones"
    frontend_directory = ROOT / "frontend/public/prebaked_zones"
    for directory in [backend_directory, frontend_directory]:
        directory.mkdir(parents=True, exist_ok=True)
    (frontend_directory / filename).write_bytes(content)
    (backend_directory / f"{filename}.gz").write_bytes(gzip.compress(content, mtime=0))
    (backend_directory / filename).unlink(missing_ok=True)
    index = ROOT / "backend/data/prebaked_zones/manifest.json"
    manifest = json.loads(index.read_text()) if index.exists() else []
    manifest = [item for item in manifest if item["area_id"] != area_id] + [{**entry, "file": f"{filename}.gz"}]
    index.write_text(json.dumps(manifest, indent=2) + "\n")
    frontend_manifest = [{**item, "file": item["file"].removesuffix(".gz")} for item in manifest]
    (ROOT / "frontend/src/services/bundledAreaManifest.json").write_text(json.dumps(frontend_manifest, indent=2) + "\n")
    print(json.dumps({"file": filename, "bytes": len(content), "counts": counts}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("area_id")
    export(parser.parse_args().area_id)
