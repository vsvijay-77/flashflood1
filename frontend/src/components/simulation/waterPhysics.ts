/**
 * Local-Inertial Shallow-Water Hydrodynamic Engine
 *
 * Implements 2D hydrodynamic flow from high terrain to low terrain:
 * - Free surface head: terrain bed elevation + water depth
 * - Gravity g = 9.81 m/s²
 * - Topographic slope gradient driving water downhill
 * - Manning roughness friction n
 * - Conservative donor-volume limiting
 * - Boundary polygon enforcement
 * - Adaptive CFL timestepping
 * - Real-time control integration (speed, source rise, pause, reset)
 */

import { predictEdgeDischarge } from "./terrainFlowGnn";

export interface SimulationConfig {
  cols: number;
  rows: number;
  dx: number; // grid cell spacing in meters (approx 8 - 15m)
  dy?: number;
  manningN?: number; // default ~0.035
  gravity?: number; // 9.81
  cflSafety?: number; // 0.6
  maxSubstepsPerFrame?: number;
  flowModel?: "physics" | "gnn";
}

export interface CellEdge {
  from: number;
  to: number;
  isX: boolean; // true if horizontal edge (dx), false if vertical edge (dy)
  discharge: number; // m²/s
}

export interface WaterPhysicsState {
  cols: number;
  rows: number;
  dx: number;
  totalCells: number;
  bed: Float32Array; // terrain elevation (m)
  depth: Float32Array; // water depth (m)
  initialDepth: Float32Array; // initial state for reset
  delta: Float32Array; // net depth change per step
  velocityX: Float32Array; // horizontal velocity m/s
  velocityY: Float32Array; // vertical velocity m/s
  insideMask: Uint8Array; // 1 if inside marked area polygon, 0 otherwise
  isSource: Uint8Array; // 1 if high-terrain source cell
  initialSourceDepth: Float32Array;
  edges: CellEdge[];
  elapsedSeconds: number;
  firstArrivalSeconds: Float64Array; // first ≥0.10 m crossing, -1 if not reached
  peakDepth: Float32Array;
  totalVolumeM3: number;
  injectedVolumeM3: number;
  floodedAreaHectares: number;
  maxDepthM: number;
}

export class WaterPhysicsSimulation {
  private pathMask: Uint8Array;
  private totalOutflow: Float32Array;
  private countX: Uint8Array;
  private countY: Uint8Array;
  public config: Required<SimulationConfig>;
  public state: WaterPhysicsState;

