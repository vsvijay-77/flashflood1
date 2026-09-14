import type { WaterSourceFeature } from "@/services/osmWaterSourceService";

interface SourceGrid {
  cols: number;
  rows: number;
  dx: number;
  dy: number;
  south: number;
  west: number;
  north: number;
  east: number;
}

function inRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Rasterize complete waterways, with a level lake surface and a sloping river surface. */
export function createWaterSources(grid: SourceGrid, terrain: Float32Array,
  insideMask: Uint8Array, features: WaterSourceFeature[]) {
  const { cols, rows, dx, dy, south, west, north, east } = grid;
  const bed = new Float32Array(terrain);
  const sourceMask = new Uint8Array(terrain.length);
  const initialDepths = new Float32Array(terrain.length);
  const toX = (lng: number) => (lng - west) / (east - west) * (cols - 1) * dx;
  const toY = (lat: number) => (lat - south) / (north - south) * (rows - 1) * dy;
  const setSource = (i: number, level: number, channelDepth: number) => {
    sourceMask[i] = 1;
    bed[i] = level - channelDepth;
    initialDepths[i] = channelDepth;
  };
  const tagLine = (coords: number[][], feature: WaterSourceFeature) => {
    const suppliedWidth = Number.parseFloat(String(feature.properties?.width ?? ""));
    const width = Number.isFinite(suppliedWidth) && suppliedWidth > 0 ? suppliedWidth
      : feature.waterType === "river" ? 20 : 5;
    // Half a cell diagonal ensures a continuous channel even between grid nodes.
    const radius = Math.max(width / 2, Math.hypot(dx, dy) / 2);
    for (let s = 0; s < coords.length - 1; s++) {
      const ax = toX(coords[s][0]), ay = toY(coords[s][1]);
      const bx = toX(coords[s + 1][0]), by = toY(coords[s + 1][1]);
      const length2 = (bx - ax) ** 2 + (by - ay) ** 2;
      const c0 = Math.max(0, Math.ceil((Math.min(ax, bx) - radius) / dx));
      const c1 = Math.min(cols - 1, Math.floor((Math.max(ax, bx) + radius) / dx));
      const r0 = Math.max(0, Math.ceil((Math.min(ay, by) - radius) / dy));
      const r1 = Math.min(rows - 1, Math.floor((Math.max(ay, by) + radius) / dy));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const i = r * cols + c;
        if (!insideMask[i]) continue;
        const x = c * dx, y = r * dy;
        const t = length2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / length2)) : 0;
        if ((x - ax - t * (bx - ax)) ** 2 + (y - ay - t * (by - ay)) ** 2 <= radius ** 2) {
          setSource(i, terrain[i], 1.8);
        }
      }
    }
  };
  const tagPolygon = (rings: number[][][], feature: WaterSourceFeature) => {
    if (!rings[0]?.length) return;
    const cells: number[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!insideMask[i]) continue;
      const lng = west + c / (cols - 1) * (east - west);
      const lat = south + r / (rows - 1) * (north - south);
      if (inRing(lng, lat, rings[0]) && !rings.slice(1).some(hole => inRing(lng, lat, hole))) cells.push(i);
    }
    if (!cells.length) return;
    const heights = cells.map(i => terrain[i]).sort((a, b) => a - b);
    const lakeLevel = heights[Math.floor(heights.length / 2)];
    const river = feature.waterType === "river" || feature.waterType === "riverbank" || feature.waterType === "canal";
    for (const i of cells) setSource(i, river ? terrain[i] : lakeLevel, 2.2);
  };
  // Area features take precedence over centerlines where a river enters a lake.
  for (const feature of features) {
    const geom = feature.geometry;
    if (geom.type === "LineString") tagLine(geom.coordinates, feature);
    if (geom.type === "MultiLineString") for (const line of geom.coordinates) tagLine(line, feature);
  }
  for (const feature of features) {
    const geom = feature.geometry;
    if (geom.type === "Polygon") tagPolygon(geom.coordinates, feature);
    if (geom.type === "MultiPolygon") for (const polygon of geom.coordinates) tagPolygon(polygon, feature);
  }
  return { bed, sourceMask, initialDepths };
}
