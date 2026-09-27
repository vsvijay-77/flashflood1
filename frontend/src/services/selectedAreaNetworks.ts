import { extractNetworks, type NetworkExtractionResponse } from "@/lib/routingApi";

import { loadBundledArea } from "./bundledArea";

/** Retry failed layers; the backend reuses each successfully saved layer. */
export async function loadSelectedAreaNetworks(
  params: Parameters<typeof extractNetworks>[0], signal: AbortSignal,
  onProgress?: (result: NetworkExtractionResponse) => void,
) {
  const bundled = await loadBundledArea(params, signal);
  if (bundled) return bundled;
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
    }
  }
  if (partial) return partial;
  throw lastError;
}
