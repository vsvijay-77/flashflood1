import manifest from "./bundledAreaManifest.json";
import type { extractNetworks, NetworkExtractionResponse } from "@/lib/routingApi";

type Params = Parameters<typeof extractNetworks>[0];
export const bundledAreaVersion = manifest.map(entry => entry.sha256.slice(0, 12)).join("-");

export function bundledAreaEntry(params: Params) {
  const id = (params.area_id || params.area_key || "").replace(/^dt-area-/, "");
  return manifest.find(entry => {
    if (id && id !== entry.area_id) return false;
    if (params.polygon) {
      return params.polygon.length === entry.polygon.length && params.polygon.every((point, i) =>
        point.length === 2 && point.every((v, j) => Math.abs(v - entry.polygon[i][j]) < 1e-9));
    }
    // Do not reuse an entire saved area for a different viewport or radius.
    if ([params.north, params.south, params.east, params.west].some(v => v != null)) return false;
    return id === entry.area_id;
  });
}

export async function loadBundledArea(params: Params, signal: AbortSignal): Promise<NetworkExtractionResponse | null> {
  signal.throwIfAborted();
  const entry = bundledAreaEntry(params);
  if (!entry) return null;
  try {
    const response = await fetch(`/prebaked_zones/${entry.file}?v=${entry.sha256.slice(0, 12)}`, { signal });
    if (!response.ok) return null;
    const data = await response.json();
    signal.throwIfAborted();
    if (data.snapshot?.area_id !== entry.area_id || data.osm_loading?.complete !== true
      || JSON.stringify(data.snapshot.polygon) !== JSON.stringify(entry.polygon)) return null;
    for (const name of ["roads", "rivers", "buildings"] as const) {
      if (!Array.isArray(data[name]?.geojson?.features) || data[name].geojson.features.length !== entry.counts[name]) return null;
    }
    return data;
  } catch {
    signal.throwIfAborted();
    return null;
  }
}
