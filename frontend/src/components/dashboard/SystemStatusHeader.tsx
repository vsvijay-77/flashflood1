import { CheckCircle2, Wifi, Cloud, Map as MapIcon, Brain, Shield, Sparkles } from "lucide-react";

export function SystemStatusHeader() {
  return (
    <div className="relative overflow-hidden border-b border-slate-800/80 bg-gradient-to-r from-slate-950 via-[#0a192f] to-slate-950 px-4 py-3 sm:px-6 shadow-md">
      {/* Subtle background ambient glow */}
      <div className="absolute -top-12 -left-12 size-48 rounded-full bg-cyan-500/10 blur-2xl pointer-events-none" />
      <div className="absolute -top-12 right-20 size-48 rounded-full bg-emerald-500/10 blur-2xl pointer-events-none" />

      <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="relative flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shadow-xs">
            <span className="absolute -top-0.5 -right-0.5 flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500"></span>
            </span>
            <Shield className="size-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold tracking-wider uppercase text-emerald-400 flex items-center gap-1.5">
                <span className="inline-block size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live Mission Control
              </span>
              <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-mono text-cyan-300">
                1s Ingest
              </span>
            </div>
            <p className="text-xs font-semibold text-white/90">
              Flood Early Warning &amp; LoRa Mesh Telemetry Hub
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[11px] font-medium text-slate-300">
          <div className="flex items-center gap-1.5 rounded-full bg-slate-900/80 border border-slate-700/60 px-2.5 py-1 backdrop-blur-xs">
            <Wifi className="size-3.5 text-cyan-400" />
            <span>LoRa Mesh: <strong className="text-cyan-300 font-semibold">Active</strong></span>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-slate-900/80 border border-slate-700/60 px-2.5 py-1 backdrop-blur-xs">
            <Cloud className="size-3.5 text-emerald-400" />
            <span>Supabase DB: <strong className="text-emerald-300 font-semibold">Connected</strong></span>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-slate-900/80 border border-slate-700/60 px-2.5 py-1 backdrop-blur-xs">
            <MapIcon className="size-3.5 text-blue-400" />
            <span>Digital Twin: <strong className="text-blue-300 font-semibold">Ready</strong></span>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-slate-900/80 border border-slate-700/60 px-2.5 py-1 backdrop-blur-xs">
            <Brain className="size-3.5 text-purple-400" />
            <span>AI Risk Model: <strong className="text-purple-300 font-semibold">Live</strong></span>
          </div>
          <div className="hidden md:flex items-center gap-1.5 text-slate-400 pl-1">
            <Sparkles className="size-3 text-amber-400 animate-spin" style={{ animationDuration: "8s" }} />
            <span className="text-[10px] font-mono text-slate-400">Sync: Real-Time</span>
          </div>
        </div>
      </div>
    </div>
  );
}
