import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Clock3, X } from "lucide-react";
import { arrivalLabel, formatArrivalTime, type ArrivalForecastResult } from "./arrivalForecast";
import type { BuildingExposure } from "./buildingExposure";

export function HouseArrivalPanel({ buildings, elapsed, forecast, error, onRetry, selectedId, onSelect }: {
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  buildings: BuildingExposure[];
  elapsed: number;
  forecast: ArrivalForecastResult | null;
  error?: string | null;
  onRetry?: () => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (selectedId) setOpen(true); }, [selectedId]);
  const selected = useMemo(() => buildings.find(b => b.id === selectedId), [buildings, selectedId]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const deferredBuildings = useDeferredValue(buildings);
  const matches = useMemo(() => {
    if (!open) return [];
    const search = deferredQuery.trim().toLowerCase();
    return deferredBuildings.filter(building => !search || `${building.name} ${building.id} ${building.kind}`.toLowerCase().includes(search));
  }, [open, deferredBuildings, deferredQuery]);
  const lastPage = Math.max(0, Math.ceil(matches.length / 50) - 1);
  const currentPage = Math.min(page, lastPage);

  return <div className="absolute bottom-4 left-3 z-30 text-white">
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open}
      className="flex items-center gap-2 rounded-xl border border-cyan-600 bg-slate-950/95 px-3 py-3 text-xs shadow-xl">
      <Clock3 className="size-4 text-cyan-300" /> House arrival times · {buildings.length}
    </button>
    {open && <section aria-label="House arrival times" className="absolute bottom-14 left-0 flex max-h-[55vh] w-[min(26rem,calc(100vw-3rem))] flex-col rounded-xl border border-cyan-700 bg-slate-950/95 p-3 shadow-2xl">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Estimated water arrival</h2>
        <button type="button" aria-label="Close house arrival times" onClick={() => setOpen(false)} className="rounded p-1 hover:bg-slate-800"><X className="size-4" /></button>
      </div>
      <p className="mt-1 text-xs text-slate-400">Click a house to locate it in 3D. Time from simulation start to 10 cm of water. {forecast?.complete ? `Forecast covers ${formatArrivalTime(forecast.horizon)}.` : `Calculating in the background${forecast ? ` · checked ${formatArrivalTime(forecast.throughSeconds)}` : ""}…`}</p>
      {selected && <div className="mt-2 rounded border border-yellow-500/60 bg-yellow-950/20 p-2 text-xs" role="status">
        <strong>{selected.name}</strong> · {selected.id}
        <div className="mt-1 text-cyan-200">{arrivalLabel(selected, elapsed, forecast)}</div>
        <div className="mt-1 text-slate-300">Current water: {selected.currentDepthM.toFixed(2)} m · Peak: {selected.peakDepthM.toFixed(2)} m</div>
      </div>}
      {error && <div role="status" className="mt-2 text-xs text-amber-200">{error}
        <button type="button" onClick={onRetry} className="ml-2 rounded bg-cyan-700 px-2 py-1 text-white">Retry arrival calculation</button>
      </div>}
      <input aria-label="Search house arrivals" placeholder="Search building name or ID" value={query}
        onChange={event => { setQuery(event.target.value); setPage(0); }}
        className="my-3 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs" />
      <div className="min-h-0 overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-950 text-slate-400"><tr><th className="py-2 pr-2">Building</th><th className="py-2">Arrival / countdown</th></tr></thead>
          <tbody>{matches.slice(currentPage * 50, (currentPage + 1) * 50).map(building => <tr key={building.id} className="border-t border-slate-800">
            <td className="max-w-44 py-2 pr-2"><button type="button" onClick={() => onSelect?.(building.id)} aria-pressed={selectedId === building.id} className="max-w-44 truncate text-left text-cyan-200 underline hover:text-white" title={`Show ${building.name} in 3D`}>{building.name}</button><div className="text-[10px] text-slate-500">{building.id}</div></td>
            <td className="py-2 text-cyan-200">
              {building.arrivalSeconds === null && building.predictedArrivalSeconds !== null && <div>~{formatArrivalTime(building.predictedArrivalSeconds)} from start</div>}
              <div className="text-[11px]">{arrivalLabel(building, elapsed, forecast)}</div>
            </td>
          </tr>)}</tbody>
        </table>
        {!matches.length && <p className="py-4 text-xs text-slate-400">{buildings.length ? "No matching buildings." : "No building footprints loaded for this area."}</p>}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
        <button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="rounded px-2 py-1 hover:bg-slate-800 disabled:opacity-40">Previous</button>
        <span>{matches.length} buildings · {currentPage + 1}/{lastPage + 1}</span>
        <button disabled={currentPage >= lastPage} onClick={() => setPage(currentPage + 1)} className="rounded px-2 py-1 hover:bg-slate-800 disabled:opacity-40">Next</button>
      </div>
      <p className="mt-2 text-[10px] text-slate-500">Modeled estimates at the displayed terrain resolution. No arrival within this window does not mean no future flooding.</p>
    </section>}
  </div>;
}
