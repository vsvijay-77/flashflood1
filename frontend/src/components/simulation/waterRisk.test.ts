import { describe, expect, it } from "vitest";
import { waterHazard, waterRiskPixels, type WaterRiskSnapshot } from "./waterRisk";

function grid(): WaterRiskSnapshot {
  return { cols: 3, rows: 2, south: 10, north: 11, west: 77, east: 78, elapsedSeconds: 0,
    depth: new Float32Array([0, 0.5, 2, 2, 0, 0]),
    velocityX: new Float32Array(6), velocityY: new Float32Array(6),
    inside: new Uint8Array([1, 1, 1, 1, 1, 1]), knownTerrain: new Uint8Array([1, 1, 1, 1, 1, 1]) };
}

describe("modeled water heatmap", () => {
  it("uses fixed depth and flow scales, never relative frame maxima", () => {
    expect(waterHazard(0, 100, 100)).toBe(0);
    expect(waterHazard(0.01, 0, 0)).toBe(0);
    expect(waterHazard(0.5, 0, 0)).toBe(0.25);
    expect(waterHazard(1, 0, 0)).toBe(0.5);
    expect(waterHazard(0.5, 3, 0)).toBe(0.75);
    expect(waterHazard(0.5, -3, 0)).toBe(0.75);
    expect(waterHazard(3, 4, 5)).toBe(1);
  });

  it("maps north to the top of a non-square grid and leaves dry cells clear", () => {
    const { pixels, wetCells, unknownCells } = waterRiskPixels(grid());
    expect(Array.from(pixels.slice(0, 4))).toEqual([220, 38, 38, 220]);
    expect(pixels[3 * 4 + 3]).toBe(0); // Southwest is dry.
    expect(pixels[5 * 4 + 3]).toBe(220);
    expect(wetCells).toBe(3);
    expect(unknownCells).toBe(0);
  });

  it("masks outside and unassessed cells instead of inferring risk from missing data", () => {
    const snapshot = grid();
    snapshot.inside[1] = 0;
    snapshot.knownTerrain[2] = 0;
    snapshot.velocityX[3] = NaN;
    const result = waterRiskPixels(snapshot);
    expect(result.wetCells).toBe(0);
    expect(result.unknownCells).toBe(2);
    expect(result.pixels.every(value => value === 0)).toBe(true);
  });

  it("clears past flood colors after drainage or reset without changing input arrays", () => {
    const snapshot = grid();
    const before = snapshot.depth.slice();
    expect(waterRiskPixels(snapshot).wetCells).toBe(3);
    expect(snapshot.depth).toEqual(before);
    snapshot.depth.fill(0);
    expect(waterRiskPixels(snapshot).pixels.every(value => value === 0)).toBe(true);
  });
});
