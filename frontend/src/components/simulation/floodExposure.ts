import type { WaterPhysicsState } from "./waterPhysics";

export interface FloodSurface {
  state: WaterPhysicsState;
  terrain: Float32Array;
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface FloodSample {
  cells: [number, number, number];
  weights: [number, number, number];
}

// Match the two triangles used by the water mesh, including its polygon mask.
export function sampleFloodTriangle(surface: FloodSurface, lng: number, lat: number): FloodSample | null {
  const { cols, rows, insideMask } = surface.state;
  const x = (lng - surface.west) / (surface.east - surface.west) * (cols - 1);
  const y = (lat - surface.south) / (surface.north - surface.south) * (rows - 1);
  if (!Number.isFinite(x + y) || x < 0 || y < 0 || x > cols - 1 || y > rows - 1) return null;
  const c = Math.min(cols - 2, Math.floor(x)), r = Math.min(rows - 2, Math.floor(y));
  const u = x - c, v = y - r, a = r * cols + c;
  const sample: FloodSample = u + v <= 1
    ? { cells: [a, a + 1, a + cols], weights: [1 - u - v, u, v] }
    : { cells: [a + 1, a + cols, a + cols + 1], weights: [1 - v, 1 - u, u + v - 1] };
  return sample.cells.every(i => insideMask[i]) ? sample : null;
}

function insideRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i], [px, py] = ring[j];
    if ((y > lat) !== (py > lat) && lng < (px - x) * (lat - y) / (py - y) + x) inside = !inside;
  }
  return inside;
}

/** Cache footprint probes once per terrain grid, not once per simulation frame. */
export function buildFloodSamples(surface: FloodSurface, rings: number[][][]): FloodSample[] {
  const outer = rings[0];
  if (!outer?.length) return [];
  const { cols, rows } = surface.state;
  const stepLng = (surface.east - surface.west) / (cols - 1);
  const stepLat = (surface.north - surface.south) / (rows - 1);
  const samples: FloodSample[] = [];
  const add = (lng: number, lat: number) => {
    const sample = sampleFloodTriangle(surface, lng, lat);
    if (sample) samples.push(sample);
  };
  // Probe the perimeter at half-cell intervals to catch partial inundation.
  for (const ring of rings) for (let i = 0; i < ring.length - 1; i++) {
    const [x, y] = ring[i], [nx, ny] = ring[i + 1];
    const steps = Math.max(1, Math.ceil(2 * Math.max(Math.abs(nx - x) / stepLng, Math.abs(ny - y) / stepLat)));
    for (let s = 0; s <= steps; s++) add(x + (nx - x) * s / steps, y + (ny - y) * s / steps);
  }
  const c0 = Math.max(0, Math.ceil((Math.min(...outer.map(p => p[0])) - surface.west) / stepLng));
  const c1 = Math.min(cols - 1, Math.floor((Math.max(...outer.map(p => p[0])) - surface.west) / stepLng));
  const r0 = Math.max(0, Math.ceil((Math.min(...outer.map(p => p[1])) - surface.south) / stepLat));
  const r1 = Math.min(rows - 1, Math.floor((Math.max(...outer.map(p => p[1])) - surface.south) / stepLat));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const lng = surface.west + c * stepLng, lat = surface.south + r * stepLat;
    if (insideRing(lng, lat, outer) && !rings.slice(1).some(hole => insideRing(lng, lat, hole))) add(lng, lat);
  }
  return samples;
}

/** Water depth above actual ground, excluding the submerged bed of natural water bodies. */
export function buildingFloodDepth(surface: FloodSurface, samples: FloodSample[]): number {
  const { bed, depth } = surface.state;
  let maxDepth = 0;
  for (const { cells, weights } of samples) {
    let aboveGround = 0;
    for (let j = 0; j < 3; j++) {
      const i = cells[j];
      aboveGround += weights[j] * (bed[i] + depth[i] - surface.terrain[i]);
    }
    maxDepth = Math.max(maxDepth, aboveGround);
  }
  return maxDepth;
}

// Use the same 5 cm inundation threshold as the simulation's flooded-area metric.
export const BUILDING_FLOOD_THRESHOLD_M = 0.05;
