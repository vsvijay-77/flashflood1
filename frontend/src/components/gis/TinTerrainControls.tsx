/**
 * Compact TIN Terrain Control Panel & Status Overlay
 *
 * Provides full control over:
 * - TIN visibility
 * - GNN Graph Nodes toggle (placed when TIN connects)
 * - Wireframe toggle (Surface vs Surface + Triangle Edges)
 * - Terrain Surface toggle
 * - Elevation coloring toggle
 * - Opacity slider
 * - Vertical exaggeration
 * - Refresh TIN action
 *
 * Displays DEM metadata, GNN Graph Architecture, number of graphs and nodes,
 * vertex/triangle counts, elevation range, and loading status.
 */

import React, { useState } from "react";
import {
  Mountain,
  Grid,
  Palette,
  Sliders,
  RefreshCw,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Layers,
  Cpu,
  Zap,
  Activity,
  X,
} from "lucide-react";
import type { TinTerrainData } from "@/services/tinTerrain";

export interface TinTerrainControlsProps {
  data: TinTerrainData | null;
  loading: boolean;
  error: string | null;
  tinActive: boolean;
  wireframeActive: boolean;
  surfaceActive: boolean;
  elevationColoring: boolean;
  gnnNodesActive: boolean;
  opacity: number;
  verticalExaggeration: number;
  onToggleTin: (active: boolean) => void;
  onToggleWireframe: (active: boolean) => void;
  onToggleSurface: (active: boolean) => void;
  onToggleElevationColoring: (active: boolean) => void;
  onToggleGnnNodes: (active: boolean) => void;
  onChangeOpacity: (val: number) => void;
  onChangeExaggeration: (val: number) => void;
  onRefresh: () => void;
  onClose?: () => void;
  className?: string;
}

