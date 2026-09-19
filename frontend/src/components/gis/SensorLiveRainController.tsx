import React from "react";
import CesiumSelectedAreaRainOverlay from "../simulation/CesiumSelectedAreaRainOverlay";

export interface SensorLiveRainControllerProps {
  viewer: any; // Cesium.Viewer
  polygonCoords: [number, number][] | null;
  sensorRainfall: number; // Real-time rainfall detected by the sensor (mm/h)
  windSpeedKmh?: number;
  groundHeight?: number;
  isFlatView?: boolean;
  thresholdMmH?: number; // Threshold to trigger rain (default: 20 mm/h / 20%)
  forceActive?: boolean; // Optional manual override
}

/**
 * SensorLiveRainController
 * 
 * Standalone, lightweight atmospheric rain controller driven strictly by live sensor telemetry.
 * 
 * Specification:
 * - If sensor rainfall is detected (> threshold), make the rain fall based on that exact intensity.
 * - No simulation page / sheet opened.
 * - No flood water increase, no Three.js water mesh, no river flooding physics.
 * - Just atmospheric rainfall visualization rendered on top of the Cesium monitored zone.
 */
export function SensorLiveRainController({
  viewer,
  polygonCoords,
  sensorRainfall,
  windSpeedKmh = 20,
  groundHeight = 293,
  isFlatView = false,
  thresholdMmH = 20,
  forceActive = false,
}: SensorLiveRainControllerProps) {
  // Rain is active if detected sensor rainfall exceeds threshold, or forced active
  const isRainActive = forceActive || sensorRainfall > thresholdMmH;
  const currentIntensity = isRainActive ? Math.max(15, sensorRainfall) : 0;

  if (!viewer || !isRainActive || currentIntensity <= 0) {
    return null;
  }

  return (
    <CesiumSelectedAreaRainOverlay
      viewer={viewer}
      polygonCoords={polygonCoords}
      active={isRainActive}
      intensityMm={currentIntensity}
      windSpeedKmh={windSpeedKmh}
      groundHeight={groundHeight}
      isFlatView={isFlatView}
      className="sensor-live-rain-overlay"
    />
  );
}

export default SensorLiveRainController;
