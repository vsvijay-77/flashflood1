import { extractNetworks, type NetworkExtractionResponse } from "@/lib/routingApi";

async function loadPrebakedZone(params: Parameters<typeof extractNetworks>[0]): Promise<NetworkExtractionResponse | null> {
  try {
    const rawId = params.area_id || params.area_key || "";
    const cleanId = rawId.replace(/^dt-area-/, "");
    const urls: string[] = [];
    if (cleanId) {
      urls.push(`/prebaked_zones/${cleanId}.json`);
    }
    const lat = params.lat ?? params.polygon?.[0]?.[0];
    const lng = params.lng ?? params.polygon?.[0]?.[1];
    if (lat != null && lng != null && lat >= 30 && lat <= 32 && lng >= 78 && lng <= 80) {
      urls.push("/prebaked_zones/zone2.json");
    }
    if (cleanId || lat != null) {
      urls.push("/prebaked_zones/default.json");
    }

    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (data && (data.roads?.geojson?.features?.length || data.rivers?.geojson?.features?.length)) {
            return data as NetworkExtractionResponse;
          }
        }
      } catch {}
    }
  } catch {}
  return null;
}

/** Retry failed layers; the backend reuses each successfully saved layer. */
export async function loadSelectedAreaNetworks(
  params: Parameters<typeof extractNetworks>[0], signal: AbortSignal,
  onProgress?: (result: NetworkExtractionResponse) => void,
) {
  let lastError: unknown;
  let partial: NetworkExtractionResponse | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    if (attempt > 0) {
      // Back off before retrying: 2s, then 4s
      await new Promise<void>((resolve, reject) => {
        const delay = attempt * 2000;
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, delay);
        signal.addEventListener("abort", abort, { once: true });
      });
      signal.throwIfAborted();
    }
    try {
      const result = await extractNetworks(params, signal);
      signal.throwIfAborted();
      if (result.status === "success" && result.osm_loading?.complete === true) return result;
      const roadCount = result.roads?.geojson?.features?.length ?? 0;
      const riverCount = result.rivers?.geojson?.features?.length ?? 0;
      if (result.status === "success" && (roadCount > 0 || riverCount > 0)) {
        // A cache outage can put retries on different serverless instances.
        // Retain geometry already received even if the next partial response
        // contains only the other layer.
        partial = partial ? {
          ...result,
          roads: roadCount > 0 ? result.roads : partial.roads,
          rivers: riverCount > 0 ? result.rivers : partial.rivers,
        } : result;
        onProgress?.(partial);
      }
      // Partial success — all saved layers will be reused on the next attempt
      lastError = new Error("Some network layers are incomplete");
    } catch (error) {
      signal.throwIfAborted();
      lastError = error;
      const prebaked = await loadPrebakedZone(params);
      if (prebaked) {
        onProgress?.(prebaked);
        return prebaked;
      }
    }
  }
  if (partial) return partial;
  const prebaked = await loadPrebakedZone(params);
  if (prebaked) return prebaked;
  throw lastError;
}
