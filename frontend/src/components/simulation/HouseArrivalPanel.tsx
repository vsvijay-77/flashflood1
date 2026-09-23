import { useMemo, useState } from "react";
import { Clock3, X, Eye } from "lucide-react";
import { arrivalLabel, formatArrivalTime, type ArrivalForecastResult } from "./arrivalForecast";
import type { BuildingExposure } from "./buildingExposure";

export function getHouseDisplayArrival(building: BuildingExposure, elapsed: number, forecast: ArrivalForecastResult | null): string {
  const lbl = arrivalLabel(building, elapsed, forecast);
  if (!lbl.includes("unassessed") && !lbl.includes("calculating")) {
    return lbl;
  }
  if (building.distanceToRiverM && building.distanceToRiverM > 0) {
    const estSec = Math.max(15, Math.round(building.distanceToRiverM / 1.8));
    return `Flood in ~${formatArrivalTime(estSec)}`;
  }
  return lbl;
}

export function HouseArrivalPanel({
  buildings,
  elapsed,
  forecast,
  error,
  onRetry,
  onSelectBuilding,
}: {
  buildings: BuildingExposure[];
  elapsed: number;
  forecast: ArrivalForecastResult | null;
  error?: string | null;
  onRetry?: () => void;
  onSelectBuilding?: (building: BuildingExposure) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const matches = useMemo(() => {
    if (!open) return [];
    const search = query.trim().toLowerCase();
    return buildings
      .filter(building => !search || `${building.name} ${building.id} ${building.kind}`.toLowerCase().includes(search))
      .sort((a, b) => {
        const timeA = a.arrivalSeconds ?? a.predictedArrivalSeconds ?? (a.distanceToRiverM ? Math.round(a.distanceToRiverM / 1.8) : Infinity);
        const timeB = b.arrivalSeconds ?? b.predictedArrivalSeconds ?? (b.distanceToRiverM ? Math.round(b.distanceToRiverM / 1.8) : Infinity);
        return timeA - timeB;
      });
  }, [open, buildings, query]);

  const lastPage = Math.max(0, Math.ceil(matches.length / 50) - 1);
  const currentPage = Math.min(page, lastPage);

  return (
    <div className="absolute bottom-4 left-3 z-30 text-white">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-xl border border-cyan-600 bg-slate-950/95 px-3 py-3 text-xs shadow-xl hover:border-cyan-400 transition-colors cursor-pointer"
      >
        <Clock3 className="size-4 text-cyan-300" /> House arrival times · {buildings.length}
      </button>

      {open && (
        <section
          aria-label="House arrival times"
          className="absolute bottom-14 left-0 flex max-h-[58vh] w-[min(28rem,calc(100vw-3rem))] flex-col rounded-xl border border-cyan-700 bg-slate-950/95 p-3 shadow-2xl backdrop-blur-md"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <div>
              <h2 className="text-sm font-semibold text-white flex items-center gap-1.5">
                <Clock3 className="size-4 text-cyan-400" /> Estimated water arrival
              </h2>
              <div className="text-[10px] text-cyan-300/80 font-mono mt-0.5">Click any house to view on map</div>
            </div>
            <button
              type="button"
              aria-label="Close house arrival times"
              onClick={() => setOpen(false)}
              className="rounded p-1 hover:bg-slate-800 transition-colors text-slate-400 hover:text-white"
            >
              <X className="size-4" />
            </button>
          </div>

          <p className="mt-2 text-xs text-slate-400">
            Time from start to 10 cm inundation. {forecast?.complete ? `Forecast horizon: ${formatArrivalTime(forecast.horizon)}.` : "Computing dynamic forecast in background…"}
          </p>

          {error && (
            <div role="status" className="mt-2 text-xs text-amber-200 bg-amber-950/40 border border-amber-800/60 p-2 rounded">
              {error}
              <button
                type="button"
                onClick={onRetry}
                className="ml-2 rounded bg-cyan-700 px-2 py-1 text-white hover:bg-cyan-600 cursor-pointer"
              >
                Retry calculation
              </button>
            </div>
          )}

          <input
            aria-label="Search house arrivals"
            placeholder="Search house name or ID…"
            value={query}
            onChange={event => {
              setQuery(event.target.value);
              setPage(0);
            }}
            className="my-2.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />

          <div className="min-h-0 overflow-y-auto pr-1">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2 pr-2">House</th>
                  <th className="py-2">Arrival / Countdown</th>
                </tr>
              </thead>
              <tbody>
                {matches.slice(currentPage * 50, (currentPage + 1) * 50).map(building => {
                  const arrivalText = getHouseDisplayArrival(building, elapsed, forecast);
                  const isFlooded = building.arrivalSeconds !== null;
                  const isIncoming = building.predictedArrivalSeconds !== null && building.predictedArrivalSeconds > elapsed;

                  return (
                    <tr
                      key={building.id}
                      onClick={() => onSelectBuilding?.(building)}
                      className="border-t border-slate-800/80 hover:bg-cyan-950/50 cursor-pointer transition-colors group"
                      title={`Click to view ${building.name} on map`}
                    >
                      <td className="max-w-44 py-2 pr-2">
                        <div className="truncate font-medium text-slate-200 group-hover:text-cyan-300 transition-colors" title={building.name}>
                          {building.name}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono flex items-center gap-1.5">
                          <span>{building.id}</span>
                          {building.distanceToRiverM && (
                            <span className="text-slate-600">· {Math.round(building.distanceToRiverM)}m to water</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 text-cyan-200">
                        {building.arrivalSeconds === null && building.predictedArrivalSeconds !== null && (
                          <div className="text-[10px] text-slate-400">~{formatArrivalTime(building.predictedArrivalSeconds)} from start</div>
                        )}
                        <div className="text-[11px] font-semibold flex items-center justify-between gap-1">
                          <span className={isFlooded ? "text-rose-400 font-bold" : isIncoming ? "text-amber-300 font-bold" : "text-cyan-300"}>
                            {arrivalText}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[9px] text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity bg-cyan-950 px-1.5 py-0.5 rounded border border-cyan-800">
                            <Eye className="size-2.5" /> View
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {!matches.length && (
              <p className="py-4 text-xs text-slate-400 text-center">
                {buildings.length ? "No matching buildings." : "No building footprints loaded for this area."}
              </p>
            )}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-slate-800 pt-2 text-xs text-slate-400">
            <button
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
              className="rounded px-2 py-1 hover:bg-slate-800 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span>{matches.length} buildings · {currentPage + 1}/{lastPage + 1}</span>
            <button
              disabled={currentPage >= lastPage}
              onClick={() => setPage(currentPage + 1)}
              className="rounded px-2 py-1 hover:bg-slate-800 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
