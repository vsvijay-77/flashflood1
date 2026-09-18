import type { WaterSourceFeature } from "@/services/osmWaterSourceService";
import { inWaterPolygon, segmentDistance, type Point } from "./floodModel";

export interface SourceGrid {
  cols: number;
  rows: number;
  west: number;
  south: number;
  east: number;
  north: number;
  dx: number;
  dy: number;
}

export function rasterizeWaterSources(features: WaterSourceFeature[], grid: SourceGrid, inside: Uint8Array) {
  const mask = new Uint8Array(inside.length);
  const longitudeScale = grid.dx * (grid.cols - 1) / (grid.east - grid.west);
  const latitudeScale = grid.dy * (grid.rows - 1) / (grid.north - grid.south);
  const project = (point: Point): Point => [(point[0] - grid.west) * longitudeScale, (point[1] - grid.south) * latitudeScale];
  let featureCount = 0;
  for (const feature of features) {
    let intersects = false;
    const geometry = feature.geometry;
    const polygons: Point[][][] = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
    const lines: Point[][] = geometry.type === "LineString" ? [geometry.coordinates] : geometry.type === "MultiLineString" ? geometry.coordinates : [];
    const mark = (column: number, row: number) => {
      const index = row * grid.cols + column;
      if (inside[index]) { mask[index] = 1; intersects = true; }
    };
    const visit = (points: Point[], padding: number, contains: (point: Point) => boolean) => {
      if (!points.length) return;
      const minColumn = Math.max(0, Math.floor((Math.min(...points.map(point => point[0])) - padding) / grid.dx));
      const maxColumn = Math.min(grid.cols - 1, Math.ceil((Math.max(...points.map(point => point[0])) + padding) / grid.dx));
      const minRow = Math.max(0, Math.floor((Math.min(...points.map(point => point[1])) - padding) / grid.dy));
      const maxRow = Math.min(grid.rows - 1, Math.ceil((Math.max(...points.map(point => point[1])) + padding) / grid.dy));
      for (let row = minRow; row <= maxRow; row++) for (let column = minColumn; column <= maxColumn; column++) {
        if (inside[row * grid.cols + column] && contains([column * grid.dx, row * grid.dy])) mark(column, row);
      }
    };
    for (const polygon of polygons) {
      const rings = polygon.map(ring => ring.map(project));
      if (rings[0]?.length >= 3) visit(rings[0], 0, point => inWaterPolygon(point, rings));
    }
    const widthValue = feature.properties?.width_m ?? feature.properties?.width;
    const requestedWidth = typeof widthValue === "number" ? widthValue : Number.parseFloat(String(widthValue ?? ""));
    const width = Number.isFinite(requestedWidth) && requestedWidth > 0 ? requestedWidth : feature.waterType === "river" ? 8 : 3;
    const radius = Math.max(Math.min(width, 20) / 2, Math.hypot(grid.dx, grid.dy) * 0.45);
    for (const line of lines) for (let index = 1; index < line.length; index++) {
      const start = project(line[index - 1]), end = project(line[index]);
      visit([start, end], radius, point => segmentDistance(point, start, end) <= radius);
    }
    if (intersects) featureCount++;
  }
  return { mask, featureCount };
}
