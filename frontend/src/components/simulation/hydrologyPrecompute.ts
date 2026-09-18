/**
 * Hydrological Terrain Precomputation
 *
 * Precomputes static terrain drainage properties once at setup time:
 * - Elevation grid
 * - Downhill slope gradients (D8 steepest descent & proportional weights)
 * - Upstream flow accumulation (topological sort from high to low elevation)
 * - River network influence factors (Major river: 2.5x, Stream: 1.7x, Near river: 1.35x, Overland: 0.85x)
 * - Distance to mapped waterways
 * - Local depression / ponding lip elevations
 */

export interface HydrologyGridInput {
  cols: number;
  rows: number;
  dx: number;
  dy: number;
  bedElevations: Float32Array | number[];
  insideMask: Uint8Array | boolean[];
  waterBodyMask?: Uint8Array | boolean[];
  pathMask?: Uint8Array;
}

export interface HydrologicalPrecomputedGrid {
  cols: number;
  rows: number;
  dx: number;
  dy: number;
  totalCells: number;
  elevation: Float32Array;
  maxDownhillSlope: Float32Array;
  steepestNeighbour: Int32Array;
  downhillNeighbours: Int32Array; // totalCells * 8
  downhillWeights: Float32Array;   // totalCells * 8
  downhillCount: Uint8Array;       // totalCells
  isDepression: Uint8Array;
  depressionLipElev: Float32Array;
  flowAccumulation: Float32Array;
  riverFactor: Float32Array;
  distanceToRiver: Float32Array;
  isRiver: Uint8Array;
  sortedHighToLow: Int32Array;
}

// 8 neighbor offsets: E, W, N, S, NE, NW, SE, SW
const D8_COLS = [1, -1, 0, 0, 1, -1, 1, -1];
const D8_ROWS = [0, 0, -1, 1, -1, -1, 1, 1];

