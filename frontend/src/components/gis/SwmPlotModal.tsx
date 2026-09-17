import { useMemo, useState } from "react";
import { X, BarChart2, CloudRain, Waves, Mountain, Activity, Info } from "lucide-react";

interface SwmPlotProps {
  onClose: () => void;
  activeHorizon: "1d" | "2d" | "3d" | "4d" | "5d" | "6d" | "7d";
}

interface SwarmPoint {
  id: string;
  category: "rain" | "flood" | "landslide" | "saturation";
  value: number; // 0 - 100 scale
  rawText: string;
  hour: string;
  severity: "low" | "moderate" | "high" | "critical";
  xJitter: number; // offset in pixels (-25 to +25)
}

export default function SwmPlotModal({ onClose, activeHorizon }: SwmPlotProps) {
  const [selectedPoint, setSelectedPoint] = useState<SwarmPoint | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("all");

  // Generate deterministic forecast swarm data points across the horizon
  const points = useMemo<SwarmPoint[]>(() => {
    const horizonMultiplier =
      activeHorizon === "1d" ? 1.0 :
      activeHorizon === "2d" ? 1.4 :
      activeHorizon === "3d" ? 2.1 :
      activeHorizon === "4d" ? 2.6 :
      activeHorizon === "5d" ? 1.2 :
      activeHorizon === "6d" ? 0.6 : 0.3;

    const data: SwarmPoint[] = [];

    // 24 timeline hourly intervals
    for (let h = 0; h < 24; h++) {
      const hourStr = `+${h}h (${(h % 12 || 12)}:00 ${h >= 12 ? "PM" : "AM"})`;

      // 1. Rain (0 - 100 mm/h normalized)
      const baseRain = Math.max(0, (14 + 18 * Math.sin(h / 3.2) + (h > 8 && h < 18 ? 25 : 0)) * horizonMultiplier);
      const rainVal = Math.min(100, Number(baseRain.toFixed(1)));
      data.push({
        id: `rain-${h}`,
        category: "rain",
        value: rainVal,
        rawText: `${rainVal} mm/h`,
        hour: hourStr,
        severity: rainVal > 50 ? "critical" : rainVal > 25 ? "high" : rainVal > 10 ? "moderate" : "low",
        xJitter: ((h % 5) - 2) * 9 + (h % 2 === 0 ? 3 : -3),
      });

      // 2. Flood Risk (0 - 100%)
      const baseFlood = Math.min(100, Math.max(5, (rainVal * 0.85 + (h > 10 ? (h - 10) * 2.5 : 0))));
      data.push({
        id: `flood-${h}`,
        category: "flood",
        value: baseFlood,
        rawText: `${baseFlood.toFixed(0)}% Inundation`,
        hour: hourStr,
        severity: baseFlood > 75 ? "critical" : baseFlood > 50 ? "high" : baseFlood > 25 ? "moderate" : "low",
        xJitter: (((h * 3) % 5) - 2) * 8 + (h % 3 === 0 ? -4 : 4),
      });

      // 3. Landslide Hazard (0 - 100%)
      const baseLandslide = Math.min(100, Math.max(0, (rainVal * 0.72 + (h > 6 ? 15 : 0))));
      data.push({
        id: `landslide-${h}`,
        category: "landslide",
        value: baseLandslide,
        rawText: `FoS ${(2.0 - baseLandslide / 85).toFixed(2)} (${baseLandslide.toFixed(0)}%)`,
        hour: hourStr,
        severity: baseLandslide > 70 ? "critical" : baseLandslide > 45 ? "high" : baseLandslide > 20 ? "moderate" : "low",
        xJitter: (((h * 7) % 5) - 2) * 8.5 + (h % 2 === 0 ? -2 : 2),
      });

      // 4. Soil Saturation (0 - 100%)
      const baseSat = Math.min(100, Math.max(30, 45 + rainVal * 0.5 + h * 1.2));
      data.push({
        id: `sat-${h}`,
        category: "saturation",
        value: baseSat,
        rawText: `${baseSat.toFixed(0)}% Saturation`,
        hour: hourStr,
        severity: baseSat > 85 ? "critical" : baseSat > 70 ? "high" : baseSat > 50 ? "moderate" : "low",
        xJitter: (((h * 2) % 5) - 2) * 8,
      });
    }

    return data;
  }, [activeHorizon]);

  const categories = [
    { key: "rain", label: "Precipitation", icon: CloudRain, color: "text-cyan-400", bg: "bg-cyan-500", border: "border-cyan-400" },
    { key: "flood", label: "Flood Risk", icon: Waves, color: "text-blue-400", bg: "bg-blue-500", border: "border-blue-400" },
    { key: "landslide", label: "Landslide", icon: Mountain, color: "text-amber-400", bg: "bg-amber-500", border: "border-amber-400" },
    { key: "saturation", label: "Soil Moisture", icon: Activity, color: "text-emerald-400", bg: "bg-emerald-500", border: "border-emerald-400" },
  ] as const;

  const filteredPoints = useMemo(() => {
    if (activeCategory === "all") return points;
    return points.filter((p) => p.category === activeCategory);
  }, [points, activeCategory]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-2xl border border-cyan-500/60 bg-slate-950 p-5 text-white shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-cyan-950 text-cyan-400 border border-cyan-800">
              <BarChart2 className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-100">
                  Swarm Plot (SwmPlot) — Multi-Hazard Distribution
                </h3>
                <span className="rounded-md bg-cyan-950 px-2 py-0.5 text-[10px] font-bold text-cyan-300 border border-cyan-800">
                  {activeHorizon} Horizon
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Non-overlapping categorical scatter distribution of Rain, Flood, Landslide, and Saturation points.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            data-testid="close-swmplot-modal"
            title="Close Swarm Plot"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setActiveCategory("all")}
              className={`px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                activeCategory === "all"
                  ? "bg-cyan-500 text-slate-950"
                  : "bg-slate-900 text-slate-400 hover:text-white border border-slate-800"
              }`}
            >
              All Hazards (4x24)
            </button>
            {categories.map((c) => (
              <button
                key={c.key}
                onClick={() => setActiveCategory(c.key)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                  activeCategory === c.key
                    ? "bg-slate-800 text-white border border-cyan-500/50"
                    : "bg-slate-900 text-slate-400 hover:text-white border border-slate-800"
                }`}
              >
                <c.icon className={`size-3 ${c.color}`} />
                <span>{c.label}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-emerald-500" /> Low</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-amber-500" /> Moderate</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-orange-500" /> High</span>
            <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-red-500 animate-pulse" /> Critical</span>
          </div>
        </div>

        {/* Swarm Plot Canvas Area */}
        <div className="relative h-72 w-full rounded-xl border border-slate-800 bg-slate-900/90 p-4">
          {/* Y Axis Grid lines */}
          <div className="absolute inset-x-12 inset-y-4 flex flex-col justify-between pointer-events-none opacity-30 text-[10px] font-mono text-slate-400">
            <div className="border-b border-slate-700 w-full flex justify-between"><span>100% / Severe</span></div>
            <div className="border-b border-slate-700 w-full flex justify-between"><span>75% / High</span></div>
            <div className="border-b border-slate-700 w-full flex justify-between"><span>50% / Moderate</span></div>
            <div className="border-b border-slate-700 w-full flex justify-between"><span>25% / Low</span></div>
            <div className="border-b border-slate-700 w-full flex justify-between"><span>0% / Baseline</span></div>
          </div>

          {/* 4 Categorical Columns */}
          <div className="relative h-full grid grid-cols-4 px-8">
            {categories.map((cat) => {
              const catPoints = filteredPoints.filter((p) => p.category === cat.key);
              return (
                <div key={cat.key} className="relative h-full flex flex-col items-center">
                  {/* Category Axis Line */}
                  <div className="absolute inset-y-0 w-0.5 bg-slate-800/80 pointer-events-none" />

                  {/* Points Swarm */}
                  <div className="relative w-full h-full">
                    {catPoints.map((p) => {
                      // Y coordinate: 0 at bottom, 100 at top
                      const bottomPct = Math.max(4, Math.min(96, p.value));
                      const isHovered = selectedPoint?.id === p.id;
                      const dotColor =
                        p.severity === "critical" ? "bg-red-500 ring-red-300" :
                        p.severity === "high" ? "bg-orange-500 ring-orange-300" :
                        p.severity === "moderate" ? "bg-amber-500 ring-amber-300" :
                        "bg-emerald-500 ring-emerald-300";

                      return (
                        <div
                          key={p.id}
                          style={{
                            bottom: `${bottomPct}%`,
                            left: `calc(50% + ${p.xJitter}px)`,
                          }}
                          onMouseEnter={() => setSelectedPoint(p)}
                          onClick={() => setSelectedPoint(p)}
                          className={`absolute -translate-x-1/2 -translate-y-1/2 size-3 rounded-full cursor-pointer transition-all duration-100 ${dotColor} ${
                            isHovered ? "scale-175 ring-4 z-30" : "hover:scale-150 ring-1 opacity-90"
                          }`}
                        />
                      );
                    })}
                  </div>

                  {/* Column Header at bottom */}
                  <div className="mt-1 text-center font-semibold text-[11px] text-slate-300 flex items-center gap-1">
                    <cat.icon className={`size-3 ${cat.color}`} />
                    <span>{cat.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected Point Inspector */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs flex items-center justify-between">
          {selectedPoint ? (
            <div className="flex items-center gap-3">
              <span
                className={`size-3 rounded-full ${
                  selectedPoint.severity === "critical" ? "bg-red-500" :
                  selectedPoint.severity === "high" ? "bg-orange-500" :
                  selectedPoint.severity === "moderate" ? "bg-amber-500" : "bg-emerald-500"
                }`}
              />
              <span className="font-bold text-white uppercase tracking-wider text-[11px]">
                {selectedPoint.category} Point:
              </span>
              <span className="font-mono text-cyan-300 font-bold">{selectedPoint.rawText}</span>
              <span className="text-slate-400">• Time Offset: {selectedPoint.hour}</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-800 text-slate-300">
                {selectedPoint.severity} severity
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-slate-400 text-xs">
              <Info className="size-4 text-cyan-400" />
              <span>Hover or click any swarm point to inspect exact hourly forecast metrics and hazard severity.</span>
            </div>
          )}

          <button
            onClick={onClose}
            className="px-3 py-1 rounded-md text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-slate-950 transition-colors cursor-pointer"
          >
            Close Plot
          </button>
        </div>
      </div>
    </div>
  );
}
