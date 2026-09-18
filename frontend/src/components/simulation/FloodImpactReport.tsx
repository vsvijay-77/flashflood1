import { useState } from "react";
import type { SimulationReportData } from "./simulationReport";
import { formatArrivalTime } from "./arrivalForecast";
import type { BuildingExposure } from "./buildingExposure";
import { downloadFloodReportPdf } from "@/lib/generateFloodReportPdf";

export function FloodImpactReport({ buildings, scenario, completedReport, saveStatus, onRetry, onDismiss }: {
  buildings: BuildingExposure[]; scenario: Record<string, unknown>; completedReport?: SimulationReportData;
  saveStatus?: string; onRetry?: () => void; onDismiss?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const affected = buildings.filter(building => building.affectedDuringRun);
  const assessed = buildings.filter(building => building.assessed).length;
  const homes = affected.filter(building => ["house", "residential", "apartments", "detached", "semidetached_house", "terrace"].includes(building.kind)).length;
  const download = () => {
    const blob = new Blob([JSON.stringify(completedReport ?? { generatedAt: new Date().toISOString(), disclaimer: "Experimental synthetic-trained model; simulated exposure, not observed damage or a calibrated forecast. Building use may be unknown. Peak values cover this run; settings are current and may have changed during the run.", method: "Maximum depth across terrain cells intersecting each loaded footprint; exposure threshold 0.10 m. No floor heights or structural vulnerability modeled.", scenario, summary: { loaded: buildings.length, assessed, affectedNow: buildings.filter(building => building.affectedNow).length, affectedDuringRun: affected.length, residentialAffectedDuringRun: homes }, buildings }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "experimental-flood-impact-report.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <>
    {!completedReport && <button type="button" onClick={() => setOpen(true)} className="absolute bottom-4 right-3 z-30 rounded-xl border border-cyan-500 bg-slate-950/95 px-4 py-3 text-sm text-white shadow-xl">Flood report · {assessed ? `${affected.length} exposed buildings` : "awaiting building coverage"}</button>}
    {(open || completedReport) && <div className="absolute inset-0 z-[110] flex items-center justify-center bg-slate-950/70 p-4">
      <section role="dialog" aria-modal="true" aria-label="Flood impact report" className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-cyan-700 bg-slate-950 p-5 text-white">
        <header className="flex items-center justify-between gap-4"><h2 className="text-lg font-semibold">{scenario.model === "gnn" ? "Experimental GNN" : "Physics"} flood impact report</h2><button autoFocus type="button" onClick={() => { setOpen(false); onDismiss?.(); }} className="rounded border border-slate-600 px-3 py-2">Close report</button></header>
        {completedReport && <div role="status" className="my-3 rounded bg-slate-800 p-3 text-sm">
          Simulation ended · {saveStatus}
          {saveStatus?.startsWith("Save failed") && <button type="button" onClick={onRetry} className="ml-3 rounded bg-cyan-700 px-3 py-2">Retry save</button>}
        </div>}
        <div className="min-h-0 overflow-auto">
          <p className="my-3 text-sm text-amber-200">Experimental simulation—not a calibrated forecast or a damage assessment.</p>
          <p className="text-sm">{assessed} / {buildings.length} loaded buildings assessed · {buildings.filter(building => building.affectedNow).length} exposed now · {affected.length} exposed during this run · {homes} tagged residential.</p>
          <p className="my-3 text-xs text-slate-400">Exposure means ≥0.10 m simulated water in a terrain cell intersecting a footprint. Coarse terrain cells can overestimate exposure. Unknown building types are not counted as houses. Unassessed buildings are outside the sampled cells or have unusable geometry. Missing map buildings are not included. Floor levels and structural damage are not modeled.</p>
          <div className="my-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            {[["Elapsed", `${Number(scenario.elapsedSeconds).toFixed(1)} s`], ["Rainfall", `${scenario.rainfallMmH} mm/h`], ["Maximum depth", `${Number(scenario.maxDepthM).toFixed(2)} m`], ["Flood extent", `${Number(scenario.floodedAreaHectares).toFixed(2)} ha`], ["Floodwater", `${Number(scenario.waterVolumeM3).toFixed(1)} m³`], ["Terrain grid", String(scenario.grid)]].map(([label, value]) => <div key={label} className="rounded bg-slate-900 p-3"><div className="text-slate-400">{label}</div><div className="mt-1 text-cyan-200">{value}</div></div>)}
          </div>
          <p className="mb-3 text-xs text-slate-400">Current settings may have changed during this run. Download includes all current parameters and the selected area. Peak depths and first arrivals are recorded at every solver substep.</p>
          {!buildings.length && <p className="py-3">No building footprints loaded yet. Coverage is unknown, not zero risk.</p>}
          <table className="w-full text-left text-xs"><thead><tr className="border-b border-slate-600"><th className="py-2">Building / use</th><th>Current depth</th><th>Peak depth</th><th>Arrival (simulation time)</th><th>Exposure</th></tr></thead><tbody>
            {[...buildings].sort((first, second) => second.peakDepthM - first.peakDepthM).slice(0, 200).map(building => <tr key={building.id} className="border-b border-slate-800"><td className="py-2">{building.name}<div className="text-slate-400">{building.kind}</div></td><td>{building.assessed ? `${building.currentDepthM.toFixed(2)} m` : "—"}</td><td>{building.assessed ? `${building.peakDepthM.toFixed(2)} m` : "—"}</td><td>{building.arrivalSeconds != null ? `Reached ${formatArrivalTime(building.arrivalSeconds)}` : building.predictedArrivalSeconds != null ? `Estimated ${formatArrivalTime(building.predictedArrivalSeconds)}` : "Not recorded"}</td><td>{!building.assessed ? "Unassessed" : building.affectedNow ? "Exposed now" : building.affectedDuringRun ? "Previously exposed" : "Below threshold"}</td></tr>)}
          </tbody></table>
          {buildings.length > 200 && <p className="mt-2 text-xs">Showing the 200 highest peak depths. Download includes every loaded building.</p>}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            data-testid="download-pdf-btn"
            onClick={() =>
              downloadFloodReportPdf({
                areaName: (scenario.areaName as string) || "Monitored Catchment Basin",
                centerLat: scenario.centerLat as number,
                centerLng: scenario.centerLng as number,
                scenario,
                buildings,
              })
            }
            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-bold px-4 py-2 text-xs shadow-md transition-all cursor-pointer"
          >
            <span>Download PDF Report</span>
          </button>
          <button type="button" onClick={download} className="rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-300 px-4 py-2 text-xs transition-colors cursor-pointer">Download full report (JSON)</button>
        </div>
      </section>
    </div>}
  </>;
}
