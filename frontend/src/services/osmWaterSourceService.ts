/**
 * OSM Water Source Service
 *
 * Fetches lakes, reservoirs, ponds, rivers, streams, canals, and riverbanks
 * from OpenStreetMap via Overpass API mirrors with:
 * - Polygon, MultiPolygon, LineString, and MultiLineString support
 * - Preservation of multipolygon holes and islands
 * - In-memory and localStorage caching with TTL
 * - Request deduplication and AbortController cancellation
 * - Fallback Overpass mirrors
 * - OpenStreetMap attribution
 * - Lowest sampled terrain depression fallback when no OSM water is found
 */

export interface WaterSourceGeometry {
  type: "LineString" | "MultiLineString" | "Polygon" | "MultiPolygon";
  coordinates: any;
}

export interface WaterSourceFeature {
  id: string;
  name: string;
  waterType: "river" | "stream" | "canal" | "lake" | "reservoir" | "pond" | "basin" | "riverbank" | "water";
  isPolygon: boolean;
  geometry: WaterSourceGeometry;
  properties: Record<string, any>;
}

export interface OsmWaterQueryResult {
  features: WaterSourceFeature[];
  isFallback: boolean;
  fallbackReason?: string;
  attribution: string;
  cached: boolean;
  sourceMirror?: string;
}

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

export const OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)";

// In-memory cache
const memoryCache = new Map<string, { data: OsmWaterQueryResult; timestamp: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const LOCAL_STORAGE_PREFIX = "flash_flood_osm_water_";

// In-flight request deduplication
const inFlightRequests = new Map<string, Promise<OsmWaterQueryResult>>();

function getCacheKey(bbox: { south: number; west: number; north: number; east: number }): string {
  return `${bbox.south.toFixed(4)}_${bbox.west.toFixed(4)}_${bbox.north.toFixed(4)}_${bbox.east.toFixed(4)}`;
}

function loadFromLocalStorage(key: string): OsmWaterQueryResult | null {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.timestamp < CACHE_TTL_MS) {
      return { ...parsed.data, cached: true };
    }
    localStorage.removeItem(LOCAL_STORAGE_PREFIX + key);
  } catch (e) {
    // Ignore storage quota or parse errors
  }
  return null;
}

function saveToLocalStorage(key: string, data: OsmWaterQueryResult) {
  try {
    localStorage.setItem(
      LOCAL_STORAGE_PREFIX + key,
      JSON.stringify({ data, timestamp: Date.now() })
    );
  } catch (e) {
    // Handle storage quota exceeded gracefully
    try {
      // Clear oldest keys
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LOCAL_STORAGE_PREFIX)) {
          localStorage.removeItem(k);
          break;
        }
      }
    } catch {}
  }
}

/**
 * Parses Overpass JSON elements into structured GeoJSON water features,
 * assembling ways and relation multipolygons with proper hole preservation.
 */
