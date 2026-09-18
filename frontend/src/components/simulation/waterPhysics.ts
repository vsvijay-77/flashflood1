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
import { precomputeHydrology, type HydrologicalPrecomputedGrid } from "./hydrologyPrecompute";

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
  isDiagonal?: boolean;
  distance: number;
  directionX: number;
  directionY: number;
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
  public hydrology: HydrologicalPrecomputedGrid;

  constructor(
    config: SimulationConfig,
    bedElevations: Float32Array | number[],
    insideMask?: Uint8Array | boolean[],
    sourceMask?: Uint8Array | boolean[],
    initialDepths?: Float32Array | number[],
    pathMask?: Uint8Array,
    hydrology?: HydrologicalPrecomputedGrid,
  ) {
    this.config = {
      cols: config.cols,
      rows: config.rows,
      dx: config.dx,
      dy: config.dy ?? config.dx,
      manningN: config.manningN ?? 0.032,
      gravity: config.gravity ?? 9.81,
      cflSafety: config.cflSafety ?? 0.6,
      // 60x playback needs roughly nine stable 0.2 s steps per rendered frame.
      maxSubstepsPerFrame: config.maxSubstepsPerFrame ?? 12,
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
      // When initialDepths is provided, use it directly. The visual river network
      // is drawn from its source vectors; this hydraulic layer starts dry.
      const d = inside[i] ? Math.max(0, initialDepths?.[i] ?? 0) : 0;
      depth[i] = d;
      initialDepth[i] = d;
      // initialSourceDepth is the stable level used by injectSourceRise().
      // Vector river rendering handles the resting water appearance.
      initialSourceDepth[i] = d > 0 ? d : (isSrc && inside[i] ? 0.025 : 0);
    }

    this.hydrology = hydrology ?? precomputeHydrology({
      cols: this.config.cols,
      rows: this.config.rows,
      dx: this.config.dx,
      dy: this.config.dy,
      bedElevations: bed,
      insideMask: inside,
      waterBodyMask: isSource,
      pathMask: this.pathMask,
    });

    // Build all eight neighbor connections. The terrain model already uses D8
    // drainage, so the live solver must do the same to avoid broken diagonal
    // mountain streams and disconnected flood fronts.
    const edges: CellEdge[] = [];
    const cols = this.config.cols;
    const rows = this.config.rows;
    const diagonalDistance = Math.hypot(this.config.dx, this.config.dy);
    const diagonalX = this.config.dx / diagonalDistance;
    const diagonalY = this.config.dy / diagonalDistance;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const from = r * cols + c;

        // Right edge (X direction)
        if (c + 1 < cols) {
          const to = r * cols + (c + 1);
          if (inside[from] && inside[to]) {
            edges.push({ from, to, isX: true, distance: this.config.dx, directionX: 1, directionY: 0, discharge: 0 });
          }
        }

        // Bottom edge (Y direction)
        if (r + 1 < rows) {
          const to = (r + 1) * cols + c;
          if (inside[from] && inside[to]) {
            edges.push({ from, to, isX: false, distance: this.config.dy, directionX: 0, directionY: 1, discharge: 0 });
          }
        }

        if (r + 1 < rows && c + 1 < cols) {
          const to = (r + 1) * cols + (c + 1);
          if (inside[from] && inside[to]) {
            edges.push({ from, to, isX: false, isDiagonal: true, distance: diagonalDistance, directionX: diagonalX, directionY: diagonalY, discharge: 0 });
          }
        }

        if (r + 1 < rows && c > 0) {
          const to = (r + 1) * cols + (c - 1);
          if (inside[from] && inside[to]) {
            edges.push({ from, to, isX: false, isDiagonal: true, distance: diagonalDistance, directionX: -diagonalX, directionY: diagonalY, discharge: 0 });
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

    if (effectiveRise <= 0) {
      for (let i = 0; i < totalCells; i++) {
        if (!insideMask[i]) continue;
        if (isSource[i] && depth[i] > initialSourceDepth[i]) {
          const drainRate = Math.min(depth[i] - initialSourceDepth[i], 0.20 * dt);
          depth[i] -= drainRate;
        }
      }
      return;
    }

    for (let i = 0; i < totalCells; i++) {
      if (!insideMask[i]) continue;
      // Inflow enters at the mapped river/stream channels
      if (isSource[i]) {
        const targetDepth = initialSourceDepth[i] + effectiveRise;
        if (depth[i] < targetDepth) {
          // A restrained inflow lets the flood front emerge from waterways over
          // Gradual rise rate: river water swells smoothly and overtops banks m² by m²
          const riseRate = Math.min(targetDepth - depth[i], (0.08 + 0.04 * Math.min(effectiveRise, 4.0)) * dt);
          depth[i] += riseRate;
          this.state.injectedVolumeM3 += riseRate * cellArea;
        } else if (depth[i] > targetDepth) {
          const drainRate = Math.min(depth[i] - targetDepth, 0.05 * dt);
          depth[i] -= drainRate;
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

    // Compute CFL timestep once per frame (O(1) calculation)
    const cflDt = this.computeCFLTimestep();

    let stepCount = 0;
    while (remainingTime > 1e-8) {
      if (stepCount > 0 && Number.isFinite(budgetMs) &&
          (stepCount >= this.config.maxSubstepsPerFrame || performance.now() - startedAt >= budgetMs)) break;
      const dt = Math.min(remainingTime, cflDt);
      this.stepPhysics(dt);
      if (sourceRiseM >= 0) {
        this.injectSourceRise(sourceRiseM, dt);
      }
      if (rainfallMmH > 0) {
        const addedDepth = (rainfallMmH / 3_600_000) * dt;
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
      const distance = edge.distance;
      const gradient = (headB - headA) / distance;

      // Scale Manning roughness by stream hierarchy:
      // Major river channels: lower friction (factor 2.0-3.0, smooth bed)
      // Tributary streams: moderate friction (factor 1.4-2.0)
      // Overland terrain: higher friction (factor 0.7-1.0, vegetated)
      const riverFactorA = this.hydrology ? this.hydrology.riverFactor[a] : 1.0;
      const riverFactorB = this.hydrology ? this.hydrology.riverFactor[b] : 1.0;
      const avgRiverFactor = 0.5 * (riverFactorA + riverFactorB);
      const effectiveN = n / Math.max(0.4, avgRiverFactor);

      const friction =
        1 +
        (g * dt * effectiveN * effectiveN * Math.abs(edge.discharge)) /
          Math.pow(Math.max(0.02, waterDepth), 7 / 3);

      // Downhill momentum equation
      if (this.config.flowModel === "gnn") {
        const channel = this.state.isSource[a] || this.state.isSource[b];
        const path = this.pathMask[a] || this.pathMask[b];
        const effectiveRoughness = effectiveN * (channel ? 0.7 : path ? 0.85 : 1);
        edge.discharge = -Math.sign(gradient) * predictEdgeDischarge(waterDepth, Math.abs(gradient), effectiveRoughness);
      } else {
        edge.discharge = (edge.discharge - g * waterDepth * dt * gradient) / friction;
      }

      // Conservative donor-volume limiting: cannot export more water than is available
      const donor = edge.discharge >= 0 ? a : b;
      const available = depth[donor] * distance;

      const requested = Math.abs(edge.discharge) * dt;
      // Over dry land margins, limit transfer rate so expansion creeps m² by m² visibly
      const shallowMargin = Math.min(depth[a], depth[b]);
      const wettingDepth = Math.max(depth[a], depth[b]);
      const wettingProgress = Math.min(1, Math.max(0, (wettingDepth - 0.01) / 0.11));
      const wettingFactor = wettingProgress * wettingProgress * (3 - 2 * wettingProgress);
      const isOverlandExpansion = shallowMargin < 0.08;
      const transferLimit = isOverlandExpansion
        ? available * Math.min(1.0, (0.16 + 0.48 * wettingFactor) * dt)
        : available;
      const limited = Math.min(requested, transferLimit);

      edge.discharge = Math.sign(edge.discharge) * (limited / Math.max(1e-5, dt));
    }

    // Accumulate net depth changes for all cells
    const totalCells = this.state.totalCells;
    const totalOutflow = this.totalOutflow;
    totalOutflow.fill(0);

    for (const edge of edges) {
      const distance = edge.distance;
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
      const distance = edge.distance;
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

    this.bridgeWettingGaps();
  }

  /**
   * Smooths isolated dry cells between nearby wet valley cells. The bridge is
   * conservative and refuses to cross a terrain lip, so it removes rendering
   * gaps without turning separate basins into one continuous lake.
   */
  private bridgeWettingGaps(): void {
    const { cols, rows, bed, depth, insideMask } = this.state;
    const adjustments = new Float32Array(this.state.totalCells);
    const neighbourOffsets = [
      [-1, -1], [0, -1], [1, -1],
      [-1, 0],           [1, 0],
      [-1, 1],  [0, 1],  [1, 1],
    ];

    for (let row = 1; row < rows - 1; row++) {
      for (let column = 1; column < cols - 1; column++) {
        const index = row * cols + column;
        if (!insideMask[index] || depth[index] >= 0.014) continue;

        const contributors: number[] = [];
        let depthSum = 0;
        for (const [columnOffset, rowOffset] of neighbourOffsets) {
          const neighbour = (row + rowOffset) * cols + column + columnOffset;
          if (!insideMask[neighbour] || depth[neighbour] < 0.028) continue;
          // Do not bridge across a bank or ridge that is materially higher
          // than the adjacent wet water surface.
          if (bed[index] > bed[neighbour] + depth[neighbour] + 0.12) continue;
          contributors.push(neighbour);
          depthSum += depth[neighbour];
        }

        if (contributors.length < 2) continue;
        const targetDepth = Math.min(0.045, (depthSum / contributors.length) * 0.32);
        const required = targetDepth - depth[index];
        if (required <= 1e-5) continue;

        let available = 0;
        for (const neighbour of contributors) available += Math.max(0, depth[neighbour] - 0.018);
        if (available <= 1e-5) continue;

        const transferred = Math.min(required, available * 0.20);
        adjustments[index] += transferred;
        for (const neighbour of contributors) {
          const share = Math.max(0, depth[neighbour] - 0.018) / available;
          adjustments[neighbour] -= transferred * share;
        }
      }
    }

    for (let i = 0; i < depth.length; i++) {
      if (adjustments[i] !== 0) depth[i] = Math.max(0, depth[i] + adjustments[i]);
    }
  }

  /**
   * Calculates maximum stable timestep based on Courant-Friedrichs-Lewy (CFL) condition.
   */
  public computeCFLTimestep(): number {
    const { depth, edges, totalCells } = this.state;
    const { dx, gravity, cflSafety } = this.config;

    let maxWaveSpeed = 0.5;
    for (let i = 0; i < totalCells; i++) {
      if (depth[i] > 0.01) {
        const c = Math.sqrt(gravity * depth[i]) + Math.hypot(this.state.velocityX[i], this.state.velocityY[i]);
        if (c > maxWaveSpeed) maxWaveSpeed = c;
      }
    }

    for (let e = 0; e < edges.length; e++) {
      const edge = edges[e];
      const donor = edge.discharge >= 0 ? edge.from : edge.to;
      const d = depth[donor];
      if (d > 0.005) {
        const edgeSpeed = Math.sqrt(gravity * d) + Math.abs(edge.discharge) / d;
        if (edgeSpeed > maxWaveSpeed) maxWaveSpeed = edgeSpeed;
      }
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

      velocityX[a] += v * edge.directionX;
      velocityX[b] += v * edge.directionX;
      velocityY[a] += v * edge.directionY;
      velocityY[b] += v * edge.directionY;
      countX[a]++;
      countX[b]++;
      countY[a]++;
      countY[b]++;
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
