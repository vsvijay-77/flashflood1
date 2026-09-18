import { describe, it, expect } from "vitest";
import { precomputeHydrology } from "./hydrologyPrecompute";

describe("hydrologyPrecompute", () => {
  it("computes slopes, flow accumulation, and directs flow from high to low terrain", () => {
    // 3x3 grid with high terrain on left and slope down to right
    const bedElevations = [
      10, 5, 0,
      10, 5, 0,
      10, 5, 0,
    ];
    const hydro = precomputeHydrology({
      cols: 3,
      rows: 3,
      dx: 10,
      dy: 10,
      bedElevations,
      insideMask: new Uint8Array(9).fill(1),
    });

    expect(hydro.elevation[0]).toBe(10);
    expect(hydro.elevation[2]).toBe(0);

    // Left cells should direct flow to the right
    expect(hydro.maxDownhillSlope[0]).toBeGreaterThan(0);
    expect(hydro.downhillCount[0]).toBeGreaterThan(0);

    // Low-lying right cells should have high flow accumulation
    expect(hydro.flowAccumulation[2]).toBeGreaterThan(hydro.flowAccumulation[0]);
    expect(hydro.flowAccumulation[5]).toBeGreaterThan(hydro.flowAccumulation[3]);
  });

  it("identifies local depressions and their lip elevations", () => {
    // 3x3 grid with center cell being a depression (pit)
    const bedElevations = [
      10, 10, 10,
      10,  2, 10,
      10, 10, 10,
    ];
    const hydro = precomputeHydrology({
      cols: 3,
      rows: 3,
      dx: 10,
      dy: 10,
      bedElevations,
      insideMask: new Uint8Array(9).fill(1),
    });

    const centerIdx = 4; // row 1, col 1
    expect(hydro.isDepression[centerIdx]).toBe(1);
    expect(hydro.depressionLipElev[centerIdx]).toBe(10);
    expect(hydro.downhillCount[centerIdx]).toBe(0);
  });

  it("assigns higher riverFactor to mapped waterways and near-river cells", () => {
    const bedElevations = new Float32Array(9).fill(5);
    const waterBodyMask = new Uint8Array(9);
    waterBodyMask[4] = 1; // Center is a river

    const hydro = precomputeHydrology({
      cols: 3,
      rows: 3,
      dx: 10,
      dy: 10,
      bedElevations,
      insideMask: new Uint8Array(9).fill(1),
      waterBodyMask,
    });

    expect(hydro.isRiver[4]).toBe(1);
    expect(hydro.riverFactor[4]).toBeGreaterThan(2.0); // Major river >= 2.0x
    expect(hydro.riverFactor[3]).toBeGreaterThan(1.2); // Adjacent cell >= 1.2x
    expect(hydro.distanceToRiver[4]).toBe(0);
    expect(hydro.distanceToRiver[3]).toBe(10);
  });
});
