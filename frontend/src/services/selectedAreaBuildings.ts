import { extractBuildings, type BuildingFeature } from "@/lib/routingApi";

/**
 * Fetch building footprints for a polygon area, retrying up to 3 times.
 * The backend filters buildings to the polygon boundary and saves them to
 * Supabase — subsequent calls for the same area return instantly from cache.
 */
export async function loadSelectedAreaBuildings(
  polygon: [number, number][],
  signal: AbortSignal,
  onProgress?: (message: string) => void,
  areaId?: string,
  areaKey?: string,
): Promise<BuildingFeature[]> {
  signal.throwIfAborted();
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      onProgress?.(`Loading and saving building footprints · attempt ${attempt}/3`);
      const result = await extractBuildings(
        { polygon, area_id: areaId, area_key: areaKey },
        AbortSignal.any([signal, AbortSignal.timeout(300_000)]),
      );
      if (result.status !== "success" || result.osm_loading?.complete !== true || !Array.isArray(result.buildings?.geojson?.features)) {
        throw new Error("Incomplete building response");
      }
      signal.throwIfAborted();
      // Return the features as-is; the caller (loadBuildings) applies the
      // polygon boundary filter to match the exact drawn area.
      return result.buildings.geojson.features as BuildingFeature[];
    } catch (error) {
      signal.throwIfAborted();
      lastError = error;
      if (attempt < 3) await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, attempt * 2000);
        signal.addEventListener("abort", abort, { once: true });
      });
    }
  }
  throw lastError;
}
