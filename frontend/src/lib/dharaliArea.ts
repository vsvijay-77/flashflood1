import type { CustomArea } from "./types";
import { calculatePolygonAreaSqMeters } from "./gisUtils";

/**
 * Dharali is a village in Uttarkashi district, Uttarakhand, India.
 * This is the ONLY monitored area shown throughout the application.
 * All other areas from the API / Supabase are filtered out.
 */
export const DHARALI_AREA_ID = "b3e2c3ce-e6b0-4c37-8f85-5595d23f5d40";

export const DHARALI_POLYGON: [number, number][] = [
  [30.948169143221595, 78.71978759765625],
  [31.130844260159883, 78.7218475341797],
  [31.129374846459353, 79.06070709228517],
  [30.947580251654042, 79.07272338867189],
];

const areaSqMeters = calculatePolygonAreaSqMeters(DHARALI_POLYGON);

export const DHARALI_AREA: CustomArea = {
  id: DHARALI_AREA_ID,
  name: "Dharali",
  district: "Uttarkashi",
  type: "River Basin",
  risk: "High",
  priority: "High",
  description:
    "Dharali village and surrounding Uttarkashi river basin. High flash-flood and landslide risk zone monitored by the deployed LoRa sensor mesh network.",
  date: "2026-09-01",
  lat: 31.039,
  lng: 78.8938,
  shape: "Polygon",
  polygon: DHARALI_POLYGON,
  areaSqMeters,
  monitoring_type: "combined",
};

/**
 * Returns ONLY the Dharali area, discarding everything else.
 * Call this instead of rendering any array that comes from the API or Supabase.
 */
export const DHARALI_ONLY: CustomArea[] = [DHARALI_AREA];
