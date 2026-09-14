import type { BuildingFeature, RoadFeature, RiverFeature } from "@/lib/routingApi";

type Point = [number, number];

function onSegment(p: Point, a: Point, b: Point): boolean {
  return Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) < 1e-12
    && p[0] >= Math.min(a[0], b[0]) - 1e-10 && p[0] <= Math.max(a[0], b[0]) + 1e-10
    && p[1] >= Math.min(a[1], b[1]) - 1e-10 && p[1] <= Math.max(a[1], b[1]) + 1e-10;
}

function inRing(p: Point, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j] as Point, b = ring[i] as Point;
    if (onSegment(p, a, b)) return true;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (p: Point, q: Point, r: Point) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b)
    || (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0);
}

export function buildingTouchesArea(rings: number[][][], area: [number, number][]): boolean {
  const selection = area.map(([lat, lng]): Point => [lng, lat]);
  if (rings[0].some(p => inRing(p as Point, selection))) return true;
  if (selection.some(p => inRing(p, rings[0]) && !rings.slice(1).some(hole => inRing(p, hole)))) return true;
  return rings.some(ring => ring.some((p, i) => selection.some((q, j) =>
    intersects(p as Point, ring[(i + 1) % ring.length] as Point, q, selection[(j + 1) % selection.length]))));
}

export function buildingCenter(ring: number[][]): { lat: number; lon: number } {
  const [ox, oy] = ring[0];
  let area = 0, x = 0, y = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const ax = ring[i][0] - ox, ay = ring[i][1] - oy, bx = ring[i + 1][0] - ox, by = ring[i + 1][1] - oy;
    const cross = ax * by - bx * ay;
    area += cross; x += (ax + bx) * cross; y += (ay + by) * cross;
  }
  return Math.abs(area) > 1e-16 ? { lon: ox + x / (3 * area), lat: oy + y / (3 * area) } : { lon: ox, lat: oy };
}

export function buildingHeight(properties: BuildingFeature["properties"]): number {
  for (const value of [properties.height, properties.height_m, properties.estimated_height]) {
    const height = typeof value === "string" ? Number.parseFloat(value) : Number(value);
    if (Number.isFinite(height) && height > 0) return height;
  }
  return 6;
}

// ─── 🛣️ & 🌊 SPATIAL CLEARANCE INDEX TO PREVENT BUILDINGS IN PATHS ─────────────

// Segment: [x1 (lon), y1 (lat), x2 (lon), y2 (lat), setbackM]
type ClearanceSegment = [number, number, number, number, number];

export interface PathClearanceIndex {
  cellSize: number;
  grid: Map<number, ClearanceSegment[]>;
  waterPolygons: number[][][]; // GeoJSON [lon, lat] rings
  hasData: boolean;
}

function pointToSegmentDistM(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cosLat: number
): number {
  const dx = (x2 - x1) * 111132.0 * cosLat;
  const dy = (y2 - y1) * 111132.0;
  const segLenSq = dx * dx + dy * dy;
  if (segLenSq < 1e-6) {
    return Math.hypot((px - x1) * 111132.0 * cosLat, (py - y1) * 111132.0);
  }
  const dpx = (px - x1) * 111132.0 * cosLat;
  const dpy = (py - y1) * 111132.0;
  const t = Math.max(0, Math.min(1, (dpx * dx + dpy * dy) / segLenSq));
  return Math.hypot(dpx - t * dx, dpy - t * dy);
}

