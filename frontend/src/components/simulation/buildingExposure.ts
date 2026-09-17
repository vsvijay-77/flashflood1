import type { BuildingFeature } from "@/lib/routingApi";

export interface ExposureGrid {
  cols: number; rows: number; west: number; east: number; south: number; north: number;
}

export interface BuildingSample {
  id: string; name: string; kind: string; cells: number[];
}

export const exposureThresholdM = 0.1;

function clippedArea(ring: number[][], bounds: number[]) {
  let points = ring;
  for (let side = 0; side < 4; side++) {
    const axis = side % 2;
    const limit = bounds[side];
    const inside = (point: number[]) => side < 2 ? point[axis] >= limit : point[axis] <= limit;
    const output: number[][] = [];
    for (let index = 0; index < points.length; index++) {
      const start = points[index];
      const end = points[(index + 1) % points.length];
      if (inside(start)) output.push(start);
      if (inside(start) !== inside(end)) {
        const fraction = (limit - start[axis]) / (end[axis] - start[axis]);
        output.push([start[0] + fraction * (end[0] - start[0]), start[1] + fraction * (end[1] - start[1])]);
      }
    }
    points = output;
  }
  if (points.length < 3) return 0;
  const origin = points[0];
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + (point[0] - origin[0]) * (next[1] - origin[1]) - (next[0] - origin[0]) * (point[1] - origin[1]);
  }, 0)) / 2;
}

export function indexBuildings(buildings: BuildingFeature[], grid: ExposureGrid, mask: Uint8Array): BuildingSample[] {
  const longitudeStep = (grid.east - grid.west) / (grid.cols - 1);
  const latitudeStep = (grid.north - grid.south) / (grid.rows - 1);
  if (!(longitudeStep > 0 && latitudeStep > 0)) return [];
  const seen = new Set<string>();
  return buildings.flatMap((building, index) => {
    const id = String(building.id ?? building.properties.id ?? index);
    if (seen.has(id)) return [];
    seen.add(id);
    const polygons = building.geometry.type === "Polygon" ? [building.geometry.coordinates as number[][][]] : building.geometry.coordinates as number[][][][];
    const cells = new Set<number>();
    for (const polygon of polygons) {
      const outer = polygon[0];
      if (!outer?.length || polygon.some(ring => ring.some(point => !Number.isFinite(point[0]) || !Number.isFinite(point[1])))) continue;
      const columns = outer.map(point => (point[0] - grid.west) / longitudeStep);
      const rows = outer.map(point => (point[1] - grid.south) / latitudeStep);
      for (let row = Math.max(0, Math.ceil(Math.min(...rows) - 0.5)); row <= Math.min(grid.rows - 1, Math.floor(Math.max(...rows) + 0.5)); row++) {
        for (let col = Math.max(0, Math.ceil(Math.min(...columns) - 0.5)); col <= Math.min(grid.cols - 1, Math.floor(Math.max(...columns) + 0.5)); col++) {
          const cell = row * grid.cols + col;
          if (!mask[cell]) continue;
          const longitude = grid.west + col * longitudeStep;
          const latitude = grid.south + row * latitudeStep;
          const bounds = [longitude - longitudeStep / 2, latitude - latitudeStep / 2, longitude + longitudeStep / 2, latitude + latitudeStep / 2];
          const area = clippedArea(outer, bounds) - polygon.slice(1).reduce((sum, ring) => sum + clippedArea(ring, bounds), 0);
          if (area > longitudeStep * latitudeStep * 1e-10) cells.add(cell);
        }
      }
    }
    return [{ id, name: building.properties.name || `Building ${id}`, kind: building.properties.building && building.properties.building !== "yes" ? building.properties.building : "unknown", cells: [...cells] }];
  });
}

export function assessBuildings(samples: BuildingSample[], depths: Float32Array, peaks: Float32Array, arrivals?: Float64Array, predicted?: Float64Array) {
  return samples.map(sample => {
    let currentDepthM = 0;
    let peakDepthM = 0;
    let arrivalSeconds = Infinity;
    let predictedArrivalSeconds = Infinity;
    for (const cell of sample.cells) {
      currentDepthM = Math.max(currentDepthM, depths[cell] || 0);
      peakDepthM = Math.max(peakDepthM, peaks[cell] || 0);
      if (arrivals && arrivals[cell] >= 0) arrivalSeconds = Math.min(arrivalSeconds, arrivals[cell]);
      if (predicted && predicted[cell] >= 0) predictedArrivalSeconds = Math.min(predictedArrivalSeconds, predicted[cell]);
    }
    return { ...sample, cells: undefined, assessed: sample.cells.length > 0, currentDepthM, peakDepthM,
      arrivalSeconds: Number.isFinite(arrivalSeconds) ? arrivalSeconds : null,
      predictedArrivalSeconds: Number.isFinite(predictedArrivalSeconds) ? predictedArrivalSeconds : null,
      affectedNow: currentDepthM >= exposureThresholdM, affectedDuringRun: peakDepthM >= exposureThresholdM };
  });
}

export type BuildingExposure = ReturnType<typeof assessBuildings>[number];
