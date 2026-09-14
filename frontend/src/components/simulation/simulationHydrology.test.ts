import { describe, expect, it } from "vitest";
import { WaterPhysicsSimulation } from "./waterPhysics";
import { createWaterSources } from "./waterSources";
import { buildFloodSamples, buildingFloodDepth, sampleFloodTriangle, type FloodSurface } from "./floodExposure";
import type { WaterSourceFeature } from "@/services/osmWaterSourceService";

describe("terrain-driven rain and overflow", () => {
  it("routes rainfall downhill without adding a fictitious hilltop source", () => {
    const sim = new WaterPhysicsSimulation({ cols: 4, rows: 1, dx: 10, dy: 20 }, [6, 4, 2, 0]);
    for (let i = 0; i < 300; i++) sim.advance(0.2, 1, 0, 120, false);
    expect(sim.state.depth[3]).toBeGreaterThan(sim.state.depth[0]);
    expect(sim.state.velocityX[1]).toBeGreaterThan(0);
    const expectedVolume = 120 / 3_600_000 * sim.state.elapsedSeconds * 4 * 200;
    const volume = sim.state.depth.reduce((sum, d) => sum + d * 200, 0);
    expect(volume).toBeCloseTo(expectedVolume, 4);
    expect(sim.state.injectedVolumeM3).toBeCloseTo(expectedVolume, 6);
    expect(sim.state.isSource.every(v => v === 0)).toBe(true);
    const previous = Array.from(sim.state.depth);
    sim.advance(0, 1, 0, 120, false);
    expect(Array.from(sim.state.depth)).toEqual(previous);
    sim.reset();
    expect(sim.state.depth.every(v => v === 0)).toBe(true);
  });

  it("respects the selected boundary when rain falls", () => {
    const sim = new WaterPhysicsSimulation({ cols: 3, rows: 1, dx: 10 }, [0, 0, 0], [true, false, true]);
    sim.injectRainfall(100, 3600);
    expect(sim.state.depth[0]).toBeCloseTo(0.1);
    expect(sim.state.depth[1]).toBe(0);
    expect(sim.state.injectedVolumeM3).toBeCloseTo(20);
  });

  it("preserves flow and volume when a rectangular grid is rotated", () => {
    const x = new WaterPhysicsSimulation({ cols: 3, rows: 2, dx: 4, dy: 9 },
      [4, 2, 0, 4, 2, 0], undefined, undefined, [2, 0, 0, 0, 0, 0]);
    const y = new WaterPhysicsSimulation({ cols: 2, rows: 3, dx: 9, dy: 4 },
      [4, 4, 2, 2, 0, 0], undefined, undefined, [2, 0, 0, 0, 0, 0]);
    for (let i = 0; i < 100; i++) { x.advance(0.05, 1, 0, 0, false); y.advance(0.05, 1, 0, 0, false); }
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
      expect(x.state.depth[r * 3 + c]).toBeCloseTo(y.state.depth[c * 2 + r], 5);
    }
    expect(x.state.depth.reduce((sum, d) => sum + d * 36, 0)).toBeCloseTo(72, 4);
  });

  it("spreads from a water body into connected low ground while high ridges stay dry", () => {
    const sim = new WaterPhysicsSimulation({ cols: 7, rows: 1, dx: 5 },
      [8, 1, 1, -2, 1, 1, 8], undefined, [false, false, false, true, false, false, false], [0, 0, 0, 2, 0, 0, 0]);
    for (let i = 0; i < 150; i++) sim.advance(0.2, 1, 3);
    for (const i of [1, 2, 4, 5]) expect(sim.state.depth[i]).toBeGreaterThan(0.1);
    expect(sim.state.depth[0]).toBe(0);
    expect(sim.state.depth[6]).toBe(0);
  });
});

