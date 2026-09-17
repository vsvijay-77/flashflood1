import React from "react";
import {
  Play,
  Pause,
  RotateCcw,
  Waves,
  Eye,
  EyeOff,
  Activity,
  Layers,
  Clock,
  Maximize2,
  Info,
  CheckCircle2,
  AlertTriangle,
  X,
} from "lucide-react";

export interface WaterSimulationControlPanelProps {
  isRunning: boolean;
  isPaused: boolean;
  showWater: boolean;
  sourceRise: number; // 0 to 10m
  speed: number; // 1, 10, 30, 60
  waveIntensity: number; // 0.2 to 2.0
  statusText: string;
  isFallbackSource: boolean;
  osmFeatureCount: number;
  gridResolution: string; // e.g. "64 × 64 (11.5m)"
  elapsedSeconds: number;
  spreadAreaHectares: number;
  maxDepthM: number;
  isReady: boolean;
  rainfallMmH: number;
  onRainfallChange: (value: number) => void;
  scenarioInflow: boolean;
  onScenarioInflowChange: (value: boolean) => void;
  fps: number;
  effectiveSpeed: number;
  renderScale: number;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
  onToggleVisibility: (visible: boolean) => void;
  onSourceRiseChange: (val: number) => void;
  onSpeedChange: (speed: number) => void;
  onWaveIntensityChange: (intensity: number) => void;
  onClose?: () => void;
}

