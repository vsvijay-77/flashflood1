"""Read exported geometry without requiring Supabase or a map provider."""
import gzip
import hashlib
import json
from pathlib import Path

DIRECTORY = Path(__file__).resolve().parents[1] / "data" / "prebaked_zones"


def load_bundled_area(payload):
    try:
        entries = json.loads((DIRECTORY / "manifest.json").read_text())
        area_id = (payload.area_id or payload.area_key or "").removeprefix("dt-area-")
        for entry in entries:
            if area_id and area_id != entry["area_id"]:
                continue
            if payload.polygon:
                expected = entry["polygon"]
                if len(payload.polygon) != len(expected) or any(
                    len(point) != 2 or any(abs(v - expected[i][j]) >= 1e-9 for j, v in enumerate(point))
                    for i, point in enumerate(payload.polygon)
                ):
                    continue
            elif area_id != entry["area_id"] or any(getattr(payload, field) is not None for field in ("north", "south", "east", "west")):
                continue
            content = (DIRECTORY / entry["file"]).read_bytes()
            if entry["file"].endswith(".gz"):
                content = gzip.decompress(content)
            if hashlib.sha256(content).hexdigest() != entry["sha256"]:
                return None
            return json.loads(content)
    except (OSError, EOFError, ValueError, KeyError, TypeError):
        pass
    return None
