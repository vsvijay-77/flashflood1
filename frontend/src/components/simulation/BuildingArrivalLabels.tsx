import { useEffect, useRef } from "react";
import type { BuildingFeature } from "@/lib/routingApi";
import type { BuildingExposure } from "./buildingExposure";
import { arrivalLabel, type ArrivalForecastResult } from "./arrivalForecast";
declare const Cesium: any;

export function BuildingArrivalLabels({ viewer, buildings, exposures, elapsed, forecast }: {
  viewer: any; buildings: BuildingFeature[]; exposures: BuildingExposure[]; elapsed: number; forecast: ArrivalForecastResult | null;
}) {
  const labels = useRef(new Map<string, any>());
  useEffect(() => {
    if (!viewer || viewer.isDestroyed()) return;
    const collection = new Cesium.CustomDataSource("simulation-building-arrivals");
    viewer.dataSources.add(collection);
    // Only label the top 15 buildings closest to water or with highest exposure to avoid GPU texture exhaustion
    const displayBuildings = buildings.slice(0, 15);
    for (const [index, building] of displayBuildings.entries()) {
      const id = String(building.id ?? building.properties?.id ?? index);
      if (labels.current.has(id)) continue;
      const ring = building.geometry?.type === "Polygon" ? building.geometry.coordinates[0] : building.geometry?.coordinates[0]?.[0];
      if (!ring?.length) continue;
      const points = ring as number[][];
      const lon = points.reduce((sum, p) => sum + p[0], 0) / points.length;
      const lat = points.reduce((sum, p) => sum + p[1], 0) / points.length;
      const props = building.properties || {};
      const height = Math.max(3, Number(props.height_m ?? props.height ?? props.estimated_height) || 6);
      const entity = collection.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, height + 3),
        label: {
          text: "Water ETA · calculating…", font: "bold 12px sans-serif",
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          fillColor: Cesium.Color.CYAN, showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("#0f172a").withAlpha(0.9),
          backgroundPadding: new Cesium.Cartesian2(6, 4),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -6),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 4000),
          scaleByDistance: new Cesium.NearFarScalar(200, 1, 4000, 0.55),
        },
      });
      labels.current.set(id, entity);
    }
    viewer.scene.requestRender();
    return () => {
      labels.current.clear();
      if (!viewer.isDestroyed()) viewer.dataSources.remove(collection, true);
    };
  }, [viewer, buildings]);

  useEffect(() => {
    let changed = false;
    for (const exposure of exposures) {
      const entity = labels.current.get(exposure.id);
      if (!entity) continue;
      const newText = arrivalLabel(exposure, elapsed, forecast);
      if (entity.label.text._value !== newText) {
        entity.label.text = newText;
        entity.label.fillColor = exposure.arrivalSeconds !== null ? Cesium.Color.ORANGE : Cesium.Color.CYAN;
        changed = true;
      }
    }
    if (changed && viewer && !viewer.isDestroyed()) {
      viewer.scene.requestRender();
    }
  }, [viewer, exposures, elapsed, forecast]);
  return null;
}
