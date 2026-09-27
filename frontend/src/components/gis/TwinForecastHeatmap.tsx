import { useEffect, useMemo, useRef, useState } from "react";
import { apiPost, ApiError } from "@/lib/api";
import { hazardColor } from "../simulation/waterRisk";

declare const Cesium: any;
type Frame = { time: string; precipitation: number; temperature_2m: number; relative_humidity_2m: number; wind_speed_10m: number; scores: number[] };
type Forecast = { mode: string; source: string; fetched_at: string; frames: Frame[]; size: number };
const forecastCache = new Map<string, { at: number; forecast: Forecast }>();
const frameCache = new WeakMap<Forecast, Map<number, string>>();
const isMeasuredHeight = (height: unknown): height is number => typeof height === "number" && Number.isFinite(height) && height >= -500 && height <= 9000;
type Props = {
  viewer: any;
  polygon: [number, number][];
  selectedHour?: number;
  onSelectedHourChange?: (hour: number) => void;
  onFrameTimesChange?: (times: string[]) => void;
  opacity?: number;
  hideCard?: boolean;
};

export function validateForecast(value: Forecast): Forecast {
  if (!Number.isInteger(value?.size) || value.size < 2 || value.size > 21 || !Array.isArray(value.frames) || !value.frames.length
    || value.frames.some(frame => !Number.isFinite(Date.parse(frame.time))
      || ![frame.precipitation, frame.temperature_2m, frame.relative_humidity_2m, frame.wind_speed_10m].every(Number.isFinite)
      || !Array.isArray(frame.scores) || frame.scores.length !== value.size * value.size
      || frame.scores.some(score => !Number.isFinite(score) || score < 0 || score > 1))) {
    throw new Error("Forecast data is incomplete. Retry to load the heatmap.");
  }
  return value;
}

export function forecastFrameIndex(hour: number, count: number) {
  return Math.max(0, Math.min(Math.max(0, count - 1), Number.isFinite(hour) ? Math.floor(hour) : 0));
}

// Rows run south to north; the image runs north to south.
export function surfaceImage(
  polygon: [number, number][],
  bounds: number[],
  scores: number[],
  size: number,
  _elevations?: number[],
  resolution = 512
) {
  if (scores.length !== size * size || scores.some(score => !Number.isFinite(score))) throw new Error("Incomplete heatmap scores");
  const [south, north, west, east] = bounds;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = resolution;
  const ctx = canvas.getContext("2d")!;
  const pixels = ctx.createImageData(resolution, resolution);

  // Absolute forecast scale: dry terrain must not be painted as inundation.
  const effectiveScores = scores.map(score => Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0);
  for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
    const gx = x / (resolution - 1) * (size - 1), gy = (1 - y / (resolution - 1)) * (size - 1);
    const col = Math.min(size - 2, Math.floor(gx)), row = Math.min(size - 2, Math.floor(gy));
    const fx = gx - col, fy = gy - row;
    const rawVal = (effectiveScores[row * size + col] * (1 - fx) + effectiveScores[row * size + col + 1] * fx) * (1 - fy)
      + (effectiveScores[(row + 1) * size + col] * (1 - fx) + effectiveScores[(row + 1) * size + col + 1] * fx) * fy;

    const value = Math.max(0, Math.min(1, rawVal));
    const offset = (y * resolution + x) * 4;
    pixels.data.set(hazardColor(value), offset);
    // Show the full area: minimum alpha 60 for zero-risk cells so the entire polygon is always visible
    pixels.data[offset + 3] = Math.max(60, Math.round(245 * Math.min(1, value * 3)));
  }
  ctx.putImageData(pixels, 0, 0);

  if (polygon && polygon.length >= 3) {
    ctx.globalCompositeOperation = "destination-in";
    ctx.beginPath();
    const dLng = Math.max(1e-7, east - west);
    const dLat = Math.max(1e-7, north - south);
    // Expand each vertex by 2px toward outside so edge pixels are fully included
    const pxs = polygon.map(([lat, lng]) => ({
      x: (lng - west) / dLng * resolution,
      y: (north - lat) / dLat * resolution,
    }));
    const cx = pxs.reduce((s, p) => s + p.x, 0) / pxs.length;
    const cy = pxs.reduce((s, p) => s + p.y, 0) / pxs.length;
    pxs.forEach((p, i) => {
      const dx = p.x - cx, dy = p.y - cy;
      const len = Math.max(1, Math.hypot(dx, dy));
      const ex = p.x + (dx / len) * 2, ey = p.y + (dy / len) * 2;
      if (i === 0) ctx.moveTo(ex, ey); else ctx.lineTo(ex, ey);
    });
    ctx.closePath();
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }
  return canvas.toDataURL("image/png");
}