  constructor(
    config: SimulationConfig,
    bedElevations: Float32Array | number[],
    insideMask?: Uint8Array | boolean[],
    sourceMask?: Uint8Array | boolean[],
    initialDepths?: Float32Array | number[],
    pathMask?: Uint8Array,
  ) {
    this.config = {
      cols: config.cols,
      rows: config.rows,
      dx: config.dx,
      dy: config.dy ?? config.dx,
      manningN: config.manningN ?? 0.032,
      gravity: config.gravity ?? 9.81,
      cflSafety: config.cflSafety ?? 0.6,
      maxSubstepsPerFrame: config.maxSubstepsPerFrame ?? 16,
      flowModel: config.flowModel ?? "physics",
    };

    const totalCells = this.config.cols * this.config.rows;
    this.pathMask = pathMask ?? new Uint8Array(totalCells);
    this.totalOutflow = new Float32Array(totalCells);
    this.countX = new Uint8Array(totalCells);
    this.countY = new Uint8Array(totalCells);
    const bed = new Float32Array(totalCells);
    const depth = new Float32Array(totalCells);
    const initialDepth = new Float32Array(totalCells);
    const delta = new Float32Array(totalCells);
    const velocityX = new Float32Array(totalCells);
    const velocityY = new Float32Array(totalCells);
    const inside = new Uint8Array(totalCells);
    const isSource = new Uint8Array(totalCells);
    const initialSourceDepth = new Float32Array(totalCells);

    // Initialize bed elevations and source masks
    for (let i = 0; i < totalCells; i++) {
      bed[i] = bedElevations[i] !== undefined ? bedElevations[i] : 0.0;
      inside[i] = insideMask ? (insideMask[i] ? 1 : 0) : 1;
      const isSrc = sourceMask ? (sourceMask[i] ? 1 : 0) : 0;
      isSource[i] = isSrc;
      const d = inside[i] ? Math.max(0, initialDepths?.[i] ?? (isSrc ? 1.8 : 0)) : 0;
      depth[i] = d;
      initialDepth[i] = d;
      initialSourceDepth[i] = d;
    }

    // Build grid edges across ALL cells inside the marked boundary so water can flow freely downhill
    const edges: CellEdge[] = [];
    const cols = this.config.cols;
    const rows = this.config.rows;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const from = r * cols + c;

        // Right edge (X direction)
        if (c + 1 < cols) {
          const to = r * cols + (c + 1);
          if (inside[from] && inside[to]) {
            edges.push({ from, to, isX: true, discharge: 0 });
          }
        }

        // Bottom edge (Y direction)
        if (r + 1 < rows) {
          const to = (r + 1) * cols + c;
          if (inside[from] && inside[to]) {
            edges.push({ from, to, isX: false, discharge: 0 });
          }
        }
      }
    }

    this.state = {
      cols,
      rows,
      dx: this.config.dx,
      totalCells,
      bed,
      depth,
      initialDepth,
      delta,
      velocityX,
      velocityY,
      insideMask: inside,
      isSource,
      initialSourceDepth,
      edges,
      elapsedSeconds: 0,
      firstArrivalSeconds: Float64Array.from(depth, (d, i) => inside[i] && d >= 0.1 ? 0 : -1),
      peakDepth: new Float32Array(depth),
      totalVolumeM3: 0,
      injectedVolumeM3: 0,
      floodedAreaHectares: 0,
      maxDepthM: 0,
    };

    this.updateMetrics();
  }

  /**
   * Resets simulation: restores initial source water depths and clears momentum/velocities.
   */
  public reset(): void {
    const { totalCells, depth, initialDepth, delta, velocityX, velocityY, edges } = this.state;
    for (let i = 0; i < totalCells; i++) {
      depth[i] = initialDepth[i];
      delta[i] = 0;
      velocityX[i] = 0;
      velocityY[i] = 0;
    }
    for (const edge of edges) {
      edge.discharge = 0;
    }
    this.state.firstArrivalSeconds = Float64Array.from(initialDepth, (d, i) => this.state.insideMask[i] && d >= 0.1 ? 0 : -1);
    this.state.peakDepth.set(initialDepth);
    this.state.elapsedSeconds = 0;
    this.state.injectedVolumeM3 = 0;
    this.updateMetrics();
  }

  /**
   * Injects continuous water inflow at the high-terrain sources based on source rise control.
   */
  public injectSourceRise(sourceRiseM: number, dt: number): void {
    const { totalCells, depth, isSource, initialSourceDepth, dx, insideMask } = this.state;
    const cellArea = dx * this.config.dy;
    const effectiveRise = Math.max(0, sourceRiseM);

    for (let i = 0; i < totalCells; i++) {
      if (insideMask[i] && isSource[i]) {
        const targetDepth = initialSourceDepth[i] + effectiveRise;
        if (depth[i] < targetDepth) {
          const riseRate = Math.min(targetDepth - depth[i], (0.8 + 0.4 * effectiveRise) * dt);
          depth[i] += riseRate;
          this.state.injectedVolumeM3 += riseRate * cellArea;
        }
      }
    }
  }

  /**
   * Advances the shallow-water physics by time dt using adaptive CFL sub-stepping.
   */
  public advance(deltaTime: number, speedMultiplier = 1.0, sourceRiseM = 1.2, rainfallMmH = 0, budgetMs = Infinity): number {
    if (![deltaTime, speedMultiplier, sourceRiseM, rainfallMmH].every(Number.isFinite) || deltaTime <= 0 || speedMultiplier <= 0) return 0;

    const totalSimTime = deltaTime * speedMultiplier;
    if (!Number.isFinite(totalSimTime)) return 0;
    let remainingTime = totalSimTime;
    const startedAt = performance.now();

    let stepCount = 0;
    while (remainingTime > 1e-8) {
      if (stepCount > 0 && Number.isFinite(budgetMs) &&
          (stepCount >= this.config.maxSubstepsPerFrame || performance.now() - startedAt >= budgetMs)) break;
      const dt = Math.min(remainingTime, this.computeCFLTimestep());
      this.stepPhysics(dt);
      if (sourceRiseM > 0) {
        this.injectSourceRise(sourceRiseM, dt);
      }
      if (rainfallMmH > 0) {
        const addedDepth = rainfallMmH / 3_600_000 * dt;
        for (let index = 0; index < this.state.totalCells; index++) if (this.state.insideMask[index]) {
          this.state.depth[index] += addedDepth;
          this.state.injectedVolumeM3 += addedDepth * this.config.dx * this.config.dy;
        }
      }
      remainingTime -= dt;
      this.state.elapsedSeconds += dt;
      for (let i = 0; i < this.state.totalCells; i++) {
        if (!this.state.insideMask[i]) continue;
        const d = this.state.depth[i];
        this.state.peakDepth[i] = Math.max(this.state.peakDepth[i], d);
        if (d >= 0.1 && this.state.firstArrivalSeconds[i] < 0) this.state.firstArrivalSeconds[i] = this.state.elapsedSeconds;
      }
      stepCount++;
    }

    this.computeCellVelocities();
    this.updateMetrics();
    return totalSimTime - remainingTime;
  }

  /**
   * Hydrodynamic step: calculates gravity & pressure driven flow down the terrain elevation gradient.
   */
  public stepPhysics(dt: number): void {
    const { g = 9.81, n = this.config.manningN, dx } = {
      g: this.config.gravity,
      n: this.config.manningN,
      dx: this.config.dx,
    };

    const { bed, depth, delta, edges } = this.state;

    for (const edge of edges) {
      const a = edge.from;
      const b = edge.to;

      const headA = bed[a] + depth[a];
      const headB = bed[b] + depth[b];

      // Effective flow depth over highest bed elevation
      const waterDepth = Math.max(headA, headB) - Math.max(bed[a], bed[b]);

      if (waterDepth <= 0.0001) {
        edge.discharge = 0;
        continue;
      }

      // Water surface gradient from high to low terrain: (headB - headA)
      const distance = edge.isX ? dx : this.config.dy;
      const gradient = (headB - headA) / distance;
      const friction =
        1 +
        (g * dt * n * n * Math.abs(edge.discharge)) /
          Math.pow(Math.max(0.02, waterDepth), 7 / 3);

      // Downhill momentum equation
      if (this.config.flowModel === "gnn") {
        const channel = this.state.isSource[a] || this.state.isSource[b];
        const path = this.pathMask[a] || this.pathMask[b];
        const effectiveRoughness = n * (channel ? 0.7 : path ? 0.85 : 1);
        edge.discharge = -Math.sign(gradient) * predictEdgeDischarge(waterDepth, Math.abs(gradient), effectiveRoughness);
      } else {
        edge.discharge = (edge.discharge - g * waterDepth * dt * gradient) / friction;
      }

      // Conservative donor-volume limiting: cannot export more water than is available
      const donor = edge.discharge >= 0 ? a : b;
      const available = depth[donor] * distance;

      const requested = Math.abs(edge.discharge) * dt;
      const limited = Math.min(requested, available);

      edge.discharge = Math.sign(edge.discharge) * (limited / Math.max(1e-5, dt));
    }

    // Accumulate net depth changes for all cells
    const totalCells = this.state.totalCells;
    const totalOutflow = this.totalOutflow;
    totalOutflow.fill(0);

    for (const edge of edges) {
      const distance = edge.isX ? dx : this.config.dy;
      if (edge.discharge > 0) {
        totalOutflow[edge.from] += edge.discharge * dt / distance;
      } else if (edge.discharge < 0) {
        totalOutflow[edge.to] += -edge.discharge * dt / distance;
      }
    }

    // Scale edges where cell outflow exceeds available volume
    for (const edge of edges) {
      let flow = edge.discharge * dt;
      if (flow > 0) {
        const donor = edge.from;
        const avail = depth[donor];
        if (totalOutflow[donor] > avail && totalOutflow[donor] > 0) {
          flow *= avail / totalOutflow[donor];
        }
      } else if (flow < 0) {
        const donor = edge.to;
        const avail = depth[donor];
        if (totalOutflow[donor] > avail && totalOutflow[donor] > 0) {
          flow *= avail / totalOutflow[donor];
        }
      }

      edge.discharge = flow / dt;
      const distance = edge.isX ? dx : this.config.dy;
      delta[edge.from] -= flow / distance;
      delta[edge.to] += flow / distance;
    }

    // Apply net depth changes to all cells strictly within the marked boundary
    const inside = this.state.insideMask;

    for (let i = 0; i < totalCells; i++) {
      if (inside[i]) {
        depth[i] = Math.max(0, depth[i] + delta[i]);
      } else {
        depth[i] = 0;
      }
      delta[i] = 0;
    }
  }

  /**
   * Calculates maximum stable timestep based on Courant-Friedrichs-Lewy (CFL) condition.
   */
  public computeCFLTimestep(): number {
    const { depth, totalCells } = this.state;
    const { dx, gravity, cflSafety } = this.config;

    let maxWaveSpeed = 0.5;
    for (let i = 0; i < totalCells; i++) {
      if (depth[i] > 0.01) {
        const c = Math.sqrt(gravity * depth[i]) + Math.hypot(this.state.velocityX[i], this.state.velocityY[i]);
        if (c > maxWaveSpeed) maxWaveSpeed = c;
      }
    }

    for (const edge of this.state.edges) {
      const donor = edge.discharge >= 0 ? edge.from : edge.to;
      if (depth[donor] > 0.005) maxWaveSpeed = Math.max(maxWaveSpeed,
        Math.sqrt(gravity * depth[donor]) + Math.abs(edge.discharge) / depth[donor]);
    }
    const cflDt = (cflSafety * Math.min(dx, this.config.dy)) / maxWaveSpeed;
    return Math.min(0.20, cflDt);
  }

  /**
   * Reconstructs cell-center velocity vectors from staggered edge discharges.
   */
  private computeCellVelocities(): void {
    const { cols, rows, depth, velocityX, velocityY, edges } = this.state;

    velocityX.fill(0);
    velocityY.fill(0);
    const countX = this.countX, countY = this.countY;
    countX.fill(0); countY.fill(0);

    for (const edge of edges) {
      const a = edge.from;
      const b = edge.to;
      const avgDepth = Math.max(0.02, 0.5 * (depth[a] + depth[b]));
      const v = edge.discharge / avgDepth;

      if (edge.isX) {
        velocityX[a] += v;
        velocityX[b] += v;
        countX[a]++;
        countX[b]++;
      } else {
        velocityY[a] += v;
        velocityY[b] += v;
        countY[a]++;
        countY[b]++;
      }
    }

    for (let i = 0; i < this.state.totalCells; i++) {
      if (countX[i] > 0) velocityX[i] /= countX[i];
      if (countY[i] > 0) velocityY[i] /= countY[i];
    }
  }

  /**
   * Updates hydrodynamic telemetry metrics (flooded area in hectares, max depth in meters).
   */
  private updateMetrics(): void {
    const { totalCells, depth, dx, insideMask } = this.state;
    const cellAreaM2 = dx * this.config.dy;
    let floodedCount = 0;
    let maxD = 0;
    let totalVol = 0;

    for (let i = 0; i < totalCells; i++) {
      if (insideMask[i]) {
        if (depth[i] > 0.05) floodedCount++;
        totalVol += depth[i] * cellAreaM2;
        if (depth[i] > maxD) maxD = depth[i];
      }
    }

    this.state.floodedAreaHectares = (floodedCount * cellAreaM2) / 10000;
    this.state.maxDepthM = maxD;
    this.state.totalVolumeM3 = totalVol;
  }
}
