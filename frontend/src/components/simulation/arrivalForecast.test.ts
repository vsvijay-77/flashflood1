import { describe, expect, it, vi } from "vitest";
import { WaterPhysicsSimulation } from "./waterPhysics";
import { assessBuildings } from "./buildingExposure";
import { advanceArrivalForecast, arrivalLabel, createArrivalForecast, type ArrivalForecastInput } from "./arrivalForecast";
import { defaultFlashFloodParameters, getFloodForcing } from "./flashFloodParameters";

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
    live.advanceWithForcing(data.horizon, 1, seconds => getFloodForcing(data.rainfall, data.sourceRise, data.parameters, seconds));
    expect(result.complete).toBe(true);
    expect(result.arrivals[0]).toBeCloseTo(live.state.firstArrivalSeconds[0], 5);
    expect(result.arrivals[0]).toBeGreaterThan(100);
    expect(result.arrivals[0]).toBeLessThan(data.parameters.durationMinutes * 60);
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
    expect(sim.state.depth[0]).toBeGreaterThan(0);
    expect(sim.state.depth[0]).toBeLessThan(0.06);
    expect(result.arrivals[0]).toBe(-1);
    const dry = input(0);
    expect(advanceArrivalForecast(createArrivalForecast(dry), dry, 10000).arrivals[0]).toBe(-1);
  });
  it("keeps a budget-limited forecast pending without inventing shallow-water or downhill arrivals", () => {
    const data = input(0);
    data.config = { cols: 2, rows: 1, dx: 10 };
    data.bed = new Float32Array([1, 0]);
    data.inside = new Uint8Array([1, 1]);
    data.sources = new Uint8Array([0, 0]);
    data.paths = new Uint8Array([0, 0]);
    data.depth = new Float32Array([0.09, 0]);
    const forecast = createArrivalForecast(data);
    const result = advanceArrivalForecast(forecast, data, 0);
    expect(result.complete).toBe(false);
    expect(result.throughSeconds).toBe(0);
    expect([...result.arrivals]).toEqual([-1, -1]);
    expect(result.arrivals).toBe(forecast.state.firstArrivalSeconds);
    expect(arrivalLabel({ assessed: true, arrivalSeconds: null, predictedArrivalSeconds: null }, 0, result)).toContain("calculating");
  });
  it("continues the same solver across bounded slices until the full horizon is covered", () => {
    const data = input();
    const forecast = createArrivalForecast(data);
    let clock = 0;
    const timing = vi.spyOn(performance, "now").mockImplementation(() => clock++);
    let partial;
    try {
      partial = advanceArrivalForecast(forecast, data, 10);
    } finally {
      timing.mockRestore();
    }
    expect(partial.complete).toBe(false);
    expect(partial.throughSeconds).toBeGreaterThan(0);
    expect(partial.throughSeconds).toBeLessThan(data.horizon);
    expect(partial.arrivals[0]).toBe(-1);
    const result = advanceArrivalForecast(forecast, data, 10000);
    expect(result.complete).toBe(true);
    expect(result.throughSeconds).toBeCloseTo(data.horizon, 6);
    const uninterrupted = advanceArrivalForecast(createArrivalForecast(data), data, 10000);
    expect(result.arrivals[0]).toBeCloseTo(uninterrupted.arrivals[0], 1);
  });
  it("finishes a dry zero-intensity scenario without simulating empty steps", () => {
    const data = input();
    data.sources[0] = 1;
    data.sourceRise = 2;
    data.parameters.floodIntensity = 0;
    const sim = createArrivalForecast(data);
    const advance = vi.spyOn(sim, "advanceWithForcing");
    const result = advanceArrivalForecast(sim, data, 0);
    expect(result.complete).toBe(true);
    expect(result.throughSeconds).toBe(data.horizon);
    expect(result.arrivals[0]).toBe(-1);
    expect(advance).not.toHaveBeenCalled();
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
    expect(sim.state.initialSourceDepth[0]).toBe(0);
    const explicit = { ...data, initialSourceDepth: new Float32Array([0.025]) };
    expect(createArrivalForecast(explicit).state.initialSourceDepth[0]).toBeCloseTo(0.025);
  });
  it("preserves historical arrivals and momentum in mid-run snapshots", () => {
    const data = input(0);
    data.depth[0] = 0.02;
    data.elapsed = 90;
    data.firstArrivalSeconds = new Float64Array([35]);
    data.velocityX = new Float32Array([0.3]);
    data.velocityY = new Float32Array([-0.2]);
    const sim = createArrivalForecast(data);
    expect(sim.state.firstArrivalSeconds[0]).toBe(35);
    expect(sim.state.firstArrivalSeconds).not.toBe(data.firstArrivalSeconds);
    expect(sim.state.velocityX[0]).toBeCloseTo(0.3);
    expect(sim.state.velocityY[0]).toBeCloseTo(-0.2);
  });
  it("keeps coarse-grid arrival estimates close to real-time playback while conserving water", () => {
    const data = input(150);
    data.config = { cols: 8, rows: 1, dx: 300, flowModel: "physics" };
    data.bed = Float32Array.from({ length: 8 }, (_, i) => (7 - i) * 5);
    data.inside = new Uint8Array(8).fill(1);
    data.sources = new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]);
    data.paths = new Uint8Array(8);
    data.depth = new Float32Array(8);
    data.sourceRise = 2;
    data.horizon = 600;
    const prediction = advanceArrivalForecast(createArrivalForecast(data), data, 10000);
    const live = new WaterPhysicsSimulation(data.config, data.bed, data.inside, data.sources, data.depth);
    const forcing = (seconds: number) => getFloodForcing(data.rainfall, data.sourceRise, data.parameters, seconds);
    for (let frame = 0; frame < data.horizon * 30; frame++) live.advanceWithForcing(1 / 30, 1, forcing);
    expect(prediction.complete).toBe(true);
    expect(prediction.arrivals[0]).toBeGreaterThan(0);
    for (let cell = 0; cell < 8; cell++) {
      expect(prediction.arrivals[cell] >= 0).toBe(live.state.firstArrivalSeconds[cell] >= 0);
      if (prediction.arrivals[cell] >= 0) expect(Math.abs(prediction.arrivals[cell] - live.state.firstArrivalSeconds[cell])).toBeLessThan(3);
    }
    expect(Math.abs(live.state.totalVolumeM3 - live.state.injectedVolumeM3) / live.state.injectedVolumeM3).toBeLessThan(0.001);
  });
  it("forecasts downhill travel from headwaters instead of filling downstream river cells", () => {
    const data = input(0);
    data.config = { cols: 5, rows: 1, dx: 10, sourceMode: "headwaters" };
    data.bed = new Float32Array([8, 6, 4, 2, 0]);
    data.inside = new Uint8Array(5).fill(1);
    data.sources = new Uint8Array(5).fill(1);
    data.paths = new Uint8Array(5);
    data.depth = new Float32Array(5);
    data.sourceRise = 1;
    const forecast = createArrivalForecast(data);
    expect(Array.from(forecast.state.isSource)).toEqual([1, 0, 0, 0, 0]);
    const result = advanceArrivalForecast(forecast, data, 10000);
    expect(result.complete).toBe(true);
    expect(result.arrivals[0]).toBeGreaterThan(0);
    expect(result.arrivals[4]).toBeGreaterThan(result.arrivals[0]);
    expect(forecast.state.totalVolumeM3).toBeCloseTo(forecast.state.injectedVolumeM3, 2);
  });
});
