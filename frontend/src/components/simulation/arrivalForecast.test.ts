import { describe, expect, it } from "vitest";
import { WaterPhysicsSimulation } from "./waterPhysics";
import { assessBuildings } from "./buildingExposure";
import { advanceArrivalForecast, arrivalLabel, createArrivalForecast, type ArrivalForecastInput } from "./arrivalForecast";
import { defaultFlashFloodParameters } from "./flashFloodParameters";

const input = (rainfall = 3600): ArrivalForecastInput => ({
  config: { cols: 1, rows: 1, dx: 10, flowModel: "gnn" }, bed: new Float32Array([0]),
  inside: new Uint8Array([1]), sources: new Uint8Array([0]), paths: new Uint8Array([0]),
  depth: new Float32Array([0]), discharges: [], elapsed: 0, rainfall, sourceRise: 0,
  parameters: { ...defaultFlashFloodParameters, durationMinutes: 3, infiltrationMmH: 0 }, horizon: 240,
});

describe("building arrival forecasts", () => {
  it("matches the visible solver's threshold time, records once and resets", () => {
    const data = input();
    const forecast = createArrivalForecast(data);
    const result = advanceArrivalForecast(forecast, data, 10000);
    const live = new WaterPhysicsSimulation(data.config, data.bed, data.inside, data.sources, data.depth);
    live.advance(120, 1, 0, data.rainfall);
    expect(result.complete).toBe(true);
    expect(result.arrivals[0]).toBeCloseTo(live.state.firstArrivalSeconds[0], 5);
    expect(result.arrivals[0]).toBeCloseTo(100, 0);
    const first = live.state.firstArrivalSeconds[0];
    live.advance(20, 1, 0, 0);
    expect(live.state.firstArrivalSeconds[0]).toBe(first);
    live.reset();
    expect(live.state.firstArrivalSeconds[0]).toBe(-1);
    expect(live.state.peakDepth[0]).toBe(0);
  });
  it("stops rain at storm end and does not invent arrivals for a dry forecast", () => {
    const data = input(3600);
    data.parameters.durationMinutes = 1;
    const sim = createArrivalForecast(data);
    const result = advanceArrivalForecast(sim, data, 10000);
    expect(sim.state.depth[0]).toBeCloseTo(0.06, 5);
    expect(result.arrivals[0]).toBe(-1);
    const dry = input(0);
    expect(advanceArrivalForecast(createArrivalForecast(dry), dry, 10000).arrivals[0]).toBe(-1);
  });
  it("records transient arrivals and keeps peaks after water recedes", () => {
    const sim = new WaterPhysicsSimulation({ cols: 2, rows: 1, dx: 2, flowModel: "gnn" }, [0, -1], undefined, undefined, [0.3, 0]);
    sim.advance(5, 1, 0);
    expect(sim.state.firstArrivalSeconds[0]).toBe(0);
    expect(sim.state.firstArrivalSeconds[1]).toBeGreaterThan(0);
    expect(sim.state.peakDepth[0]).toBeCloseTo(0.3);
    expect(sim.state.depth[0]).toBeLessThan(0.1);
  });
  it("uses earliest intersected cell and preserves unknowns for unassessed buildings", () => {
    const samples = [{ id: "home", name: "Home", kind: "house", cells: [0, 1] }, { id: "outside", name: "Outside", kind: "unknown", cells: [] }];
    const buildings = assessBuildings(samples, new Float32Array([0, 0.2]), new Float32Array([0.3, 0.2]), new Float64Array([20, 40]), new Float64Array([15, 30]));
    expect(buildings[0].arrivalSeconds).toBe(20);
    expect(buildings[0].predictedArrivalSeconds).toBe(15);
    expect(buildings[1].arrivalSeconds).toBeNull();
    expect(arrivalLabel(buildings[0], 50, null)).toBe("Reached at 20s");
    expect(arrivalLabel(buildings[1], 50, null)).toContain("unassessed");
  });
  it("distinguishes pending forecasts from no arrival and avoids overdue countdowns", () => {
    const building = { assessed: true, arrivalSeconds: null, predictedArrivalSeconds: null };
    expect(arrivalLabel(building, 0, null)).toContain("calculating");
    expect(arrivalLabel(building, 0, { complete: true, horizon: 3600 })).toContain("No arrival by 60m");
    expect(arrivalLabel({ ...building, predictedArrivalSeconds: 120 }, 60, null)).toBe("Water in ~1m 0s");
    expect(arrivalLabel({ ...building, predictedArrivalSeconds: 120 }, 130, null)).toContain("updating");
  });
  it("keeps forecast source targets relative to the dry start when refreshing mid-run", () => {
    const data = input(0);
    data.sources[0] = 1; data.depth[0] = 0.8; data.sourceRise = 1; data.elapsed = 30; data.horizon = 40;
    const sim = createArrivalForecast(data);
    advanceArrivalForecast(sim, data, 10000);
    expect(sim.state.depth[0]).toBeCloseTo(1);
  });
});