export default function TwinForecastHeatmap({
  viewer,
  polygon,
  selectedHour,
  onSelectedHourChange,
  onFrameTimesChange,
  opacity: externalOpacity,
  hideCard,
}: Props) {
  const areaKey = JSON.stringify(polygon);
  const area = useMemo<[number, number][]>(() => JSON.parse(areaKey), [areaKey]);
  const bounds = useMemo(() => [Math.min(...area.map(p => p[0])), Math.max(...area.map(p => p[0])),
    Math.min(...area.map(p => p[1])), Math.max(...area.map(p => p[1]))], [area]);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [localHour, setLocalHour] = useState(0);
  const hour = forecastFrameIndex(selectedHour ?? localHour, forecast?.frames.length ?? 0);
  const setHour = (next: number) => {
    setLocalHour(next);
    onSelectedHourChange?.(next);
  };
  const [visible, setVisible] = useState(true);
  const [localOpacity, setLocalOpacity] = useState(1.0);
  const opacity = externalOpacity ?? localOpacity;
  const setOpacity = setLocalOpacity;
  const layerRef = useRef<any>(null);

  const opacityRef = useRef(opacity);
  opacityRef.current = opacity;
  const [refresh, setRefresh] = useState(0);
  useEffect(() => { onFrameTimesChange?.(forecast?.frames.map(frame => frame.time) ?? []); }, [forecast, onFrameTimesChange]);
  useEffect(() => {
    setForecast(null); setError(""); setHour(0);
    if (!viewer || viewer.isDestroyed() || area.length < 3) return;
    const controller = new AbortController();
    let cancelled = false;
    const timer = window.setTimeout(() => { cancelled = true; controller.abort(); setLoading(false); setError("Terrain or weather request timed out. Retry to load the heatmap."); }, 60000);
    const cached = forecastCache.get(areaKey);
    if (refresh === 0 && cached && Date.now() - cached.at < 300000) {
      window.clearTimeout(timer); setForecast(cached.forecast); setLoading(false);
      return () => { cancelled = true; controller.abort(); };
    }
    setLoading(true);
    (async () => {
      const [south, north, west, east] = bounds;
      // Allow up to 1.0° areas so large monitored zones get full coverage
      if (!(north > south && east > west && north - south <= 1.0 && east - west <= 1.0)) throw new Error("Select an area smaller than 1 degree to load the terrain forecast.");
      const provider = viewer.terrainProvider ?? viewer.scene?.terrainProvider;
      if (!provider || provider instanceof Cesium.EllipsoidTerrainProvider) throw new Error("Terrain elevations are unavailable. Load terrain and retry.");
      if (provider?.readyPromise) {
        try { await provider.readyPromise; } catch { /* ignore */ }
      }
      // Use maximum 21×21 grid = 441 points for dense, full-area coverage
      const size = 21;
      const positions = Array.from({ length: size * size }, (_, i) => Cesium.Cartographic.fromDegrees(
        west + (i % size) / (size - 1) * (east - west), south + Math.floor(i / size) / (size - 1) * (north - south)));

      // Fast path: reuse already-loaded Cesium globe tile heights (zero network cost)
      let elevations = positions.map(pos => viewer.scene?.globe?.getHeight?.(pos));
      const hasMissing = elevations.some(h => !isMeasuredHeight(h));

      if (hasMissing && provider && !(provider instanceof Cesium.EllipsoidTerrainProvider)) {
        let terrainTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          // Bounded coarse terrain fetch for the weather/terrain estimate.
          const terrain: any = await Promise.race([
            Cesium.sampleTerrain(provider, 8, positions),
            new Promise((_, reject) => { terrainTimer = setTimeout(() => reject(new Error("Terrain sampling timed out")), 2000); }),
          ]);
          elevations = terrain.map((p: any, i: number) => isMeasuredHeight(p?.height) ? p.height : elevations[i]);
        } catch {
          // Keep measured globe heights; incomplete coverage is reported below.
        } finally { clearTimeout(terrainTimer); }
      }
      if (cancelled) return;

      // Missing terrain cannot be inferred from camera altitude or a flat mean.
      if (elevations.some(h => !isMeasuredHeight(h))) throw new Error("Terrain coverage is incomplete or outside supported elevations. Retry once the area is loaded.");

      const result = validateForecast(await apiPost<Forecast>("/digital-twin/surface-forecast", { south, north, west, east, size, elevations }, { signal: controller.signal }));
      if (!cancelled) {
        if (forecastCache.size >= 8) forecastCache.delete(forecastCache.keys().next().value!);
        forecastCache.set(areaKey, { at: Date.now(), forecast: result });
        setForecast(result);
      }
    })().catch(err => {
      if (!cancelled) {
        console.error("[TwinForecastHeatmap] Forecast fetch error:", err);
        const detail = err instanceof ApiError ? (err.body as { detail?: unknown })?.detail : undefined;
        setError(typeof detail === "string" ? detail : err.message || "Forecast could not be loaded.");
      }
    }).finally(() => { window.clearTimeout(timer); if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [viewer, area, bounds, refresh]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !forecast || !visible) return;
    let disposed = false;
    const [south, north, west, east] = bounds;
    const frame = forecast.frames[hour];
    if (!frame?.scores) return;
    let images = frameCache.get(forecast);
    if (!images) { images = new Map(); frameCache.set(forecast, images); }
    let url = images.get(hour);
    if (!url) {
      url = surfaceImage(area, bounds, frame.scores, forecast.size, undefined, 512);
      if (images.size >= 12) images.delete(images.keys().next().value!);
      images.set(hour, url);
    }
    Cesium.SingleTileImageryProvider.fromUrl(url, {
      rectangle: Cesium.Rectangle.fromDegrees(west, south, east, north),
      credit: "Weather: Open-Meteo",
    }).then((provider: any) => {
      if (disposed || viewer.isDestroyed()) return;
      const previous = layerRef.current;
      const layer = viewer.imageryLayers.addImageryProvider(provider);
      layerRef.current = layer;
      layer.alpha = opacityRef.current;
      viewer.imageryLayers.raiseToTop(layer);
      if (previous) viewer.imageryLayers.remove(previous, true);
      viewer.scene.requestRender();
      setError("");
    }).catch((err: any) => {
      console.error("[TwinForecastHeatmap] fromUrl error:", err);
      if (!disposed) setError("Unable to render the surface heatmap.");
    });
    return () => { disposed = true; };
  }, [viewer, forecast, hour, visible, area, bounds]);

  // Keep the previous hour visible until its replacement has loaded. Area
  // changes, refreshes, hiding and unmounting still remove the old layer.
  const hasForecast = !!forecast;
  useEffect(() => () => {
    if (layerRef.current && viewer && !viewer.isDestroyed()) {
      viewer.imageryLayers.remove(layerRef.current, true);
      viewer.scene.requestRender();
    }
    layerRef.current = null;
  }, [viewer, area, visible, hasForecast]);

  useEffect(() => {
    if (layerRef.current && viewer && !viewer.isDestroyed()) {
      layerRef.current.alpha = opacity;
      viewer.scene.requestRender();
    }
  }, [opacity, viewer]);

  const frame = forecast?.frames[hour];
  if (hideCard) return loading || error ? <div role="status" className="absolute top-28 left-3 z-30 max-w-72 rounded-lg bg-slate-950/95 p-3 text-xs text-cyan-100">
    {loading ? "Loading terrain and hourly weather estimate…" : error}
    {error && <button className="ml-2 underline" onClick={() => setRefresh(x => x + 1)}>Retry heatmap</button>}
  </div> : null;
  return <section className="absolute top-[405px] left-3 z-30 w-64 max-h-[calc(100%-26rem)] overflow-y-auto rounded-xl border border-cyan-500/50 bg-slate-950 opacity-100 p-3 text-xs text-slate-100 shadow-2xl animate-in fade-in slide-in-from-left-2 duration-200 custom-dt-scrollbar" aria-label="Weather forecast surface heatmap" onKeyDown={e => e.stopPropagation()} onKeyUp={e => e.stopPropagation()}>
    <div className="flex items-center justify-between gap-2">
      <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={visible} onChange={e => setVisible(e.target.checked)} /> Forecast heatmap</label>
      <button className="text-cyan-300 disabled:opacity-50" disabled={loading} onClick={() => setRefresh(x => x + 1)}>Refresh</button>
    </div>
    {loading && <p className="mt-2" role="status">Loading terrain and hourly weather…</p>}
    {error && <p className="mt-2 text-amber-300" role="alert">{error}</p>}
    {forecast && frame && <>
      <p className="mt-2 text-amber-200">{forecast.mode === "gnn_transformer" ? "GNN–Transformer · loaded checkpoint" : "Experimental weather + terrain estimate · no trained weights"}</p>
      <label className="mt-2 block">{new Date(frame.time).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        <input aria-label="Forecast hour" className="mt-1 w-full accent-cyan-400" type="range" min={0} max={forecast.frames.length - 1} step={1} value={hour} onChange={e => setHour(Number(e.target.value))} />
      </label>
      <div className="grid grid-cols-2 gap-1 text-slate-300"><span>Rain {frame.precipitation.toFixed(1)} mm/h</span><span>{frame.temperature_2m.toFixed(1)} °C</span><span>Humidity {frame.relative_humidity_2m}%</span><span>Wind {frame.wind_speed_10m} km/h</span></div>
      <div className="mt-2 h-2 rounded bg-gradient-to-r from-blue-600 via-cyan-500 via-35% to-red-600" style={{ background: "linear-gradient(to right,#2563eb,#06b6d4,#ea580c,#dc2626)" }} />
      <div className="mt-1 flex justify-between text-[10px]"><span>Low · 0</span><span>Forecast hazard index</span><span className="text-red-400 font-bold">High · 1</span></div>
      <label className="mt-2 flex items-center gap-2">Opacity<input aria-label="Heatmap opacity" className="w-full accent-cyan-400" type="range" min={0.1} max={1.0} step={0.05} value={opacity} onChange={e => setOpacity(Number(e.target.value))} /></label>
      <p className="mt-2 text-[10px] text-slate-400"><a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="underline">Open-Meteo</a> · fetched {new Date(forecast.fetched_at).toLocaleTimeString()} · area-centre weather; local terrain variation. Not a calibrated flood probability.</p>
    </>}
  </section>;
}
