import { describe, expect, it } from "vitest";
import { predictEdgeDischarge, terrainFlowGnnMetadata } from "./terrainFlowGnn";
import { WaterPhysicsSimulation } from "./waterPhysics";
import { defaultFlashFloodParameters, runoffRainfall } from "./flashFloodParameters";
import { createFlowGraphOverlay } from "./flowGraphOverlay";

describe("synthetic-trained terrain graph flow", () => {
  it("ships trained weights with held-out synthetic validation", () => {
    expect(terrainFlowGnnMetadata.trainingGraphs).toBe(1792);
    expect(terrainFlowGnnMetadata.validationGraphs).toBe(256);
    expect(terrainFlowGnnMetadata.validationMeanRelativeError).toBeLessThan(0.005);
    for (const depth of [0.0002, 0.01, 0.2, 1, 5]) for (const slope of [0.001, 0.1, 1]) {
      const reference = Math.pow(depth, 5 / 3) * Math.sqrt(slope) / 0.035;
      expect(predictEdgeDischarge(depth, slope, 0.035) / reference).toBeCloseTo(1, 3);
    }
  });

  it("responds monotonically to depth, slope and roughness", () => {
    const baseline = predictEdgeDischarge(0.1, 0.01, 0.04);
    expect(predictEdgeDischarge(0.2, 0.01, 0.04)).toBeGreaterThan(baseline);
    expect(predictEdgeDischarge(0.1, 0.02, 0.04)).toBeGreaterThan(baseline);
    expect(predictEdgeDischarge(0.1, 0.01, 0.08)).toBeLessThan(baseline);
    expect(predictEdgeDischarge(0, 0.01, 0.04)).toBe(0);
    expect(predictEdgeDischarge(0.1, 0, 0.04)).toBe(0);
  });

  it("produces more downstream flooding with higher rain and conserves water", () => {
    const simulate = (rain: number) => {
      const simulation = new WaterPhysicsSimulation({ cols: 5, rows: 1, dx: 10, flowModel: "gnn" }, [4, 3, 2, 1, 0]);
      simulation.advance(600, 1, 0, runoffRainfall(rain, defaultFlashFloodParameters, 0));
      expect(simulation.state.totalVolumeM3).toBeCloseTo(simulation.state.injectedVolumeM3, 3);
      return simulation.state;
    };
    const low = simulate(10), high = simulate(200);
    expect(high.totalVolumeM3).toBeGreaterThan(low.totalVolumeM3 * 10);
    expect(high.depth[4]).toBeGreaterThan(low.depth[4] * 5);
    expect(high.depth[4]).toBeGreaterThan(high.depth[0]);
    expect(high.floodedAreaHectares).toBeGreaterThan(low.floodedAreaHectares);
  });

  it("starts dry even on mapped streams with zero rain and river rise", () => {
    const simulation = new WaterPhysicsSimulation({ cols: 3, rows: 1, dx: 10, flowModel: "gnn" }, [2, 1, 0], undefined, new Uint8Array([1, 1, 1]), new Float32Array(3));
    simulation.advance(60, 1, 0, 0);
    expect(simulation.state.totalVolumeM3).toBe(0);
  });

  it("does not send water over a dry uphill barrier", () => {
    const simulation = new WaterPhysicsSimulation({ cols: 3, rows: 1, dx: 10, flowModel: "gnn" }, [0, 2, 0], undefined, undefined, [0.2, 0, 0]);
    simulation.advance(30, 1, 0, 0);
    expect(simulation.state.depth[2]).toBe(0);
    expect(simulation.state.totalVolumeM3).toBeCloseTo(20);
  });

  it("uses mapped paths as a roughness feature, without adding water", () => {
    const terrain = new WaterPhysicsSimulation({ cols: 2, rows: 1, dx: 10, flowModel: "gnn" }, [1, 0], undefined, undefined, [0.1, 0]);
    const path = new WaterPhysicsSimulation({ cols: 2, rows: 1, dx: 10, flowModel: "gnn" }, [1, 0], undefined, undefined, [0.1, 0], new Uint8Array([1, 1]));
    terrain.stepPhysics(0.01); path.stepPhysics(0.01);
    expect(path.state.depth[1]).toBeGreaterThan(terrain.state.depth[1]);
    expect(path.state.depth[0] + path.state.depth[1]).toBeCloseTo(0.1);
  });

  it("updates runoff immediately when rainfall changes and keeps existing water", () => {
    const simulation = new WaterPhysicsSimulation({ cols: 2, rows: 1, dx: 10, flowModel: "gnn" }, [1, 0]);
    simulation.advance(60, 1, 0, 10);
    const lowAdded = simulation.state.injectedVolumeM3;
    simulation.advance(60, 1, 0, 200);
    expect(simulation.state.injectedVolumeM3 - lowAdded).toBeCloseTo(lowAdded * 20, 4);
    const volume = simulation.state.totalVolumeM3;
    simulation.advance(60, 1, 0, 0);
    expect(simulation.state.totalVolumeM3).toBeCloseTo(volume, 4);
  });

  it("draws directional graph connections without modifying simulation state", () => {
    const simulation = new WaterPhysicsSimulation({ cols: 2, rows: 1, dx: 10, flowModel: "gnn" }, [2, 0]);
    const overlay = createFlowGraphOverlay(simulation.state, new Float32Array([0, 2, 0, 10, 0, 0]), new Uint8Array(2));
    expect(overlay.displayedEdges).toBe(1);
    expect(overlay.group.children).toHaveLength(2);
    overlay.group.visible = false;
    overlay.update(simulation.state);
    expect(simulation.state.totalVolumeM3).toBe(0);
    overlay.dispose();
  });
});
