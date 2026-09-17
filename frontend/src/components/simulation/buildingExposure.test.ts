import { describe, expect, it } from "vitest";
import type { BuildingFeature } from "@/lib/routingApi";
import { assessBuildings, indexBuildings } from "./buildingExposure";

const grid = { cols: 3, rows: 3, west: 0, east: 2, south: 0, north: 2 };
const mask = new Uint8Array(9).fill(1);
const square = (west: number, south: number, east: number, north: number) => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const building = (rings: number[][][]): BuildingFeature => ({ type: "Feature", properties: { id: "home", building: "house" }, geometry: { type: "Polygon", coordinates: rings } });

describe("building exposure", () => {
  it("includes small footprints between terrain nodes", () => {
    expect(indexBuildings([building([square(0.1, 0.1, 0.2, 0.2)])], grid, mask)[0].cells).toEqual([0]);
  });
  it("samples all intersecting cells rather than only a centroid", () => {
    expect(indexBuildings([building([square(0.4, 0.4, 1.6, 1.6)])], grid, mask)[0].cells).toHaveLength(9);
  });
  it("excludes holes, masked cells and outside footprints", () => {
    const hollow = building([square(-0.4, -0.4, 2.4, 2.4), square(0.4, 0.4, 1.6, 1.6)]);
    expect(indexBuildings([hollow], grid, mask)[0].cells).not.toContain(4);
    expect(indexBuildings([hollow], grid, new Uint8Array(9))[0].cells).toEqual([]);
    expect(indexBuildings([building([square(5, 5, 6, 6)])], grid, mask)[0].cells).toEqual([]);
  });
  it("handles multipolygons and deduplicates IDs", () => {
    const feature = building([]);
    feature.geometry = { type: "MultiPolygon", coordinates: [[square(-0.1, -0.1, 0.1, 0.1)], [square(1.9, 1.9, 2.1, 2.1)]] };
    const result = indexBuildings([feature, feature], grid, mask);
    expect(result).toHaveLength(1);
    expect(result[0].cells).toEqual([0, 8]);
  });
  it("distinguishes current, historical and unknown exposure", () => {
    const samples = [{ id: "home", name: "Home", kind: "house", cells: [0, 1] }, { id: "outside", name: "Outside", kind: "unknown", cells: [] }];
    const result = assessBuildings(samples, new Float32Array([0, 0.05]), new Float32Array([0.3, 0.2]));
    expect(result[0].affectedNow).toBe(false);
    expect(result[0].affectedDuringRun).toBe(true);
    expect(result[0].peakDepthM).toBeCloseTo(0.3);
    expect(result[1].assessed).toBe(false);
    expect(assessBuildings(samples, new Float32Array(2), new Float32Array(2))[0].affectedDuringRun).toBe(false);
    expect(assessBuildings(samples, new Float32Array([0.1, 0]), new Float32Array([0.1, 0]))[0].affectedNow).toBe(true);
  });
});
