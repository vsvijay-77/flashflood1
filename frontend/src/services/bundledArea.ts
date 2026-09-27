import manifest from "./bundledAreaManifest.json";
import type { extractNetworks, NetworkExtractionResponse } from "@/lib/routingApi";

type Params = Parameters<typeof extractNetworks>[0];
export const bundledAreaVersion = manifest.map(entry => entry.sha256.slice(0, 12)).join("-");

export function bundledAreaEntry(params: Params) {
  const id = (params.area_id || params.area_key || "").replace(/^dt-area-/, "");
  // 1. Direct ID match
  if (id) {
    const matchById = manifest.find(entry => entry.area_id === id);
    if (matchById) return matchById;
  }

  // 2. Polygon match (exact or overlapping bounding box)
  if (params.polygon && params.polygon.length >= 3) {
    const pLats = params.polygon.map(p => p[0]);
    const pLngs = params.polygon.map(p => p[1]);
    const pMinLat = Math.min(...pLats), pMaxLat = Math.max(...pLats);
    const pMinLng = Math.min(...pLngs), pMaxLng = Math.max(...pLngs);

    const matchByPoly = manifest.find(entry => {
      if (entry.polygon.length === params.polygon!.length && params.polygon!.every((point, i) =>
        point.length === 2 && point.every((v, j) => Math.abs(v - entry.polygon[i][j]) < 1e-5))) {
        return true;
      }
      const eLats = entry.polygon.map(p => p[0]);
      const eLngs = entry.polygon.map(p => p[1]);
      const eMinLat = Math.min(...eLats), eMaxLat = Math.max(...eLats);
      const eMinLng = Math.min(...eLngs), eMaxLng = Math.max(...eLngs);

      const latOverlap = Math.max(0, Math.min(pMaxLat, eMaxLat) - Math.max(pMinLat, eMinLat));
      const lngOverlap = Math.max(0, Math.min(pMaxLng, eMaxLng) - Math.max(pMinLng, eMinLng));
      const overlapArea = latOverlap * lngOverlap;
      const pArea = (pMaxLat - pMinLat) * (pMaxLng - pMinLng);
      return pArea > 0 && (overlapArea / pArea) > 0.4;
    });
    if (matchByPoly) return matchByPoly;
  }

  return manifest[0] || null;
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
    if (data.status !== "success") return null;
    return data;
  } catch {
    signal.throwIfAborted();
    return null;
  }
}
