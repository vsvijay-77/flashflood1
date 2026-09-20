import { describe, expect, it } from "vitest";

// Helper function implementing the threshold logic used in CesiumDigitalTwinViewer
export function shouldTriggerRain(telemetry: { hasData: boolean; rainfall: number; rainfallPct: number }): boolean {
  return telemetry.hasData && (telemetry.rainfall > 50 || telemetry.rainfallPct > 50);
}

export function shouldTriggerWaterSimulation(telemetry: {
  hasData: boolean;
  waterLevelMm: number;
  waterLevelM: number;
  soilMoisture: number;
}): boolean {
  if (!telemetry.hasData) return false;
  const isWaterLevelOver40 = telemetry.waterLevelMm >= 40 || (telemetry.waterLevelM * 100) >= 40;
  const isSoilMoistureOver40 = telemetry.soilMoisture >= 40;
  return isWaterLevelOver40 || isSoilMoistureOver40;
}

describe("Sensor Simulation Triggers", () => {
  describe("Atmospheric Rain Trigger (> 50% only)", () => {
    it("does NOT trigger rain when rainfall is 50 or below", () => {
      expect(shouldTriggerRain({ hasData: true, rainfall: 0, rainfallPct: 0 })).toBe(false);
      expect(shouldTriggerRain({ hasData: true, rainfall: 20, rainfallPct: 20 })).toBe(false);
      expect(shouldTriggerRain({ hasData: true, rainfall: 45, rainfallPct: 45 })).toBe(false);
      expect(shouldTriggerRain({ hasData: true, rainfall: 50, rainfallPct: 50 })).toBe(false);
    });

    it("triggers rain ONLY when rainfall or rainfallPct exceeds 50%", () => {
      expect(shouldTriggerRain({ hasData: true, rainfall: 50.1, rainfallPct: 50.1 })).toBe(true);
      expect(shouldTriggerRain({ hasData: true, rainfall: 75, rainfallPct: 75 })).toBe(true);
      expect(shouldTriggerRain({ hasData: true, rainfall: 100, rainfallPct: 100 })).toBe(true);
    });

    it("does NOT trigger rain when there is no telemetry data", () => {
      expect(shouldTriggerRain({ hasData: false, rainfall: 80, rainfallPct: 80 })).toBe(false);
    });
  });

  describe("Water Simulation Trigger (water level or soil moisture >= 40%, otherwise NO)", () => {
    it("does NOT trigger water simulation when both water level and soil moisture are below 40%", () => {
      expect(shouldTriggerWaterSimulation({ hasData: true, waterLevelMm: 0, waterLevelM: 0, soilMoisture: 0 })).toBe(false);
      expect(shouldTriggerWaterSimulation({ hasData: true, waterLevelMm: 20, waterLevelM: 0.2, soilMoisture: 35 })).toBe(false);
      expect(shouldTriggerWaterSimulation({ hasData: true, waterLevelMm: 39, waterLevelM: 0.39, soilMoisture: 39 })).toBe(false);
    });

    it("triggers water simulation when water level is 40% or higher", () => {
      expect(shouldTriggerWaterSimulation({ hasData: true, waterLevelMm: 40, waterLevelM: 0.4, soilMoisture: 10 })).toBe(true);
      expect(shouldTriggerWaterSimulation({ hasData: true, waterLevelMm: 60, waterLevelM: 0.6, soilMoisture: 0 })).toBe(true);
    });

    it("triggers water simulation when soil moisture is 40% or higher", () => {
      expect(shouldTriggerWaterSimulation({ hasData: true, waterLevelMm: 0, waterLevelM: 0, soilMoisture: 40 })).toBe(true);
      expect(shouldTriggerWaterSimulation({ hasData: true, waterLevelMm: 15, waterLevelM: 0.15, soilMoisture: 65 })).toBe(true);
    });

    it("triggers water simulation when both water level and soil moisture reach 40% or higher", () => {
      expect(shouldTriggerWaterSimulation({ hasData: true, waterLevelMm: 45, waterLevelM: 0.45, soilMoisture: 55 })).toBe(true);
    });

    it("does NOT trigger water simulation when telemetry has no data initially", () => {
      expect(shouldTriggerWaterSimulation({ hasData: false, waterLevelMm: 80, waterLevelM: 0.8, soilMoisture: 90 })).toBe(false);
    });
  });

  describe("Simulation Persistence ('even values reach 0 not stop simulation just continue only user can stop it')", () => {
    it("keeps water simulation running when values drop to 0 after being auto-started", () => {
      let isSimActive = false;
      let autoStartedBySensor = false;

      // 1. Telemetry reaches 45% soil moisture -> triggers simulation
      const telemetry1 = { hasData: true, waterLevelMm: 10, waterLevelM: 0.1, soilMoisture: 45 };
      if (shouldTriggerWaterSimulation(telemetry1)) {
        isSimActive = true;
        autoStartedBySensor = true;
      }
      expect(isSimActive).toBe(true);
      expect(autoStartedBySensor).toBe(true);

      // 2. Sensor values drop to 0
      const telemetry2 = { hasData: true, waterLevelMm: 0, waterLevelM: 0, soilMoisture: 0 };
      const triggered = shouldTriggerWaterSimulation(telemetry2);
      expect(triggered).toBe(false);

      // In CesiumDigitalTwinViewer:
      if (triggered) {
        isSimActive = true;
        autoStartedBySensor = true;
      } else if (autoStartedBySensor) {
        // User rule: even values reach 0 not stop simulation, just continue
        isSimActive = true;
      }
      expect(isSimActive).toBe(true); // Still running!

      // 3. User manually stops simulation
      function onUserStop() {
        autoStartedBySensor = false;
        isSimActive = false;
      }
      onUserStop();
      expect(isSimActive).toBe(false);
    });
  });
});
