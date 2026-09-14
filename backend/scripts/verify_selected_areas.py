"""Opt-in live test. Creates five labelled areas; delete them through Monitoring."""
import asyncio
import json
import os
import random
import time
import uuid
from pathlib import Path

import httpx
from shapely.geometry import Polygon, shape
from services.selected_area_store import selected_area_store as store
from services.supabase_network_store import supabase_network_store
from services.supabase_building_store import supabase_building_store

REPORT = Path(__file__).resolve().parents[2] / "artifacts" / "digital-twin-five-areas.json"


async def main():
    rng = random.Random(9142026)
    candidates = [("Chennai",13.012,80.25),("Bengaluru",12.976,77.625),("Coimbatore",10.997,76.977),
                  ("Hyderabad",17.423,78.474),("Madurai",9.926,78.122),("Kolkata",22.568,88.338),("Pune",18.521,73.856)]
    areas = json.loads(REPORT.read_text()) if os.getenv("DT_VERIFY_RESUME") and REPORT.exists() else []
    for name,lat,lng in ([] if areas else rng.sample(candidates,5)):
        d = rng.uniform(.005,.007)
        polygon = [[lat-d,lng-d],[lat-d,lng+d],[lat+d,lng+d*.8],[lat+d*.9,lng-d]]
        row = {"id":str(uuid.uuid4()),"name":f"DT verification - {name}","lat":lat,"lng":lng,
               "shape":"Polygon:"+json.dumps(polygon),"description":"Temporary five-area loading/deletion verification",
               "district":name,"area_type":"River Basin","risk_category":"Medium"}
        await store.request("POST","custom_areas",json=row)
        areas.append({"id":row["id"],"name":name,"polygon":polygon})
    REPORT.parent.mkdir(exist_ok=True)
    REPORT.write_text(json.dumps(areas,indent=2))
    semaphore = asyncio.Semaphore(2)
    async with httpx.AsyncClient(timeout=100) as client:
        async def check(area):
            async with semaphore:
                async def call(route):
                    start = time.perf_counter()
                    response = await client.post(f"{os.getenv('DT_VERIFY_API', 'http://127.0.0.1:8001')}/api/geo/{route}",json={"area_id":area["id"]})
                    duration = round(time.perf_counter()-start,3)
                    response.raise_for_status()
                    return response.json(),duration
                try:
                    (network,ns),(building,bs) = await asyncio.gather(call("extract-networks"),call("extract-buildings"))
                    paths,water,houses = network["roads"]["geojson"]["features"],network["rivers"]["geojson"]["features"],building["buildings"]["geojson"]["features"]
                    selection = Polygon([(lng,lat) for lat,lng in area["polygon"]]).buffer(1e-10)
                    assert all(selection.covers(shape(f["geometry"])) for f in paths+water+houses),"Geometry outside area"
                    key = "dt-area-"+area["id"]
                    start = time.perf_counter()
                    sn,sb = await asyncio.gather(supabase_network_store.load(key),supabase_building_store.load(key+":buildings"))
                    db_seconds = round(time.perf_counter()-start,3)
                    assert len((sn or {}).get("roads",[]))==len(paths) and len((sn or {}).get("rivers",[]))==len(water)
                    assert sb is not None and len(sb["features"])==len(houses)
                    (cached,cs),(cached_b,cbs) = await asyncio.gather(call("extract-networks"),call("extract-buildings"))
                    assert cached["osm_loading"]["source"]==cached_b["osm_loading"]["source"]=="Supabase"
                    area.update(paths=len(paths),water=len(water),water_bodies=sum("Polygon" in f["geometry"]["type"] for f in water),buildings=len(houses),
                        first_network_seconds=ns,first_building_seconds=bs,cached_network_seconds=cs,cached_building_seconds=cbs,db_read_seconds=db_seconds,
                        network_timing_ms=network["timing_ms"],building_timing_ms=building["timing_ms"],
                        persisted=network["persistence"]["saved"] and building["persistence"]["saved"],only_selected_area=True)
                    assert area["persisted"]
                    area.pop("error", None)
                except Exception as exc:
                    area["error"] = str(exc)
                REPORT.write_text(json.dumps(areas,indent=2))
                print(json.dumps({k:v for k,v in area.items() if k!="polygon"}),flush=True)
        await asyncio.gather(*(check(area) for area in areas))


if __name__=="__main__":
    asyncio.run(main())
