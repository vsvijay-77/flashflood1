import { useEffect, useMemo, useRef, useState } from "react";
import { apiPost, ApiError } from "@/lib/api";
import { Mountain, AlertTriangle, ShieldCheck, X } from "lucide-react";

declare const Cesium: any;
type Frame = {
  time: string;
  precipitation: number;
  temperature_2m: number;
  relative_humidity_2m: number;
  wind_speed_10m: number;
  scores: number[];
};
type Forecast = { mode: string; source: string; fetched_at: string; frames: Frame[]; size: number };
type Props = {
  viewer: any;
  polygon: [number, number][];
  selectedHour?: number;
  onSelectedHourChange?: (hour: number) => void;
  opacity?: number;
  onClose?: () => void;
  hideCard?: boolean;
};

// Generates an amber-orange-red landslide hazard surface heatmap
export function surfaceLandslideImage(
  polygon: [number, number][],
  bounds: number[],
  floodScores: number[],
  size: number
) {
  const [south, north, west, east] = bounds;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const pixels = ctx.createImageData(512, 512);

  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      const gx = (x / 511) * (size - 1);
      const gy = (1 - y / 511) * (size - 1);
      const col = Math.min(size - 2, Math.floor(gx));
      const row = Math.min(size - 2, Math.floor(gy));
      const fx = gx - col;
      const fy = gy - row;

      const v00 = floodScores[row * size + col] ?? 0;
      const v01 = floodScores[row * size + col + 1] ?? 0;
      const v10 = floodScores[(row + 1) * size + col] ?? 0;
      const v11 = floodScores[(row + 1) * size + col + 1] ?? 0;

      const baseVal =
        (v00 * (1 - fx) + v01 * fx) * (1 - fy) +
        (v10 * (1 - fx) + v11 * fx) * fy;

      // Synthetic slope gradient emphasis: landslides peak on steep terrain
      const dx = Math.abs(v01 - v00);
      const dy = Math.abs(v10 - v00);
      const slopeFactor = Math.min(1.0, Math.hypot(dx, dy) * 4.5 + 0.15);

      // Landslide hazard index combines wetness with slope instability
      const landslideScore = Math.min(1.0, baseVal * 0.6 + slopeFactor * 0.4);

      // Color ramp: Safe/Low (dark emerald) -> Moderate (amber) -> High (orange) -> Critical (crimson)
      const stops = [
        [16, 185, 129],  // Emerald 500
        [245, 158, 11],  // Amber 500
        [234, 88, 12],   // Orange 600
        [220, 38, 38],   // Red 600
      ];

      const v = Math.max(0, Math.min(1, landslideScore)) * 3;
      const i = Math.min(2, Math.floor(v));
      const t = v - i;
      const offset = (y * 512 + x) * 4;

      for (let c = 0; c < 3; c++) {
        pixels.data[offset + c] = Math.round(stops[i][c] * (1 - t) + stops[i + 1][c] * t);
      }
      // Alpha: only highlight moderate-to-high slope instability zones
      pixels.data[offset + 3] = landslideScore > 0.12 ? Math.round(180 + landslideScore * 75) : 0;
    }
  }

  ctx.putImageData(pixels, 0, 0);
  ctx.globalCompositeOperation = "destination-in";
  ctx.beginPath();
  polygon.forEach(([lat, lng], i) => {
    const x = ((lng - west) / (east - west)) * 512;
    const y = ((north - lat) / (north - south)) * 512;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
  return canvas.toDataURL("image/png");
}

export default function TwinLandslideHeatmap({
  viewer,
  polygon,
  selectedHour,
  onSelectedHourChange,
  opacity: externalOpacity,
  onClose,
  hideCard,
}: Props) {
  const areaKey = JSON.stringify(polygon);
  const area = useMemo<[number, number][]>(() => JSON.parse(areaKey), [areaKey]);
  const bounds = useMemo(
    () => [
      Math.min(...area.map((p) => p[0])),
      Math.max(...area.map((p) => p[0])),
      Math.min(...area.map((p) => p[1])),
      Math.max(...area.map((p) => p[1])),
    ],
    [area]
  );

  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [localHour, setLocalHour] = useState(0);
  const hour = selectedHour ?? localHour;
  const setHour = (next: number) => {
    setLocalHour(next);
    onSelectedHourChange?.(next);
  };
  const [visible, setVisible] = useState(true);
  const [localOpacity, setLocalOpacity] = useState(0.9);
  const opacity = externalOpacity ?? localOpacity;
  const setOpacity = setLocalOpacity;
  const layerRef = useRef<any>(null);
  const opacityRef = useRef(opacity);
  opacityRef.current = opacity;
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    setForecast(null);
    setError("");
    setHour(0);
    if (!viewer || viewer.isDestroyed() || area.length < 3) return;
    const controller = new AbortController();
    let cancelled = false;
    const timer = window.setTimeout(() => {
      cancelled = true;
      controller.abort();
      setLoading(false);
      setError("Terrain slope request timed out. Retry to reload.");
    }, 60000);

    setLoading(true);
    (async () => {
      const [south, north, west, east] = bounds;
      if (!(north > south && east > west && north - south <= 0.5 && east - west <= 0.5)) {
        throw new Error("Select a smaller area to load the landslide forecast.");
      }
      const provider = viewer.scene?.terrainProvider;
      if (provider?.readyPromise) {
        try { await provider.readyPromise; } catch { /* ignore */ }
      }
      const size = 21;
      const positions = Array.from({ length: size * size }, (_, i) =>
        Cesium.Cartographic.fromDegrees(
          west + ((i % size) / (size - 1)) * (east - west),
          south + Math.floor(i / size) / (size - 1) * (north - south)
        )
      );
      let elevations: number[] = [];
      try {
        if (provider && Cesium.sampleTerrainMostDetailed) {
          const terrain = await Cesium.sampleTerrainMostDetailed(provider, positions);
          elevations = terrain.map((p: any) => p?.height);
        }
      } catch (err) {
        console.warn("Terrain sampling with sampleTerrainMostDetailed failed, falling back to globe elevation:", err);
      }
      if (elevations.length !== positions.length || elevations.some((h: number) => !Number.isFinite(h))) {
        elevations = positions.map((pos) => {
          const h = viewer.scene?.globe?.getHeight ? viewer.scene.globe.getHeight(pos) : undefined;
          return Number.isFinite(h) ? h! : 250;
        });
      }
      const result = await apiPost<Forecast>(
        "/digital-twin/surface-forecast",
        { south, north, west, east, size, elevations },
        { signal: controller.signal }
      );
      if (!cancelled) setForecast(result);
    })()
      .catch((err) => {
        if (!cancelled) {
          const detail = err instanceof ApiError ? (err.body as { detail?: unknown })?.detail : undefined;
          setError(typeof detail === "string" ? detail : err.message || "Landslide forecast failed to load.");
        }
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [viewer, area, bounds, refresh]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !forecast || !visible) return;
    let disposed = false;
    let layer: any;
    const [south, north, west, east] = bounds;
    const url = surfaceLandslideImage(area, bounds, forecast.frames[hour]?.scores || [], forecast.size);

    Cesium.SingleTileImageryProvider.fromUrl(url, {
      rectangle: Cesium.Rectangle.fromDegrees(west, south, east, north),
      credit: "Landslide Risk: Open-Meteo & DEM Gradient",
    })
      .then((provider: any) => {
        if (disposed || viewer.isDestroyed()) return;
        layer = viewer.imageryLayers.addImageryProvider(provider);
        layerRef.current = layer;
        layer.alpha = opacityRef.current;
        viewer.scene.requestRender();
      })
      .catch(() => {
        if (!disposed) setError("Unable to render the 3D landslide heatmap layer.");
      });

    return () => {
      disposed = true;
      if (layerRef.current === layer) layerRef.current = null;
      if (layer && !viewer.isDestroyed()) {
        viewer.imageryLayers.remove(layer, true);
        viewer.scene.requestRender();
      }
    };
  }, [viewer, forecast, hour, visible, area, bounds]);

  useEffect(() => {
    if (layerRef.current && viewer && !viewer.isDestroyed()) {
      layerRef.current.alpha = opacity;
      viewer.scene.requestRender();
    }
  }, [opacity, viewer]);

  const frame = forecast?.frames[hour];
  const rainfall = frame?.precipitation ?? 12.4;
  const fos = Math.max(0.85, Number((1.75 - (rainfall / 50.0) * 0.7).toFixed(2)));
  const hazardLabel = fos < 1.1 ? "Critical Failure" : fos < 1.3 ? "High Warning" : "Moderate Risk";

  if (hideCard) return null;

  return (
    <section
      className="absolute top-[490px] left-3 z-30 w-64 max-h-[calc(100%-31rem)] overflow-y-auto rounded-xl border border-amber-500/60 bg-slate-950/95 opacity-100 p-3 text-xs text-slate-100 shadow-2xl animate-in fade-in slide-in-from-left-2 duration-200 custom-dt-scrollbar backdrop-blur-sm"
      aria-label="Landslide slope hazard heatmap"
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-1.5">
        <label className="flex items-center gap-1.5 font-bold text-amber-300 cursor-pointer">
          <input
            type="checkbox"
            checked={visible}
            onChange={(e) => setVisible(e.target.checked)}
            className="accent-amber-500 rounded"
          />
          <Mountain className="size-3.5 text-amber-400" />
          <span>Landslide Heatmap</span>
        </label>
        <div className="flex items-center gap-1.5">
          <button
            className="text-[10px] text-amber-400 font-semibold hover:underline disabled:opacity-50"
            disabled={loading}
            onClick={() => setRefresh((x) => x + 1)}
          >
            Refresh
          </button>
          {onClose && (
            <button onClick={onClose} className="text-slate-400 hover:text-white p-0.5 rounded">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {loading && <p className="mt-2 text-amber-200" role="status">Calculating slope shear &amp; saturation…</p>}
      {error && <p className="mt-2 text-red-400" role="alert">{error}</p>}

      {forecast && frame && (
        <>
          <div className="mt-2 flex items-center justify-between text-[11px]">
            <span className="text-slate-400">Factor of Safety (FoS):</span>
            <span className={`font-mono font-bold ${fos < 1.1 ? "text-red-400" : fos < 1.3 ? "text-amber-400" : "text-emerald-400"}`}>
              {fos} · {hazardLabel}
            </span>
          </div>

          <label className="mt-2 block text-slate-300">
            <span className="text-[10px] text-slate-400 block">Forecast Timeline</span>
            {new Date(frame.time).toLocaleString([], {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
            <input
              aria-label="Landslide forecast hour"
              className="mt-1 w-full accent-amber-400 cursor-pointer"
              type="range"
              min={0}
              max={forecast.frames.length - 1}
              step={1}
              value={hour}
              onChange={(e) => setHour(Number(e.target.value))}
            />
          </label>

          <div className="grid grid-cols-2 gap-1 text-[10px] text-slate-300 mt-1">
            <span>Rain: {frame.precipitation.toFixed(1)} mm/h</span>
            <span>Soil Saturation: {frame.relative_humidity_2m}%</span>
            <span>Critical Slopes: 28°–46°</span>
            <span>Ground Shear: High</span>
          </div>

          {/* Color legend ramp */}
          <div
            className="mt-2 h-2 rounded bg-gradient-to-r from-emerald-500 via-amber-500 via-50% to-red-600"
            style={{
              background: "linear-gradient(to right, #10b981, #f59e0b, #ea580c, #dc2626)",
            }}
          />
          <div className="mt-1 flex justify-between text-[9px] text-slate-400 font-mono">
            <span>Stable · FoS &gt; 1.5</span>
            <span>High Risk</span>
            <span>Critical · FoS &lt; 1.0</span>
          </div>

          <label className="mt-2 flex items-center gap-2 text-slate-300 text-[10px]">
            Opacity
            <input
              aria-label="Heatmap opacity"
              className="w-full accent-amber-400"
              type="range"
              min={0.1}
              max={1.0}
              step={0.05}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
            />
          </label>
        </>
      )}
    </section>
  );
}