export function parseOverpassWaterElements(elements: any[]): WaterSourceFeature[] {
  const nodes = new Map<number, [number, number]>(); // id -> [lng, lat]
  const ways = new Map<number, { id: number; nodes: number[]; tags: Record<string, string> }>();
  const relations: any[] = [];

  for (const el of elements) {
    if (el.type === "node" && typeof el.lon === "number" && typeof el.lat === "number") {
      nodes.set(el.id, [el.lon, el.lat]);
    } else if (el.type === "way" && Array.isArray(el.nodes)) {
      ways.set(el.id, { id: el.id, nodes: el.nodes, tags: el.tags || {} });
    } else if (el.type === "relation") {
      relations.push(el);
    }
  }

  const features: WaterSourceFeature[] = [];
  const waysUsedInRelations = new Set<number>();

  // 1. Process Relations (MultiPolygons with outer/inner rings)
  for (const rel of relations) {
    const tags = rel.tags || {};
    const isWater =
      tags.waterway ||
      tags.natural === "water" ||
      tags.water ||
      tags.landuse === "reservoir" ||
      tags.landuse === "basin";

    if (!isWater) continue;

    const outerWaySegments: [number, number][][] = [];
    const innerWaySegments: [number, number][][] = [];

    if (Array.isArray(rel.members)) {
      for (const member of rel.members) {
        if (member.type === "way") {
          const way = ways.get(member.ref);
          if (!way) continue;
          waysUsedInRelations.add(member.ref);

          const coords: [number, number][] = [];
          for (const nid of way.nodes) {
            const pt = nodes.get(nid);
            if (pt) coords.push(pt);
          }
          if (coords.length < 2) continue;

          if (member.role === "inner") {
            innerWaySegments.push(coords);
          } else {
            outerWaySegments.push(coords);
          }
        }
      }
    }

    const outerRings = assembleRings(outerWaySegments);
    const innerRings = assembleRings(innerWaySegments);

    if (outerRings.length === 0) continue;

    const waterType = normalizeWaterType(tags);

    if (outerRings.length === 1) {
      // Single polygon with holes
      const polyCoords = [outerRings[0], ...innerRings];
      features.push({
        id: `rel_${rel.id}`,
        name: tags.name || `${waterType} #${rel.id}`,
        waterType,
        isPolygon: true,
        geometry: {
          type: "Polygon",
          coordinates: polyCoords,
        },
        properties: tags,
      });
    } else {
      // MultiPolygon with multiple outer islands, each may contain holes
      const multiPolyCoords = outerRings.map((outerRing) => {
        const holesForOuter: [number, number][][] = [];
        for (const innerRing of innerRings) {
          if (isRingInsideOuterRing(innerRing, outerRing)) {
            holesForOuter.push(innerRing);
          }
        }
        return [outerRing, ...holesForOuter];
      });

      features.push({
        id: `rel_${rel.id}`,
        name: tags.name || `${waterType} #${rel.id}`,
        waterType,
        isPolygon: true,
        geometry: {
          type: "MultiPolygon",
          coordinates: multiPolyCoords,
        },
        properties: tags,
      });
    }
  }

  // 2. Process Standalone Ways
  for (const [wayId, way] of ways.entries()) {
    if (waysUsedInRelations.has(wayId)) continue;
    const tags = way.tags || {};
    const coords: [number, number][] = [];
    for (const nid of way.nodes) {
      const pt = nodes.get(nid);
      if (pt) coords.push(pt);
    }
    if (coords.length < 2) continue;

    const waterType = normalizeWaterType(tags);
    const isClosed =
      coords.length >= 4 &&
      coords[0][0] === coords[coords.length - 1][0] &&
      coords[0][1] === coords[coords.length - 1][1];

    const isAreaTag =
      tags.natural === "water" ||
      tags.water ||
      tags.waterway === "riverbank" ||
      tags.landuse === "reservoir" ||
      tags.landuse === "basin" ||
      tags.area === "yes";

    if (isClosed && isAreaTag) {
      features.push({
        id: `way_${wayId}`,
        name: tags.name || `${waterType} #${wayId}`,
        waterType,
        isPolygon: true,
        geometry: {
          type: "Polygon",
          coordinates: [coords],
        },
        properties: tags,
      });
    } else {
      features.push({
        id: `way_${wayId}`,
        name: tags.name || `${waterType} #${wayId}`,
        waterType,
        isPolygon: false,
        geometry: {
          type: "LineString",
          coordinates: coords,
        },
        properties: tags,
      });
    }
  }

  return features;
}

/** Connects line segments into closed rings if possible */
function assembleRings(segments: [number, number][][]): [number, number][][] {
  if (segments.length === 0) return [];
  const rings: [number, number][][] = [];
  const remaining = [...segments];

  while (remaining.length > 0) {
    let current = remaining.shift()!;
    let extended = true;

    while (extended && remaining.length > 0) {
      extended = false;
      const head = current[0];
      const tail = current[current.length - 1];

      for (let i = 0; i < remaining.length; i++) {
        const seg = remaining[i];
        const segHead = seg[0];
        const segTail = seg[seg.length - 1];

        if (distSq(tail, segHead) < 1e-9) {
          current.push(...seg.slice(1));
          remaining.splice(i, 1);
          extended = true;
          break;
        } else if (distSq(tail, segTail) < 1e-9) {
          const rev = [...seg].reverse();
          current.push(...rev.slice(1));
          remaining.splice(i, 1);
          extended = true;
          break;
        } else if (distSq(head, segTail) < 1e-9) {
          current.unshift(...seg.slice(0, -1));
          remaining.splice(i, 1);
          extended = true;
          break;
        } else if (distSq(head, segHead) < 1e-9) {
          const rev = [...seg].reverse();
          current.unshift(...rev.slice(0, -1));
          remaining.splice(i, 1);
          extended = true;
          break;
        }
      }
    }

    // Ensure ring is closed
    if (
      current.length >= 3 &&
      distSq(current[0], current[current.length - 1]) > 1e-9
    ) {
      current.push([...current[0]]);
    }

    if (current.length >= 4) {
      rings.push(current);
    }
  }

  return rings;
}

