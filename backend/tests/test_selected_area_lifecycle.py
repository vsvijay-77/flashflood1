import httpx
import pytest
from fastapi import HTTPException
from shapely.geometry import Polygon, shape
from services.selected_area_store import SelectedAreaStore, clip_features
from services.supabase_network_store import SupabaseNetworkStore


def test_clips_crossing_paths_and_water_with_holes():
    polygon = [[0,0],[0,2],[2,2],[2,0]]
    features = [
        {"properties":{"id":"path"},"geometry":{"type":"LineString","coordinates":[[-1,1],[3,1]]}},
        {"properties":{"id":"lake"},"geometry":{"type":"Polygon","coordinates":[[[-1,-1],[3,-1],[3,3],[-1,3],[-1,-1]],[[.5,.5],[.5,1.5],[1.5,1.5],[1.5,.5],[.5,.5]]]}},
    ]
    result = clip_features(features,{},polygon)
    assert len(result)==2
    assert shape(result[0]["geometry"]).length==2
    assert shape(result[1]["geometry"]).area==3
    assert all(Polygon([(lng,lat) for lat,lng in polygon]).covers(shape(f["geometry"])) for f in result)


@pytest.mark.asyncio
async def test_database_pages_past_thousand_paths(monkeypatch):
    rows=[{"feature_id":str(i),"feature_type":"path","geometry":{"type":"LineString","coordinates":[[0,0],[1,1]]}} for i in range(1000)]
    rows.append({"feature_id":"river","feature_type":"waterway","geometry":{"type":"LineString","coordinates":[[0,0],[1,1]]}})
    requests=[]
    def respond(request):
        offset=int(request.url.params.get("offset",0)); requests.append(offset)
        return httpx.Response(200,json=rows[offset:offset+1000])
    real_client=httpx.AsyncClient
    monkeypatch.setattr(httpx,"AsyncClient",lambda **kw:real_client(transport=httpx.MockTransport(respond),**kw))
    store=SupabaseNetworkStore(); store.table_url,store.key="https://example.test/features","test-key"
    loaded=await store.load("area")
    assert requests==[0,1000]
    assert len(loaded["roads"])==1000 and len(loaded["rivers"])==1


@pytest.mark.asyncio
async def test_delete_failure_keeps_parent_and_late_save_cannot_resurrect(monkeypatch):
    store=SelectedAreaStore(); parent={"id":"one","user_id":None}; calls=[]; fail=True
    async def request(method,table,**kwargs):
        nonlocal parent
        calls.append((method,table))
        if method=="GET": return [parent] if parent else []
        if table=="simulations" and fail: raise HTTPException(503,"unavailable")
        if table=="custom_areas": parent=None
        return []
    monkeypatch.setattr(store,"request",request)
    with pytest.raises(HTTPException): await store.delete("one",{"role":"admin"})
    assert parent is not None and ("DELETE","custom_areas") not in calls
    fail=False
    await store.delete("one",{"role":"admin"})
    with pytest.raises(HTTPException) as error:
        async with store.writing("dt-area-one","one"):
            pytest.fail("Old download recreated deleted data")
    assert error.value.status_code==404


@pytest.mark.asyncio
async def test_cannot_delete_another_users_area(monkeypatch):
    store=SelectedAreaStore()
    async def area(_): return {"id":"one","user_id":"owner"}
    monkeypatch.setattr(store,"get_area",area)
    with pytest.raises(HTTPException) as error: await store.delete("one",{"id":"different","role":"viewer"})
    assert error.value.status_code==403
