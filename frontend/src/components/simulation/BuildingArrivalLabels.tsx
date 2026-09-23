import { useEffect, useRef } from "react";
import type { BuildingFeature } from "@/lib/routingApi";
import type { BuildingExposure } from "./buildingExposure";
import { formatArrivalTime, type ArrivalForecastResult } from "./arrivalForecast";

declare const Cesium: any;

export interface RooftopBadgeStyle {
  text: string;
  fillColor: any;
  bgColor: any;
  pointColor: any;
}

export function formatRooftopArrivalBadge(
  exposure: BuildingExposure | undefined,
  elapsed: number,
  forecast: Pick<ArrivalForecastResult, "complete" | "horizon"> | null,
  fallbackDistanceM?: number
): RooftopBadgeStyle {
  const CesiumRef = typeof Cesium !== "undefined" ? Cesium : null;
  const cyan = CesiumRef?.Color?.fromCssColorString?.("#38bdf8") ?? "#38bdf8";
  const orange = CesiumRef?.Color?.fromCssColorString?.("#fb923c") ?? "#fb923c";
  const vibrantOrange = CesiumRef?.Color?.fromCssColorString?.("#f97316") ?? "#f97316";
  const red = CesiumRef?.Color?.fromCssColorString?.("#ef4444") ?? "#ef4444";
  const green = CesiumRef?.Color?.fromCssColorString?.("#4ade80") ?? "#4ade80";
  const slate = CesiumRef?.Color?.fromCssColorString?.("#94a3b8") ?? "#94a3b8";

  const darkBg = CesiumRef?.Color?.fromCssColorString?.("#090d16")?.withAlpha?.(0.92) ?? "#090d16";
  const redBg = CesiumRef?.Color?.fromCssColorString?.("#450a0a")?.withAlpha?.(0.95) ?? "#450a0a";
  const orangeBg = CesiumRef?.Color?.fromCssColorString?.("#431407")?.withAlpha?.(0.95) ?? "#431407";
  const greenBg = CesiumRef?.Color?.fromCssColorString?.("#064e3b")?.withAlpha?.(0.92) ?? "#064e3b";

  // 1. Water has reached this house!
  if (exposure?.arrivalSeconds !== null && exposure?.arrivalSeconds !== undefined) {
    const reachedTimeStr = formatArrivalTime(exposure.arrivalSeconds);
    return {
      text: `⚠️ FLOODED · ${reachedTimeStr}`,
      fillColor: red,
      bgColor: redBg,
      pointColor: red,
    };
  }

  // 2. Incoming flood with predicted arrival time
  if (
    exposure?.predictedArrivalSeconds !== null &&
    exposure?.predictedArrivalSeconds !== undefined &&
    exposure.predictedArrivalSeconds > elapsed
  ) {
    const remainingSeconds = exposure.predictedArrivalSeconds - elapsed;
    const timeStr = formatArrivalTime(remainingSeconds);
    const isUrgent = remainingSeconds <= 90;
    return {
      text: `🌊 Flood in ~${timeStr}`,
      fillColor: isUrgent ? orange : cyan,
      bgColor: isUrgent ? orangeBg : darkBg,
      pointColor: isUrgent ? vibrantOrange : cyan,
    };
  }

  // 3. Flood predicted to have arrived just now / imminent
  if (
    exposure?.predictedArrivalSeconds !== null &&
    exposure?.predictedArrivalSeconds !== undefined &&
    exposure.predictedArrivalSeconds <= elapsed
  ) {
    return {
      text: `🌊 Flood Imminent`,
      fillColor: vibrantOrange,
      bgColor: orangeBg,
      pointColor: vibrantOrange,
    };
  }

  // 4. Forecast completed and this house will not be flooded within the horizon
  if (forecast?.complete) {
    return {
      text: `🛡️ Safe (> ${formatArrivalTime(forecast.horizon)})`,
      fillColor: green,
      bgColor: greenBg,
      pointColor: CesiumRef?.Color?.fromCssColorString?.("#22c55e") ?? "#22c55e",
    };
  }

  // 5. Fallback from river distance if available before forecast finishes
  if (fallbackDistanceM && fallbackDistanceM > 0) {
    const estSeconds = Math.max(15, Math.round(fallbackDistanceM / 1.8));
    return {
      text: `🌊 Flood ETA: ~${formatArrivalTime(estSeconds)}`,
      fillColor: cyan,
      bgColor: darkBg,
      pointColor: cyan,
    };
  }

  // 6. Still calculating
  return {
    text: `⏱️ Flood ETA: Calculating…`,
    fillColor: slate,
    bgColor: darkBg,
    pointColor: CesiumRef?.Color?.fromCssColorString?.("#64748b") ?? "#64748b",
  };
}

