import { describe, expect, it } from "vitest";
import { defaultFlashFloodParameters, getFloodForcing, runoffRainfall } from "./flashFloodParameters";
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

describe("shared gradual flood forcing", () => {
  it("starts at zero even with maximum controls and grows from a small first second", () => {
    const parameters = { ...defaultFlashFloodParameters, floodIntensity: 200 };
    expect(getFloodForcing(300, 10, parameters, 0)).toEqual({ sourceRiseM: 0, rainfallMmH: 0 });
    const start = getFloodForcing(300, 10, parameters, 1);
    const growing = getFloodForcing(300, 10, parameters, 30);
    expect(start.sourceRiseM).toBeLessThan(0.02);
    expect(start.rainfallMmH).toBeLessThan(1);
    expect(growing.sourceRiseM).toBeGreaterThan(start.sourceRiseM);
    expect(growing.rainfallMmH).toBeGreaterThan(start.rainfallMmH);
  });

  it("uses selected peak controls and applies intensity once without a synthetic extreme storm", () => {
    const parameters = { ...defaultFlashFloodParameters, soilSaturation: 100, floodIntensity: 200 };
    expect(getFloodForcing(300, 10, parameters, 90)).toEqual({ sourceRiseM: 20, rainfallMmH: 600 });
    expect(getFloodForcing(300, 0, parameters, 90).sourceRiseM).toBe(0);
    expect(getFloodForcing(300, 10, { ...parameters, floodIntensity: 0 }, 90))
      .toEqual({ sourceRiseM: 0, rainfallMmH: 0 });
    expect(getFloodForcing(300, 10, { ...parameters, windSpeedKmh: 100 }, 90))
      .toEqual(getFloodForcing(300, 10, parameters, 90));
  });

  it("respects short storm durations and stops adding water at the selected end", () => {
    const parameters = { ...defaultFlashFloodParameters, durationMinutes: 1 };
    expect(getFloodForcing(100, 1, parameters, 30).sourceRiseM).toBe(1);
    expect(getFloodForcing(100, 1, parameters, 59).sourceRiseM).toBeLessThan(0.02);
    expect(getFloodForcing(100, 1, parameters, 60)).toEqual({ sourceRiseM: 0, rainfallMmH: 0 });
    expect(getFloodForcing(100, 1, parameters, 120)).toEqual({ sourceRiseM: 0, rainfallMmH: 0 });
  });

  it("runs one simulated second at 1x and begins with only a shallow source thread", () => {
    const simulation = new WaterPhysicsSimulation({ cols: 5, rows: 1, dx: 10 }, [4, 3, 2, 1, 0],
      undefined, [true, false, false, false, false]);
    const parameters = { ...defaultFlashFloodParameters, floodIntensity: 200 };
    const forcing = (elapsed: number) => getFloodForcing(300, 10, parameters, elapsed);
    for (let frame = 0; frame < 60; frame++) simulation.advanceWithForcing(1 / 60, 1, forcing);
    expect(simulation.state.elapsedSeconds).toBeCloseTo(1, 8);
    expect(simulation.state.maxDepthM).toBeGreaterThan(0);
    expect(simulation.state.maxDepthM).toBeLessThan(0.02);
    expect(simulation.state.floodedAreaHectares).toBe(0);
    expect(simulation.state.firstArrivalSeconds[4]).toBe(-1);
    expect(simulation.state.totalVolumeM3).toBeCloseTo(simulation.state.injectedVolumeM3, 5);
    simulation.reset();
    expect(simulation.state.totalVolumeM3).toBe(0);
    expect(simulation.state.initialSourceDepth[0]).toBe(0);
  });

  it("grows a wider flood with stronger parameters through hydraulic flow", () => {
    const simulate = (intensity: number) => {
      const simulation = new WaterPhysicsSimulation({ cols: 7, rows: 1, dx: 5 }, [0, 0, 0, 0, 0, 0, 0],
        undefined, [false, false, false, true, false, false, false]);
      const parameters = { ...defaultFlashFloodParameters, floodIntensity: intensity };
      simulation.advanceWithForcing(30, 1, elapsed => getFloodForcing(150, 1, parameters, elapsed));
      return simulation;
    };
    const mild = simulate(20), strong = simulate(150);
    expect(strong.state.injectedVolumeM3).toBeGreaterThan(mild.state.injectedVolumeM3);
    expect(strong.state.depth[0]).toBeGreaterThan(mild.state.depth[0]);
    expect(strong.state.floodedAreaHectares).toBeGreaterThan(mild.state.floodedAreaHectares);
  });
});
