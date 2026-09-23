import { describe, expect, it } from "vitest";
import { selectHeadwaterSources } from "./headwaterSources";
import { WaterPhysicsSimulation } from "./waterPhysics";

describe("uphill flood origins", () => {
  it("uses only the uphill end of a river and leaves downstream houses initially dry", () => {
    const bed = new Float32Array([8, 6, 4, 2, 0]);
    const mask = new Uint8Array(5).fill(1);
    expect(Array.from(selectHeadwaterSources(5, 1, bed, mask, mask))).toEqual([1, 0, 0, 0, 0]);
    const sim = new WaterPhysicsSimulation({ cols: 5, rows: 1, dx: 10, sourceMode: "headwaters" }, bed, mask, mask);
    sim.advance(0.1, 1, 1, 0);
    expect(sim.state.depth[0]).toBeGreaterThan(0);
    expect(Array.from(sim.state.depth.slice(1))).toEqual([0, 0, 0, 0]);
    expect(Array.from(sim.state.isWaterway)).toEqual([1, 1, 1, 1, 1]);
    sim.advance(120, 1, 1, 0);
    expect(sim.state.depth[4]).toBeGreaterThan(0.01);
    expect(sim.state.firstArrivalSeconds[4]).toBeGreaterThan(sim.state.firstArrivalSeconds[0]);
    expect(sim.state.totalVolumeM3).toBeCloseTo(sim.state.injectedVolumeM3, 2);
  });
  it("consolidates a high flat reach to one entry and excludes low disconnected waterways", () => {
    const bed = new Float32Array([10, 10, 7, 4, 2, 0, 1]);
    const waterways = new Uint8Array([1, 1, 1, 1, 0, 1, 1]);
    expect(Array.from(selectHeadwaterSources(7, 1, bed, new Uint8Array(7).fill(1), waterways)))
      .toEqual([0, 1, 0, 0, 0, 0, 0]);
  });
  it("does not invent a hilltop for missing waterways or level terrain", () => {
    expect(Array.from(selectHeadwaterSources(3, 1, new Float32Array([3, 2, 1]), new Uint8Array(3).fill(1), new Uint8Array(3)))).toEqual([0, 0, 0]);
    expect(Array.from(selectHeadwaterSources(3, 1, new Float32Array([2, 2, 2]), new Uint8Array(3).fill(1), new Uint8Array(3).fill(1)))).toEqual([0, 0, 0]);
  });
});
