import { describe, expect, it } from "vitest";
import { defaultFlashFloodParameters, runoffRainfall } from "./flashFloodParameters";
import { WaterPhysicsSimulation } from "./waterPhysics";

describe("flash flood rainfall controls", () => {
  it("produces more runoff as soil saturation increases", () => {
    const dry = runoffRainfall(100, { ...defaultFlashFloodParameters, soilSaturation: 0, infiltrationMmH: 30 }, 0);
    const wet = runoffRainfall(100, { ...defaultFlashFloodParameters, soilSaturation: 100, infiltrationMmH: 30 }, 0);
    expect(dry).toBe(70);
    expect(wet).toBe(100);
  });

  it("ends rainfall at the configured duration without removing existing floodwater", () => {
    const parameters = { ...defaultFlashFloodParameters, durationMinutes: 1 };
    expect(runoffRainfall(100, parameters, 59)).toBeGreaterThan(0);
    expect(runoffRainfall(100, parameters, 60)).toBe(0);
    const simulation = new WaterPhysicsSimulation({ cols: 3, rows: 1, dx: 10 }, [2, 1, 0], undefined, undefined, [0.2, 0, 0]);
    simulation.advance(10, 1, 0, runoffRainfall(100, parameters, 60));
    expect(simulation.state.depth[2]).toBeGreaterThan(0);
    expect(simulation.state.totalVolumeM3).toBeCloseTo(20);
  });

  it("routes rain from a mountain slope to the lower village without requiring a river source", () => {
    const simulation = new WaterPhysicsSimulation({ cols: 5, rows: 1, dx: 10 }, [8, 6, 4, 2, 0]);
    simulation.advance(300, 1, 0, 120);
    expect(simulation.state.depth[4]).toBeGreaterThan(simulation.state.depth[0] * 2);
    expect(simulation.state.injectedVolumeM3).toBeCloseTo(5, 4);
    expect(simulation.state.velocityX[2]).toBeGreaterThan(0);
  });
});
