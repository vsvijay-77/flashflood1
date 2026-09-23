import { describe, it, expect } from "vitest";
import { formatRooftopArrivalBadge } from "./BuildingArrivalLabels";
import type { BuildingExposure } from "./buildingExposure";

describe("formatRooftopArrivalBadge", () => {
  it("formats flooded status when water has reached the house", () => {
    const exposure: BuildingExposure = {
      id: "bldg-1",
      name: "House 1",
      kind: "house",
      cells: undefined,
      assessed: true,
      currentDepthM: 0.35,
      peakDepthM: 0.45,
      arrivalSeconds: 42,
      predictedArrivalSeconds: 30,
      affectedNow: true,
      affectedDuringRun: true,
    };
    const badge = formatRooftopArrivalBadge(exposure, 60, null);
    expect(badge.text).toBe("⚠️ FLOODED · 42s");
  });

  it("formats dynamic countdown when flood is incoming", () => {
    const exposure: BuildingExposure = {
      id: "bldg-2",
      name: "House 2",
      kind: "house",
      cells: undefined,
      assessed: true,
      currentDepthM: 0,
      peakDepthM: 0,
      arrivalSeconds: null,
      predictedArrivalSeconds: 150,
      affectedNow: false,
      affectedDuringRun: false,
    };
    const badge = formatRooftopArrivalBadge(exposure, 60, null);
    expect(badge.text).toBe("🌊 Flood in ~1m 30s");
  });

  it("formats imminent warning when countdown expires before actual arrival recorded", () => {
    const exposure: BuildingExposure = {
      id: "bldg-3",
      name: "House 3",
      kind: "house",
      cells: undefined,
      assessed: true,
      currentDepthM: 0.05,
      peakDepthM: 0.05,
      arrivalSeconds: null,
      predictedArrivalSeconds: 50,
      affectedNow: false,
      affectedDuringRun: false,
    };
    const badge = formatRooftopArrivalBadge(exposure, 55, null);
    expect(badge.text).toBe("🌊 Flood Imminent");
  });

  it("formats safe badge when forecast is complete and house is not reached", () => {
    const exposure: BuildingExposure = {
      id: "bldg-4",
      name: "House 4",
      kind: "house",
      cells: undefined,
      assessed: true,
      currentDepthM: 0,
      peakDepthM: 0,
      arrivalSeconds: null,
      predictedArrivalSeconds: null,
      affectedNow: false,
      affectedDuringRun: false,
    };
    const badge = formatRooftopArrivalBadge(exposure, 10, { complete: true, horizon: 3600 });
    expect(badge.text).toBe("🛡️ Safe (> 60m 0s)");
  });

  it("formats fallback arrival time from river proximity when forecast is pending", () => {
    const badge = formatRooftopArrivalBadge(undefined, 0, null, 180);
    // 180m / 1.8 m/s = 100s -> ~1m 40s
    expect(badge.text).toBe("🌊 Flood ETA: ~1m 40s");
  });

  it("formats calculating status when unassessed and no distance is available", () => {
    const badge = formatRooftopArrivalBadge(undefined, 0, null, undefined);
    expect(badge.text).toBe("⏱️ Flood ETA: Calculating…");
  });
});
