import { Activity, BrainCircuit, Database, GitBranch, RefreshCw, Satellite, ShieldAlert } from "lucide-react";
import { formatHazardLeadTime, formatHazardProbability, MULTI_HAZARD_COLORS } from "@/lib/multiHazard";
import { useMultiHazard } from "@/lib/useMultiHazard";

const sourceGroups = [
  { icon: Activity, label: "IoT telemetry", detail: "soil, water, rain, IMU" },
  { icon: Satellite, label: "Satellite + weather", detail: "SAR, optical, rainfall" },
  { icon: Database, label: "Terrain + history", detail: "DEM, hydrology, soil" },
];

export function MultiHazardIntelligencePanel({ areaId, polygon }: { areaId?: string; polygon?: [number, number][] }) {
  const { model, heatmap, ready, features, timestamp, ageMinutes, stale, message, refresh } = useMultiHazard(areaId, polygon);
  const { data, isLoading } = model;
  const isFetching = model.isFetching || heatmap.isFetching;
  const statusLabels: Record<string, string> = {
    checkpoint_missing: "Not trained · checkpoint missing",
    checkpoint_invalid: "Checkpoint invalid",
    model_loaded: "Model loaded · not ready",
    model_ready: data?.calibrated ? "Calibrated model ready" : "Model ready · uncalibrated",
  };

  return (
    <section data-testid="multi-hazard-intelligence-panel" className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-200 bg-gradient-to-r from-[#0F4C81]/[0.06] via-cyan-50/70 to-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#0F4C81] text-white shadow-sm">
            <BrainCircuit className="size-5" />
          </span>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Spatio-temporal Multi-Hazard Intelligence</h2>
            <p className="mt-0.5 text-xs text-slate-600">Temporal Transformer → graph attention → flood, landslide, combined-risk and lead-time outputs.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${ready ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
            <span className={`size-1.5 rounded-full ${ready ? "bg-emerald-500" : "bg-amber-500"}`} />
            {isLoading ? "Checking model" : model.isError ? "Model service unavailable" : statusLabels[data?.status ?? ""] || "Model not ready"}
          </span>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={isFetching}
            className="inline-flex size-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-[#0F4C81] disabled:opacity-50"
            title="Refresh model status and predictions"
            aria-label="Refresh model status and predictions"
          >
            <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="grid gap-3 p-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="grid gap-2 sm:grid-cols-3">
          {sourceGroups.map(({ icon: Icon, label, detail }) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
              <Icon className="size-4 text-[#0F4C81]" />
              <p className="mt-2 text-[11px] font-bold text-slate-800">{label}</p>
              <p className="mt-0.5 text-[10px] text-slate-500">{detail}</p>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-800"><GitBranch className="size-3.5 text-cyan-700" /> Model details</div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
            <div><span className="block text-slate-500">Temporal context</span><strong className="font-mono text-slate-800">{data?.temporal_context_hours != null ? `${data.temporal_context_hours}h` : "—"}</strong></div>
            <div><span className="block text-slate-500">Forecast horizon</span><strong className="font-mono text-slate-800">{data?.forecast_horizon_hours != null ? `${data.forecast_horizon_hours}h` : "—"}</strong></div>
            <div><span className="block text-slate-500">GIS output</span><strong className="text-slate-800">GeoJSON</strong></div>
            <div><span className="block text-slate-500">Risk classes</span><strong className="text-slate-800">4 levels</strong></div>
          </div>
        </div>
      </div>

      {ready && (
        <div className="mx-4 mb-4 space-y-3" data-testid="multi-hazard-predictions">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
            <span>Model version: <strong className="font-mono text-slate-900">{data?.model_version || "—"}</strong></span>
            {timestamp && !heatmap.isError && (
              <span className={stale ? "font-semibold text-amber-800" : ""} title={timestamp}>
                {stale ? "Stale predictions" : "Latest inference"}: {new Date(timestamp).toLocaleString()}
                {ageMinutes !== null && Number.isFinite(ageMinutes) ? ` (${ageMinutes} min ago)` : ""}
              </span>
            )}
            {heatmap.isFetching && <span>Fetching predictions…</span>}
          </div>
          {features.length > 0 && (
            <>
              <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
                <table className="w-full whitespace-nowrap text-left text-xs">
                  <thead className="sticky top-0 bg-slate-100 text-[10px] text-slate-600">
                    <tr>{["Node", "Flood probability", "Landslide probability", "Combined risk", "Confidence", "Lead time", "Risk class"].map(label => <th key={label} className="px-3 py-2 font-semibold">{label}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {features.map(({ properties: node }, index) => (
                      <tr key={`${node.node_id}-${index}`}>
                        <td className="px-3 py-2 font-mono font-semibold text-slate-900">{node.node_id}</td>
                        <td className="px-3 py-2">{formatHazardProbability(node.flood_probability)}</td>
                        <td className="px-3 py-2">{formatHazardProbability(node.landslide_probability)}</td>
                        <td className="px-3 py-2">{formatHazardProbability(node.combined_risk)}</td>
                        <td className="px-3 py-2">{formatHazardProbability(node.confidence)}</td>
                        <td className="px-3 py-2">{formatHazardLeadTime(node.lead_time_minutes)}</td>
                        <td className="px-3 py-2"><span className="mr-1.5 inline-block size-2 rounded-full" style={{ backgroundColor: MULTI_HAZARD_COLORS[node.risk_class] }} />{node.risk_class}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-slate-500">{features.length} prediction location{features.length === 1 ? "" : "s"} in the selected area. Confidence is a calibrated estimate of prediction correctness; — means unavailable. Lead time is shown only when the model supports it.</p>
            </>
          )}
        </div>
      )}
      {message && (
        <div className="mx-4 mb-4 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-950">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-amber-700" />
          <span>{message}</span>
        </div>
      )}
    </section>
  );
}
