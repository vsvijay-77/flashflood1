import * as THREE from "three";
import type { WaterSourceFeature } from "@/services/osmWaterSourceService";
import type { SourceGrid } from "./water/sourceRaster";

/** Linear-time, eight-neighbour distance field in metres from mapped water. */
export function waterwayDistances(mask: Uint8Array, width: number, height: number, dx: number, dy: number, limit: number) {
  const distances = Float32Array.from(mask, value => value ? 0 : limit);
  const diagonal = Math.hypot(dx, dy);
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const i = row * width + col;
    if (col) distances[i] = Math.min(distances[i], distances[i - 1] + dx);
    if (row) {
      distances[i] = Math.min(distances[i], distances[i - width] + dy);
      if (col) distances[i] = Math.min(distances[i], distances[i - width - 1] + diagonal);
      if (col + 1 < width) distances[i] = Math.min(distances[i], distances[i - width + 1] + diagonal);
    }
  }
  for (let row = height - 1; row >= 0; row--) for (let col = width - 1; col >= 0; col--) {
    const i = row * width + col;
    if (col + 1 < width) distances[i] = Math.min(distances[i], distances[i + 1] + dx);
    if (row + 1 < height) {
      distances[i] = Math.min(distances[i], distances[i + width] + dy);
      if (col) distances[i] = Math.min(distances[i], distances[i + width - 1] + diagonal);
      if (col + 1 < width) distances[i] = Math.min(distances[i], distances[i + width + 1] + diagonal);
    }
  }
  return distances;
}

/** A static subcell channel outline; rebuilt only when terrain/OSM data changes. */
export function createWaterwayDistanceTexture(features: WaterSourceFeature[], grid: SourceGrid) {
  const widthM = grid.dx * (grid.cols - 1), heightM = grid.dy * (grid.rows - 1);
  const spacing = Math.max(8, widthM / 1023, heightM / 1023);
  const width = Math.max(2, Math.ceil(widthM / spacing) + 1);
  const height = Math.max(2, Math.ceil(heightM / spacing) + 1);
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.strokeStyle = "white"; context.fillStyle = "white";
  context.lineCap = "round"; context.lineJoin = "round";
  const path = (points: number[][]) => {
    points.forEach((point, i) => {
      const x = (point[0] - grid.west) / (grid.east - grid.west) * (width - 1);
      const y = (point[1] - grid.south) / (grid.north - grid.south) * (height - 1);
      if (i) context.lineTo(x, y); else context.moveTo(x, y);
    });
  };
  for (const feature of features) {
    const geometry = feature.geometry;
    const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.type === "MultiLineString" ? geometry.coordinates : [];
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
    const measured = Number.parseFloat(String(feature.properties?.width_m ?? feature.properties?.width ?? ""));
    const riverWidth = measured > 0 ? Math.min(20, measured) : feature.waterType === "river" ? 8 : 3;
    context.lineWidth = Math.max(1, riverWidth / spacing);
    for (const line of lines) { context.beginPath(); path(line); context.stroke(); }
    for (const polygon of polygons) {
      context.beginPath();
      for (const ring of polygon) { path(ring); context.closePath(); }
      context.fill("evenodd");
    }
  }
  const pixels = context.getImageData(0, 0, width, height).data;
  const mask = Uint8Array.from({ length: width * height }, (_, i) => pixels[i * 4 + 3] >= 64 ? 1 : 0);
  const maxDistance = Math.max(grid.dx, grid.dy) * 2;
  const distances = waterwayDistances(mask, width, height, widthM / (width - 1), heightM / (height - 1), maxDistance);
  const values = Uint8Array.from(distances, distance => Math.round(Math.min(1, distance / maxDistance) * 255));
  const texture = new THREE.DataTexture(values, width, height, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false; texture.needsUpdate = true;
  return { texture, maxDistance };
}