function distSq(p1: [number, number], p2: [number, number]): number {
  const dx = p1[0] - p2[0];
  const dy = p1[1] - p2[1];
  return dx * dx + dy * dy;
}

function isRingInsideOuterRing(inner: [number, number][], outer: [number, number][]): boolean {
  if (inner.length === 0 || outer.length < 3) return false;
  const pt = inner[0];
  return isPointInPolyCoords(pt[0], pt[1], outer);
}

function isPointInPolyCoords(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function normalizeWaterType(tags: Record<string, string>): WaterSourceFeature["waterType"] {
  const wt = (tags.waterway || tags.water || tags.natural || "").toLowerCase();
  if (["river", "stream", "canal", "lake", "reservoir", "pond", "basin", "riverbank"].includes(wt)) {
    return wt as any;
  }
  if (tags.natural === "water") return "water";
  if (tags.landuse === "reservoir") return "reservoir";
  if (tags.landuse === "basin") return "basin";
  return "stream";
}

/**
 * Fetches OSM water sources for a given bounding box with mirror failover,
 * request deduplication, and caching.
 */
export async function fetchOsmWaterSources(
  bbox: { south: number; west: number; north: number; east: number },
  signal?: AbortSignal
): Promise<OsmWaterQueryResult> {
  const cacheKey = getCacheKey(bbox);

  // 1. Check in-memory cache
  const inMem = memoryCache.get(cacheKey);
  if (inMem && Date.now() - inMem.timestamp < CACHE_TTL_MS) {
    return { ...inMem.data, cached: true };
  }

  // 2. Check localStorage cache
  const localData = loadFromLocalStorage(cacheKey);
  if (localData) {
    memoryCache.set(cacheKey, { data: localData, timestamp: Date.now() });
    return localData;
  }

  // 3. Check in-flight request deduplication
  const existingReq = inFlightRequests.get(cacheKey);
  if (existingReq) {
    return existingReq;
  }

  const queryPromise = (async () => {
    const overpassQuery = `
      [out:json][timeout:20];
      (
        way["waterway"~"river|stream|canal|drain|ditch|riverbank|dock"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
        relation["waterway"~"river|stream|canal|drain|ditch|riverbank|dock"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
        way["water"~"lake|reservoir|pond|river|basin|canal|lagoon|oxbow|stream|pool"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
        relation["water"~"lake|reservoir|pond|river|basin|canal|lagoon|oxbow|stream|pool"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
        way["natural"~"water|coastline|bay|wetland"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
        relation["natural"~"water|coastline|bay|wetland"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
        way["landuse"~"reservoir|basin"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
        relation["landuse"~"reservoir|basin"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
      );
      out body;
      >;
      out skel qt;
    `.replace(/\s+/g, " ").trim();

    let lastError: any = null;

    for (const mirror of OVERPASS_MIRRORS) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      try {
        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => timeoutController.abort(), 16000);

        const onParentAbort = () => timeoutController.abort();
        signal?.addEventListener("abort", onParentAbort, { once: true });

        const resp = await fetch(mirror, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
          body: `data=${encodeURIComponent(overpassQuery)}`,
          signal: timeoutController.signal,
        });

        clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onParentAbort);

        if (!resp.ok) {
          lastError = new Error(`Mirror ${mirror} HTTP ${resp.status}`);
          continue;
        }

        const json = await resp.json();
        if (!json || !Array.isArray(json.elements)) {
          lastError = new Error("Invalid response elements from Overpass");
          continue;
        }

        const features = parseOverpassWaterElements(json.elements);
        const result: OsmWaterQueryResult = {
          features,
          isFallback: false,
          attribution: OSM_ATTRIBUTION,
          cached: false,
          sourceMirror: mirror,
        };

        memoryCache.set(cacheKey, { data: result, timestamp: Date.now() });
        saveToLocalStorage(cacheKey, result);
        return result;
      } catch (err: any) {
        if (err?.name === "AbortError" && signal?.aborted) {
          throw err;
        }
        lastError = err;
      }
    }

    // All mirrors failed or timed out
    console.warn("[OSM Water] All Overpass mirrors failed. Returning fallback empty response.", lastError);
    return {
      features: [],
      isFallback: true,
      fallbackReason: lastError?.message || "Overpass mirrors unreachable",
      attribution: OSM_ATTRIBUTION,
      cached: false,
    };
  })();

  inFlightRequests.set(cacheKey, queryPromise);
  try {
    return await queryPromise;
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}
