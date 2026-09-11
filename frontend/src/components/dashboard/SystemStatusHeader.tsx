import { CheckCircle2, Wifi, Cloud, Map as MapIcon, Brain } from "lucide-react";

export function SystemStatusHeader() {
  return (
    <div className="flex flex-col gap-4 border-b border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="size-5 text-emerald-500" />
        <span className="font-semibold text-slate-900">All Systems Operational</span>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-600 sm:gap-6">
        <div className="flex items-center gap-1.5">
          <Wifi className="size-4 text-emerald-500" />
          <span>LoRaWAN Status: Connected</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Cloud className="size-4 text-emerald-500" />
          <span>Cloud API: Connected</span>
        </div>
        <div className="flex items-center gap-1.5">
          <MapIcon className="size-4 text-emerald-500" />
          <span>GIS Service: Active</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Brain className="size-4 text-emerald-500" />
          <span>AI Analytics: Active</span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-500">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500"></span>
          </span>
          <span>Last Data Sync: Just Now</span>
        </div>
      </div>
    </div>
  );
}
