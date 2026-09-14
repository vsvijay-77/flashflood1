import pytest
import math
from services.ms_building_service import (
    ms_building_service,
    point_to_segment_dist_m,
    build_road_spatial_grid,
    is_building_in_road_path,
)
from services.osm_road_service import OSMRoadService

def test_point_to_segment_dist_m():
    cos_lat = math.cos(math.radians(10.66))
    # Point exactly on segment
    d0 = point_to_segment_dist_m(77.0000, 10.6600, 76.9900, 10.6600, 77.0100, 10.6600, cos_lat)
    assert d0 < 0.01

    # Point 10 meters north of segment
    # 1 degree lat ~ 111132 meters, so 10 meters ~ 10 / 111132 degrees
    d_lat = 10.0 / 111132.0
    d10 = point_to_segment_dist_m(77.0000, 10.6600 + d_lat, 76.9900, 10.6600, 77.0100, 10.6600, cos_lat)
    assert abs(d10 - 10.0) < 0.1

def test_is_building_in_road_path():
    cos_lat = math.cos(math.radians(10.66))
    # Road segment from (77.00, 10.66) to (77.02, 10.66) with 7m setback
    road_segs = [(77.00, 10.66, 77.02, 10.66, 7.0)]
    grid = build_road_spatial_grid(road_segs)

    # Building center 3 meters away from road -> should be detected as in road path
    d_lat_3m = 3.0 / 111132.0
    ring_inside = [
        [77.01, 10.66 + d_lat_3m],
        [77.0101, 10.66 + d_lat_3m],
        [77.0101, 10.66 + d_lat_3m + 0.0001],
        [77.01, 10.66 + d_lat_3m + 0.0001],
        [77.01, 10.66 + d_lat_3m],
    ]
    assert is_building_in_road_path(10.66 + d_lat_3m, 77.01, ring_inside, grid) is True

    # Building center 25 meters away from road -> should be clear
    d_lat_25m = 25.0 / 111132.0
    ring_outside = [
        [77.01, 10.66 + d_lat_25m],
        [77.0101, 10.66 + d_lat_25m],
        [77.0101, 10.66 + d_lat_25m + 0.0001],
        [77.01, 10.66 + d_lat_25m + 0.0001],
        [77.01, 10.66 + d_lat_25m],
    ]
    assert is_building_in_road_path(10.66 + d_lat_25m, 77.01, ring_outside, grid) is False

@pytest.mark.asyncio
async def test_get_buildings_for_bbox_clears_roads():
    # Pollachi test bbox
    min_lat, min_lon, max_lat, max_lon = 10.64, 76.98, 10.68, 77.03
    res = await ms_building_service.get_buildings_for_bbox(
        min_lat=min_lat, min_lon=min_lon, max_lat=max_lat, max_lon=max_lon, max_buildings=200
    )
    features = res.get("features", [])
    assert len(features) > 0

    # Get road segments to verify no returned building is within 3.5m of road centerline
    road_svc = OSMRoadService()
    _, road_fc = await road_svc.get_road_network(max_lat, min_lat, max_lon, min_lon)
    roads = road_fc.get("features", [])
    assert len(roads) > 0

    road_segs = []
    for r in roads:
        coords = (r.get("geometry") or {}).get("coordinates") or []
        for i in range(len(coords) - 1):
            road_segs.append((float(coords[i][0]), float(coords[i][1]), float(coords[i+1][0]), float(coords[i+1][1]), 3.5))

    grid = build_road_spatial_grid(road_segs)
    cos_lat = math.cos(math.radians(10.66))

    violating_buildings = 0
    for b in features:
        c = b.get("properties", {})
        lat, lon = c.get("lat"), c.get("lon")
        geom = b.get("geometry", {})
        ring = (geom.get("coordinates") or [[]])[0]
        # Check if centroid is within 3.5m
        cx = int(lon / 0.003)
        cy = int(lat / 0.003)
        for dcx in (-1, 0, 1):
            for dcy in (-1, 0, 1):
                for x1, y1, x2, y2, setback in grid.get((cx + dcx, cy + dcy), []):
                    if point_to_segment_dist_m(lon, lat, x1, y1, x2, y2, cos_lat) < 3.5:
                        violating_buildings += 1
                        break

    assert violating_buildings == 0, f"Found {violating_buildings} buildings violating road setback!"