export const WaterSimulationControlPanel: React.FC<WaterSimulationControlPanelProps> = ({
  isRunning,
  isPaused,
  showWater,
  sourceRise,
  speed,
  waveIntensity,
  statusText,
  isFallbackSource,
  osmFeatureCount,
  gridResolution,
  elapsedSeconds,
  spreadAreaHectares,
  maxDepthM,
  isReady,
  rainfallMmH,
  onRainfallChange,
  scenarioInflow,
  onScenarioInflowChange,
  fps,
  effectiveSpeed,
  renderScale,
  onStart,
  onPause,
  onResume,
  onReset,
  onToggleVisibility,
  onSourceRiseChange,
  onSpeedChange,
  onWaveIntensityChange,
  onClose,
}) => {
  // Format elapsed seconds as MM:SS
  const mins = Math.floor(elapsedSeconds / 60);
  const secs = Math.floor(elapsedSeconds % 60);
  const formattedTime = `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;

  const speedOptions = [1, 10, 30, 60];

  return (
    <div
      role="region"
      aria-label="Water Simulation Controls"
      onWheel={(e) => e.stopPropagation()}
      className="absolute bottom-3 right-3 z-20 w-88 max-w-[calc(100%-1.5rem)] max-h-[calc(100%-5rem)] overflow-y-auto bg-slate-950/95 backdrop-blur-md border border-cyan-500/40 rounded-xl shadow-2xl p-4 text-slate-100 flex flex-col gap-3.5 select-none animate-in fade-in zoom-in-95 duration-200 overscroll-contain"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-lg bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-cyan-300">
            <Waves className="size-4 animate-pulse" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-white tracking-wide flex items-center gap-1.5">
              <span>Water Simulation</span>
              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded-full bg-cyan-900/60 border border-cyan-500/40 text-cyan-300">
                3D Shallow-Water
              </span>
            </h3>
            <p className="text-[10px] text-slate-400 truncate max-w-52">
              Terrain-adaptive hydrodynamic spread
            </p>
          </div>
        </div>

        {/* Top Right Actions: Show/Hide Visibility Toggle & Close */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onToggleVisibility(!showWater)}
            aria-label={showWater ? "Hide Water" : "Show Water"}
            title={showWater ? "Hide Water Layer" : "Show Water Layer"}
            className={`p-1.5 rounded-lg border text-xs transition-all cursor-pointer ${
              showWater
                ? "bg-cyan-950/80 border-cyan-500/50 text-cyan-300 hover:bg-cyan-900"
                : "bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200"
            }`}
          >
            {showWater ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Water Simulation"
              title="Close Water Simulation"
              className="p-1.5 rounded-lg border border-slate-800 hover:border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-all cursor-pointer"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Status Bar */}
      <div
        className={`px-2.5 py-1.5 rounded-lg border text-[11px] flex items-center justify-between ${
          isFallbackSource
            ? "bg-amber-950/60 border-amber-500/40 text-amber-200"
            : isRunning && !isPaused
            ? "bg-cyan-950/60 border-cyan-500/40 text-cyan-200"
            : "bg-slate-900/80 border-slate-800 text-slate-300"
        }`}
      >
        <span className="flex items-center gap-1.5 font-medium truncate">
          {isFallbackSource ? (
            <AlertTriangle className="size-3.5 text-amber-400 shrink-0" />
          ) : isRunning && !isPaused ? (
            <Activity className="size-3.5 text-cyan-400 animate-pulse shrink-0" />
          ) : (
            <CheckCircle2 className="size-3.5 text-slate-400 shrink-0" />
          )}
          <span className="truncate">{statusText}</span>
        </span>
        <span className="font-mono text-[10px] px-1.5 py-0.2 rounded bg-slate-900/80 border border-slate-700/60 shrink-0">
          {isPaused ? "PAUSED" : isRunning ? "RUNNING" : "STANDBY"}
        </span>
      </div>

      {/* Primary Actions: Start, Pause, Resume, Reset */}
      <div className="grid grid-cols-2 gap-2">
        {!isRunning || isPaused ? (
          <button
            type="button"
            onClick={isRunning ? onResume : onStart}
            aria-label={isRunning ? "Resume Water" : "Start Water"}
            disabled={!isReady}
            className="flex items-center justify-center gap-1.5 py-2 px-3 bg-gradient-to-r from-cyan-600 to-sky-600 hover:from-cyan-500 hover:to-sky-500 text-white font-bold text-xs rounded-lg transition-all shadow-md shadow-cyan-950 cursor-pointer active:scale-98"
          >
            <Play className="size-3.5 fill-current" />
            <span>{isRunning ? "Resume" : "Start Water"}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onPause}
            aria-label="Pause Water"
            className="flex items-center justify-center gap-1.5 py-2 px-3 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-lg transition-all shadow-md shadow-amber-950 cursor-pointer active:scale-98"
          >
            <Pause className="size-3.5 fill-current" />
            <span>Pause</span>
          </button>
        )}

        <button
          type="button"
          onClick={onReset}
          aria-label="Reset Water"
          className="flex items-center justify-center gap-1.5 py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-semibold text-xs rounded-lg border border-slate-700 transition-all cursor-pointer active:scale-98"
        >
          <RotateCcw className="size-3.5" />
          <span>Reset Water</span>
        </button>
      </div>

      {/* Sliders: Source Rise Limit & Surface Waves */}
      <div className="space-y-2.5 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
        {/* Source Rise Limit Slider */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <label htmlFor="source-rise-slider" className="font-semibold text-slate-300">
              Source Rise Limit
            </label>
            <span className="font-mono text-cyan-300 font-bold bg-cyan-950/80 px-1.5 py-0.2 rounded border border-cyan-500/40">
              +{sourceRise.toFixed(2)} m
            </span>
          </div>
          <input
            id="source-rise-slider"
            type="range"
            min="0"
            max="10"
            step="0.1"
            value={sourceRise}
            onChange={(e) => onSourceRiseChange(parseFloat(e.target.value))}
            className="w-full accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[9px] text-slate-400">
            <span>0 m (Base)</span>
            <span>5 m</span>
            <span>10 m (Max)</span>
          </div>
        </div>

        {/* Surface Waves Slider */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <label htmlFor="surface-waves-slider" className="font-semibold text-slate-300">
              Surface Waves
            </label>
            <span className="font-mono text-cyan-300 font-bold bg-cyan-950/80 px-1.5 py-0.2 rounded border border-cyan-500/40">
              {waveIntensity.toFixed(1)}×
            </span>
          </div>
          <input
            id="surface-waves-slider"
            type="range"
            min="0.2"
            max="2.0"
            step="0.1"
            value={waveIntensity}
            onChange={(e) => onWaveIntensityChange(parseFloat(e.target.value))}
            className="w-full accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
          />
          <div className="flex justify-between text-[9px] text-slate-400">
            <span>Calm</span>
            <span>Moderate</span>
            <span>Rough</span>
          </div>
        </div>
      </div>

      {/* Time Speed Selector: 1x, 10x, 30x, 60x */}
      <label className="text-[11px] text-slate-300 space-y-2">
        <span className="flex justify-between"><span>Rainfall input</span><span>{rainfallMmH} mm/h</span></span>
        <input aria-label="Water rainfall input" type="range" min="0" max="300" step="5" value={rainfallMmH} onChange={event => onRainfallChange(Number(event.target.value))} className="w-full accent-cyan-400" />
      </label>
      {isFallbackSource && isReady && (
        <label className="text-[10px] text-amber-200 flex items-start gap-2">
          <input type="checkbox" checked={scenarioInflow} onChange={event => onScenarioInflowChange(event.target.checked)} />
          <span>Add synthetic upslope inflow. No mapped water source intersects this grid; this is not an observed river.</span>
        </label>
      )}
      <div className="flex items-center justify-between text-xs">
        <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
          <Clock className="size-3 text-cyan-400" />
          <span>Simulation Speed:</span>
        </span>
        <div className="flex gap-1">
          {speedOptions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSpeedChange(s)}
              aria-label={`${s}x speed`}
              className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                speed === s
                  ? "bg-cyan-500 text-slate-950 shadow-xs"
                  : "bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700"
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      {/* Live Telemetry Grid */}
      <div className="grid grid-cols-2 gap-1.5 text-[10px] pt-1 border-t border-slate-800/80">
        <div className="p-1.5 bg-slate-900/60 rounded border border-slate-800">
          <div className="text-slate-400">Elapsed Time</div>
          <div className="font-mono font-bold text-white text-xs">{formattedTime}</div>
        </div>
        <div className="p-1.5 bg-slate-900/60 rounded border border-slate-800">
          <div className="text-slate-400">Spread Area</div>
          <div className="font-mono font-bold text-cyan-300 text-xs">
            {spreadAreaHectares.toFixed(2)} ha
          </div>
        </div>
        <div className="p-1.5 bg-slate-900/60 rounded border border-slate-800">
          <div className="text-slate-400">OSM Features</div>
          <div className="font-mono font-bold text-white truncate">
            {isFallbackSource ? `${osmFeatureCount} inflow cells` : `${osmFeatureCount} mapped cells`}
          </div>
        </div>
        <div className="p-1.5 bg-slate-900/60 rounded border border-slate-800">
          <div className="text-slate-400">Grid Resolution</div>
          <div className="font-mono font-bold text-white truncate">{gridResolution}</div>
        </div>
      </div>

      {/* Attribution and Disclaimer */}
      <div role="status" aria-label="Water performance" className="text-[10px] font-mono text-cyan-200">
        {isPaused ? "Paused" : !isRunning ? "Standby" : `${fps} FPS · ${effectiveSpeed.toFixed(1)}× actual · ${renderScale.toFixed(2)} render scale`}
        {isRunning && !isPaused && fps > 0 && (fps < 28 || effectiveSpeed < speed * 0.75) && (
          <p className="text-amber-300 font-sans mt-1">Performance limited: render resolution adapts; elapsed time shows actual simulated progress.</p>
        )}
      </div>
      <div className="space-y-1 text-[9px] text-slate-400 leading-tight pt-1 border-t border-slate-800">
        <div className="flex items-center justify-between">
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
            className="hover:text-cyan-300 underline decoration-slate-600"
          >
            © OpenStreetMap contributors
          </a>
          <span className="font-mono">Shallow-Water 2D</span>
        </div>
        <p className="italic text-slate-400 flex items-start gap-1">
          <Info className="size-2.5 text-cyan-400 shrink-0 mt-0.5" />
          <span>DEM-driven approximation, not a calibrated forecast. Source depths are assumed; rainfall is direct input without infiltration. Buildings are visual only, not hydraulic barriers.</span>
        </p>
      </div>
    </div>
  );
};