export function BuildingArrivalLabels({
  viewer,
  buildings,
  exposures,
  elapsed,
  forecast,
  visible = true,
}: {
  viewer: any;
  buildings: BuildingFeature[];
  exposures: BuildingExposure[];
  elapsed: number;
  forecast: ArrivalForecastResult | null;
  visible?: boolean;
}) {
  const labels = useRef(new Map<string, any>());

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || typeof Cesium === "undefined") return;

    const collection = new Cesium.CustomDataSource("simulation-building-arrivals");
    collection.show = visible;
    viewer.dataSources.add(collection);

    // Label all loaded buildings in the area (cap at 250 for peak 60 FPS performance)
    const maxLabels = 250;
    const count = Math.min(buildings.length, maxLabels);

    for (let index = 0; index < count; index++) {
      const building = buildings[index];
      const id = String(building.id ?? building.properties?.id ?? index);
      if (labels.current.has(id)) continue;

      const props = building.properties || {};
      let lon = props.lon ?? props.lng;
      let lat = props.lat;

      if (typeof lon !== "number" || typeof lat !== "number") {
        const ring = building.geometry?.type === "Polygon"
          ? building.geometry.coordinates[0]
          : building.geometry?.coordinates?.[0]?.[0];
        if (!ring?.length) continue;
        const points = ring as number[][];
        lon = points.reduce((sum, p) => sum + p[0], 0) / points.length;
        lat = points.reduce((sum, p) => sum + p[1], 0) / points.length;
      }

      if (typeof lon !== "number" || typeof lat !== "number" || !Number.isFinite(lon) || !Number.isFinite(lat)) {
        continue;
      }

      const rawHeight = Number(props.height_m ?? props.height ?? props.estimated_height);
      const height = Math.max(3.5, Number.isFinite(rawHeight) ? rawHeight : 6.0);
      const fallbackDist = Number(props.distance_to_river_m) || (parseFloat(String(props.distance_from_river || "")) || 350);

      const initialBadge = formatRooftopArrivalBadge(undefined, elapsed, forecast, fallbackDist);

      const entity = collection.entities.add({
        id: `arrival-label-${id}`,
        position: Cesium.Cartesian3.fromDegrees(lon, lat, height + 2.5),
        point: {
          pixelSize: 6,
          color: initialBadge.pointColor,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1.5,
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 10000),
          scaleByDistance: new Cesium.NearFarScalar(150, 1.0, 8000, 0.5),
        },
        label: {
          text: initialBadge.text,
          font: "bold 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          fillColor: initialBadge.fillColor,
          showBackground: true,
          backgroundColor: initialBadge.bgColor,
          backgroundPadding: new Cesium.Cartesian2(8, 4),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -10),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 10000),
          scaleByDistance: new Cesium.NearFarScalar(150, 1.0, 8000, 0.55),
        },
      });

      (entity as any)._fallbackDist = fallbackDist;
      labels.current.set(id, entity);
    }

    viewer.scene.requestRender();

    return () => {
      labels.current.clear();
      if (!viewer.isDestroyed()) {
        try {
          viewer.dataSources.remove(collection, true);
        } catch (e) {}
      }
    };
  }, [viewer, buildings, visible]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || typeof Cesium === "undefined") return;

    let changed = false;
    const exposureMap = new Map<string, BuildingExposure>();
    for (const exp of exposures) {
      exposureMap.set(exp.id, exp);
    }

    for (const [id, entity] of labels.current.entries()) {
      const exposure = exposureMap.get(id);
      const fallbackDist = (entity as any)._fallbackDist;
      const badge = formatRooftopArrivalBadge(exposure, elapsed, forecast, fallbackDist);

      const currentText = entity.label?.text?.getValue?.(Cesium.JulianDate.now()) ?? entity.label?.text;
      if (currentText !== badge.text) {
        entity.label.text = badge.text;
        entity.label.fillColor = badge.fillColor;
        entity.label.backgroundColor = badge.bgColor;
        if (entity.point) {
          entity.point.color = badge.pointColor;
        }
        changed = true;
      }
    }

    if (changed && viewer && !viewer.isDestroyed()) {
      viewer.scene.requestRender();
    }
  }, [viewer, exposures, elapsed, forecast]);

  return null;
}
