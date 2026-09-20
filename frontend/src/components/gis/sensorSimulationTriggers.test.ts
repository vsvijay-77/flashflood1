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

export function computeSimulationRunningState(
  currentState: { isRunning: boolean; triggeredBySensor: boolean },
  telemetry: {
    hasData: boolean;
    waterLevelMm: number;
    waterLevelM: number;
    soilMoisture: number;
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

  // CRITICAL USER REQUIREMENT:
  // "when flood triggered by sensor not stop it evn values 0 user should manually stop it"
  // If it was already running (triggered by sensor), dropping values to 0 does NOT stop it!
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

    it("does NOT trigger water simulation when telemetry has no data ('otherwise no')", () => {
      expect(shouldTriggerWaterSimulation({ hasData: false, waterLevelMm: 80, waterLevelM: 0.8, soilMoisture: 90 })).toBe(false);
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
