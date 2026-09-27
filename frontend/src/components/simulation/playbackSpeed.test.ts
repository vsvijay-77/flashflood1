import { describe, expect, it } from "vitest";
import { clampFloodPlaybackSpeed, floodPlaybackRate, floodPlaybackSpeeds } from "./playbackSpeed";
import { WaterPhysicsSimulation } from "./waterPhysics";

describe("retuned flood playback", () => {
  it("preserves starting speed at 2× and increases the 10× preset pace to 120×", () => {
    expect(floodPlaybackSpeeds.map(floodPlaybackRate)).toEqual([0.5, 2, 6, 12, 30, 120]);
    expect(floodPlaybackSpeeds.at(-1)).toBe(10);
    for (const speed of floodPlaybackSpeeds) {
      const sim = new WaterPhysicsSimulation({ cols: 1, rows: 1, dx: 10 }, [0]);
      sim.advance(1, floodPlaybackRate(speed), 0);
      expect(sim.state.elapsedSeconds).toBeCloseTo(floodPlaybackRate(speed), 6);
    }
  });
  it("bounds external speed requests and interpolates intermediate settings", () => {
    expect(clampFloodPlaybackSpeed(60)).toBe(10);
    expect(floodPlaybackRate(60)).toBe(120);
    expect(floodPlaybackRate(-1)).toBe(0.5);
    expect(floodPlaybackRate(NaN)).toBe(2);
    expect(floodPlaybackRate(4)).toBe(21);
  });
});
