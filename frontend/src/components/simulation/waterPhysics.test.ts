import { describe, it, expect } from "vitest";
import { WaterPhysicsSimulation } from "./waterPhysics";

describe("WaterPhysicsSimulation Engine", () => {
  // 1. Downhill Flow: Water placed on an inclined plane flows to lower elevation cells
  it("simulates downhill flow correctly according to terrain slope", () => {
    const cols = 5;
    const rows = 1;
    const dx = 10;
    // Slope descending from left (elev 10) to right (elev 0)
    const bed = [10, 7.5, 5, 2.5, 0];
    const initialDepths = [2, 0, 0, 0, 0];

    const sim = new WaterPhysicsSimulation(
      { cols, rows, dx, manningN: 0.035 },
      bed,
      undefined,
      undefined,
      initialDepths
    );

    // Advance 5 seconds
    sim.advance(5.0, 1.0);

    // Water should have moved from cell 0 downhill towards cells 1, 2, 3...
    expect(sim.state.depth[0]).toBeLessThan(2.0);
    expect(sim.state.depth[1] + sim.state.depth[2] + sim.state.depth[3]).toBeGreaterThan(0.1);
  });

  // 2. Barrier Overtopping: Water cannot cross dry barriers until head overtops them
  it("prevents barrier crossing until water surface overtops the barrier height", () => {
    const cols = 3;
    const rows = 1;
    const dx = 10;
    // Cell 0: valley (0m), Cell 1: barrier ridge (5m), Cell 2: valley (0m)
    const bed = [0, 5, 0];

    // Case A: Initial water head in cell 0 is 3m (bed 0 + depth 3 = 3m < barrier 5m)
    const simBlocked = new WaterPhysicsSimulation(
      { cols, rows, dx },
      bed,
      undefined,
      undefined,
      [3, 0, 0]
    );

    simBlocked.advance(5.0, 1.0);
    // Water must NOT cross the barrier to cell 2
    expect(simBlocked.state.depth[2]).toBe(0);
    expect(simBlocked.state.depth[1]).toBe(0);

    // Case B: Water head in cell 0 overtops barrier (bed 0 + depth 7 = 7m > barrier 5m)
    const simOvertopping = new WaterPhysicsSimulation(
      { cols, rows, dx },
      bed,
      undefined,
      undefined,
      [7, 0, 0]
    );

    simOvertopping.advance(5.0, 1.0);
    // Water overtops barrier and enters cell 1 and cell 2
    expect(simOvertopping.state.depth[1]).toBeGreaterThan(0);
    expect(simOvertopping.state.depth[2]).toBeGreaterThan(0);
  });

  // 3. Lake-at-Rest Balance: Flat water surface maintains hydrostatic equilibrium
  it("preserves lake-at-rest hydrostatic balance with zero false discharge", () => {
    const cols = 5;
    const rows = 1;
    const dx = 10;
    // Variable bed topography
    const bed = [2, 1, 0.5, 1.5, 2.5];
    // Water level constant at head = 4.0m across all cells
    const targetHead = 4.0;
    const initialDepths = bed.map((b) => targetHead - b);

    const sim = new WaterPhysicsSimulation(
      { cols, rows, dx },
      bed,
      undefined,
      undefined,
      initialDepths
    );

    const initialTotalVolume = sim.state.totalVolumeM3;

    // Advance 10 seconds
    sim.advance(10.0, 1.0);

    // Depth in each cell must remain virtually unchanged
    for (let i = 0; i < cols; i++) {
      expect(Math.abs(sim.state.depth[i] - initialDepths[i])).toBeLessThan(0.001);
    }
    expect(Math.abs(sim.state.totalVolumeM3 - initialTotalVolume)).toBeLessThan(0.01);
  });

  // 4. Manning Friction: Higher roughness reduces flow rate and discharge
  it("retards flow velocity with higher Manning roughness n", () => {
    const cols = 4;
    const rows = 1;
    const dx = 10;
    const bed = [6, 4, 2, 0];
    const initialDepths = [2, 0, 0, 0];

    // Smooth channel (n = 0.015)
    const simSmooth = new WaterPhysicsSimulation(
      { cols, rows, dx, manningN: 0.015 },
      bed,
      undefined,
      undefined,
      initialDepths
    );
    // Rough channel (n = 0.08)
    const simRough = new WaterPhysicsSimulation(
      { cols, rows, dx, manningN: 0.08 },
      bed,
      undefined,
      undefined,
      initialDepths
    );

    simSmooth.advance(2.0, 1.0);
    simRough.advance(2.0, 1.0);

    // Smooth channel should transport more water downstream to cell 3 than rough channel
    const smoothDownstream = simSmooth.state.depth[2] + simSmooth.state.depth[3];
    const roughDownstream = simRough.state.depth[2] + simRough.state.depth[3];
    expect(smoothDownstream).toBeGreaterThan(roughDownstream);
  });

  // 5. Momentum: Flow retains momentum onto flat sections
  it("retains inertial momentum across flat ground", () => {
    const cols = 5;
    const rows = 1;
    const dx = 10;
    // Slope on cells 0, 1, then flat on cells 2, 3, 4
    const bed = [5, 2, 0, 0, 0];
    const initialDepths = [3, 0, 0, 0, 0];

    const sim = new WaterPhysicsSimulation(
      { cols, rows, dx },
      bed,
      undefined,
      undefined,
      initialDepths
    );

    // Advance
    sim.advance(4.0, 1.0);

    // Momentum carries water forward across flat cells
    expect(sim.state.depth[3]).toBeGreaterThan(0.01);
  });

  // 6. Water Conservation: Total water volume is conserved in closed domain
  it("strictly conserves total water volume to high precision", () => {
    const cols = 6;
    const rows = 6;
    const dx = 10;
    // Bowl-shaped terrain
    const bed: number[] = [];
    const initialDepths: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const distFromCenter = Math.hypot(r - 2.5, c - 2.5);
        bed.push(distFromCenter * 2);
        // Place initial slug of water near top-left
        initialDepths.push(r === 1 && c === 1 ? 5.0 : 0.0);
      }
    }

    const sim = new WaterPhysicsSimulation(
      { cols, rows, dx },
      bed,
      undefined,
      undefined,
      initialDepths
    );

    const initialVolume = sim.state.totalVolumeM3;
    expect(initialVolume).toBe(5.0 * dx * dx);

    // Simulate 20 seconds of sloshing
    for (let s = 0; s < 10; s++) {
      sim.advance(2.0, 1.0);
    }

    const finalVolume = sim.state.totalVolumeM3;
    const relativeError = Math.abs(finalVolume - initialVolume) / initialVolume;
    expect(relativeError).toBeLessThan(1e-5);
  });

  // 7. Dry/Wet Boundaries: No negative depths and proper dry cell handling
  it("maintains non-negative depths across dry/wet boundaries", () => {
    const cols = 4;
    const rows = 4;
    const dx = 10;
    const bed = new Array(16).fill(10);
    bed[5] = 2; // local depression
    const initialDepths = new Array(16).fill(0);
    initialDepths[5] = 4;

    const sim = new WaterPhysicsSimulation(
      { cols, rows, dx },
      bed,
      undefined,
      undefined,
      initialDepths
    );

    sim.advance(5.0, 1.0);

    for (let i = 0; i < 16; i++) {
      expect(sim.state.depth[i]).toBeGreaterThanOrEqual(0);
    }
  });

  // 8. Polygon Holes: Water does not penetrate masked hole cells
  it("prevents water from entering polygon hole cells", () => {
    const cols = 3;
    const rows = 3;
    const dx = 10;
    const bed = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const initialDepths = [3, 0, 0, 0, 0, 0, 0, 0, 0];

    // Center cell (index 4) is a polygon hole (masked out = false)
    const insideMask = [
      true, true, true,
      true, false, true,
      true, true, true,
    ];

    const sim = new WaterPhysicsSimulation(
      { cols, rows, dx },
      bed,
      insideMask,
      undefined,
      initialDepths
    );

    sim.advance(5.0, 1.0);

    // Center hole cell must have zero depth
    expect(sim.state.depth[4]).toBe(0);
    // Outer cells around it receive flow
    expect(sim.state.depth[1] + sim.state.depth[3]).toBeGreaterThan(0.1);
  });

  // 9. Reset Behavior: Clears momentum and restores initial state
  it("resets water depths and clears momentum on reset()", () => {
    const cols = 4;
    const rows = 1;
    const dx = 10;
    const bed = [5, 3, 1, 0];
    const initialDepths = [2, 0, 0, 0];

    const sim = new WaterPhysicsSimulation(
      { cols, rows, dx },
      bed,
      undefined,
      undefined,
      initialDepths
    );

    sim.advance(4.0, 1.0);
    expect(sim.state.depth[0]).toBeLessThan(2.0);
    expect(sim.state.elapsedSeconds).toBeGreaterThan(0);

    sim.reset();

    // After reset: depths restored and elapsed time zeroed
    expect(sim.state.depth[0]).toBe(2.0);
    expect(sim.state.depth[1]).toBe(0.0);
    expect(sim.state.depth[2]).toBe(0.0);
    expect(sim.state.depth[3]).toBe(0.0);
    expect(sim.state.elapsedSeconds).toBe(0);
    for (const edge of sim.state.edges) {
      expect(edge.discharge).toBe(0);
    }
  });
});

