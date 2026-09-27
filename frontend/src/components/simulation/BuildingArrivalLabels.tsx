import { useEffect, useMemo, useRef } from "react";
import type { BuildingFeature } from "@/lib/routingApi";
import type { BuildingExposure, ExposureGrid } from "./buildingExposure";
import { buildingHeight } from "../gis/buildingGeometry";
import { arrivalLabel, type ArrivalForecastResult } from "./arrivalForecast";
declare const Cesium: any;

export function houseBounds(building: BuildingFeature) {
  const polygons = building.geometry.type === "Polygon" ? [building.geometry.coordinates as number[][][]] : building.geometry.coordinates as number[][][][];
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const polygon of polygons) for (const point of polygon[0] || []) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    west = Math.min(west, point[0]); east = Math.max(east, point[0]);
    south = Math.min(south, point[1]); north = Math.max(north, point[1]);
  }
  return east > west && north > south ? { west, east, south, north } : null;
}

export function BuildingArrivalLabels({ viewer, buildings, exposures, elapsed, forecast, selectedId, onSelect, grid, bed, selectionEnabled = true }: {
  viewer: any; buildings: BuildingFeature[]; exposures: BuildingExposure[]; elapsed: number; forecast: ArrivalForecastResult | null;
  selectionEnabled?: boolean;
  selectedId: string | null; onSelect: (id: string) => void; grid: ExposureGrid | null; bed?: Float32Array;
}) {
  const labels = useRef(new Map<string, any>());
  const lookup = useMemo(() => new Map(buildings.map((building, index) => [String(building.id ?? building.properties.id ?? index), building])), [buildings]);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectionEnabledRef = useRef(selectionEnabled);
  selectionEnabledRef.current = selectionEnabled;
  const ground = (bounds: NonNullable<ReturnType<typeof houseBounds>>) => {
    const lon = (bounds.west + bounds.east) / 2, lat = (bounds.south + bounds.north) / 2;
    const loadedHeight = viewer.scene.globe.getHeight(Cesium.Cartographic.fromDegrees(lon, lat));
    if (Number.isFinite(loadedHeight)) return loadedHeight;
    if (grid && bed) {
      const c = Math.max(0, Math.min(grid.cols - 1, Math.round((lon - grid.west) / (grid.east - grid.west) * (grid.cols - 1))));
      const r = Math.max(0, Math.min(grid.rows - 1, Math.round((lat - grid.south) / (grid.north - grid.south) * (grid.rows - 1))));
      if (Number.isFinite(bed[r * grid.cols + c])) return bed[r * grid.cols + c];
    }
    return viewer.scene.globe.getHeight(Cesium.Cartographic.fromDegrees(lon, lat)) ?? 0;
  };
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click: any) => {
      if (!selectionEnabledRef.current) return;
      const picked = viewer.scene.pick(click.position);
      const entity = picked?.id;
      const candidate = entity?._houseId ?? (entity?._buildingData ? entity.id : null);
      if (candidate != null && lookup.has(String(candidate))) onSelectRef.current(String(candidate));
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    return () => handler.destroy();
  }, [viewer, lookup]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !selectedId) return;
    const building = lookup.get(selectedId);
    const b = building && houseBounds(building);
    if (!b || !building) return;
    let disposed = false;
    const focus = (height: number) => {
      if (disposed || viewer.isDestroyed()) return;
      const label = labels.current.get(selectedId);
      if (label) label.position = Cesium.Cartesian3.fromDegrees((b.west + b.east) / 2, (b.south + b.north) / 2, height + buildingHeight(building.properties) + 3);
      viewer.camera.flyToBoundingSphere(Cesium.BoundingSphere.fromPoints([
        Cesium.Cartesian3.fromDegrees(b.west, b.south, height),
        Cesium.Cartesian3.fromDegrees(b.east, b.north, height + buildingHeight(building.properties)),
      ]), { duration: 0.8, offset: new Cesium.HeadingPitchRange(0, -0.65, 120) });
      viewer.scene.requestRender();
    };
    focus(ground(b));
    // Refine only the selected house: a coarse flood cell can be hundreds of
    // metres from the footprint on mountain terrain.
    if (viewer.terrainProvider?.availability) {
      Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [Cesium.Cartographic.fromDegrees((b.west + b.east) / 2, (b.south + b.north) / 2)])
        .then((points: any[]) => { if (Number.isFinite(points[0]?.height)) focus(points[0].height); }).catch(() => {});
    }
    return () => { disposed = true; };

  }, [viewer, lookup, selectedId, grid, bed]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const collection = new Cesium.CustomDataSource("simulation-building-arrivals");
    viewer.dataSources.add(collection);
    // Bounded text atlas; houses remain selectable through their orange footprints and table rows.
    const ids = [...new Set([...(selectedId ? [selectedId] : []), ...lookup.keys()])].slice(0, 15);
    for (const id of ids) {
      const building = lookup.get(id);
      const b = building && houseBounds(building);
      if (!building || !b) continue;
      const entity = collection.entities.add({
        position: Cesium.Cartesian3.fromDegrees((b.west + b.east) / 2, (b.south + b.north) / 2, ground(b) + buildingHeight(building.properties) + 3),
        label: { text: "Water ETA · calculating…", font: "bold 12px sans-serif", fillColor: Cesium.Color.CYAN,
          showBackground: true, backgroundColor: Cesium.Color.fromCssColorString("#0f172a").withAlpha(0.9),
          backgroundPadding: new Cesium.Cartesian2(6, 4), verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 4000),
          scaleByDistance: new Cesium.NearFarScalar(200, 1, 4000, 0.55) },
      });
      entity._houseId = id;
      labels.current.set(id, entity);
    }
    viewer.scene.requestRender();
    return () => { labels.current.clear(); if (!viewer.isDestroyed()) viewer.dataSources.remove(collection, true); };
  }, [viewer, lookup, selectedId, grid, bed]);

  useEffect(() => {
    for (const exposure of exposures) {
      const entity = labels.current.get(exposure.id);
      if (!entity) continue;
      const text = arrivalLabel(exposure, elapsed, forecast);
      if (entity.label.text.getValue() !== text) entity.label.text = text;
      entity.label.fillColor = exposure.arrivalSeconds !== null ? Cesium.Color.ORANGE : Cesium.Color.CYAN;
    }
    if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender();
  }, [viewer, exposures, elapsed, forecast, selectedId, lookup]);
  return null;
}
