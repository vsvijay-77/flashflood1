import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiGet } from "./api";
import { parseMultiHazardHeatmap, selectAreaPredictions, type MultiHazardModelInfo } from "./multiHazard";

function predictionError(error: unknown): string {
  if (error instanceof ApiError && error.status === 503) {
    const body = error.body as { detail?: string | { reason?: string; message?: string } } | null;
    const detail = body?.detail;
    return typeof detail === "string" ? detail : detail?.reason || detail?.message || "The model is not ready for predictions.";
  }
  return "The prediction service could not be reached or returned invalid data. Risk values are unavailable.";
}

/** Shared query keys keep the panel and map on the same API snapshot. */
export function useMultiHazard(areaId?: string, polygon?: [number, number][]) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const model = useQuery({
    queryKey: ["digital-twin", "multi-hazard-model"],
    queryFn: ({ signal }) => apiGet<MultiHazardModelInfo>("/digital-twin/multi-hazard/model-info", { signal }),
    retry: false,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const ready = !model.isError && model.data?.ready === true;
  const heatmap = useQuery({
    queryKey: ["digital-twin", "multi-hazard-heatmap", areaId ?? null, model.data?.model_version ?? null],
    queryFn: async ({ signal }) => parseMultiHazardHeatmap(await apiGet<unknown>(
      `/digital-twin/multi-hazard/heatmap/latest${areaId ? `?area_id=${encodeURIComponent(areaId)}` : ""}`,
      { signal },
    )),
    enabled: ready && Boolean(areaId || (polygon && polygon.length >= 3)),
    retry: false,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const features = useMemo(() => ready && !heatmap.isError && heatmap.data
    ? selectAreaPredictions(heatmap.data, areaId, polygon, model.data?.model_version)
    : [], [ready, heatmap.isError, heatmap.data, areaId, polygon, model.data?.model_version]);
  const timestamp = heatmap.data?.metadata?.timestamp || features[0]?.properties.timestamp;
  const ageMinutes = timestamp ? Math.max(0, Math.floor((now - Date.parse(timestamp)) / 60_000)) : null;
  const stale = heatmap.data?.metadata?.stale === true
    || (ageMinutes !== null && ageMinutes >= (model.data?.forecast_horizon_hours || 1) * 60);
  const message = model.isError
    ? "The model service could not be reached. Risk predictions are unavailable."
    : !ready
      ? model.data?.reason || "A trained model checkpoint is required before predictions can be shown."
      : heatmap.isError
        ? predictionError(heatmap.error)
        : heatmap.data?.metadata?.reason || (!features.length && !heatmap.isFetching
          ? "No predictions are available for this area. Run graph inference with this area's observations."
          : null);

  const refresh = async () => {
    const updated = await model.refetch();
    if (!updated.isError && updated.data?.ready) await heatmap.refetch();
  };
  return { model, heatmap, ready, features, timestamp, ageMinutes, stale, message, refresh };
}