export function buildPathClearanceIndex(
  roads?: RoadFeature[],
  rivers?: RiverFeature[],
  cellSize = 0.003 // ~330m cells
): PathClearanceIndex {
  const grid = new Map<number, ClearanceSegment[]>();
  const waterPolygons: number[][][] = [];

  const addSegment = (x1: number, y1: number, x2: number, y2: number, setbackM: number) => {
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    const c1x = Math.floor(minX / cellSize), c2x = Math.floor(maxX / cellSize);
    const c1y = Math.floor(minY / cellSize), c2y = Math.floor(maxY / cellSize);
    const seg: ClearanceSegment = [x1, y1, x2, y2, setbackM];
    for (let cx = c1x; cx <= c2x; cx++) {
      for (let cy = c1y; cy <= c2y; cy++) {
        const key = ((cx & 0xffff) << 16) | (cy & 0xffff);
        let cell = grid.get(key);
        if (!cell) {
          cell = [];
          grid.set(key, cell);
        }
        cell.push(seg);
      }
    }
  };

  // Index road paths with hierarchical setback
  if (roads && roads.length > 0) {
    for (const r of roads) {
      const coords = r.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) continue;
      const rType = r.properties?.road_type || "residential";
      const setbackM = (rType === "motorway" || rType === "trunk") ? 8.5
        : (rType === "primary") ? 7.0
        : (rType === "secondary" || rType === "tertiary") ? 6.0
        : (rType === "residential" || rType === "living_street" || rType === "unclassified") ? 5.0
        : 3.5; // footpaths, cycleways, tracks

      for (let i = 0; i < coords.length - 1; i++) {
        const p1 = coords[i], p2 = coords[i + 1];
        if (!Array.isArray(p1) || !Array.isArray(p2) || p1.length < 2 || p2.length < 2) continue;
        addSegment(p1[0], p1[1], p2[0], p2[1], setbackM);
      }
    }
  }

  // Index waterways and water bodies
  if (rivers && rivers.length > 0) {
    for (const riv of rivers) {
      const geom = riv.geometry;
      if (!geom) continue;
      if (geom.type === "LineString") {
        const coords = geom.coordinates as [number, number][];
        if (Array.isArray(coords) && coords.length >= 2) {
          const w = (riv.properties?.width_m || 4) / 2 + 6.0;
          for (let i = 0; i < coords.length - 1; i++) {
            const p1 = coords[i], p2 = coords[i + 1];
            if (Array.isArray(p1) && Array.isArray(p2)) {
              addSegment(p1[0], p1[1], p2[0], p2[1], w);
            }
          }
        }
      } else if ((geom as any).type === "Polygon") {
        const coords = (geom.coordinates as unknown) as [number, number][][];
        if (Array.isArray(coords) && coords.length > 0 && Array.isArray(coords[0])) {
          waterPolygons.push(coords[0]);
          for (let i = 0; i < coords[0].length - 1; i++) {
            const p1 = coords[0][i], p2 = coords[0][i + 1];
            addSegment(p1[0], p1[1], p2[0], p2[1], 8.0);
          }
        }
      } else if ((geom as any).type === "MultiPolygon") {
        const coords = (geom.coordinates as unknown) as [number, number][][][];
        if (Array.isArray(coords)) {
          for (const poly of coords) {
            if (Array.isArray(poly) && poly.length > 0 && Array.isArray(poly[0])) {
              waterPolygons.push(poly[0]);
              for (let i = 0; i < poly[0].length - 1; i++) {
                const p1 = poly[0][i], p2 = poly[0][i + 1];
                addSegment(p1[0], p1[1], p2[0], p2[1], 8.0);
              }
            }
          }
        }
      }
    }
  }

  return {
    cellSize,
    grid,
    waterPolygons,
    hasData: grid.size > 0 || waterPolygons.length > 0,
  };
}

/**
 * Evaluates whether a building footprint ring sits in or crosses any road path or waterway.
 */
export function isBuildingInPath(
  ring: number[][],
  center: { lat: number; lon: number },
  index: PathClearanceIndex
): boolean {
  if (!index.hasData) return false;

  // 1. Check if building is inside any water polygon
  const cPt: Point = [center.lon, center.lat];
  for (const wRing of index.waterPolygons) {
    if (inRing(cPt, wRing)) return true;
  }

  // 2. Query spatial hash grid around building bounding box
  let minLon = center.lon, maxLon = center.lon, minLat = center.lat, maxLat = center.lat;
  for (const pt of ring) {
    if (pt[0] < minLon) minLon = pt[0];
    if (pt[0] > maxLon) maxLon = pt[0];
    if (pt[1] < minLat) minLat = pt[1];
    if (pt[1] > maxLat) maxLat = pt[1];
  }

  const c1x = Math.floor((minLon - 0.0002) / index.cellSize);
  const c2x = Math.floor((maxLon + 0.0002) / index.cellSize);
  const c1y = Math.floor((minLat - 0.0002) / index.cellSize);
  const c2y = Math.floor((maxLat + 0.0002) / index.cellSize);

  const candidateSegments: ClearanceSegment[] = [];
  const seenSegs = new Set<string>();

  for (let cx = c1x; cx <= c2x; cx++) {
    for (let cy = c1y; cy <= c2y; cy++) {
      const key = ((cx & 0xffff) << 16) | (cy & 0xffff);
      const cell = index.grid.get(key);
      if (!cell) continue;
      for (const seg of cell) {
        const sKey = `${seg[0]},${seg[1]},${seg[2]},${seg[3]}`;
        if (!seenSegs.has(sKey)) {
          seenSegs.add(sKey);
          candidateSegments.push(seg);
        }
      }
    }
  }

  if (candidateSegments.length === 0) return false;

  const cosLat = Math.cos((center.lat * Math.PI) / 180);

  // Check 1: Building centroid proximity to road centerline
  for (const [x1, y1, x2, y2, setbackM] of candidateSegments) {
    const distCenter = pointToSegmentDistM(center.lon, center.lat, x1, y1, x2, y2, cosLat);
    if (distCenter < setbackM) {
      return true; // House centroid is in the road path corridor
    }
  }

  // Check 2: Any building footprint vertex encroachment
  for (const pt of ring) {
    const px = pt[0], py = pt[1];
    for (const [x1, y1, x2, y2, setbackM] of candidateSegments) {
      const distVtx = pointToSegmentDistM(px, py, x1, y1, x2, y2, cosLat);
      if (distVtx < setbackM * 0.65) {
        return true; // Building corner touches or overlaps the road
      }
    }
  }

  // Check 3: Line-segment intersection between building polygon edges and road segment
  for (let i = 0; i < ring.length - 1; i++) {
    const a: Point = [ring[i][0], ring[i][1]];
    const b: Point = [ring[i + 1][0], ring[i + 1][1]];
    for (const [x1, y1, x2, y2] of candidateSegments) {
      const c: Point = [x1, y1];
      const d: Point = [x2, y2];
      if (intersects(a, b, c, d)) {
        return true; // Building wall physically crosses the road path
      }
    }
  }

  return false;
}

