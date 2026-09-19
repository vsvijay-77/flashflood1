import { useState } from "react";
import { CloudRain, Mountain, Pause, Play, RotateCcw, SlidersHorizontal, X, Eye, EyeOff, Network, Check, FileText, Waves } from "lucide-react";
import { runoffRainfall } from "./flashFloodParameters";
import type { FlashFloodParameters } from "./flashFloodParameters";
import type { WaterSimulationControlPanelProps } from "./WaterSimulationControlPanel";

interface Props extends Omit<WaterSimulationControlPanelProps, "scenarioInflow" | "onScenarioInflowChange"> {
  parameters: FlashFloodParameters;
  onParametersChange: (parameters: FlashFloodParameters) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  showGraph: boolean;
  onToggleGraph: () => void;
  graphCounts: {
    nodes: number;
    edges: number;
    displayedEdges: number;
    areaKm2?: number;
    spacingM?: number;
  };
  waterVolume: number;
  onRestart: () => void;
  onApply?: () => void;
  showRain?: boolean;
  onToggleRain?: (showRain: boolean) => void;
}

function Parameter({ name, unit, value, min, max, step = 1, onChange, hint }: {
  name: string; unit: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void; hint: string;
}) {
  return <label className="block rounded-xl border border-slate-700/70 bg-slate-900/70 p-3">
    <span className="flex items-center justify-between gap-3 text-sm font-medium text-slate-200">
      {name}<span className="flex items-center gap-1 text-cyan-200">
        <input aria-label={name} type="number" min={min} max={max} step={step} value={value}
          onChange={event => { const next = event.target.valueAsNumber; if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next))); }}
          className="w-20 rounded-md border border-slate-600 bg-slate-950 px-2 py-1 text-right font-mono" />
        <span className="text-xs">{unit}</span>
      </span>
    </span>
    <input aria-label={`${name} slider`} type="range" min={min} max={max} step={step} value={value}
      onChange={event => onChange(Number(event.target.value))} className="my-2 w-full accent-cyan-400" />
    <span className="block text-xs leading-relaxed text-slate-400">{hint}</span>
  </label>;
}

