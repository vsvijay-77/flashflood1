import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

export interface DigitalTwinEvacPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  elev?: number;
  instructions?: string;
  areaName?: string;
  created_at?: string;
}

export const STORAGE_KEY_UNIFIED = "dt_digital_twin_evacuation_points";
export const EVENT_NAME = "dt_evacuation_points_updated";

/**
 * Reads all evacuation points created on Digital Twin from localStorage
 * across all areas (both the unified list and any area-specific keys dt_evac_waypoints_*).
 */
export function getLocalDigitalTwinEvacPoints(): DigitalTwinEvacPoint[] {
  const pointsMap = new Map<string, DigitalTwinEvacPoint>();

  // 1. Read from unified storage
  try {
    const raw = localStorage.getItem(STORAGE_KEY_UNIFIED);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((p) => {
          if (p && typeof p.lat === "number" && typeof p.lng === "number" && p.name) {
            pointsMap.set(p.id || `${p.lat.toFixed(5)}_${p.lng.toFixed(5)}`, {
              id: p.id || `wp-${Date.now()}`,
              name: p.name,
              lat: p.lat,
              lng: p.lng,
              elev: p.elev != null ? p.elev : 310,
              instructions: p.instructions || `Proceed to safe Digital Twin shelter: ${p.name}`,
              areaName: p.areaName || "Digital Twin",
              created_at: p.created_at || new Date().toISOString(),
            });
          }
        });
      }
    }
  } catch (e) {
    console.warn("Failed reading unified dt evacuation points", e);
  }

  // 2. Read from any area-specific keys (dt_evac_waypoints_*)
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("dt_evac_waypoints_")) {
        const areaSuffix = key.replace("dt_evac_waypoints_", "").replace(/_/g, " ");
        const raw = localStorage.getItem(key);
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            list.forEach((p) => {
              if (p && typeof p.lat === "number" && typeof p.lng === "number") {
                const id = p.id || `${p.lat.toFixed(5)}_${p.lng.toFixed(5)}`;
                if (!pointsMap.has(id)) {
                  pointsMap.set(id, {
                    id,
                    name: p.name || `Evacuation Point (${areaSuffix})`,
                    lat: p.lat,
                    lng: p.lng,
                    elev: p.elev != null ? p.elev : 310,
                    instructions: p.instructions || `Proceed to safe Digital Twin shelter: ${p.name || areaSuffix}`,
                    areaName: p.areaName || areaSuffix,
                    created_at: p.created_at || new Date().toISOString(),
                  });
                }
              }
            });
          }
        }
      }
    }
  } catch (e) {
    console.warn("Failed reading area-specific dt evacuation points", e);
  }

  return Array.from(pointsMap.values());
}

/**
 * Persist an evacuation point created on Digital Twin.
 */
export async function saveDigitalTwinEvacPoint(point: DigitalTwinEvacPoint): Promise<void> {
  const current = getLocalDigitalTwinEvacPoints();
  const existingIdx = current.findIndex(
    (p) =>
      p.id === point.id ||
      (Math.abs(p.lat - point.lat) < 0.0001 && Math.abs(p.lng - point.lng) < 0.0001)
  );

  let updated: DigitalTwinEvacPoint[];
  if (existingIdx >= 0) {
    updated = [...current];
    updated[existingIdx] = { ...updated[existingIdx], ...point };
  } else {
    updated = [point, ...current];
  }

  try {
    localStorage.setItem(STORAGE_KEY_UNIFIED, JSON.stringify(updated));
  } catch (e) {}

  window.dispatchEvent(new Event(EVENT_NAME));

  // Sync to backend DB asynchronously
  try {
    await apiPost("/digital-twin/evacuation-points", point);
  } catch (e) {
    // Non-blocking: local storage is already saved
  }
}

/**
 * Delete a Digital Twin evacuation point.
 */
export async function removeDigitalTwinEvacPoint(pointId: string): Promise<void> {
  const current = getLocalDigitalTwinEvacPoints();
  const updated = current.filter((p) => p.id !== pointId);

  try {
    localStorage.setItem(STORAGE_KEY_UNIFIED, JSON.stringify(updated));
    // Also remove from area-specific keys
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("dt_evac_waypoints_")) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            const filtered = list.filter((p) => p.id !== pointId);
            localStorage.setItem(key, JSON.stringify(filtered));
          }
        }
      }
    }
  } catch (e) {}

  window.dispatchEvent(new Event(EVENT_NAME));

  try {
    await apiDelete(`/digital-twin/evacuation-points/${pointId}`);
  } catch (e) {}
}

/**
 * React hook for consuming evacuation points created on Digital Twin.
 * Automatically synchronizes between Backend DB and localStorage.
 */
export function useDigitalTwinEvacuationPoints() {
  const [points, setPoints] = useState<DigitalTwinEvacPoint[]>(getLocalDigitalTwinEvacPoints);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    const local = getLocalDigitalTwinEvacPoints();
    setPoints(local);

    try {
      const remote = await apiGet<DigitalTwinEvacPoint[]>("/digital-twin/evacuation-points");
      if (Array.isArray(remote)) {
        const mergedMap = new Map<string, DigitalTwinEvacPoint>();
        local.forEach((p) => mergedMap.set(p.id, p));
        remote.forEach((p) => mergedMap.set(p.id, p));
        const merged = Array.from(mergedMap.values());
        setPoints(merged);
        try {
          localStorage.setItem(STORAGE_KEY_UNIFIED, JSON.stringify(merged));
        } catch (e) {}
      }
    } catch (e) {
      // Backend offline or error; local points serve as source of truth
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();

    const handleUpdate = () => {
      setPoints(getLocalDigitalTwinEvacPoints());
    };

    window.addEventListener(EVENT_NAME, handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener(EVENT_NAME, handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, [refresh]);

  return {
    points,
    count: points.length,
    hasPoints: points.length > 0,
    refresh,
    isLoading,
  };
}