/** Filter buildings so none sit inside or overlap road paths or water channels. */
export function filterBuildingsClearOfPaths(
  buildings: BuildingFeature[],
  roads?: RoadFeature[],
  rivers?: RiverFeature[]
): BuildingFeature[] {
  if ((!roads || roads.length === 0) && (!rivers || rivers.length === 0)) {
    return buildings;
  }
  const index = buildPathClearanceIndex(roads, rivers);
  if (!index.hasData) return buildings;

  return buildings.filter((b) => {
    const geom = b.geometry;
    if (!geom) return true;
    const parts = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
    for (const part of parts as number[][][][]) {
      if (!Array.isArray(part) || !part[0]) continue;
      const ring = part[0];
      const center = (b.properties?.lat && b.properties?.lon)
        ? { lat: b.properties.lat, lon: b.properties.lon }
        : buildingCenter(ring);
      if (isBuildingInPath(ring, center, index)) {
        return false; // Reject house in the road/water path
      }
    }
    return true;
  });
}

/** Normalize fresh and cached GeoJSON before counting or drawing houses, keeping roads/water clean. */
export function prepareBuildingFootprints(
  features: BuildingFeature[],
  area: [number, number][],
  roads?: RoadFeature[],
  rivers?: RiverFeature[]
): BuildingFeature[] {
  const seen = new Set<string>(), result: BuildingFeature[] = [];
  const clearanceIndex = buildPathClearanceIndex(roads, rivers);

  for (const feature of features) {
    if (!feature?.geometry) continue;
    const geometry = feature.geometry;
    const parts = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
    const polygons: number[][][][] = [];
    for (const part of parts as number[][][][]) {
      if (!Array.isArray(part)) continue;
      const rings: number[][][] = [];
      let invalidOuter = false;
      for (let index = 0; index < part.length; index++) {
        const raw = part[index];
        if (!Array.isArray(raw) || raw.some(p => !Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) {
          if (index === 0) invalidOuter = true;
          continue;
        }
        const ring = raw.map(p => [p[0], p[1]]).filter((p, i, points) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
        if (new Set(ring.map(p => p.join(","))).size < 3) { if (index === 0) invalidOuter = true; continue; }
        if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ring.push([...ring[0]]);
        rings.push(ring);
      }
      if (invalidOuter || !rings.length || (area.length >= 3 && !buildingTouchesArea(rings, area))) continue;

      // Check clearance: Ensure house footprint is not in the road path or water channel
      if (clearanceIndex.hasData) {
        const center = buildingCenter(rings[0]);
        if (isBuildingInPath(rings[0], center, clearanceIndex)) {
          continue; // Skip building in path
        }
      }

      const key = rings.map(ring => ring.slice(0, -1).map(p => p.map(v => v.toFixed(7)).join(",")).sort().join(";")).sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key); polygons.push(rings);
    }
    if (!polygons.length) continue;
    result.push({ ...feature, properties: { ...feature.properties, ...buildingCenter(polygons[0][0]) }, geometry: polygons.length === 1
      ? { type: "Polygon", coordinates: polygons[0] } : { type: "MultiPolygon", coordinates: polygons } });
  }
  return result;
}

