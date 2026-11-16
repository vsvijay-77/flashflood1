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
  rainfall?: number;
  rainfallPct?: number;
}): boolean {
  if (!telemetry.hasData) return false;
  const isWaterLevelOver50 = telemetry.waterLevelMm > 50 || (telemetry.waterLevelM * 100) > 50;
  const isRainOver50 = (telemetry.rainfall ?? 0) > 50 || (telemetry.rainfallPct ?? 0) > 50;
  return isWaterLevelOver50 || isRainOver50;
}

export function computeSimulationRunningState(
  currentState: { isRunning: boolean; triggeredBySensor: boolean },
  telemetry: {
    hasData: boolean;
    waterLevelMm: number;
    waterLevelM: number;
    soilMoisture: number;
    rainfall?: number;
    rainfallPct?: number;
  },
  manuallyStoppedByUser: boolean
): { isRunning: boolean; triggeredBySensor: boolean } {
  // If user manually stopped the simulation, it must stop immediately
  if (manuallyStoppedByUser) {
    return { isRunning: false, triggeredBySensor: false };
  }

  const triggered = shouldTriggerWaterSimulation(telemetry);
  if (triggered) {
    return { isRunning: true, triggeredBySensor: true };
  }

  // If it was already running (triggered by sensor), dropping values does NOT stop it!
  if (currentState.isRunning && currentState.triggeredBySensor) {
    return { isRunning: true, triggeredBySensor: true };
  }

  return { isRunning: false, triggeredBySensor: false };
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

  describe("Water Simulation Trigger (water level > 50 or rain > 50)", () => {
    it("does NOT trigger water simulation when both water level and rain are at or below 50", () => {
      expect(shouldTriggerWaterSimulation({ hasData: true, waterLevelMm: 0, waterLevelM: 0, soilMoisture: 0, rainfall: 0 })).toBe(false);
      expect(shouldTriggerWaterSimulation({ hasData: true, waterLevelMm: 20, waterLevelM: 0.2, soilMoisture: 35, rainfall: 40 })).toBe(false);
      expect(shouldTriggerWaterSimulation({ hasData: true, waterLevelMm: 50, waterLevelM: 0.5, soilMoisture: 39, rainfall: 50 })).toBe(false);
    });

    it("triggers water simulation when water level is greater than 50", () => {
      expect(shouldTriggerWaterSimulation({ hasData: true, waterLevelMm: 51, waterLevelM: 0.51, soilMoisture: 10 })).toBe(true);
      expect(shouldTriggerWaterSimulation({ hasData: true, waterLevelMm: 60, waterLevelM: 0.6, soilMoisture: 0 })).toBe(true);
    });

    it("triggers water simulation when rain sensor exceeds 50%", () => {
      expect(shouldTriggerWaterSimulation({ hasData: true, waterLevelMm: 10, waterLevelM: 0.1, soilMoisture: 20, rainfallPct: 55 })).toBe(true);
      expect(shouldTriggerWaterSimulation({ hasData: true, waterLevelMm: 0, waterLevelM: 0, soilMoisture: 0, rainfall: 75 })).toBe(true);
    });

    it("does NOT trigger water simulation when telemetry has no data", () => {
      expect(shouldTriggerWaterSimulation({ hasData: false, waterLevelMm: 80, waterLevelM: 0.8, soilMoisture: 90, rainfall: 90 })).toBe(false);
    });
  });

  describe("Sensor Trigger Persistence & Manual Stop Rule", () => {
    it("keeps simulation running even if water level and soil moisture drop to 0", () => {
      // Step 1: Start with sensor trigger (water level 45%)
      const state1 = computeSimulationRunningState(
        { isRunning: false, triggeredBySensor: false },
        { hasData: true, waterLevelMm: 45, waterLevelM: 0.45, soilMoisture: 20 },
        false
      );
      expect(state1.isRunning).toBe(true);
      expect(state1.triggeredBySensor).toBe(true);

      // Step 2: Telemetry drops to 0!
      const state2 = computeSimulationRunningState(
        state1,
        { hasData: true, waterLevelMm: 0, waterLevelM: 0, soilMoisture: 0 },
        false
      );
      expect(state2.isRunning).toBe(true);
      expect(state2.triggeredBySensor).toBe(true);

      // Step 3: Telemetry disconnected / no data!
      const state3 = computeSimulationRunningState(
        state2,
        { hasData: false, waterLevelMm: 0, waterLevelM: 0, soilMoisture: 0 },
        false
      );
      expect(state3.isRunning).toBe(true);
      expect(state3.triggeredBySensor).toBe(true);
    });

    it("stops simulation ONLY when user manually stops it", () => {
      const runningState = { isRunning: true, triggeredBySensor: true };

      // User manually clicks 'End simulation'
      const stoppedState = computeSimulationRunningState(
        runningState,
        { hasData: true, waterLevelMm: 0, waterLevelM: 0, soilMoisture: 0 },
        true // manuallyStoppedByUser = true
      );
      expect(stoppedState.isRunning).toBe(false);
      expect(stoppedState.triggeredBySensor).toBe(false);
    });
  });
});