export function precomputeHydrology(input: HydrologyGridInput): HydrologicalPrecomputedGrid {
  const { cols, rows, dx, dy } = input;
  const totalCells = cols * rows;
  const diagDist = Math.hypot(dx, dy);
  const D8_DIST = [dx, dx, dy, dy, diagDist, diagDist, diagDist, diagDist];

  const elevation = new Float32Array(totalCells);
  const inside = new Uint8Array(totalCells);
  for (let i = 0; i < totalCells; i++) {
    elevation[i] = Number.isFinite(input.bedElevations[i]) ? Number(input.bedElevations[i]) : 0;
    inside[i] = input.insideMask ? (input.insideMask[i] ? 1 : 0) : 1;
  }

  const maxDownhillSlope = new Float32Array(totalCells);
  const steepestNeighbour = new Int32Array(totalCells).fill(-1);
  const downhillNeighbours = new Int32Array(totalCells * 8).fill(-1);
  const downhillWeights = new Float32Array(totalCells * 8);
  const downhillCount = new Uint8Array(totalCells);
  const isDepression = new Uint8Array(totalCells);
  const depressionLipElev = new Float32Array(totalCells).fill(Infinity);

  // 1. D8 Neighbourhood, Slopes, Downhill Weights, and Depression Lip Detection
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (!inside[idx]) continue;

      const currentElev = elevation[idx];
      let maxSlope = 0;
      let steepestIdx = -1;
      let count = 0;
      let totalSlopeWeight = 0;
      let minSurroundingElev = Infinity;

      for (let k = 0; k < 8; k++) {
        const nr = r + D8_ROWS[k];
        const nc = c + D8_COLS[k];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;

        const nIdx = nr * cols + nc;
        if (!inside[nIdx]) continue;

        const nElev = elevation[nIdx];
        if (nElev < minSurroundingElev) minSurroundingElev = nElev;

        const dist = D8_DIST[k];
        const slope = (currentElev - nElev) / dist;

        if (slope > 0.0001) {
          downhillNeighbours[idx * 8 + count] = nIdx;
          downhillWeights[idx * 8 + count] = slope;
          totalSlopeWeight += slope;
          count++;

          if (slope > maxSlope) {
            maxSlope = slope;
            steepestIdx = nIdx;
          }
        }
      }

      downhillCount[idx] = count;
      maxDownhillSlope[idx] = maxSlope;
      steepestNeighbour[idx] = steepestIdx;

      // Normalize downhill weights so sum = 1.0
      if (totalSlopeWeight > 0) {
        for (let k = 0; k < count; k++) {
          downhillWeights[idx * 8 + k] /= totalSlopeWeight;
        }
      } else {
        // Local depression: all neighbours are higher
        isDepression[idx] = 1;
        depressionLipElev[idx] = minSurroundingElev;
      }
    }
  }

  // 2. Topological Sort from Highest Elevation to Lowest Elevation
  const sortedHighToLow = new Int32Array(
    Array.from({ length: totalCells }, (_, i) => i)
      .filter(i => inside[i])
      .sort((a, b) => elevation[b] - elevation[a])
  );

  // 3. Flow Accumulation: upstream contributing area
  const flowAccumulation = new Float32Array(totalCells).fill(1.0);
  for (let s = 0; s < sortedHighToLow.length; s++) {
    const idx = sortedHighToLow[s];
    const count = downhillCount[idx];
    const accum = flowAccumulation[idx];

    if (count > 0) {
      for (let k = 0; k < count; k++) {
        const nIdx = downhillNeighbours[idx * 8 + k];
        const weight = downhillWeights[idx * 8 + k];
        flowAccumulation[nIdx] += accum * weight;
      }
    }
  }

  // 4. Mapped Waterways & River Factor Map
  const isRiver = new Uint8Array(totalCells);
  const distanceToRiver = new Float32Array(totalCells).fill(Infinity);
  const riverFactor = new Float32Array(totalCells).fill(0.85); // default overland: 0.85x

  let mappedRiverCount = 0;
  if (input.waterBodyMask) {
    for (let i = 0; i < totalCells; i++) {
      if (inside[i] && input.waterBodyMask[i]) {
        isRiver[i] = 1;
        distanceToRiver[i] = 0;
        mappedRiverCount++;
      }
    }
  }

  // If no mapped waterways exist in the area, identify top flow accumulation cells as natural channels
  if (mappedRiverCount === 0) {
    const accumThreshold = 35; // cells draining >= 35 upstream cells form natural drainage gullies
    for (let i = 0; i < totalCells; i++) {
      if (inside[i] && flowAccumulation[i] >= accumThreshold) {
        isRiver[i] = 1;
        distanceToRiver[i] = 0;
        mappedRiverCount++;
      }
    }
  } else {
    // Also mark prominent natural drainage gullies that feed into the mapped waterways
    for (let i = 0; i < totalCells; i++) {
      if (inside[i] && flowAccumulation[i] >= 80 && !isRiver[i]) {
        isRiver[i] = 1;
        distanceToRiver[i] = 0;
      }
    }
  }

  // Fast Euclidean distance transform to nearest river cell (BFS propagation)
  const queue: number[] = [];
  for (let i = 0; i < totalCells; i++) {
    if (isRiver[i]) queue.push(i);
  }

  let head = 0;
  while (head < queue.length) {
    const curr = queue[head++];
    const cr = Math.floor(curr / cols);
    const cc = curr % cols;
    const curDist = distanceToRiver[curr];

    for (let k = 0; k < 4; k++) { // 4-connected propagation for distance transform
      const nr = cr + D8_ROWS[k];
      const nc = cc + D8_COLS[k];
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const nIdx = nr * cols + nc;
      if (!inside[nIdx]) continue;

      const newDist = curDist + (k < 2 ? dx : dy);
      if (newDist < distanceToRiver[nIdx]) {
        distanceToRiver[nIdx] = newDist;
        queue.push(nIdx);
      }
    }
  }

  // 5. Compute riverFactor based on stream hierarchy:
  // - Major river: 2.5x
  // - Stream: 1.7x
  // - Near river (< 35m): 1.35x
  // - Natural drainage line / gully (high accumulation): 1.2x
  // - No drainage (overland): 0.85x
  const nearRiverThreshold = Math.max(35, dx * 1.5);
  for (let i = 0; i < totalCells; i++) {
    if (!inside[i]) {
      riverFactor[i] = 0;
      continue;
    }

    if (isRiver[i]) {
      const isMajor = flowAccumulation[i] > 200 || (input.waterBodyMask && input.waterBodyMask[i]);
      riverFactor[i] = isMajor ? 2.6 : 1.75;
    } else if (distanceToRiver[i] <= nearRiverThreshold) {
      riverFactor[i] = 1.35;
    } else if (flowAccumulation[i] > 20) {
      riverFactor[i] = 1.15;
    } else {
      riverFactor[i] = 0.85;
    }
  }

  return {
    cols,
    rows,
    dx,
    dy,
    totalCells,
    elevation,
    maxDownhillSlope,
    steepestNeighbour,
    downhillNeighbours,
    downhillWeights,
    downhillCount,
    isDepression,
    depressionLipElev,
    flowAccumulation,
    riverFactor,
    distanceToRiver,
    isRiver,
    sortedHighToLow,
  };
}