describe("water volume regression", () => {
  it("keeps explicit dry sources dry and includes shallow water in volume", () => {
    const sim = new WaterPhysicsSimulation({ cols: 2, rows: 1, dx: 10 }, [0, 0], undefined,
      new Uint8Array([1, 0]), [0, 0.01]);
    expect(Array.from(sim.state.depth)).toEqual([0, Math.fround(0.01)]);
    expect(sim.state.totalVolumeM3).toBe(1);
    expect(sim.state.floodedAreaHectares).toBe(0);
  });
  it("conserves water when one wet cell feeds four dry neighbours", () => {
    const sim = new WaterPhysicsSimulation({ cols: 3, rows: 3, dx: 1 }, new Float32Array(9),
      undefined, undefined, [0, 0, 0, 0, 2, 0, 0, 0, 0]);
    for (let i = 0; i < 60; i++) sim.advance(1 / 30, 1, 0);
    expect(Array.from(sim.state.depth).reduce((a, b) => a + b, 0)).toBeCloseTo(2, 5);
    expect(Array.from(sim.state.depth).every(d => Number.isFinite(d) && d >= 0)).toBe(true);
    sim.reset();
    expect(sim.state.depth[4]).toBe(2);
    expect(sim.state.edges.every(e => e.discharge === 0)).toBe(true);
  });
});
