import { describe, expect, it } from "vitest";
import { rasterizeWaterSources, type SourceGrid } from "./sourceRaster";
import type { WaterSourceFeature } from "@/services/osmWaterSourceService";

const grid: SourceGrid = { cols: 11, rows: 11, dx: 10, dy: 10, west: 0, south: 0, east: 0.001, north: 0.001 };
const feature = (geometry: WaterSourceFeature["geometry"], width = 1): WaterSourceFeature => ({
  id: "water-test", name: "Test", waterType: "stream", isPolygon: geometry.type.includes("Polygon"), geometry, properties: { width_m: width },
});

describe("mapped water rasterization", () => {
  it("marks narrow diagonal channels continuously without widening them to a fixed 35 m corridor", () => {
    const result = rasterizeWaterSources([feature({ type: "LineString", coordinates: [[0, 0], [0.001, 0.001]] })], grid, new Uint8Array(121).fill(1));
    for (let index = 0; index < 11; index++) expect(result.mask[index * 11 + index]).toBe(1);
    expect(result.mask[5 * 11 + 8]).toBe(0);
    expect(result.featureCount).toBe(1);
  });

  it("preserves islands and excludes the selected area's dry mask", () => {
    const inside = new Uint8Array(121).fill(1);
    inside[12] = 0;
    const result = rasterizeWaterSources([feature({ type: "Polygon", coordinates: [
      [[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]],
      [[0.0003, 0.0003], [0.0007, 0.0003], [0.0007, 0.0007], [0.0003, 0.0007], [0.0003, 0.0003]],
    ] })], grid, inside);
    expect(result.mask[60]).toBe(0);
    expect(result.mask[12]).toBe(0);
    expect(result.mask[13]).toBe(1);
  });

  it("does not invent sources for empty or nonintersecting water data", () => {
    const result = rasterizeWaterSources([feature({ type: "LineString", coordinates: [[1, 1], [2, 2]] })], grid, new Uint8Array(121).fill(1));
    expect(result.mask.some(Boolean)).toBe(false);
    expect(result.featureCount).toBe(0);
    expect(rasterizeWaterSources([], grid, new Uint8Array(121).fill(1)).mask.some(Boolean)).toBe(false);
  });
});
