import { useEffect, useMemo, useRef, useState } from "react";
import { apiPost, ApiError } from "@/lib/api";

declare const Cesium: any;
type Frame = { time: string; precipitation: number; temperature_2m: number; relative_humidity_2m: number; wind_speed_10m: number; scores: number[] };
type Forecast = { mode: string; source: string; fetched_at: string; frames: Frame[]; size: number };
type Props = {
  viewer: any;
  polygon: [number, number][];
  selectedHour?: number;
  onSelectedHourChange?: (hour: number) => void;
};

// Rows run south to north; the image runs north to south.
export function surfaceImage(polygon: [number, number][], bounds: number[], scores: number[], size: number) {
  const [south, north, west, east] = bounds;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const pixels = ctx.createImageData(512, 512);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const gx = x / 511 * (size - 1), gy = (1 - y / 511) * (size - 1);
    const col = Math.min(size - 2, Math.floor(gx)), row = Math.min(size - 2, Math.floor(gy));
    const fx = gx - col, fy = gy - row;
    const value = (scores[row * size + col] * (1 - fx) + scores[row * size + col + 1] * fx) * (1 - fy)
      + (scores[(row + 1) * size + col] * (1 - fx) + scores[(row + 1) * size + col + 1] * fx) * fy;
    // Fixed index scale: blue -> cyan -> yellow -> red.
    const stops = [[37, 99, 235], [6, 182, 212], [250, 204, 21], [220, 38, 38]];
    const v = Math.max(0, Math.min(1, value)) * 3, i = Math.min(2, Math.floor(v));
    const offset = (y * 512 + x) * 4;
    for (let c = 0; c < 3; c++) pixels.data[offset + c] = Math.round(stops[i][c] * (1 - (v - i)) + stops[i + 1][c] * (v - i));
    pixels.data[offset + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  ctx.globalCompositeOperation = "destination-in";
  ctx.beginPath();
  polygon.forEach(([lat, lng], i) => {
    const x = (lng - west) / (east - west) * 512, y = (north - lat) / (north - south) * 512;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath(); ctx.fill();
  return canvas.toDataURL("image/png");
}

export default function TwinForecastHeatmap({ viewer, polygon, selectedHour, onSelectedHourChange }: Props) {
  const areaKey = JSON.stringify(polygon);
  const area = useMemo<[number, number][]>(() => JSON.parse(areaKey), [areaKey]);
  const bounds = useMemo(() => [Math.min(...area.map(p => p[0])), Math.max(...area.map(p => p[0])),
    Math.min(...area.map(p => p[1])), Math.max(...area.map(p => p[1]))], [area]);
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
  const [opacity, setOpacity] = useState(1.0);
  const layerRef = useRef<any>(null);
  const opacityRef = useRef(opacity);
  opacityRef.current = opacity;
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    setForecast(null); setError(""); setHour(0);
    if (!viewer || viewer.isDestroyed() || area.length < 3) return;
    const controller = new AbortController();
    let cancelled = false;
    const timer = window.setTimeout(() => { cancelled = true; controller.abort(); setLoading(false); setError("Terrain or weather request timed out. Retry to load the heatmap."); }, 60000);
    setLoading(true);
    (async () => {
      const [south, north, west, east] = bounds;
      if (!(north > south && east > west && north - south <= 0.5 && east - west <= 0.5)) throw new Error("Select a smaller area to load the terrain forecast.");
      await viewer.scene.terrainProvider.readyPromise;
      const provider = viewer.scene.terrainProvider;
      if (!provider.availability) throw new Error("Elevation terrain is not ready. Retry once the 3D terrain has loaded.");
      const size = 21;
      const positions = Array.from({ length: size * size }, (_, i) => Cesium.Cartographic.fromDegrees(
        west + (i % size) / (size - 1) * (east - west), south + Math.floor(i / size) / (size - 1) * (north - south)));
      const terrain = await Cesium.sampleTerrainMostDetailed(provider, positions);
      if (cancelled) return;
      const elevations = terrain.map((p: any) => p.height);
      if (elevations.some((h: number) => !Number.isFinite(h))) throw new Error("Elevation data is incomplete for this area.");
      const result = await apiPost<Forecast>("/digital-twin/surface-forecast", { south, north, west, east, size, elevations }, { signal: controller.signal });
      if (!cancelled) setForecast(result);
    })().catch(err => {
      if (!cancelled) {
        const detail = err instanceof ApiError ? (err.body as { detail?: unknown })?.detail : undefined;
        setError(typeof detail === "string" ? detail : err.message || "Forecast could not be loaded.");
      }
    }).finally(() => { window.clearTimeout(timer); if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [viewer, area, bounds, refresh]);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || !forecast || !visible) return;
    let disposed = false;
    let layer: any;
    const [south, north, west, east] = bounds;
    const url = surfaceImage(area, bounds, forecast.frames[hour].scores, forecast.size);
    Cesium.SingleTileImageryProvider.fromUrl(url, {
      rectangle: Cesium.Rectangle.fromDegrees(west, south, east, north),
      credit: "Weather: Open-Meteo",
    }).then((provider: any) => {
      if (disposed || viewer.isDestroyed()) return;
      layer = viewer.imageryLayers.addImageryProvider(provider);
      layerRef.current = layer;
      layer.alpha = opacityRef.current;
      viewer.scene.requestRender();
    }).catch(() => { if (!disposed) setError("Unable to render the surface heatmap."); });
    return () => {
      disposed = true;
      if (layerRef.current === layer) layerRef.current = null;
      if (layer && !viewer.isDestroyed()) { viewer.imageryLayers.remove(layer, true); viewer.scene.requestRender(); }
    };
  }, [viewer, forecast, hour, visible, area, bounds]);

  useEffect(() => {
    if (layerRef.current && viewer && !viewer.isDestroyed()) {
      layerRef.current.alpha = opacity;
      viewer.scene.requestRender();
    }
  }, [opacity, viewer]);

  const frame = forecast?.frames[hour];
  return <section className="absolute top-[385px] left-3 z-30 w-64 max-h-[calc(100%-25rem)] overflow-y-auto rounded-xl border border-cyan-500/50 bg-slate-950 opacity-100 p-3 text-xs text-slate-100 shadow-2xl animate-in fade-in slide-in-from-left-2 duration-200 custom-dt-scrollbar" aria-label="Weather forecast surface heatmap" onKeyDown={e => e.stopPropagation()} onKeyUp={e => e.stopPropagation()}>
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
      <div className="mt-2 h-2 rounded bg-gradient-to-r from-blue-600 via-cyan-500 via-35% to-red-600" style={{ background: "linear-gradient(to right,#2563eb,#06b6d4,#facc15,#dc2626)" }} />
      <div className="mt-1 flex justify-between text-[10px]"><span>Low · 0</span><span>Relative hazard index</span><span>High · 1</span></div>
      <label className="mt-2 flex items-center gap-2">Opacity<input aria-label="Heatmap opacity" className="w-full accent-cyan-400" type="range" min={0.1} max={1.0} step={0.05} value={opacity} onChange={e => setOpacity(Number(e.target.value))} /></label>
      <p className="mt-2 text-[10px] text-slate-400"><a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="underline">Open-Meteo</a> · fetched {new Date(forecast.fetched_at).toLocaleTimeString()} · area-centre weather; local terrain variation. Not a calibrated flood probability.</p>
    </>}
  </section>;
}