describe("mapped water sources", () => {
  const grid = { cols: 5, rows: 5, dx: 10, dy: 10, south: 0, west: 0, north: 4, east: 4 };
  const feature = (geometry: WaterSourceFeature["geometry"], waterType: WaterSourceFeature["waterType"] = "lake"): WaterSourceFeature => ({
    id: "test", name: "Test water", waterType, isPolygon: geometry.type === "Polygon", geometry, properties: {},
  });

  it("covers a whole lake at one surface elevation while preserving an island", () => {
    const terrain = new Float32Array(25).fill(100);
    terrain[6] = 100.4;
    const lake = feature({ type: "Polygon", coordinates: [
      [[-0.5, -0.5], [4.5, -0.5], [4.5, 4.5], [-0.5, 4.5], [-0.5, -0.5]],
      [[1.5, 1.5], [2.5, 1.5], [2.5, 2.5], [1.5, 2.5], [1.5, 1.5]],
    ] });
    const source = createWaterSources(grid, terrain, new Uint8Array(25).fill(1), [lake]);
    expect(source.sourceMask.reduce((a, b) => a + b, 0)).toBe(24);
    expect(source.sourceMask[12]).toBe(0);
    expect(source.bed[12]).toBe(100);
    for (let i = 0; i < 25; i++) if (source.sourceMask[i]) {
      expect(source.bed[i] + source.initialDepths[i]).toBeCloseTo(100, 4);
    }
  });

  it("rasterizes long river segments continuously instead of separated source dots", () => {
    const riverGrid = { ...grid, cols: 21, rows: 3, north: 2, east: 20 };
    const river = feature({ type: "LineString", coordinates: [[0, 1], [20, 1]] }, "stream");
    const source = createWaterSources(riverGrid, new Float32Array(63), new Uint8Array(63).fill(1), [river]);
    for (let c = 0; c < 21; c++) expect(source.sourceMask[21 + c]).toBe(1);
    expect(source.sourceMask[0]).toBe(0);
  });
});

describe("house inundation", () => {
  function surface(): FloodSurface {
    const sim = new WaterPhysicsSimulation({ cols: 3, rows: 3, dx: 10 }, new Float32Array(9));
    return { state: sim.state, terrain: new Float32Array(9), south: 0, west: 0, north: 2, east: 2 };
  }
  const footprint = (x: number, y: number) => [[[x, y], [x + 0.1, y], [x + 0.1, y + 0.1], [x, y + 0.1], [x, y]]];

  it("flags the wet footprint and leaves a dry house in the same area unaffected", () => {
    const grid = surface();
    grid.state.depth[0] = 0.5;
    expect(buildingFloodDepth(grid, buildFloodSamples(grid, footprint(0.1, 0.1)))).toBeGreaterThan(0.05);
    expect(buildingFloodDepth(grid, buildFloodSamples(grid, footprint(1.5, 1.5)))).toBe(0);
    grid.state.depth.fill(0);
    expect(buildingFloodDepth(grid, buildFloodSamples(grid, footprint(0.1, 0.1)))).toBe(0);
  });

  it("does not flag normal channel depth below the terrain surface", () => {
    const grid = surface();
    grid.state.bed.fill(-2);
    grid.state.depth.fill(2);
    const probes = buildFloodSamples(grid, footprint(0.1, 0.1));
    expect(buildingFloodDepth(grid, probes)).toBe(0);
    grid.state.depth.fill(2.5);
    expect(buildingFloodDepth(grid, probes)).toBeCloseTo(0.5);
  });

  it("rejects water outside the selection and matches the rendered triangle", () => {
    const grid = surface();
    expect(sampleFloodTriangle(grid, -0.1, 0)).toBeNull();
    const probe = sampleFloodTriangle(grid, 0.25, 0.25)!;
    expect(probe.cells).toEqual([0, 1, 3]);
    expect(probe.weights).toEqual([0.5, 0.25, 0.25]);
    grid.state.insideMask[3] = 0;
    expect(sampleFloodTriangle(grid, 0.25, 0.25)).toBeNull();
  });
});