export function FlashFloodControlPanel(props: Props) {
  const { isRunning, isPaused, isReady, parameters, onParametersChange } = props;
  const [appliedToast, setAppliedToast] = useState<boolean>(false);
  const isStormOver = props.elapsedSeconds >= parameters.durationMinutes * 60;
  const status = !isReady
    ? "Preparing terrain"
    : !isRunning
    ? "Ready to start"
    : isPaused
    ? "Paused"
    : isStormOver
    ? props.waterVolume < 20
      ? "Storm ended · Flood cycle complete"
      : "Storm ended · Flood draining & receding"
    : "Running";

  const elapsed = `${Math.floor(props.elapsedSeconds / 60)}:${String(Math.floor(props.elapsedSeconds % 60)).padStart(2, "0")}`;
  const change = (key: keyof FlashFloodParameters) => (value: number) => onParametersChange({ ...parameters, [key]: value });
  const togglePlayback = !isRunning ? props.onStart : isPaused ? props.onResume : props.onPause;
  const playbackLabel = !isRunning ? "Start Flash Flood" : isPaused ? "Resume Flash Flood" : "Pause Flash Flood";
  const handleStartFromModal = () => {
    if (!isRunning) {
      props.onStart();
      props.onOpenChange(false); // Closes parameters modal so 3D terrain and flood effects are seen!
    } else if (isPaused) {
      props.onResume();
      props.onOpenChange(false);
    } else {
      props.onPause();
    }
  };
  const runoff = runoffRainfall(props.rainfallMmH, parameters, props.elapsedSeconds);

  return <>
    <div role="toolbar" aria-label="Flash Flood quick controls" className="absolute right-3 top-16 z-30 flex items-center gap-1.5 rounded-xl border border-cyan-600/60 bg-slate-950/95 p-2 text-white shadow-xl">
      <button type="button" onClick={() => props.onOpenChange(true)} aria-label="Open Flash Flood parameters" className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold hover:bg-slate-800">
        <SlidersHorizontal className="size-4 text-cyan-300" /> Flash Flood <span className="text-cyan-300">{elapsed}</span>
        {parameters.durationMinutes <= 2.2 && (
          <span className="text-[10px] text-amber-300 font-mono font-normal">(-30% time)</span>
        )}
      </button>
      <div className="flex items-center gap-1.5 rounded-lg border border-cyan-700/60 bg-cyan-950/80 px-2.5 py-1.5 text-xs" title="Simulation Water Level based on sensor telemetry">
        <Waves className="size-3.5 text-cyan-400" />
        <span className="text-slate-400">Water Level:</span>
        <span className="font-mono font-bold text-cyan-200">{props.sourceRise.toFixed(2)} m</span>
      </div>
      {props.onApply && (
        <button
          type="button"
          disabled={!isReady}
          onClick={() => {
            props.onApply?.();
            setAppliedToast(true);
            setTimeout(() => setAppliedToast(false), 3500);
          }}
          aria-label="Apply changes to scenario"
          title="Apply new parameters immediately to the active scenario without resetting water"
          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-md shadow-emerald-950/60 hover:bg-emerald-500 active:scale-95 transition-all disabled:opacity-40 cursor-pointer"
        >
          <Check className="size-3.5" /> Apply
        </button>
      )}
      <button type="button" disabled={!isReady} onClick={togglePlayback} aria-label={playbackLabel} title={playbackLabel} className="rounded-lg bg-cyan-700 p-2 hover:bg-cyan-600 disabled:opacity-40">
        {isRunning && !isPaused ? <Pause className="size-4" /> : <Play className="size-4" />}
      </button>
      <button
        type="button"
        onClick={props.onToggleGraph}
        aria-pressed={props.showGraph}
        aria-label={props.showGraph ? "Hide terrain flow graph" : "Show terrain flow graph"}
        title={props.showGraph ? "Hide terrain flow graph" : "Show terrain flow graph"}
        className={`flex items-center gap-1 rounded-lg p-2 text-xs font-medium transition-colors ${props.showGraph ? "bg-emerald-700 text-white hover:bg-emerald-600" : "text-slate-200 hover:bg-slate-800"}`}
      >
        <Network className="size-4" />
        {props.showGraph ? "Hide Graph" : "Flow Graph"}
      </button>
      <button
        type="button"
        disabled={!isReady}
        onClick={props.onClose}
        aria-label="End simulation and generate standard flood report"
        title="End simulation and view standard 12-section flood report"
        className="flex items-center gap-1 rounded-lg bg-rose-700/80 hover:bg-rose-600 px-2.5 py-2 text-xs font-semibold text-white shadow-md transition-all cursor-pointer disabled:opacity-40"
      >
        <FileText className="size-3.5" />
        <span>End & Report</span>
      </button>
    </div>
    {props.showGraph && !props.open && <div role="status" aria-label="Terrain flow graph legend" className="absolute right-3 top-32 z-30 max-w-xs rounded-lg border border-slate-600 bg-slate-950/95 p-3 text-xs text-slate-200">
      <div>{parameters.flowModel === "gnn" ? "Experimental GNN" : "Physics"} · {props.graphCounts.nodes} nodes · {props.graphCounts.displayedEdges} edges</div>
      {props.graphCounts.areaKm2 !== undefined && props.graphCounts.areaKm2 > 0 && (
        <div className="mt-1 text-[11px] text-cyan-300 font-medium">
          Coverage: <span className="font-semibold text-white">{props.graphCounts.areaKm2.toFixed(2)} km²</span> ({props.graphCounts.spacingM ? `${props.graphCounts.spacingM.toFixed(1)}m grid` : "dense"})
        </div>
      )}
      <div className="mt-1 flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-3.5 bg-white rounded"></span><span className="font-semibold text-white">White</span> Edges</span>
        <span>·</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-black border border-slate-500 shadow-sm"></span><span className="font-semibold text-slate-200">Dark Circle</span> Nodes</span>
      </div>
      <div className="mt-1 text-slate-400">Dense mesh across 3D terrain polygon.</div>
    </div>}
    {props.open && <div className="absolute inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-3 sm:p-6" onWheel={event => event.stopPropagation()}>
      <section role="dialog" aria-modal="true" aria-labelledby="flash-flood-title" className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-cyan-500/40 bg-slate-950 text-white shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-700 px-5 py-4">
          <div className="flex items-center gap-3"><CloudRain className="size-7 text-cyan-300" /><div>
            <h2 id="flash-flood-title" className="text-lg font-semibold">Flash Flood Simulation</h2>
            <p className="text-xs text-slate-400">Rain on the hills → downhill runoff → village exposure</p>
          </div></div>
          <button autoFocus type="button" onClick={() => props.onOpenChange(false)} aria-label="Minimize Flash Flood parameters" title="Minimize; simulation keeps its current state" className="rounded-lg p-2 hover:bg-slate-800"><X className="size-5" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {appliedToast && (
            <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-emerald-500/80 bg-emerald-950/90 px-4 py-3 text-xs font-semibold text-emerald-200 shadow-xl shadow-emerald-950/60">
              <Check className="size-4 text-emerald-400 shrink-0" />
              <span>Changes applied live to active scenario! Existing flood water is preserved and new environment conditions are actively evolving.</span>
            </div>
          )}
          <p role="status" className="mb-4 rounded-lg border border-cyan-900 bg-cyan-950/40 px-3 py-2 text-xs text-cyan-200">{status}{!isRunning ? ` · ${props.statusText}` : ""}</p>
          <div className="mb-4 rounded-xl border border-emerald-800 bg-emerald-950/20 p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">Flow model</span>
              <button type="button" aria-pressed={parameters.flowModel === "gnn"} onClick={() => onParametersChange({ ...parameters, flowModel: "gnn" })} className="rounded border border-slate-600 px-3 py-2 aria-pressed:bg-emerald-700">Experimental GNN</button>
              <button type="button" aria-pressed={parameters.flowModel === "physics"} onClick={() => onParametersChange({ ...parameters, flowModel: "physics" })} className="rounded border border-slate-600 px-3 py-2 aria-pressed:bg-cyan-700">Physics baseline</button>
              <button type="button" aria-pressed={props.showGraph} onClick={props.onToggleGraph} className="rounded border border-slate-600 px-3 py-2">{props.showGraph ? "Hide" : "Show"} Flow Graph</button>
            </div>
            <p className="mt-2 text-slate-300">GNN trained on synthetic hydraulic graphs, not observed floods. Terrain controls direction; streams and paths use estimated surface roughness. Not a calibrated forecast.</p>
            <p aria-label="Live runoff input" className="mt-2 font-mono text-cyan-200">Net runoff: {runoff.toFixed(1)} mm/h · Floodwater: {props.waterVolume.toFixed(1)} m³</p>
            <p className="mt-2 text-slate-400">Higher rain, soil saturation or river rise adds more water. Higher infiltration reduces runoff; roughness slows flow. Existing water remains when inputs decrease. Restart to compare scenarios from dry conditions.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><CloudRain className="size-4 text-cyan-300" /> Storm</h3>
              <Parameter name="Flood intensity" unit="%" value={parameters.floodIntensity ?? 100} min={0} max={200} step={5} onChange={change("floodIntensity")} hint="Primary flood control — less % = less flooding, more % = more flooding. Scales both rainfall runoff and river rise." />
              <Parameter name="Rainfall intensity" unit="mm/h" value={props.rainfallMmH} min={0} max={300} step={5} onChange={props.onRainfallChange} hint="Rain falls across the selected area, including mountain slopes. Higher rain = more runoff." />
              <Parameter name="Storm duration" unit="min" value={parameters.durationMinutes} min={1} max={360} onChange={change("durationMinutes")} hint="After rainfall ends, existing water continues flowing downhill." />
              <Parameter name="Wind speed" unit="km/h" value={parameters.windSpeedKmh} min={0} max={120} onChange={change("windSpeedKmh")} hint="Changes falling rain's drift. Terrain elevation controls runoff direction." />
              <Parameter name="River rise" unit="m" value={props.sourceRise} min={0} max={10} step={0.1} onChange={props.onSourceRiseChange} hint="Optional inflow from mapped waterways. Zero means rainfall-driven runoff only." />
            </div>
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold"><Mountain className="size-4 text-emerald-300" /> Ground & flow</h3>
              <Parameter name="Soil saturation" unit="%" value={parameters.soilSaturation} min={0} max={100} onChange={change("soilSaturation")} hint="Wetter soil absorbs less rain, producing more surface runoff." />
              <Parameter name="Infiltration capacity" unit="mm/h" value={parameters.infiltrationMmH} min={0} max={100} onChange={change("infiltrationMmH")} hint="Soil absorption rate. Higher = less runoff (opposite of flood intensity)." />
              <Parameter name="Ground roughness" unit="n" value={parameters.roughness} min={0.01} max={0.15} step={0.005} onChange={change("roughness")} hint="Higher Manning roughness slows water over vegetation and uneven ground." />
              <Parameter name="Surface waves" unit="×" value={props.waveIntensity} min={0} max={2} step={0.1} onChange={props.onWaveIntensityChange} hint="Changes surface detail without changing the amount of water." />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs"><span className="mr-2 text-slate-300">Playback speed</span>{[1, 2, 5, 10, 30, 60].map(speed =>
            <button key={speed} type="button" aria-pressed={props.speed === speed} onClick={() => props.onSpeedChange(speed)} className={`rounded-lg border px-3 py-2 ${props.speed === speed ? "border-cyan-400 bg-cyan-700" : "border-slate-700 bg-slate-900"}`}>{speed}×</button>)}
            <div className="ml-auto flex items-center gap-2">
              {props.onToggleRain && (
                <button
                  type="button"
                  onClick={() => props.onToggleRain?.(!props.showRain)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer ${
                    props.showRain !== false
                      ? "border-cyan-500 bg-cyan-950/60 text-cyan-200"
                      : "border-slate-700 bg-slate-900 text-slate-400"
                  }`}
                >
                  <CloudRain className={`size-4 ${props.showRain !== false ? "text-cyan-300" : "text-slate-500"}`} />
                  {props.showRain !== false ? "Rain visible" : "Rain hidden"}
                </button>
              )}
              <button type="button" onClick={() => props.onToggleVisibility(!props.showWater)} className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 cursor-pointer">
                {props.showWater ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                {props.showWater ? "Water visible" : "Water hidden"}
              </button>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            {[["Elapsed", elapsed], ["Water extent", `${props.spreadAreaHectares.toFixed(2)} ha`], ["Maximum depth", `${props.maxDepthM.toFixed(2)} m`], ["Terrain grid", props.gridResolution]].map(([label, value]) => <div key={label} className="rounded-lg bg-slate-900 p-3"><div className="text-slate-400">{label}</div><div className="mt-1 font-mono text-cyan-200">{value}</div></div>)}
          </div>
          <p className="mt-3 text-xs text-slate-400">Slope comes from the loaded terrain. Include the mountain catchment and village in your selected area. Rooftop labels show estimated water arrival in simulated time. Reached times use the 10 cm exposure threshold.</p>
          <p aria-label="Water performance" className="mt-2 text-xs text-slate-400">{props.fps} FPS · {props.effectiveSpeed.toFixed(1)}× actual speed · {props.osmFeatureCount} mapped water features. Flow is approximated at the available terrain resolution.</p>
        </div>
        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-700 px-5 py-3">
          {props.onApply && (
            <button
              type="button"
              disabled={!isReady}
              onClick={() => {
                props.onApply?.();
                setAppliedToast(true);
                setTimeout(() => setAppliedToast(false), 3500);
              }}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-950/60 hover:bg-emerald-500 active:scale-95 transition-all disabled:opacity-40 cursor-pointer"
              title="Apply environment changes to current scenario without restarting"
            >
              <Check className="size-4" /> Apply Changes (Keep Scenario)
            </button>
          )}
          <button type="button" disabled={!isReady} onClick={handleStartFromModal} className="flex items-center gap-2 rounded-lg bg-cyan-600 px-5 py-2.5 text-sm font-semibold hover:bg-cyan-500 disabled:opacity-40">{isRunning && !isPaused ? <Pause className="size-4" /> : <Play className="size-4" />}{playbackLabel}</button>
          <button type="button" onClick={props.onReset} className="rounded-lg border border-slate-600 px-4 py-2.5 text-sm hover:bg-slate-800">Reset</button>
          <button type="button" onClick={() => props.onOpenChange(false)} className="rounded-lg border border-slate-600 px-4 py-2.5 text-sm hover:bg-slate-800">View terrain</button>
          <button type="button" onClick={props.onClose} className="ml-auto rounded-lg px-3 py-2.5 text-sm text-rose-300 hover:bg-rose-950">End simulation</button>
        </footer>
      </section>
    </div>}
  </>;
}