export function TinTerrainControls({
  data,
  loading,
  error,
  tinActive,
  wireframeActive,
  surfaceActive,
  elevationColoring,
  gnnNodesActive,
  opacity,
  verticalExaggeration,
  onToggleTin,
  onToggleWireframe,
  onToggleSurface,
  onToggleElevationColoring,
  onToggleGnnNodes,
  onChangeOpacity,
  onChangeExaggeration,
  onRefresh,
  onClose,
  className,
}: TinTerrainControlsProps) {
  const [collapsed, setCollapsed] = useState(false);

  const graphCount = data?.gnn?.graph_count ?? 1;
  const nodeCount = data?.gnn?.node_count ?? data?.vertex_count ?? 0;
  const edgeCount = data?.gnn?.edge_count ?? (data?.triangle_count ? Math.round(data.triangle_count * 1.5) : 0);

  return (
    <div
      data-testid="tin-terrain-panel"
      className={
        className ||
        "absolute top-[68px] right-3 z-50 w-80 rounded-xl bg-slate-950/95 border border-cyan-500/50 backdrop-blur-md shadow-2xl text-white animate-in fade-in slide-in-from-right-2 duration-300 pointer-events-auto"
      }
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <div className="size-6 rounded-md bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-cyan-400">
            <Mountain className="size-3.5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-black tracking-wider text-cyan-300">TIN TERRAIN</span>
              {loading ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.2 text-[9px] font-bold rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
                  <Loader2 className="size-2.5 animate-spin" />
                  Generating…
                </span>
              ) : error ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.2 text-[9px] font-bold rounded bg-rose-500/20 text-rose-300 border border-rose-500/40">
                  <AlertCircle className="size-2.5" />
                  Unavailable
                </span>
              ) : data ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.2 text-[9px] font-bold rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  <CheckCircle2 className="size-2.5" />
                  TIN READY
                </span>
              ) : null}
            </div>
            <p className="text-[9.5px] text-slate-400 leading-none mt-0.5">
              Triangulated terrain generated from Copernicus DEM
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh TIN (re-fetch Copernicus DEM from OpenTopography)"
            className="size-6 rounded flex items-center justify-center text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin text-cyan-400" : ""}`} />
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            title={collapsed ? "Expand Controls" : "Collapse Controls"}
            className="size-6 rounded flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            {collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </button>
          {onClose && (
            <button
              type="button"
              data-testid="close-tin-tab-btn"
              onClick={onClose}
              title="Close TIN Terrain Tab"
              className="size-7 rounded-lg flex items-center justify-center text-slate-200 hover:text-white bg-slate-800/90 hover:bg-rose-600 border border-slate-700/80 hover:border-rose-500 transition-all cursor-pointer ml-1 shadow-sm active:scale-95 z-20 shrink-0"
            >
              <X className="size-4 text-white" />
            </button>
          )}
        </div>
      </div>

      {/* Body Controls & Information */}
      {!collapsed && (
        <div className="p-3 space-y-3 text-xs">
          {/* Status Message Display */}
          {loading && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-cyan-950/50 border border-cyan-700/50 text-cyan-200 text-[11px] animate-pulse">
              <Loader2 className="size-3.5 animate-spin text-cyan-400 shrink-0" />
              <span>Generating terrain mesh & GNN graph topology…</span>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-2 rounded-lg bg-rose-950/60 border border-rose-700/50 text-rose-200 text-[11px]">
              <AlertCircle className="size-3.5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-rose-200">TIN terrain unavailable — standard terrain retained.</p>
                <p className="text-[10px] text-rose-300/80 mt-0.5">{error}</p>
              </div>
            </div>
          )}

          {/* 🧠 GNN Graph & Topology Details Card */}
          {data && (
            <div className="bg-slate-900/95 border border-cyan-500/50 rounded-xl p-2.5 space-y-2 text-xs shadow-inner">
              <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                <div className="flex items-center gap-1.5">
                  <Cpu className="size-3.5 text-cyan-400" />
                  <span className="font-bold text-cyan-200">GNN Graph Architecture</span>
                </div>
                <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  CONNECTED
                </span>
              </div>

              {/* Number of Graphs and Nodes */}
              <div className="grid grid-cols-2 gap-1.5 font-mono">
                <div className="bg-slate-950/80 p-2 rounded-lg border border-slate-800/80">
                  <span className="text-slate-400 block text-[9px] uppercase tracking-wider">Number of Graphs</span>
                  <strong className="text-white text-sm font-bold block mt-0.5">
                    {graphCount} {graphCount === 1 ? "Graph" : "Graphs"}
                  </strong>
                  <span className="text-[8.5px] text-slate-500">Connected Mesh Topology</span>
                </div>

                <div className="bg-slate-950/80 p-2 rounded-lg border border-slate-800/80">
                  <span className="text-slate-400 block text-[9px] uppercase tracking-wider">Number of Nodes</span>
                  <strong className="text-cyan-300 text-sm font-bold block mt-0.5">
                    {nodeCount.toLocaleString()} Nodes
                  </strong>
                  <span className="text-[8.5px] text-cyan-400/80">3D TIN Vertices</span>
                </div>

                <div className="bg-slate-950/80 p-2 rounded-lg border border-slate-800/80">
                  <span className="text-slate-400 block text-[9px] uppercase tracking-wider">Graph Edges</span>
                  <strong className="text-amber-300 text-sm font-bold block mt-0.5">
                    {edgeCount.toLocaleString()} Edges
                  </strong>
                  <span className="text-[8.5px] text-slate-500">Spatial Message Passing</span>
                </div>

                <div className="bg-slate-950/80 p-2 rounded-lg border border-slate-800/80">
                  <span className="text-slate-400 block text-[9px] uppercase tracking-wider">Node Features</span>
                  <strong className="text-emerald-300 text-sm font-bold block mt-0.5">
                    4 Features
                  </strong>
                  <span className="text-[8.5px] text-slate-500">Elev, Slope, Asp, Grad</span>
                </div>
              </div>

              {/* GNN Model status bar */}
              <div className="bg-slate-950/60 p-1.5 rounded border border-slate-800 text-[9.5px] text-slate-400 flex items-center justify-between font-mono">
                <span>Model:</span>
                <span className="text-cyan-300 font-semibold">{data.gnn?.architecture || "SpatialGNNConv (4 → 8 → 1)"}</span>
              </div>
            </div>
          )}

          {/* Quick Feature Toggles */}
          <div className="grid grid-cols-2 gap-1.5">
            {/* TIN ON/OFF */}
            <button
              type="button"
              onClick={() => onToggleTin(!tinActive)}
              className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-all cursor-pointer ${
                tinActive
                  ? "bg-cyan-600/30 border-cyan-400/60 text-cyan-200"
                  : "bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Layers className="size-3 text-cyan-400" />
                <span>TIN Mesh</span>
              </div>
              <span className={`text-[10px] font-bold ${tinActive ? "text-cyan-300" : "text-slate-500"}`}>
                {tinActive ? "ON" : "OFF"}
              </span>
            </button>

            {/* GNN Nodes ON/OFF */}
            <button
              type="button"
              disabled={!tinActive}
              onClick={() => onToggleGnnNodes(!gnnNodesActive)}
              className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                gnnNodesActive
                  ? "bg-cyan-500/40 border-cyan-300 text-white ring-1 ring-cyan-300"
                  : "bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Cpu className="size-3 text-cyan-300" />
                <span>GNN Nodes</span>
              </div>
              <span className={`text-[10px] font-bold ${gnnNodesActive ? "text-cyan-300" : "text-slate-500"}`}>
                {gnnNodesActive ? "ON" : "OFF"}
              </span>
            </button>

            {/* Wireframe ON/OFF */}
            <button
              type="button"
              disabled={!tinActive}
              onClick={() => onToggleWireframe(!wireframeActive)}
              className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                wireframeActive
                  ? "bg-cyan-500/40 border-cyan-300 text-white ring-1 ring-cyan-300"
                  : "bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Grid className="size-3 text-cyan-300" />
                <span>Wireframe</span>
              </div>
              <span className={`text-[10px] font-bold ${wireframeActive ? "text-cyan-300" : "text-slate-500"}`}>
                {wireframeActive ? "ON" : "OFF"}
              </span>
            </button>

            {/* Terrain Surface ON/OFF */}
            <button
              type="button"
              disabled={!tinActive}
              onClick={() => onToggleSurface(!surfaceActive)}
              className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                surfaceActive
                  ? "bg-emerald-600/30 border-emerald-400/60 text-emerald-200"
                  : "bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Mountain className="size-3 text-emerald-400" />
                <span>Surface</span>
              </div>
              <span className={`text-[10px] font-bold ${surfaceActive ? "text-emerald-300" : "text-slate-500"}`}>
                {surfaceActive ? "ON" : "OFF"}
              </span>
            </button>

            {/* Elevation Coloring ON/OFF */}
            <button
              type="button"
              disabled={!tinActive}
              onClick={() => onToggleElevationColoring(!elevationColoring)}
              className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed col-span-2 ${
                elevationColoring
                  ? "bg-amber-600/30 border-amber-400/60 text-amber-200"
                  : "bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Palette className="size-3 text-amber-400" />
                <span>Elevation Coloring</span>
              </div>
              <span className={`text-[10px] font-bold ${elevationColoring ? "text-amber-300" : "text-slate-500"}`}>
                {elevationColoring ? "ON" : "OFF"}
              </span>
            </button>
          </div>

          {/* Sliders: Opacity & Vertical Exaggeration */}
          <div className="space-y-2 pt-1 border-t border-slate-800/80">
            {/* Opacity Slider */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Surface Opacity</span>
                <span className="font-mono text-cyan-300 font-semibold">{Math.round(opacity * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={opacity}
                disabled={!tinActive}
                onChange={(e) => onChangeOpacity(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>

            {/* Vertical Exaggeration Slider */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Vertical Exaggeration</span>
                <span className="font-mono text-cyan-300 font-semibold">{verticalExaggeration.toFixed(1)}×</span>
              </div>
              <input
                type="range"
                min="1.0"
                max="5.0"
                step="0.5"
                value={verticalExaggeration}
                disabled={!tinActive}
                onChange={(e) => onChangeExaggeration(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>
          </div>

          {/* Elevation Color Legend Ramp */}
          {tinActive && elevationColoring && (
            <div className="pt-1.5 border-t border-slate-800/80 space-y-1">
              <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium">
                <span>Elevation Gradient</span>
                <span className="font-mono text-slate-300">
                  {data ? `${Math.round(data.min_elevation)}m → ${Math.round(data.max_elevation)}m` : "DEM Ramp"}
                </span>
              </div>
              <div
                className="h-2 w-full rounded-sm"
                style={{
                  background:
                    "linear-gradient(to right, #16a34a 0%, #65a30d 25%, #eab308 50%, #ea580c 75%, #f1f5f9 100%)",
                }}
              />
              <div className="flex items-center justify-between text-[8.5px] text-slate-500 font-mono">
                <span>Low</span>
                <span>Medium</span>
                <span>High Peak</span>
              </div>
            </div>
          )}

          {/* DEM Metadata Statistics */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2 text-[10px] space-y-1 font-mono">
            <div className="flex items-center justify-between text-slate-400">
              <span>DEM Source:</span>
              <strong className="text-white font-semibold">
                {data?.dem_source || "Copernicus GLO-30"}
              </strong>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>Resolution:</span>
              <strong className="text-white font-semibold">30 m</strong>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>Triangles:</span>
              <strong className="text-cyan-300 font-semibold">
                {data ? data.triangle_count.toLocaleString() : "—"}
              </strong>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>Elevation:</span>
              <strong className="text-amber-300 font-semibold">
                {data ? `${data.min_elevation} – ${data.max_elevation} m` : "—"}
              </strong>
            </div>
            {data?.terrain_features && (
              <div className="flex items-center justify-between text-slate-400 pt-0.5 border-t border-slate-800">
                <span>Mean Slope / Asp:</span>
                <strong className="text-emerald-400 font-semibold">
                  {data.terrain_features.mean_slope_deg}° / {data.terrain_features.mean_aspect_deg}°
                </strong>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
